# Rant

A small study of how to keep large, time-varying point data GPU-resident behind one API-agnostic interface, with a WebGPU and a WebGL2 backing that can be swapped at runtime. LiDAR sweep playback is the test workload: about 124k points per sweep at 10 Hz, streamed, scrubbed and accumulated over time.

## The idea: one point store instead of vertex buffers

The usual approach gives each chunk of points (here, each sweep) its own vertex buffer with an attribute layout, drawn as `POINTS`. Rant uses vertex pulling instead:

- **One allocation per backing**, holding flat 16-byte records (`x, y, z, intensity`). No per-sweep buffers, VAOs or attribute layouts.
- **Points are fetched by index** in the vertex shader. Each point is one instance of a 4-vertex quad generated in the shader, so the expanded geometry is never stored.
- **Sweeps are just offsets.** Uploading writes a sub-range, evicting frees a slot for reuse, and nothing is reallocated while streaming.
- **Time is a range selection.** A trail is the set of resident slots whose sweeps fall in `[t − trail, t]`. Playback and trail length only change which ranges get drawn; data already resident is never copied or reshaped.
- **The same record layout works on both APIs.** WebGPU uses a storage buffer. WebGL2 has none, so an `RGBA32F` texture stands in, read with `texelFetch`.

## Abstractions

```
SweepStream ──sync()──▶ PointCloudTimeline ──render(ranges)──▶ PointCloudBacking
 (CPU window)            (slots, time window)                   ├─ WebGPUSSBOBacking
                                                                └─ WebGL2TextureBacking
```

**`PointCloudBacking`** (`src/render/types.ts`) is the only API-specific layer: a flat point store that can draw ranges of itself.

```ts
interface PointCloudBacking {
  allocate(maxPoints: number): void;
  uploadPoints(pointOffset: number, data: Float32Array): void;
  render(uniforms: FrameUniforms, ranges: DrawRange[]): void; // DrawRange = { first, count, time }
  resize(width: number, height: number): void;
  dispose(): void;
}
```

| | `WebGPUSSBOBacking` | `WebGL2TextureBacking` |
|---|---|---|
| Store | storage buffer, `array<vec4<f32>>` | 4096-wide `RGBA32F` texture |
| Fetch | `points[instance_index]` | `texelFetch(ivec2(idx & 4095, idx >> 12))` |
| Range offset | `firstInstance` of `draw()` | `u_first` uniform per draw |
| Per-range data | uniform buffer, dynamic offset per draw | `u_sweepTime` uniform per draw |
| Upload | `queue.writeBuffer` at a byte offset | `texSubImage2D`, split into partial and whole rows |
| Capacity | adapter's `maxStorageBufferBindingSize` | `MAX_TEXTURE_SIZE` rows × 4096 points |

Shading is shared, written once in GLSL and once in WGSL (`src/render/shading.ts`).

**`PointCloudTimeline`** (`src/render/timeline.ts`) is API-agnostic. It divides the store into equal slots, one sweep each, sized in multiples of 4096 points so WebGL2 uploads can write whole texture rows. `sync()` mirrors a set of CPU-side sweeps onto the GPU, and `render()` turns the time window into draw ranges. `setBacking()` moves everything to another backing by re-uploading the resident slots, which is what the runtime toggle uses. Slots grow if a sweep outgrows them.

**`createSurface`** (`src/render/create.ts`) creates a backing on a fresh canvas, falling back from WebGPU to WebGL2. A canvas can only hold one context type, so each attempt needs a new one.

## Metrics

The panel in the top right shows half-second averages, so the two backings can be compared on the same data and camera:

| Metric | Source | Caveat |
|---|---|---|
| GPU | WebGPU `timestamp-query` around the render pass; WebGL2 `EXT_disjoint_timer_query_webgl2` around clear + draws | Optional browser features (shows "n/a" without them); results arrive a few frames late, and WebGPU timestamps may be quantised by the browser |
| CPU | `performance.now()` around `timeline.render()` | Recording and submitting only; the driver may do more work later |
| Frame | `requestAnimationFrame` interval | Capped by the display refresh rate, so GPU and CPU time are the real comparison |
| Points | resident sweeps in the trail window | One draw per sweep |
| Upload call | `performance.now()` around `uploadPoints()` | How long the call blocks, not transfer time: `writeBuffer` and `texSubImage2D` hand the data to the browser's GPU process, which uploads it later |
| Memory | resident sweep bytes / allocated point store | Point data only, no textures or uniforms |
| Switch | time to create the new backing and re-upload resident sweeps | Measured on the CPU like Upload call |

URL switches for experiments, combinable:

- `?timers=off` creates no timestamp or timer queries, to see what the measurement itself costs on the CPU.
- `?upload=staging` makes the WebGPU backing write into pooled, already-mapped staging buffers and copy them into the point store on the GPU, instead of using `queue.writeBuffer`. Bulk re-uploads become about 3× faster in Chrome, on par with WebGL2's `texSubImage2D`.
- `?backend=webgl2` picks the starting backing.

The dev server sends cross-origin-isolation headers (`vite.config.ts`). Without them, Chrome rounds `performance.now()` to 100 µs, which is too coarse for sub-millisecond upload and CPU timings.

The counters live in `BackingStats` (`src/render/types.ts`), and each backing updates its own. `src/metrics.ts` averages them over an interval, and `src/ui/metrics.ts` renders the panel.

## Running the test workload

```bash
bun install
bun run dev
```

The bar has play/pause, a scrubber, the colour channel (height, intensity, sweep age), the trail length, and the WebGPU / WebGL2 toggle. `?backend=webgl2` picks the starting backing.

`SweepStream` (`src/data/stream.ts`) fetches binary PCD sweeps (`src/data/pcd.ts`). It keeps the current sweep, the trail behind it and about 2 s of prefetch, at most 31 sweeps. The default data is 154 HDL-64 sweeps from [udacity/SFND_Lidar_Obstacle_Detection](https://github.com/udacity/SFND_Lidar_Obstacle_Detection) at a pinned commit, apparently KITTI Raw data (CC BY-NC-SA 3.0). Set `window.RANT_STREAM = { base, count, period }` before the app loads to point it elsewhere; the defaults are in `src/config.ts`.

## Limitations

- One draw per sweep in the trail. A ring-ordered store could cover a contiguous time window in one or two draws.
- Points are alpha-blended without a depth test.
- Sweep times come from the sweep index at a fixed period, and there's no ego-motion compensation, so trails smear.
- A failed fetch stops the stream.
