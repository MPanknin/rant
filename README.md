# Rant — Multimodal Robotics Sensor Workbench

Experimental browser console for streaming synchronized LiDAR, RGB camera and sensor poses. TypeScript, Three.js/WebGL and Vite. All exploration runs in the browser; local files are never uploaded.

**Live preview:** https://mpanknin.github.io/rant/  
**Development branch:** `feat/streaming-workbench` (not merged into `main`).

## Default experience

The app opens **KITTI Raw 2011_09_26_drive_0005_sync**, a real residential drive in Karlsruhe:

- 154 consecutive synchronized frames, 15.80 seconds at approximately 10 Hz.
- Velodyne HDL-64E LiDAR, rectified left RGB camera (`image_02`), original sensor timestamps and calibration.
- Genuine OXTS GPS/IMU poses, converted from world-from-IMU into world-from-Velodyne using `calib_imu_to_velo.txt`; approximately 62 m of displacement.
- About 87 MiB of prepared sensor files. Every fourth LiDAR return is retained, and PNG camera images are converted to JPEG quality 85 without resizing. XYZ units, intensity, calibration and frame ordering are preserved.

Playback waits for the next scan **and decoded camera frame**. Scrubbing never reuses an image from another timestamp. Missing images are explicitly marked. The camera overlay projects current LiDAR returns using `P_rect_02 × R_rect_00 × T_camera_from_velodyne`; click either view to inspect a corresponding point.

Enable **ACCUMULATE 20 SCANS** to compare one observation with a denser environment. The current sensor stays at the origin; history and the measured trajectory transform into its coordinate system. Space plays/pauses, left/right arrows step frames, and F focuses a selection. Mouse drag orbits, right drag pans, scroll zooms; double-click adds a frame-local annotation.

Other recordings, the original 154-frame Udacity LiDAR stream, the original single-frame fusion sample, remote manifests and local KITTI import remain available under **Recordings & import**.

## Data attribution and reproducibility

