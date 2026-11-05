"""Rebuild public/rellis from the authors' utils/example folder and example_filtered.bag.

Dependencies: numpy, scipy, pyyaml, pillow, opencv-python-headless, rosbags.
Usage: python scripts/prepare-rellis.py PATH_TO_EXAMPLE PATH_TO_BAG
The web app reads the small checked-in excerpt. No downloads occur during builds.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image
from rosbags.rosbag1 import Reader
from rosbags.typesys import Stores, get_typestore
from scipy.spatial.transform import Rotation

STORE = get_typestore(Stores.ROS1_NOETIC)
WINDOW = (1581791698., 1581791702.)
TOPICS = {'/pylon_camera_node/image_raw', '/velodyne_points', '/odometry/filtered',
          '/pylon_camera_node/camera_info'}
OUTPUT = Path(__file__).resolve().parents[1] / 'public/rellis'


def inverse_yaml(path, key):
    # Matches get_mtx_from_yaml in the authors' lidar2img.ipynb.
    entry = yaml.safe_load(path.read_text())[key]
    mat = np.eye(4)
    mat[:3, :3] = Rotation.from_quat([entry['q'][k] for k in 'xyzw']).as_matrix()
    mat[:3, 3] = [entry['t'][k] for k in 'xyz']
    return np.linalg.inv(mat)


def timestamp(msg):
    stamp = msg.header.stamp
    return stamp.sec + stamp.nanosec / 1e9


def read_excerpt(bag):
    messages = {topic: [] for topic in TOPICS}
    with Reader(bag) as reader:
        conns = [c for c in reader.connections if c.topic in TOPICS]
        for conn, _, raw in reader.messages(conns, start=int((WINDOW[0]-2)*1e9),
                                            stop=int((WINDOW[1]+2)*1e9)):
            msg = STORE.deserialize_ros1(raw, conn.msgtype)
            if WINDOW[0]-.15 <= timestamp(msg) <= WINDOW[1]+.15:
                messages[conn.topic].append(msg)
    for values in messages.values():
        values.sort(key=timestamp)
    return messages


def xyz_from_cloud(msg):
    assert not msg.is_bigendian and msg.height == 1
    fields = {f.name: f for f in msg.fields}
    assert all(fields[name].datatype == 7 for name in 'xyz')
    return np.column_stack([np.ndarray((msg.width,), dtype='<f4', buffer=msg.data,
                            offset=fields[name].offset, strides=(msg.point_step,)) for name in 'xyz'])


def independent_projection(points, mat, K, distortion):
    camera = points @ mat[:3, :3].T + mat[:3, 3]
    # Notebook bounds candidates before applying Brown-Conrady distortion.
    limit = np.tan(np.arctan2([1920, 1200], 2*np.diag(K)[:2]) + np.pi/36)
    front = (camera[:, 2] > 0) & (np.abs(camera[:, :2]) < camera[:, 2:3]*limit).all(axis=1)
    uv, _ = cv2.projectPoints(points.astype('float64'), cv2.Rodrigues(mat[:3, :3])[0],
                              mat[:3, 3], K, distortion)
    uv = uv.reshape(-1, 2)
    keep = front & (uv >= 0).all(axis=1) & (uv < [1920, 1200]).all(axis=1)
    return keep, uv[keep]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('example', type=Path)
    parser.add_argument('bag', type=Path)
    args = parser.parse_args()
    example = args.example
    camera = inverse_yaml(example/'transforms.yaml', 'os1_cloud_node-pylon_camera_node')
    ouster = inverse_yaml(example/'vel2os1.yaml', 'vel2os1')
    fx, fy, cx, cy = np.loadtxt(example/'camera_info.txt')
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
    distortion = np.array([-.134313, -.025905, .002181, .00084, 0])
    OUTPUT.mkdir(exist_ok=True)
    checks = {}

    def save_pair(stem, image, scan, scan_id, image_id, lidar_time, camera_time):
        assert image.size == (1920, 1200)
        image.resize((960, 600), Image.Resampling.LANCZOS).save(OUTPUT/(stem+'.jpg'), quality=82)
        points = scan[::2]
        points = points[np.isfinite(points).all(axis=1)]
        results = [independent_projection(points, mat, K, distortion) for mat in (camera, camera@ouster)]
        # Preserve identical sensor-local XYZ for A/B. Cull only points outside BOTH views.
        points[results[0][0] | results[1][0]].astype('<f4').tofile(OUTPUT/(stem+'.bin'))
        checks[stem+'.bin'] = {
            mode: {'count': len(uv), 'mean': uv.mean(axis=0).tolist()}
            for mode, (_, uv) in zip(['reported', 'corrected'], results)}
        return dict(image=stem+'.jpg', points=stem+'.bin', scan=scan_id, camera=image_id,
                    lidarTime=lidar_time, cameraTime=camera_time)

    ref = save_pair('reference', Image.open(example/'frame000104-1581624663_149.jpg'),
                    np.fromfile(example/'vel000104.bin', '<f4').reshape(-1, 4)[:, :3],
                    104, 104, None, 1581624663.149)
    messages = read_excerpt(args.bag)
    info = messages['/pylon_camera_node/camera_info'][0]
    assert np.allclose(info.K.reshape(3, 3), K) and np.allclose(info.D, distortion)
    images = [m for m in messages['/pylon_camera_node/image_raw'] if WINDOW[0] <= timestamp(m) <= WINDOW[1]]
    drive = []
    for i, img in enumerate(images[::2]):
        scan = min(messages['/velodyne_points'], key=lambda m: abs(timestamp(m)-timestamp(img)))
        assert abs(timestamp(img)-timestamp(scan)) <= .055
        assert img.encoding == 'bayer_rggb8'
        mosaic = img.data.reshape(img.height, img.step)[:, :img.width]
        rgb = Image.fromarray(cv2.cvtColor(mosaic, cv2.COLOR_BayerRGGB2RGB))
        drive.append(save_pair(f'field-{i:02d}', rgb, xyz_from_cloud(scan), scan.header.seq,
                               img.header.seq, timestamp(scan), timestamp(img)))
    assert len(drive) >= 15 and len({f['scan'] for f in drive}) == len(drive)
    def position(t):
        msg = min(messages['/odometry/filtered'], key=lambda m: abs(timestamp(m)-t))
        p = msg.pose.pose.position
        return np.array([p.x, p.y])
    distance = float(np.linalg.norm(position(drive[-1]['cameraTime'])-position(drive[0]['cameraTime'])))
    assert distance > 1, 'Excerpt must contain measured rig movement'
    rig = dict(intrinsics=[fx,fy,cx,cy], distortion=distortion.tolist(), width=1920, height=1200,
               cameraFromOuster=camera.flatten().tolist(), ousterFromVelodyne=ouster.flatten().tolist())
    manifest = dict(reference=ref, drive=drive, rig=rig, odometryDisplacementMeters=distance)
    (OUTPUT/'case.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (OUTPUT.parent.parent/'tests/rellis-opencv.json').write_text(json.dumps(checks, indent=2)+'\n')
    print(f'{len(drive)} pairs, {drive[-1]["cameraTime"]-drive[0]["cameraTime"]:.2f} sec, {distance:.2f} m')


if __name__ == '__main__':
    main()
