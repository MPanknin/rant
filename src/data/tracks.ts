import type {Frame,KittiCalibration} from './types.ts';
import {relativePose,transformPoint} from '../geometry/poses.ts';

export type Vec3=[number,number,number];
export interface TrackSample {frame:number;position:Vec3;rotation:Vec3;occlusion?:number;truncation?:number;state?:number}
export interface ObjectTrack {id:string;label:string;size:Vec3;samples:TrackSample[]}
export const BOX_EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const vector=(v:unknown):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);

export function validateTracks(raw:unknown,frameCount:number):ObjectTrack[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>2000)throw Error('Tracks must be an array of at most 2000 objects');
  const ids=new Set<string>();let samples=0;
  return raw.map(t=>{
    if(!t||typeof t.id!=='string'||!t.id||t.id.length>100||ids.has(t.id))throw Error('Track IDs must be unique nonempty strings');
    ids.add(t.id);
    if(typeof t.label!=='string'||!t.label||t.label.length>100||!vector(t.size)||t.size.some((n:number)=>n<=0||n>100))throw Error('Invalid track class or length/width/height');
    if(!Array.isArray(t.samples)||!t.samples.length||(samples+=t.samples.length)>200000)throw Error('Invalid or excessive track samples');
    let previous=-1;
    for(const s of t.samples){
      if(!s||!Number.isInteger(s.frame)||s.frame<=previous||s.frame>=frameCount||!vector(s.position)||!vector(s.rotation))throw Error('Track samples need ordered frame indices and finite sensor-space transforms');
      previous=s.frame;
      for(const key of ['state','occlusion','truncation'])if(s[key]!==undefined&&!Number.isInteger(s[key]))throw Error('Invalid track label metadata');
    }
    return t as ObjectTrack;
  });
}
export function sampleAt(track:ObjectTrack,frame:number):TrackSample|undefined{
  let lo=0,hi=track.samples.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(track.samples[mid].frame<frame)lo=mid+1;else hi=mid}
  return track.samples[lo]?.frame===frame?track.samples[lo]:undefined;
}
/** KITTI Raw: origin is the bottom center, X length, Y width, Z height. Rz Ry Rx. */
export function objectPoint(sample:TrackSample,x:number,y:number,z:number):Vec3{
  const [rx,ry,rz]=sample.rotation,cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
  const y1=cx*y-sx*z,z1=sx*y+cx*z,x2=cy*x+sy*z1,z2=-sy*x+cy*z1;
  return [cz*x2-sz*y1+sample.position[0],sz*x2+cz*y1+sample.position[1],z2+sample.position[2]];
}
export function boxCorners(track:ObjectTrack,sample:TrackSample):Vec3[]{
  const [l,w,h]=track.size;
  return [[-l/2,-w/2,0],[l/2,-w/2,0],[l/2,w/2,0],[-l/2,w/2,0],[-l/2,-w/2,h],[l/2,-w/2,h],[l/2,w/2,h],[-l/2,w/2,h]].map(([x,y,z])=>objectPoint(sample,x,y,z));
}
export function presenceRanges(track:ObjectTrack):Array<[number,number]>{
  const ranges:Array<[number,number]>=[];
  for(const s of track.samples){const last=ranges.at(-1);if(last&&s.frame===last[1]+1)last[1]=s.frame;else ranges.push([s.frame,s.frame])}
  return ranges;
}
/** Homogeneous camera projection, clipped before perspective divide to avoid behind-camera explosions. */
export function projectedBox(track:ObjectTrack,sample:TrackSample,c:KittiCalibration){
  const homogeneous=boxCorners(track,sample).map(([x,y,z])=>{
    const a=c.t,r=c.r,p=c.p,v=[a[0]*x+a[1]*y+a[2]*z+a[3],a[4]*x+a[5]*y+a[6]*z+a[7],a[8]*x+a[9]*y+a[10]*z+a[11]];
    const q=[r[0]*v[0]+r[1]*v[1]+r[2]*v[2],r[3]*v[0]+r[4]*v[1]+r[5]*v[2],r[6]*v[0]+r[7]*v[1]+r[8]*v[2]];
    return [p[0]*q[0]+p[1]*q[1]+p[2]*q[2]+p[3],p[4]*q[0]+p[5]*q[1]+p[6]*q[2]+p[7],p[8]*q[0]+p[9]*q[1]+p[10]*q[2]+p[11]];
  });
  const lines:Array<[number,number,number,number]>=[];
  for(const [i,j] of BOX_EDGES){
    let a=homogeneous[i],b=homogeneous[j];const near=.1;
    if(a[2]<near&&b[2]<near)continue;
    if(a[2]<near||b[2]<near){const t=(near-a[2])/(b[2]-a[2]),cut=a.map((v,k)=>v+t*(b[k]-v));if(a[2]<near)a=cut;else b=cut}
    lines.push([a[0]/a[2],a[1]/a[2],b[0]/b[2],b[1]/b[2]]);
  }
  return lines;
}
/** Convex projected silhouette hit test, including edges. */
export function projectedHull(lines:Array<[number,number,number,number]>):Array<[number,number]>{
  const pts=lines.flatMap(l=>[[l[0],l[1]],[l[2],l[3]]] as Array<[number,number]>).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o:number[],a:number[],b:number[])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower:Array<[number,number]>=[],upper:Array<[number,number]>=[];
  for(const p of pts){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p)}
  for(const p of [...pts].reverse()){while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p)}
  lower.pop();upper.pop();return lower.concat(upper);
}
export function inHull(hull:Array<[number,number]>,x:number,y:number){
  if(hull.length<3)return false;
  let sign=0;
  for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],c=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);if(Math.abs(c)<1e-8)continue;const next=Math.sign(c);if(sign&&sign!==next)return false;sign=next}
  return true;
}
export function worldPosition(sample:TrackSample,frames:readonly Frame[]):Vec3|undefined{
  const pose=frames[sample.frame]?.pose;return pose?transformPoint(pose,...sample.position):undefined;
}
export function trackPath(track:ObjectTrack,frames:readonly Frame[],current:number):Array<[Vec3,Vec3]>{
  const pose=frames[current]?.pose;if(!pose)return [];
  const segments:Array<[Vec3,Vec3]>=[];
  const stride=Math.max(1,Math.ceil(track.samples.length/1000));
  for(let i=stride;i<track.samples.length;i+=stride){
    const a=track.samples[i-stride],b=track.samples[i];
    // Never bridge missing annotations or sensor poses.
    if(b.frame-a.frame!==stride||!frames[a.frame]?.pose||!frames[b.frame]?.pose)continue;
    segments.push([transformPoint(relativePose(pose,frames[a.frame].pose!),...a.position),transformPoint(relativePose(pose,frames[b.frame].pose!),...b.position)]);
  }
  return segments;
}
export function estimatedSpeed(track:ObjectTrack,frame:number,frames:readonly Frame[]):number|undefined{
  const i=track.samples.findIndex(s=>s.frame===frame);if(i<0)return;
  const a=track.samples[Math.max(0,i-5)],b=track.samples[Math.min(track.samples.length-1,i+5)];
  if(b.frame-a.frame!==Math.min(track.samples.length-1,i+5)-Math.max(0,i-5))return;
  const pa=worldPosition(a,frames),pb=worldPosition(b,frames),dt=frames[b.frame].time-frames[a.frame].time;
  if(!pa||!pb||dt<=0)return;
  return Math.hypot(pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2])/dt;
}
