# Loading recordings

Click the recording name in the header to import a KITTI folder or load a remote manifest. Local files are indexed lazily and never uploaded.

## KITTI Raw folders

Expected files:

- `velodyne_points/data/*.bin` — float32 XYZ/intensity scans.
- `image_02/data/*` — optional camera images.
- Sensor `timestamps.txt` files — nearest camera match within 50 ms. Without timestamps, matching uses filenames and playback assumes 10 Hz.
- `calib_cam_to_cam.txt` and `calib_velo_to_cam.txt` — camera calibration. These can be supplied separately with **Add calibration**. KITTI Object calibration files containing `P2`, `R0_rect` and `Tr_velo_to_cam` are also supported.
- `world_from_velodyne.txt` or `poses.txt` — optional, one row-major 3×4 world-from-Velodyne transform per scan.

KITTI Odometry camera poses need conversion before import. The local importer does not convert OXTS files or read tracklet XML; the bundled demo preparation script handles these for its source recording.

## Remote manifests

Example schema (replace the paths with your own files):

```json
{
  "name": "My recording",
  "frames": [
    {"time": 0, "lidar": "000000.bin", "camera": "000000.jpg", "cameraTime": 0.01},
    {"time": 0.1, "lidar": "000001.bin", "camera": "000001.jpg", "cameraTime": 0.11}
  ]
}
```

Relative paths resolve against the manifest URL. Remote hosts must allow browser CORS requests.

| Field | Format |
| --- | --- |
| `frames` | 2–20,000 frames with strictly increasing `time` in seconds |
| `lidar` | Required URL: float32 XYZ/intensity `.bin` or binary PCD |
| `camera`, `cameraTime` | Optional image URL and timestamp in the same time base |
| `pose` | Optional per-frame rigid, row-major 3×4 world-from-Velodyne transform |
| `calibration` | Optional top-level object: `p` (12 values), `r` (9), `t` (12) |

Calibration matrices are row-major: projection `p`, rectification `r`, and camera-from-Velodyne `t`. Projection uses `p × r × t`. Accumulation uses `inverse(worldFromCurrentVelodyne) × worldFromSourceVelodyne`, keeping the current sensor at the origin. Velodyne axes are X forward, Y left, Z up.

### Object tracks

Optional top-level `tracks` entries contain:

- Unique string `id`, string `label`, and `size: [length, width, height]` in metres.
- Ordered `samples`, each with an exact zero-based `frame`, bottom-center `position: [x,y,z]` in that frame's Velodyne coordinates, and `rotation: [roll,pitch,yaw]` in radians, composed as Rz × Ry × Rx.
- Optional integer `state`, `occlusion` and `truncation` metadata on each sample.

Missing samples mean absent annotations; Rant does not interpolate them. Limits: 2,000 tracks and 200,000 total samples. See [manifest validation](../src/data/manifest.ts) and [track validation](../src/data/tracks.ts) for the implementation.
