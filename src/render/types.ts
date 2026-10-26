export type BackendType = 'webgpu' | 'webgl2';

/** Point attribute used for colouring. */
export enum Channel {
  Height = 0,
  Intensity = 1,
  Age = 2,
}

/** Points are stored as 4 float32 values (16 bytes): x, y, z, intensity. */
export const POINT_FLOATS = 4;
export const POINT_BYTES = POINT_FLOATS * 4;

export interface FrameUniforms {
  /** Column-major view-projection in WebGL clip space (z in -1..1). */
  viewProjection: Float32Array;
  cameraRight: [number, number, number];
  cameraUp: [number, number, number];
  /** World-space billboard radius in metres. */
  pointSize: number;
  currentTime: number;
  trailDuration: number;
  channel: Channel;
}

/** A contiguous run of points from one sweep, drawn as one instanced call. */
export interface DrawRange {
  first: number;
  count: number;
  time: number;
}

export type UploadPath = 'writeBuffer' | 'staging' | 'texSubImage2D';
export type TimerState = 'on' | 'off' | 'unavailable';

export interface BackingOptions {
  /** Measure GPU time with timestamp / timer queries (adds a little CPU work per frame). */
  timers: boolean;
  /** WebGPU only: queue.writeBuffer, or mapped staging buffers copied on the GPU. */
  upload: 'writeBuffer' | 'staging';
}

/** Cumulative counters; consumers sample them and diff over an interval. */
export interface BackingStats {
  /** Bytes currently allocated for point storage. */
  allocatedBytes: number;
  uploadCalls: number;
  uploadedBytes: number;
  /** CPU time spent inside uploadPoints (driver/queue copy, not GPU completion). */
  uploadMs: number;
  uploadPath: UploadPath;
  /** Whether GPU time is measured: disabled by option, or not supported by the browser. */
  gpuTimer: TimerState;
  /** Sum and count of resolved GPU frame timings; results arrive a few frames late. */
  gpuMs: number;
  gpuSamples: number;
}

export const emptyStats = (uploadPath: UploadPath, gpuTimer: TimerState): BackingStats => ({
  allocatedBytes: 0,
  uploadPath,
  uploadCalls: 0,
  uploadedBytes: 0,
  uploadMs: 0,
  gpuTimer,
  gpuMs: 0,
  gpuSamples: 0,
});

/** GPU storage and drawing for point data; implemented once per graphics API. */
export interface PointCloudBacking {
  readonly backendType: BackendType;
  readonly capacityPoints: number;
  readonly stats: BackingStats;
  allocate(maxPoints: number): void;
  uploadPoints(pointOffset: number, data: Float32Array): void;
  resize(width: number, height: number): void;
  /** Clears the target and draws the ranges in order, so later ranges blend on top. */
  render(uniforms: FrameUniforms, ranges: DrawRange[]): void;
  dispose(): void;
}
