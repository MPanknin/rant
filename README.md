# Rant — Robot Sensor Console

Private interview prototype for inspecting KITTI Raw LiDAR and camera sequences. Three.js; streams an online sample or reads local files via the File API; no upload or backend.

## Run

```bash
npm install
npm run dev
```

## Online sample

On start the console streams 154 consecutive HDL-64 scans (binary PCD, 10 Hz) from [udacity/SFND_Lidar_Obstacle_Detection](https://github.com/udacity/SFND_Lidar_Obstacle_Detection) (`src/sensors/data/pcd/data_2`, pinned commit) via `raw.githubusercontent.com`, which allows cross-origin fetches. Scans are fetched four at a time, about 2 s ahead of the playhead, and dropped once they fall out of the window, so memory stays at roughly 25 scans. Seeking prioritizes the requested frame, cancels requests outside the new window, and displays cache/request counts. Playback waits for the next scan instead of skipping. The scans appear to be KITTI Raw data, so KITTI's CC BY-NC-SA 3.0 terms apply. A host page can point the stream elsewhere by defining `window.RANT_STREAM = { base, count, source }` before the app script.

## Real data

Download a short **synced + rectified KITTI Raw** sequence from https://www.cvlibs.net/datasets/kitti/raw_data.php. Select an extracted parent folder containing `*_sync/velodyne_points/data/*.bin` and optionally `*_sync/image_02/data/*.png`. Frames are indexed from the selected folder without eagerly reading all LiDAR bytes. The same bounded playhead cache is used for local files and online data; camera images are opened lazily when displayed. If the online sample cannot be reached, a synthetic scene is shown.

## Streaming validation

To validate the seek-priority change, open browser network throttling, start the online sample, and drag the timeline from the beginning to a distant frame. Repeat with a large local KITTI folder and verify that importing it does not eagerly load every scan. The requested frame should be fetched before prefetching its neighbors, and old-window requests should be canceled. Check the status line for cache and in-flight counts. This is a manual validation procedure; it has not been verified in an automated browser run.

## Streaming architecture

The reusable `src/data/timeline-cache.ts` module owns frame priorities, a bounded resident window, concurrent reads, cancellation, failed-frame tracking and seek statistics. It is generic in the decoded frame payload and does not import Three.js, browser UI components or KITTI parsing. `src/main.ts` supplies a loader that reads either a local `File` or an online PCD response and decodes it to interleaved XYZ/intensity samples. This allows later camera, radar, or other temporal adapters to reuse the scheduling logic.

The streaming cache uses a **128 MiB decoded-frame budget** as well as a playhead-centered window. Prefetch is deferred when the budget is full; the playhead can evict other cached frames. A single frame larger than the budget is rejected. This does not include renderer buffers, image decoding, or in-flight response allocations. The initial sample is not an MCAP/ROS reader.

Run scheduler regression tests with Node 22+ using `npm test`; the tests cover bounded retention, stale completion after reset, and oversized frames. The full browser build still requires `npm run build` and a manual rendering check.

## Streaming diagnostics

The dataset status panel reports resident scan count, active reads, cumulative bytes read (including bytes from local files), timeline seek cache hits/misses, and elapsed time from the most recent manual seek until its frame is displayed. The counters reset when the dataset changes. These are application-level counters, **not** GPU memory usage or network transfer measurements; the online byte counter counts fetched response bodies, not HTTP overhead. Failed frames are not retried indefinitely; restart the stream or reimport to retry. Aborted requests do not count as failures.

## Known limitations

- Timestamps assumed 100ms apart; filename-matched camera and LiDAR frames, without calibration/projection.
- No ego-motion compensation or ROS/MCAP support. The online sample has no camera frames.
- Annotations are frame-local points exported to JSON, not tracked cuboids.
- Synthetic mode is illustrative, not real KITTI data.
- Real KITTI import and lazy loading are not yet verified in a browser. Local File.arrayBuffer reads cannot be canceled mid-read; stale results are discarded.

## Next

Parse real timestamps and calibration, support coordinate frame transforms, decode in a worker, cuboids/tracks, and MCAP adapter.

## Browser smoke validation

Feature-branch CI launches headless Chromium against the Vite development server, intercepts the online PCD requests with a deterministic two-point binary fixture, and checks initial rendering, repeated timeline seeking and stream restart. The smoke test does not validate camera calibration, actual KITTI file import, GPU memory consumption, or long-duration playback; those remain manual/integration checks.

Local KITTI folder imports use `velodyne_points/timestamps.txt` when it has a timestamp for every scan; otherwise the viewer assumes 10 Hz. Camera images are matched to scan files by basename.
