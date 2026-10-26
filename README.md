# Rant — Robot Sensor Console

Private interview prototype for inspecting KITTI Raw LiDAR and camera sequences. Three.js; streams an online sample or reads local files via the File API; no upload or backend.

## Run

```bash
bun install
bun run dev
```

## Online sample

On start the console streams 154 consecutive HDL-64 scans (binary PCD, 10 Hz) from [udacity/SFND_Lidar_Obstacle_Detection](https://github.com/udacity/SFND_Lidar_Obstacle_Detection) (`src/sensors/data/pcd/data_2`, pinned commit) via `raw.githubusercontent.com`, which allows cross-origin fetches. Scans are fetched four at a time, about 2 s ahead of the playhead, and dropped once they fall out of the window, so memory stays at roughly 25 scans. Playback waits for the next scan instead of skipping. The scans appear to be KITTI Raw data, so KITTI's CC BY-NC-SA 3.0 terms apply. A host page can point the stream elsewhere by defining `window.RANT_STREAM = { base, count, source }` before the app script.

## Real data

Download a short **synced + rectified KITTI Raw** sequence from https://www.cvlibs.net/datasets/kitti/raw_data.php. Select an extracted parent folder containing `*_sync/velodyne_points/data/*.bin` and optionally `*_sync/image_02/data/*.png`. Up to 120 frames are read in the browser. If the online sample cannot be reached, a synthetic scene is shown.

## Known limitations

- Timestamps assumed 100ms apart; filename-matched camera and LiDAR frames, without calibration/projection.
- No ego-motion compensation or ROS/MCAP support. The online sample has no camera frames.
- Annotations are frame-local points exported to JSON, not tracked cuboids.
- Synthetic mode is illustrative, not real KITTI data.
- Real KITTI import is not yet verified; the importer is tested with synthetic KITTI-format scans.

## Next

Parse real timestamps and calibration, support coordinate frame transforms, decode in a worker, cuboids/tracks, and MCAP adapter.