Source: [KITTI Raw](https://www.cvlibs.net/datasets/kitti/raw_data.php), by Andreas Geiger, Philip Lenz, Christoph Stiller and Raquel Urtasun, *Vision meets Robotics: The KITTI Dataset*, IJRR 2013. Dataset and derived preview files: [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), for this noncommercial research demonstration. These terms apply to the data, separately from application code.

`scripts/prepare-demo.py` fetches the publicly accessible official synced/rectified and calibration archives, verifies pinned SHA-256 hashes, and builds `public/demo/`. It writes a recording manifest, per-file checksums and attribution. Generated binaries are ignored by Git and included only in the Pages artifact. GitHub Actions caches the prepared dataset using the conversion script's hash. A first uncached build downloads approximately 616 MiB; visitors only request the current streaming window from the Pages host, with no cross-origin dependency for the default showcase.

```bash
npm ci
python -m pip install numpy==2.2.6 Pillow==11.3.0
python scripts/prepare-demo.py
npm run dev
```

The first conversion requires Internet access; later local runs reuse `.cache/kitti`. Without prepared data, the UI reports that the showcase is unavailable and offers the other recording sources. It never silently substitutes synthetic data.

## Streaming and reconstruction

`src/data/timeline-cache.ts` owns playhead priority, bounded residency, concurrent reads, cancellation and generation isolation. LiDAR uses a 128 MiB decoded budget, 20 frames ahead, 19 behind, and four concurrent reads. Retaining 19 previous scans makes 20-frame accumulation possible. Far seeks request the target first and load the surrounding window; the whole recording is not loaded eagerly.

`src/data/camera-cache.ts` separately bounds decoded camera memory to 24 MiB, with six frames ahead, one behind and two reads. Object URLs are revoked on eviction/reset, and stale completions release their payloads. Budgets exclude browser HTTP cache, in-flight buffers, and renderer allocations; they are not a claim about total process or GPU memory.

`src/geometry/poses.ts` applies `inverse(worldFromCurrentVelodyne) × worldFromSourceVelodyne`. Reconstruction reuses cached scans and one fixed 240k-point Float32 staging/GPU buffer, sampling each scan to at most 12k returns. It updates on frame changes or newly resident history, not on every animation frame. Missing history or poses is reported, and the status shows how many scans contributed. History never wraps across the end of a recording.

Coordinate systems remain distinct:

- Velodyne: X forward, Y left, Z up.
- Projection: Velodyne → unrectified reference camera → rectified camera → image.
- OXTS conversion: `worldFromIMU × inverse(velodyneFromIMU)`, normalized to the first Velodyne pose.
- KITTI Odometry camera poses are **not** directly usable as Velodyne poses.

## Remote recording manifest

Load an HTTP(S) manifest under **Recordings & import**. Relative paths resolve against its URL; remote sources must allow browser CORS requests. No data is written to a server.

```json
{
  "name": "My recording",
  "frames": [
    {"time": 0, "cameraTime": 0.01, "lidar": "000000.bin", "camera": "000000.jpg", "pose": [1,0,0,0,0,1,0,0,0,0,1,0]},
    {"time": 0.1, "cameraTime": 0.11, "lidar": "000001.bin", "camera": "000001.jpg", "pose": [1,0,0,0.1,0,1,0,0,0,0,1,0]}
  ]
}
```

This is a schema illustration, not a real dataset. A manifest has 2–20,000 frames with finite, strictly increasing `time` values in seconds. `camera`, `cameraTime` and `pose` are optional per frame; missing cameras are shown explicitly. `lidar` accepts raw interleaved float32 XYZ/intensity `.bin` or binary PCD. Query strings are supported. An optional top-level `calibration` object supplies `p` (12), `r` (9), and `t` (12) finite numbers, respectively row-major projection, rectification and camera-from-Velodyne matrices. Poses are rigid row-major 3×4 **world-from-Velodyne** transforms; scale, reflection and nonfinite matrices are rejected.

## Local KITTI import

Select a KITTI Raw folder containing `velodyne_points/data/*.bin`, optionally `image_02/data/*` and sensor timestamp files. Files are indexed lazily; camera matches use the nearest timestamp within 50 ms, or filenames when timestamps are unavailable. Without complete LiDAR timestamps, the importer assumes 10 Hz.

Calibration can reside in the selected parent folder or be added afterward with **Add calibration files**. Select both `calib_cam_to_cam.txt` and `calib_velo_to_cam.txt` for KITTI Raw, or one KITTI Object calibration file with `P2`, `R0_rect`, `Tr_velo_to_cam`. Apply calibration only to the recording it belongs to.

Optional `world_from_velodyne.txt` (or legacy `poses.txt`) must already contain one rigid world-from-Velodyne matrix per scan. Ordinary KITTI Odometry `poses.txt` contains camera poses and must be converted first. OXTS conversion is implemented by the built-in preparation script, not yet by the local folder importer.

## Validation

```bash
npm test                       # deterministic TypeScript module/cache tests
python tests/test_demo.py       # actual KITTI poses, timestamps, files and static-scene alignment
npm run build
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node tests/run-browser.mjs      # starts and stops its own test server
```

Browser tests include the original mocked workflow regression suite and a separate **unmocked real-data** integration test: initial lazy loading, projection, distinct consecutive images, synchronized playback, stepping, far seeks, 20-scan reconstruction, missing frames, local import and responsive layout. `RANT_TEST_URL` on the individual browser scripts can target a deployed build. CI uploads desktop/mobile screenshots. Unit fixtures test exact translation/rotation composition, projection and calibration layouts, invalid manifests, memory limits and stale request disposal.

The real-data alignment test compares stationary scenery from frames 20 and 30; with this sampled data its median nearest-return error drops from roughly 1.76 m to 0.22 m after applying the measured poses. This is a sanity check, not a general reconstruction accuracy guarantee.

## Remaining limits

- Sensor-following reconstruction only; no world-fixed navigation mode, full-map SLAM, loop closure or scan deskew.
- Moving objects can leave trails in accumulated scans. OXTS noise and LiDAR sampling limit alignment precision.
- The default drive is 15.8 seconds and spatially subsampled; this is a compact demonstration, not a benchmark distribution.
- WebGL2 is required. Software-rendered Chromium checks do not establish GPU performance on every device.
- Local KITTI import does not infer or convert arbitrary camera/IMU pose conventions. Annotations remain frame-local points, not tracked objects.
- No radar, ROS/MCAP or multi-camera playback yet.
