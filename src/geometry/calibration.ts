import type { KittiCalibration } from '../data/types.ts';
export function projectKitti(x:number,y:number,z:number,calibration:KittiCalibration):[number,number]|undefined{
  const a=calibration.t,c=[a[0]*x+a[1]*y+a[2]*z+a[3],a[4]*x+a[5]*y+a[6]*z+a[7],a[8]*x+a[9]*y+a[10]*z+a[11]];
  const r=calibration.r,q=[r[0]*c[0]+r[1]*c[1]+r[2]*c[2],r[3]*c[0]+r[4]*c[1]+r[5]*c[2],r[6]*c[0]+r[7]*c[1]+r[8]*c[2]];
  const p=calibration.p,den=p[8]*q[0]+p[9]*q[1]+p[10]*q[2]+p[11];
  if(den<=0)return;
  return [(p[0]*q[0]+p[1]*q[1]+p[2]*q[2]+p[3])/den,(p[4]*q[0]+p[5]*q[1]+p[6]*q[2]+p[7])/den];
}
function calibrationEntries(text:string):Map<string,number[]>{
  const entries=new Map<string,number[]>();
  for(const line of text.split(/\r?\n/)){
    const match=/^\s*([\w]+):\s*(.*)$/.exec(line);
    if(!match)continue;
    const numbers=match[2].trim().split(/\s+/).map(Number);
    if(numbers.length&&numbers.every(Number.isFinite))entries.set(match[1],numbers);
  }
  return entries;
}
export function readRawCalibration(cameraText:string,velodyneText:string):KittiCalibration{
  const cam=calibrationEntries(cameraText),velo=calibrationEntries(velodyneText);
  const p=cam.get('P_rect_02'),r=cam.get('R_rect_00'),rotation=velo.get('R'),translation=velo.get('T');
  if(p?.length!==12||r?.length!==9||rotation?.length!==9||translation?.length!==3)throw Error('KITTI Raw calibration missing P_rect_02, R_rect_00, R or T');
  const t=[rotation[0],rotation[1],rotation[2],translation[0],rotation[3],rotation[4],rotation[5],translation[1],rotation[6],rotation[7],rotation[8],translation[2]];
  return {p,r,t};
}
export function readObjectCalibration(text:string):KittiCalibration{
  const entries=calibrationEntries(text);
  const p=entries.get('P2'),r=entries.get('R0_rect'),t=entries.get('Tr_velo_to_cam');
  if(p?.length!==12||r?.length!==9||t?.length!==12)throw Error('KITTI Object calibration missing P2, R0_rect or Tr_velo_to_cam');
  return {p,r,t};
}
