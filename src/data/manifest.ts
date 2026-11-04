import type {Frame,KittiCalibration} from './types.ts';
import {isRigidPose} from '../geometry/poses.ts';
type RecordingManifest={name?:string;frames:Array<{time:number;cameraTime?:number;name?:string;lidar:string;camera?:string;pose?:number[]}>;calibration?:KittiCalibration};
export function validateManifest(raw:unknown,manifestUrl:string):{name:string;frames:Frame[]}{
  if(!raw||typeof raw!=='object')throw Error('Manifest must be a JSON object');
  const manifest=raw as RecordingManifest;
  if(!Array.isArray(manifest.frames)||manifest.frames.length<2||manifest.frames.length>20000)throw Error('Manifest needs 2–20000 frames');
  const base=new URL(manifestUrl);
  const resolve=(path:string)=>{
    if(typeof path!=='string'||!path.trim())throw Error('Missing sensor URL');
    const url=new URL(path,base);
    if(!['https:','http:'].includes(url.protocol))throw Error('Only HTTP(S) sensor URLs supported');
    return url.href;
  };
  const calibration=manifest.calibration;
  if(calibration&&(!Array.isArray(calibration.p)||calibration.p.length!==12||!Array.isArray(calibration.r)||calibration.r.length!==9||!Array.isArray(calibration.t)||calibration.t.length!==12||![...calibration.p,...calibration.r,...calibration.t].every(Number.isFinite)))throw Error('Invalid KITTI calibration');
  let previous=-Infinity;
  const frames=manifest.frames.map((item,i)=>{
    if(!item||!Number.isFinite(item.time)||item.time<=previous)throw Error('Frame timestamps must be finite and strictly increasing');
    previous=item.time;
    if(item.pose&&!isRigidPose(item.pose))throw Error('Pose must be a finite 3×4 world-from-Velodyne matrix');
    if(item.cameraTime!==undefined&&!Number.isFinite(item.cameraTime))throw Error('Invalid camera timestamp');
    const url=resolve(item.lidar);
    if(!/\.(bin|pcd)(?:[?#]|$)/i.test(url))throw Error('LiDAR URL must end in .bin or .pcd');
    return {time:item.time,cameraTime:item.cameraTime,name:item.name??String(i).padStart(6,'0'),url,imageUrl:item.camera?resolve(item.camera):undefined,calibration,pose:item.pose};
  });
  return {name:manifest.name??'REMOTE MULTIMODAL',frames};
}
