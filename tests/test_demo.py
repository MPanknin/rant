"""Integration checks against actual prepared KITTI measurements, no synthetic motion."""
import json, unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path('public/demo')
class DemoTest(unittest.TestCase):
    def test_actual_recording(self):
        manifest=json.loads((ROOT/'manifest.json').read_text());frames=manifest['frames']
        self.assertEqual(len(frames),154)
        times=np.array([f['time'] for f in frames]);self.assertTrue(np.all(np.diff(times)>0))
        self.assertGreater(times[-1],15)
        poses=np.array([f['pose'] for f in frames]).reshape(-1,3,4)
        for pose in poses:
            np.testing.assert_allclose(pose[:,:3] @ pose[:,:3].T,np.eye(3),atol=2e-6)
            self.assertAlmostEqual(np.linalg.det(pose[:,:3]),1,places=5)
        self.assertGreater(np.linalg.norm(poses[-1,:,3]),60)
        for frame in frames:
            self.assertLess(abs(frame['time']-frame['cameraTime']),.05)
            self.assertGreater((ROOT/frame['lidar']).stat().st_size,160000)
            with Image.open(ROOT/frame['camera']) as image:self.assertEqual(image.size,(1242,375))

    def test_pose_alignment_on_static_scenery(self):
        frames=json.loads((ROOT/'manifest.json').read_text())['frames']
        def pose(i):
            t=np.eye(4);t[:3]=np.array(frames[i]['pose']).reshape(3,4);return t
        def scan(i):return np.fromfile(ROOT/frames[i]['lidar'],dtype='<f4').reshape(-1,4)[:,:3]
        a=scan(20);b=scan(30)
        a=a[(a[:,2]>0)&(np.linalg.norm(a,axis=1)<45)][::4]
        b=b[(b[:,2]>0)&(np.linalg.norm(b,axis=1)<60)]
        t=np.linalg.inv(pose(30)) @ pose(20)
        aligned=a@t[:3,:3].T+t[:3,3]
        def median_distance(source):
            distances=[]
            for block in np.array_split(source,20):
                distances.extend(np.sqrt(np.min(np.sum((block[:,None,:]-b[None,:,:])**2,axis=2),axis=1)))
            return np.median(distances)
        before,after=median_distance(a),median_distance(aligned)
        print(f'Real static scenery: median error {before:.3f} m -> {after:.3f} m')
        self.assertLess(after,.5);self.assertLess(after,before*.5)

if __name__=='__main__':unittest.main()
