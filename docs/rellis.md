# Why are there LiDAR returns in the sky?

[Try it on frame 000104](https://mpanknin.github.io/rant/cases/rellis/) · [Watch the 30-second recording](https://mpanknin.github.io/rant/rellis-case.mp4)

Look above the person on the left. Several arcs of returns float above the horizon. Click **Apply missing transform**. Those returns move down into the scene. Toggle the overlay to inspect the underlying photograph.

In [RELLIS-3D issue 27](https://github.com/unmannedlab/RELLIS-3D/issues/27#issuecomment-1089522167), a user fed Velodyne points into a projection example configured for the Ouster. We reproduce that operation on the authors’ published example frame. The supplied camera transform expects Ouster coordinates. Applying the Velodyne-to-Ouster transform first gives the chain **Velodyne → Ouster → Basler camera**. Both views use the same scan, image, intrinsics and lens distortion.

Choose **Field recording · excerpt** and press **Play** to compare the two chains in motion. These 20 timestamp-paired observations come from a separate [merged ROS bag](https://drive.google.com/file/d/1qSeOoY6xbQGjcrZycgPM8Ty37eKDjpJL/view?usp=sharing). The robot travels a net 3.87 m in 3.80 s according to filtered odometry. Scan and image timestamps differ by 6.5–13.9 ms. The toggle isolates the effect of the transform. It does not estimate clock offset or compensate for motion within a scan.

## Reproduce

Install the Python dependencies listed in `scripts/prepare-rellis.py`. Pass the [authors’ example directory](https://github.com/unmannedlab/RELLIS-3D/tree/c17a118fcaed1559f03cc32cc3a91dedc557f8b8/utils/example) and the extracted bag to the script. It exports the browser data and OpenCV projection fixtures. Run `npm test` to compare both transforms on all 21 pairs. Calibration conventions follow the [original notebook](https://github.com/unmannedlab/RELLIS-3D/blob/c17a118fcaed1559f03cc32cc3a91dedc557f8b8/utils/lidar2img.ipynb).

Data and derived media: Peng Jiang et al., [RELLIS-3D](https://github.com/unmannedlab/RELLIS-3D), [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). Images resized and encoded as JPEG. Scans sampled and cropped to points visible in either projection.
