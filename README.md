# Rant — Robot Sensor Console

Private interview prototype for inspecting KITTI Raw LiDAR and camera sequences. Three.js and local browser File API; no upload or backend.

## Run

```bash
npm install
npm run dev
```

## Real data

Download a short **synced + rectified KITTI Raw** sequence from https://www.cvlibs.net/datasets/kitti/raw_data.php. Select an extracted parent folder containing `*_sync/velodyne_points/data/*.bin` and optionally `*_sync/image_02/data/*.png`. Up to 120 frames are read in the browser. A synthetic scene loads by default.

## Known limitations

- Timestamps assumed 100ms apart; filename-matched camera and LiDAR frames, without calibration/projection.
- No ego-motion compensation, ROS/MCAP support, or bounded streaming cache.
- Annotations are frame-local points exported to JSON, not tracked cuboids.
- Synthetic mode is illustrative, not real KITTI data.
- Real KITTI import is not yet verified; the importer is tested with synthetic KITTI-format scans.

## Next

Parse real timestamps and calibration, support coordinate frame transforms, async decode/cache, cuboids/tracks, and MCAP adapter.
