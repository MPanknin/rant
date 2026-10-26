import { CLEAR_COLOR, SHADING_WGSL } from './shading';
import { POINT_BYTES, emptyStats, type BackingOptions, type BackingStats, type DrawRange, type FrameUniforms, type PointCloudBacking } from './types';

// Points live in one storage buffer indexed by instance_index; each range passes its offset as
// firstInstance. Per-draw values (sweep time) sit in a uniform buffer bound with a dynamic offset.
const SHADER = /* wgsl */ `
struct Frame {
  viewProj: mat4x4<f32>,
  camRight: vec4<f32>,  // xyz = right, w = point size
  camUp: vec4<f32>,     // xyz = up, w = current time
  params: vec4<f32>,    // x = trail duration, y = channel
};
struct Draw { sweepTime: f32 };

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> points: array<vec4<f32>>;
@group(1) @binding(0) var<uniform> draw: Draw;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) alpha: f32,
  @location(2) color: vec3<f32>,
};

const QUAD = array<vec2<f32>, 4>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
${SHADING_WGSL}

@vertex
fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VertexOut {
  let pt = points[i];
  let age = 1.0 - (frame.camUp.w - draw.sweepTime) / max(frame.params.x, 0.0001);
  let uv = QUAD[v];
  let world = pt.xyz + (frame.camRight.xyz * uv.x + frame.camUp.xyz * uv.y) * frame.camRight.w;
  var out: VertexOut;
  out.position = frame.viewProj * vec4<f32>(world, 1.0);
  out.uv = uv;
  out.alpha = clamp(age, 0.0, 1.0);
  out.color = shade(pt, out.alpha, i32(frame.params.y));
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let a = (1.0 - r2 * 0.65) * in.alpha;
  return vec4<f32>(in.color * a, a);
}`;

// Three.js projections target WebGL clip space; WebGPU wants z in 0..1, so remap z' = (z + w) / 2.
const Z_REMAP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 1];
const FRAME_FLOATS = 28;
/** Mapped staging buffers kept for reuse; extras created during bulk uploads are released. */
const STAGING_POOL = 4;
/** Staging sizes round up to whole MiB, so sweeps of slightly different size share buffers. */
const STAGING_ALIGN = 1 << 20;

export class WebGPUSSBOBacking implements PointCloudBacking {
  readonly backendType = 'webgpu';
  capacityPoints = 0;
  readonly stats: BackingStats;
  private readonly pipeline: GPURenderPipeline;
  private readonly frameLayout: GPUBindGroupLayout;
  private readonly drawLayout: GPUBindGroupLayout;
  private readonly frameBuffer: GPUBuffer;
  private readonly frameData = new Float32Array(FRAME_FLOATS);
  private readonly drawStride: number;
  private drawBuffer?: GPUBuffer;
  private drawBindGroup?: GPUBindGroup;
  private drawData = new Float32Array(0);
  private drawCapacity = 0;
  private pointBuffer?: GPUBuffer;
  private frameBindGroup?: GPUBindGroup;
  private readonly timer?: { querySet: GPUQuerySet; resolve: GPUBuffer; readback: GPUBuffer };
  private timerPending = false;
  /** Mapped staging buffers ready for writing (staging upload path only). */
  private readonly staging: GPUBuffer[] = [];

