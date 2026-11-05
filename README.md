# Rant

A browser-based viewer for robotics recordings, built with TypeScript, Three.js and Vite. Stream synchronized LiDAR and camera frames, inspect tracked objects, measure distances, and add point annotations.

**[Open the demo →](https://mpanknin.github.io/rant/)**

The demo is a 154-frame KITTI drive through Karlsruhe with camera calibration, GPS/IMU poses and 15 annotated objects. Frames load on demand into bounded caches. Local files stay in your browser.

[Field case: reproduce a camera–LiDAR calibration mix-up on RELLIS-3D](docs/rellis.md)

## Using it

- Click an object box to inspect or follow it. Alt-click a LiDAR return for point details.
- Use **Measure** for distances and **Annotate** to place markers and export JSON.
- **View** holds coloring, camera projection and pose-aligned accumulation of up to 20 scans.
- Click the recording name to switch datasets or import your own. See [data formats](docs/data.md).

Drag to orbit, right-drag to pan, scroll to zoom. Space plays/pauses; arrow keys step frames.

## Run locally

Requires Node.js 22.12+, Python 3.10+ and a WebGL2-capable browser.

```sh
npm ci
python -m pip install numpy==2.2.6 Pillow==11.3.0
python scripts/prepare-demo.py
npm run dev
```

The preparation script downloads about 616 MiB on its first run and writes an 87 MiB demo to `public/demo/`. Generated data is cached locally and excluded from Git.

```sh
npm test
python tests/test_demo.py
npm run build
```

CI also runs Playwright workflows against local and deployed builds.

## Dataset

[KITTI Raw](https://www.cvlibs.net/datasets/kitti/raw_data.php), recording `2011_09_26_drive_0005_sync`. Credit: Andreas Geiger, Philip Lenz, Christoph Stiller and Raquel Urtasun, *Vision meets Robotics: The KITTI Dataset*, IJRR 2013.

The demo retains every fourth LiDAR return and converts camera images to JPEG. Dataset and derived files are licensed under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), separately from the application code.

This is an experimental viewer. Object tracks are read-only; user annotations are frame-local points. Moving objects can leave trails in accumulated scans.
