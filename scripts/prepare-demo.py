"""Build a compact, noncommercial KITTI showcase; generated sensor files stay out of Git.
Requires numpy and Pillow. Uses the official synced/rectified archive, no synthetic data.
"""
from pathlib import Path
import argparse, io, json, math, hashlib, urllib.request, zipfile
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

SOURCE = 'https://s3.eu-central-1.amazonaws.com/avg-kitti/raw_data/'
DRIVE = '2011_09_26_drive_0005'
CHECKSUMS = {'tracklets.zip':'ae896496bcc762c4b0a489730b7d1b2a24513806f5e5bd4e2eeafffc86d486a4','drive.zip':'eaa3635b6ad6a707a8bab53ca38567ada8c78eb743e96d558497872fa436c136','calib.zip':'e0108cfd000cf802c14ed94fba38601185c792e5640abba015a34b7a85b812e0'}
DATE = '2011_09_26'

def download(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.part')
        urllib.request.urlretrieve(url, temporary)
        temporary.replace(path)
    with path.open('rb') as source:
        digest=hashlib.file_digest(source,'sha256').hexdigest()
    if digest != CHECKSUMS[path.name]:
        raise ValueError(f'Archive checksum mismatch: {path.name}')
    return path

def entries(text):
    result = {}
    for line in text.splitlines():
        key, _, value = line.partition(':')
        try: result[key] = np.array([float(x) for x in value.split()])
        except ValueError: pass
    return result

def rigid(rotation, translation):
    result = np.eye(4)
    result[:3,:3] = np.asarray(rotation).reshape(3,3)
    result[:3,3] = translation
    return result

def oxts_pose(packet, scale):
    lat, lon, alt, roll, pitch, yaw = packet[:6]
    cr,sr,cp,sp,cy,sy = math.cos(roll),math.sin(roll),math.cos(pitch),math.sin(pitch),math.cos(yaw),math.sin(yaw)
    rx = np.array([[1,0,0],[0,cr,-sr],[0,sr,cr]])
    ry = np.array([[cp,0,sp],[0,1,0],[-sp,0,cp]])
    rz = np.array([[cy,-sy,0],[sy,cy,0],[0,0,1]])
    translation = [scale*lon*math.pi*6378137/180, scale*6378137*math.log(math.tan((90+lat)*math.pi/360)), alt]
    return rigid(rz @ ry @ rx, translation)

def timestamps(text):
    # Integer nanoseconds avoid loss of submillisecond precision at epoch scale.
    result=[]
    for line in text.strip().splitlines():
        time=line.split()[1]; h,m,s=time.split(':'); whole,frac=s.split('.')
        result.append((int(h)*3600+int(m)*60+int(whole))*10**9+int(frac.ljust(9,'0')))
    return result

def read_tracks(archive, frame_count):
    with zipfile.ZipFile(archive) as z:
        root=ET.fromstring(z.read(DATE+'/'+DRIVE+'_sync/tracklet_labels.xml'))
    tracks=[]
    for i,item in enumerate(root.find('tracklets').findall('item')):
        first=int(item.findtext('first_frame'))
        samples=[]
        for offset,pose in enumerate(item.find('poses').findall('item')):
            frame=first+offset
            if not 0 <= frame < frame_count: continue
            samples.append({'frame':frame,'position':[float(pose.findtext(k)) for k in ['tx','ty','tz']],
                'rotation':[float(pose.findtext(k)) for k in ['rx','ry','rz']],
                'state':int(pose.findtext('state')),'occlusion':int(pose.findtext('occlusion')),'truncation':int(pose.findtext('truncation'))})
        if samples: tracks.append({'id':str(i),'label':item.findtext('objectType'),'size':[float(item.findtext(k)) for k in ['l','w','h']],'samples':samples})
    return tracks

def prepare(cache, output):
    archive=download(SOURCE+DRIVE+'/'+DRIVE+'_sync.zip',cache/'drive.zip')
    calibration=download(SOURCE+DATE+'_calib.zip',cache/'calib.zip')
    tracklets=download(SOURCE+DRIVE+'/'+DRIVE+'_tracklets.zip',cache/'tracklets.zip')
    output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(calibration) as z:
        cam=entries(z.read(DATE+'/calib_cam_to_cam.txt').decode())
        velo=entries(z.read(DATE+'/calib_velo_to_cam.txt').decode())
        imu=entries(z.read(DATE+'/calib_imu_to_velo.txt').decode())
    velo_from_imu=rigid(imu['R'],imu['T'])
    # OXTS is world-from-IMU, not world-from-Velodyne.
    imu_from_velo=np.linalg.inv(velo_from_imu)
    calib={'p':cam['P_rect_02'].tolist(),'r':cam['R_rect_00'].tolist(),'t':rigid(velo['R'],velo['T'])[:3].ravel().tolist()}
    frames=[]
    with zipfile.ZipFile(archive) as z:
        root=DATE+'/'+DRIVE+'_sync/'
        scans=sorted(n for n in z.namelist() if n.startswith(root+'velodyne_points/data/') and n.endswith('.bin'))
        lt=timestamps(z.read(root+'velodyne_points/timestamps.txt').decode())
        ct=timestamps(z.read(root+'image_02/timestamps.txt').decode())
        assert len(scans)==len(lt)==len(ct) and len(scans)>100
        first=np.fromstring(z.read(root+'oxts/data/0000000000.txt').decode(),sep=' ')
        scale=math.cos(first[0]*math.pi/180)
        origin=np.linalg.inv(oxts_pose(first,scale) @ imu_from_velo)
        for i,scan in enumerate(scans):
            name=Path(scan).stem
            assert abs(lt[i]-ct[i])<50_000_000
            points=np.frombuffer(z.read(scan),dtype='<f4').reshape(-1,4)
            # Uniform deterministic subsampling, preserving metric XYZ/intensity.
            points[::4].tofile(output/(name+'.bin'))
            image=Image.open(io.BytesIO(z.read(root+'image_02/data/'+name+'.png')))
            image.save(output/(name+'.jpg'),quality=85,optimize=True)
            packet=np.fromstring(z.read(root+'oxts/data/'+name+'.txt').decode(),sep=' ')
            pose=origin @ oxts_pose(packet,scale) @ imu_from_velo
            frames.append({'name':name,'time':(lt[i]-lt[0])/1e9,'cameraTime':(ct[i]-lt[0])/1e9,'lidar':name+'.bin','camera':name+'.jpg','pose':pose[:3].ravel().tolist()})
    tracks=read_tracks(tracklets,len(frames))
    attribution='KITTI: Andreas Geiger, Philip Lenz, Christoph Stiller, Raquel Urtasun. Vision meets Robotics: The KITTI Dataset, IJRR 2013. CC BY-NC-SA 3.0. Modified: every fourth LiDAR return, JPEG camera encoding; GPS/IMU poses converted to world-from-Velodyne; original KITTI tracklet annotations converted to JSON. Noncommercial research demonstration.'
    manifest={'name':'KARLSRUHE · DRIVE 0005','source':'https://www.cvlibs.net/datasets/kitti/raw_data.php','license':'https://creativecommons.org/licenses/by-nc-sa/3.0/','attribution':attribution,'calibration':calib,'frames':frames,'tracks':tracks,'annotationSource':'KITTI Raw tracklet_labels.xml'}
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    (output/'ATTRIBUTION.txt').write_text(attribution+'\n'+manifest['source']+'\n'+manifest['license']+'\n')
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.suffix in ['.bin','.jpg']}
    (output/'checksums.json').write_text(json.dumps(hashes,indent=2)+'\n')
    print(f'{len(tracks)} annotated tracks; {len(frames)} real paired frames, {frames[-1]["time"]:.2f} s, {sum(p.stat().st_size for p in output.iterdir())/1048576:.1f} MiB; displacement {np.linalg.norm(np.array(frames[-1]["pose"]).reshape(3,4)[:,3]):.1f} m')

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--cache',type=Path,default=Path('.cache/kitti'));parser.add_argument('--output',type=Path,default=Path('public/demo'))
    args=parser.parse_args();prepare(args.cache,args.output)