  /**
   * Requests the adapter's real buffer limits (the defaults cap a storage binding at 128 MB)
   * and timestamp queries when available.
   */
  static async create(canvas: HTMLCanvasElement, options: BackingOptions): Promise<WebGPUSSBOBacking> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
    const requiredFeatures: GPUFeatureName[] = options.timers && adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits: { maxStorageBufferBindingSize, maxBufferSize } });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas context unavailable');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new WebGPUSSBOBacking(device, context, format, options);
  }

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    private readonly options: BackingOptions,
  ) {
    this.drawStride = device.limits.minUniformBufferOffsetAlignment;
    this.frameLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.drawLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }],
    });
    const module = device.createShaderModule({ code: SHADER });
    const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.frameLayout, this.drawLayout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format, blend: { color: blend, alpha: blend } }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.frameBuffer = device.createBuffer({ size: this.frameData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    if (device.features.has('timestamp-query')) {
      this.timer = {
        querySet: device.createQuerySet({ type: 'timestamp', count: 2 }),
        resolve: device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        readback: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      };
    }
    this.stats = emptyStats(options.upload, !options.timers ? 'off' : this.timer ? 'on' : 'unavailable');
  }

  allocate(maxPoints: number): void {
    this.pointBuffer?.destroy();
    this.capacityPoints = maxPoints;
    this.stats.allocatedBytes = maxPoints * POINT_BYTES;
    this.pointBuffer = this.device.createBuffer({ size: maxPoints * POINT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.frameBindGroup = this.device.createBindGroup({
      layout: this.frameLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.pointBuffer } },
      ],
    });
  }

  uploadPoints(pointOffset: number, data: Float32Array): void {
    const start = performance.now();
    if (this.options.upload === 'staging') this.uploadViaStaging(pointOffset * POINT_BYTES, data);
    else this.device.queue.writeBuffer(this.pointBuffer!, pointOffset * POINT_BYTES, data.buffer, data.byteOffset, data.byteLength);
    this.stats.uploadMs += performance.now() - start;
    this.stats.uploadCalls++;
    this.stats.uploadedBytes += data.byteLength;
  }

  resize(): void {
    // The context follows canvas.width/height on the next getCurrentTexture().
  }

  render(u: FrameUniforms, ranges: DrawRange[]): void {
    // Only one readback in flight: frames rendered while it is mapped go untimed
    const timed = this.timer && !this.timerPending ? this.timer : undefined;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      timestampWrites: timed && { querySet: timed.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: CLEAR_COLOR[0], g: CLEAR_COLOR[1], b: CLEAR_COLOR[2], a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (this.frameBindGroup && ranges.length > 0) {
      this.writeFrame(u);
      this.writeDraws(ranges);
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.frameBindGroup);
      ranges.forEach((range, k) => {
        pass.setBindGroup(1, this.drawBindGroup!, [k * this.drawStride]);
        pass.draw(4, range.count, 0, range.first);
      });
    }
    pass.end();
    if (timed) {
      encoder.resolveQuerySet(timed.querySet, 0, 2, timed.resolve, 0);
      encoder.copyBufferToBuffer(timed.resolve, 0, timed.readback, 0, 16);
    }
    this.device.queue.submit([encoder.finish()]);
    if (timed) this.readTimestamps(timed.readback);
  }

  dispose(): void {
    for (const buffer of this.staging) buffer.destroy();
    this.pointBuffer?.destroy();
    this.drawBuffer?.destroy();
    this.frameBuffer.destroy();
    this.device.destroy();
  }

  /**
   * Writes into an already-mapped staging buffer (memory the browser shares with the GPU process),
   * then copies it into the point store on the GPU timeline. The buffer is re-mapped asynchronously
   * and returns to the pool; a new one is created (mapped at creation) when none is ready.
   */
  private uploadViaStaging(byteOffset: number, data: Float32Array): void {
    const index = this.staging.findIndex((b) => b.size >= data.byteLength);
    const buffer =
      index >= 0
        ? this.staging.splice(index, 1)[0]
        : this.device.createBuffer({ size: Math.ceil(data.byteLength / STAGING_ALIGN) * STAGING_ALIGN, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    new Float32Array(buffer.getMappedRange(0, data.byteLength)).set(data);
    buffer.unmap();
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, this.pointBuffer!, byteOffset, data.byteLength);
    this.device.queue.submit([encoder.finish()]);
    buffer
      .mapAsync(GPUMapMode.WRITE)
      .then(() => {
        if (this.staging.length < STAGING_POOL) this.staging.push(buffer);
        else buffer.destroy();
      })
      .catch(() => {}); // device destroyed on backend switch
  }

  private readTimestamps(readback: GPUBuffer): void {
    this.timerPending = true;
    readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const [begin, end] = new BigUint64Array(readback.getMappedRange());
        readback.unmap();
        const ns = Number(end - begin);
        if (ns > 0) {
          this.stats.gpuMs += ns / 1e6;
          this.stats.gpuSamples++;
        }
      })
      .catch(() => {}) // device destroyed on backend switch
      .finally(() => (this.timerPending = false));
  }

  private writeFrame(u: FrameUniforms): void {
    const d = this.frameData;
    const m = u.viewProjection;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += Z_REMAP[k * 4 + r] * m[c * 4 + k];
        d[c * 4 + r] = sum;
      }
    }
    d.set([...u.cameraRight, u.pointSize], 16);
    d.set([...u.cameraUp, u.currentTime], 20);
    d.set([u.trailDuration, u.channel, 0, 0], 24);
    this.device.queue.writeBuffer(this.frameBuffer, 0, d);
  }

  private writeDraws(ranges: DrawRange[]): void {
    if (ranges.length > this.drawCapacity) {
      this.drawCapacity = Math.max(ranges.length, this.drawCapacity * 2, 16);
      this.drawBuffer?.destroy();
      this.drawBuffer = this.device.createBuffer({ size: this.drawCapacity * this.drawStride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.drawBindGroup = this.device.createBindGroup({
        layout: this.drawLayout,
        entries: [{ binding: 0, resource: { buffer: this.drawBuffer, size: 16 } }],
      });
      this.drawData = new Float32Array((this.drawCapacity * this.drawStride) / 4);
    }
    const floatsPerDraw = this.drawStride / 4;
    ranges.forEach((range, k) => (this.drawData[k * floatsPerDraw] = range.time));
    this.device.queue.writeBuffer(this.drawBuffer!, 0, this.drawData, 0, ranges.length * floatsPerDraw);
  }
}
