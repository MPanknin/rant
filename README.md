# Rant (Raw Attributes No Topology)

<img width="1720" height="905" alt="image" src="https://github.com/user-attachments/assets/f2698c20-2a51-44be-b2b1-1365c866fe90" />


API-agnostic GPU point storage with WebGPU and WebGL2 backings.

Points are stored as flat 16-byte records (`x, y, z, intensity`) in a single allocation and pulled by index in the vertex shader. Each point is drawn as an instanced quad. There is no vertex buffer per chunk and no attribute layout, so a chunk of points is just an offset into the store.

WebGPU keeps the records in a storage buffer. WebGL2 has no storage buffers, so it uses a 4096-wide `RGBA32F` texture read with `texelFetch`. Both implement the same `PointCloudBacking` interface (`src/render/types.ts`) and can be swapped at runtime.

LiDAR playback is the test case: about 124k points per sweep at 10 Hz, streamed, scrubbed and accumulated into trails.

## Run

```bash
bun install
bun run dev
```

URL options:

- `?backend=webgl2` starts on WebGL2
- `?upload=staging` uploads through mapped staging buffers instead of `queue.writeBuffer` (WebGPU)
- `?timers=off` disables GPU timer queries

## Layout

- `src/render/` has the backing interface, the two backings and `PointCloudTimeline`, which gives each sweep a fixed slot in the store and draws the sweeps inside the trail window
- `src/data/` has the PCD parser and a stream that keeps a window of sweeps around the playhead
- `src/metrics.ts` and `src/ui/metrics.ts` handle the metrics panel: GPU time, CPU submit time, upload cost, memory

Upload timings measure how long the call blocks, not the actual transfer. The dev server sets cross-origin isolation headers so `performance.now()` is precise enough for them.

## Data

The default data is 154 HDL-64 sweeps from [udacity/SFND_Lidar_Obstacle_Detection](https://github.com/udacity/SFND_Lidar_Obstacle_Detection), which appear to be KITTI Raw data (CC BY-NC-SA 3.0). Other sources can be configured in `src/config.ts`.

## Limitations

- One draw call per sweep
- No depth test
- No ego-motion compensation, so trails smear
