import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {shell} from './ui/shell';
import {TrackWorkbench} from './rendering/track-workbench';
import type {ObjectTrack} from './data/tracks';
import {createCameraCache} from './data/camera-cache';
import type {Frame,KittiCalibration} from './data/types';
import {validateManifest} from './data/manifest';
import {projectKitti,readRawCalibration,readObjectCalibration} from './geometry/calibration';
import {accumulateInto,relativePose,transformPoint,isRigidPose} from './geometry/poses';
import { TimelineCache } from './data/timeline-cache';
import { parseKittiTimestamps, nearestTimestampIndex } from './data/synchronization';

type Note={id:number;frame:number;label:string;position:[number,number,number]};
// Online sample: consecutive HDL-64 street scans (binary PCD, KITTI-derived) from Udacity's SFND course repo, served by GitHub with CORS.
// A host page can point the stream elsewhere by defining window.RANT_STREAM before this script runs.
const STREAM:{base:string;count:number;source:string}=(globalThis as any).RANT_STREAM??{base:'https://raw.githubusercontent.com/udacity/SFND_Lidar_Obstacle_Detection/ef15da2bc172359e7d6edfdd156a2a243d10977e/src/sensors/data/pcd/data_2/',count:154,source:'udacity/SFND_Lidar_Obstacle_Detection on GitHub'};
const AHEAD=20,BEHIND=19,PARALLEL=4;// 128 MiB decoded-frame budget plus a playhead-centered prefetch window
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=shell();
const el=(id:string)=>document.getElementById(id)!;
function createRenderer(){
  try{return new THREE.WebGLRenderer({antialias:true})}
  catch(error){el('transport-status').textContent='WEBGL UNAVAILABLE';el('mode').textContent='WebGL2 is required';el('view').textContent='This browser could not start WebGL2. Enable hardware acceleration or use a WebGL2-capable browser.';throw error}
}
const renderer=createRenderer();renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0a111c);el('view').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x0a111c,.007);
const camera=new THREE.PerspectiveCamera(58,1,.1,1200);camera.up.set(0,0,1);camera.position.set(24,-30,19);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(12,0,0);controls.enableDamping=true;controls.update();
const grid=new THREE.GridHelper(140,70,0x36516a,0x1d2c40);grid.rotateX(Math.PI/2);scene.add(grid,new THREE.AxesHelper(4));
const GROUND_Z=-1.73;grid.position.z=GROUND_Z;// KITTI Velodyne sits ~1.73 m above the road
// One reusable point buffer: grows to the largest frame, afterwards only its contents are updated
const geo=new THREE.BufferGeometry();let cap=0;
function ensure(n:number){if(n<=cap)return;cap=Math.ceil(n*1.1);geo.dispose();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(cap*3),3));geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(cap*3),3))}
const cloud=new THREE.Points(geo,new THREE.PointsMaterial({size:.095,vertexColors:true}));cloud.frustumCulled=false;
const markerGeo=new THREE.SphereGeometry(.35,10,8),markerMat=new THREE.MeshBasicMaterial({color:0xffbd70});
const markers=new THREE.Group();scene.add(cloud,markers);
const measurement=new THREE.Group();scene.add(measurement);
const accumulatedGeometry=new THREE.BufferGeometry();
const accumulatedCloud=new THREE.Points(accumulatedGeometry,new THREE.PointsMaterial({size:.085,color:0x8bdce5,transparent:true,opacity:.48,depthWrite:false}));
accumulatedCloud.frustumCulled=false;accumulatedCloud.visible=false;scene.add(accumulatedCloud);
const accumulationBuffer=new Float32Array(20*12000*3);
accumulatedGeometry.setAttribute('position',new THREE.BufferAttribute(accumulationBuffer,3).setUsage(THREE.DynamicDrawUsage));
let accumulationDirty=true;
const trajectoryGeometry=new THREE.BufferGeometry();
const trajectory=new THREE.Line(trajectoryGeometry,new THREE.LineBasicMaterial({color:0xffbd70,transparent:true,opacity:.75}));trajectory.frustumCulled=false;scene.add(trajectory);
const vehicleGeometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(4.2,1.8,1.5));
const vehicle=new THREE.LineSegments(vehicleGeometry,new THREE.LineBasicMaterial({color:0x6b849b}));vehicle.position.set(-.8,0,-.9);scene.add(vehicle);
function updateAccumulation(){
  accumulationDirty=false;
  const enabled=(el('accumulate') as HTMLInputElement).checked,frame=frames[index];
  accumulatedCloud.visible=false;
  if(!frame?.pose){el('accumulation-status').textContent='No vehicle poses in this recording. Showing a single scan.';return}
  if(!enabled){el('accumulation-status').textContent='Single scan · enable history to reveal a denser environment.';return}
  const scans=[];
  for(let i=Math.max(0,index-19);i<=index;i++){
    const points=frames[i].points??cache.get(i),pose=frames[i].pose;
    if(points&&pose)scans.push({points,pose});
  }
  const {used,count}=accumulateInto(accumulationBuffer,frame.pose,scans);
  const attr=accumulatedGeometry.attributes.position as THREE.BufferAttribute;
  attr.clearUpdateRanges();attr.addUpdateRange(0,count*3);attr.needsUpdate=true;
  accumulatedGeometry.setDrawRange(0,count);accumulatedCloud.visible=count>0;
  el('accumulation-status').textContent=used+' / '+Math.min(20,index+1)+' scans accumulated · '+count.toLocaleString()+' returns · sensor following';
}
function updateTrajectory(){
  const current=frames[index]?.pose;trajectory.visible=!!current;
  if(!current)return;
  const points=frames.filter(f=>f.pose).map(f=>new THREE.Vector3(...transformPoint(relativePose(current,f.pose!),0,0,0)));
  trajectoryGeometry.setFromPoints(points);
}
(el('accumulate') as HTMLInputElement).onchange=()=>{accumulationDirty=true;updateAccumulation()};
el('reset-view').onclick=()=>{trackWorkbench.stopFollowing();camera.position.set(24,-30,19);controls.target.set(12,0,0);controls.update()};
const selectedPoint=new THREE.Mesh(new THREE.SphereGeometry(.24,12,10),new THREE.MeshBasicMaterial({color:0xffad38,depthTest:false}));selectedPoint.visible=false;selectedPoint.renderOrder=10;scene.add(selectedPoint);
const measureMaterial=new THREE.LineBasicMaterial({color:0xffc46b,depthTest:false});
const measurePointMaterial=new THREE.MeshBasicMaterial({color:0xffc46b,depthTest:false});
let toolMode:'inspect'|'measure'='inspect';
let colorMode:'height'|'intensity'|'range'='height';
(el('color-mode') as HTMLSelectElement).onchange=e=>{colorMode=(e.target as HTMLSelectElement).value as typeof colorMode;renderedIndex=-1;draw()};
let measurePoints:THREE.Vector3[]=[];
function clearMeasure(){measurePoints=[];for(const child of measurement.children)(child as THREE.Mesh).geometry.dispose();measurement.clear();el('measure-overlay').textContent=toolMode==='measure'?'Click two LiDAR points to measure their distance.':(trackWorkbench.hasAnnotations?'Click an object box to inspect its track. Alt-click a LiDAR return.':'Click a point in either view to inspect XYZ and intensity.')}
function updateMeasure(){
  for(const child of measurement.children)(child as THREE.Mesh).geometry.dispose();measurement.clear();
  for(const p of measurePoints){const m=new THREE.Mesh(new THREE.SphereGeometry(.18,8,6),measurePointMaterial);m.position.copy(p);measurement.add(m)}
  if(measurePoints.length===2){
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePoints),measureMaterial);
    line.renderOrder=5;measurement.add(line);
    const delta=measurePoints[1].clone().sub(measurePoints[0]);
    el('measure-overlay').textContent='Distance '+delta.length().toFixed(3)+' m · ΔX '+delta.x.toFixed(2)+' · ΔY '+delta.y.toFixed(2)+' · ΔZ '+delta.z.toFixed(2);
  }else el('measure-overlay').textContent='Select second point to measure distance.';
}
el('inspect-mode').onclick=()=>{toolMode='inspect';el('inspect-mode').classList.add('selected');el('measure-mode').classList.remove('selected');el('measure-overlay').textContent=trackWorkbench.hasAnnotations?'Click an object box to inspect its track. Alt-click a LiDAR return.':'Click a LiDAR point to inspect XYZ and intensity.'};
el('measure-mode').onclick=()=>{toolMode='measure';el('measure-mode').classList.add('selected');el('inspect-mode').classList.remove('selected');clearMeasure()};
el('clear-measure').onclick=clearMeasure;

let frames:Frame[]=[];
let index=0,playing=false,last=0,nextId=1,playbackSpeed=1;let notes:Note[]=[];
const trackWorkbench=new TrackWorkbench(scene,camera,controls,frame=>{setPlaying(false);seekFrame(frame)});
const cache=new TimelineCache<Float32Array>({
  ahead:AHEAD,behind:BEHIND,concurrency:PARALLEL,maxResidentBytes:128*1024*1024,
  sizeOf:points=>points.byteLength,
  load:async(i,signal)=>{
    const f=frames[i];
    let buf:ArrayBuffer;
    if(f.file){buf=await f.file.arrayBuffer();if(signal.aborted)throw new DOMException('Aborted','AbortError');if(buf.byteLength%16)throw Error('Invalid Velodyne binary: '+f.name)}
    else {const r=await fetch(f.url!,{signal});if(!r.ok)throw Error('HTTP '+r.status+' for scan '+f.name);buf=await r.arrayBuffer()}
    const binary=!!f.file||!!f.url&&/\.bin(?:[?#]|$)/i.test(f.url);
    if(binary&&(!buf.byteLength||buf.byteLength%16))throw Error('Invalid Velodyne binary: '+f.name);
    return {value:binary?new Float32Array(buf):parsePCD(buf),bytes:buf.byteLength};
  },
  onChange:()=>{accumulationDirty=true;updateBufferStatus();if(frames[index]&&cache.get(index)&&renderedIndex!==index)draw()},
  onError:(i,error)=>{setPlaying(false);el('status').textContent='Frame '+frames[i]?.name+' failed: '+String(error)}
});
const cameraCache=createCameraCache(i=>frames[i],()=>{if(frames[index]){showCamera(frames[index]);updateBufferStatus()}});
let renderedIndex=-1;let measurementFrame=-1;let shownCameraFrame:Frame|undefined;let shownCameraStatus='';
function updateBufferStatus(){
  const stats=cache.stats;
  const cameraStats=cameraCache.stats;
  el('status').textContent=`LiDAR ${stats.resident} / ${frames.length} cached · ${(stats.residentBytes/1048576).toFixed(1)} / 128 MiB · ${stats.active} reads · ${stats.failures} failed · Camera ${(cameraStats.residentBytes/1048576).toFixed(1)} / 24 MiB · ${cameraStats.failures} failed`;
  // Cache notifications may fire while the camera cache is being reset.
  const f=frames[index];
  if(f)el('frame-metadata').textContent=`${frames.length} frames · ${frames.at(-1)!.time.toFixed(1)} s\nCalibration ${f.calibration?'present':'missing'} · Pose ${f.pose?'GPS / IMU or supplied':'unavailable'}\nCamera offset ${f.cameraTime===undefined?'not provided':((f.cameraTime-f.time)*1000).toFixed(1)+' ms'}`;
}
const KITTI_P2=[721.5377,0,609.5593,44.85728,0,721.5377,172.854,0.2163791,0,0,1,0.002745884];
const KITTI_R=[.9999239,.00983776,-.007445048,-.009869795,.9999421,-.004278459,.007402527,.004351614,.9999631];
const KITTI_T=[.007533745,-.9999714,-.000616602,-.004069766,.01480249,.0007280733,-.9998902,-.07631618,.9998621,.00752379,.01480755,-.2717806];
const SAMPLE_CALIBRATION:KittiCalibration={p:KITTI_P2,r:KITTI_R,t:KITTI_T};
function updateCameraProjection(){
  trackWorkbench.renderCamera();
  const canvas=el('camera-projection') as HTMLCanvasElement;
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const view=el('camera'),img=view.querySelector('img');
  const f=frames[index],points=f&&(f.points??cache.get(index));
  const enabled=(el('project-cloud') as HTMLInputElement).checked;
  canvas.width=view.clientWidth*devicePixelRatio;canvas.height=view.clientHeight*devicePixelRatio;
  canvas.style.width=view.clientWidth+'px';canvas.style.height=view.clientHeight+'px';
  if(!enabled||shownCameraFrame!==f||!f?.calibration||!points||!img?.naturalWidth||!img.naturalHeight){
    el('projection-status').textContent=!enabled?'Projection hidden':f?.calibration?'Waiting for paired sensors':'Calibration required';
    return;
  }
  const scale=Math.min(view.clientWidth/img.naturalWidth,view.clientHeight/img.naturalHeight);
  const ox=(view.clientWidth-img.naturalWidth*scale)/2,oy=(view.clientHeight-img.naturalHeight*scale)/2;
  ctx.scale(devicePixelRatio,devicePixelRatio);
  let visible=0;
  for(let i=0;i<points.length;i+=4){
    const uv=projectKitti(points[i],points[i+1],points[i+2],f.calibration!);
    if(!uv||uv[0]<0||uv[1]<0||uv[0]>=img.naturalWidth||uv[1]>=img.naturalHeight)continue;
    const distance=Math.hypot(points[i],points[i+1],points[i+2]);
    const hue=Math.max(0,220-Math.min(distance/75,1)*220);
    ctx.fillStyle='hsla('+hue+',95%,62%,.65)';
    ctx.fillRect(ox+uv[0]*scale,oy+uv[1]*scale,1.25,1.25);
    visible++;
  }
  el('projection-status').textContent=visible.toLocaleString()+' projected points';
}
(el('project-cloud') as HTMLInputElement).onchange=updateCameraProjection;
el('focus-selection').onclick=()=>{
  if(!selectedPoint.visible)return;
  const delta=selectedPoint.position.clone().sub(controls.target);
  camera.position.add(delta);controls.target.copy(selectedPoint.position);controls.update();
};
function selectProjectedPoint(pointIndex:number,points:Float32Array){
  (document.querySelector('.inspector-details') as HTMLDetailsElement).open=true;
  const k=pointIndex*4;
  const p=new THREE.Vector3(points[k],points[k+1],points[k+2]);
  selectedPoint.position.copy(p);selectedPoint.visible=true;(el('focus-selection') as HTMLButtonElement).disabled=false;
  const uv=projectKitti(p.x,p.y,p.z,frames[index].calibration!);
  const view=el('camera'),img=view.querySelector('img'),marker=el('camera-marker');
  marker.hidden=true;
  if(uv&&img?.naturalWidth&&img.naturalHeight&&uv[0]>=0&&uv[1]>=0&&uv[0]<img.naturalWidth&&uv[1]<img.naturalHeight){
    const scale=Math.min(view.clientWidth/img.naturalWidth,view.clientHeight/img.naturalHeight);
    marker.style.left=(view.clientWidth-img.naturalWidth*scale)/2+uv[0]*scale+'px';
    marker.style.top=(view.clientHeight-img.naturalHeight*scale)/2+uv[1]*scale+'px';
    marker.hidden=false;
  }
  el('inspection').textContent='Point #'+pointIndex+' · X '+p.x.toFixed(3)+' m · Y '+p.y.toFixed(3)+' m · Z '+p.z.toFixed(3)+' m · Intensity '+points[k+3].toFixed(4)+' · Range '+p.length().toFixed(2)+' m';
}
el('camera').addEventListener('click',e=>{
  const f=frames[index],points=f&&(f.points??cache.get(index)),view=el('camera');
  const img=view.querySelector('img');
  if(!f?.calibration||!points||!img?.naturalWidth||!img.naturalHeight)return;
  const rect=view.getBoundingClientRect(),scale=Math.min(view.clientWidth/img.naturalWidth,view.clientHeight/img.naturalHeight);
  const x=(e.clientX-rect.left-(view.clientWidth-img.naturalWidth*scale)/2)/scale;
  const y=(e.clientY-rect.top-(view.clientHeight-img.naturalHeight*scale)/2)/scale;
  if(x<0||y<0||x>=img.naturalWidth||y>=img.naturalHeight)return;
  if(!e.altKey&&trackWorkbench.pickCamera(x,y))return;
  let nearest=-1,best=8*8,nearestDepth=Infinity;
  for(let i=0;i<points.length;i+=4){
    const uv=projectKitti(points[i],points[i+1],points[i+2],f.calibration!);
    if(!uv)continue;
    const d=(uv[0]-x)**2+(uv[1]-y)**2;
    if(d<best||(Math.abs(d-best)<.01&&Math.hypot(points[i],points[i+1],points[i+2])<nearestDepth)){best=d;nearest=i/4;nearestDepth=Math.hypot(points[i],points[i+1],points[i+2])}
  }
  if(nearest>=0){selectProjectedPoint(nearest,points);el('measure-overlay').textContent='Camera selection → nearest projected LiDAR return';}
  else el('measure-overlay').textContent='No projected LiDAR return within 8 image pixels';
});

function showCamera(f:Frame){
  const paired=!!(f.imageFile||f.imageUrl),image=cameraCache.get(index);
  const ready=!!image?.naturalWidth;
  el('camera-sync').textContent=paired?(ready?'FRAME '+String(index).padStart(3,'0')+' · SYNC':cameraCache.hasFailed(index)?'IMAGE FAILED':'BUFFERING'):'NO CAMERA';
  el('sensor-indicator').textContent=paired?'LIDAR + CAMERA':'LIDAR ONLY';
  const cameraStatus=el('camera-sync').textContent??'';
  if(shownCameraFrame===f&&shownCameraStatus===cameraStatus&&el('camera').querySelector('img')===(ready?image:null))return;
  shownCameraStatus=cameraStatus;
  shownCameraFrame=f;
  const view=el('camera');view.replaceChildren();
  const overlay=document.createElement('canvas');overlay.id='camera-projection';overlay.className='camera-projection';view.append(overlay);
  const marker=document.createElement('div');marker.id='camera-marker';marker.className='camera-marker';marker.hidden=true;view.append(marker);
  if(ready)view.append(image);
  else {const empty=document.createElement('div');empty.className='empty';empty.textContent=paired?(cameraCache.hasFailed(index)?'CAMERA IMAGE FAILED TO LOAD':'BUFFERING CAMERA…'):'NO CAMERA FRAME';view.append(empty)}
  updateCameraProjection();
}
function draw(){if(!frames.length)return;trackWorkbench.update(index);if(measurementFrame!==index){clearMeasure();selectedPoint.visible=false;(el('focus-selection') as HTMLButtonElement).disabled=true;measurementFrame=index}const f=frames[index];el('frame').textContent='FRAME '+String(index).padStart(3,'0');el('time').textContent=f.time.toFixed(2)+' s';(el('timeline') as HTMLInputElement).value=String(index);showCamera(f);const points=f.points??cache.get(index);if(!points){renderedIndex=-1;geo.setDrawRange(0,0);markers.clear();el('count').textContent='LOADING';accumulatedCloud.visible=false;trajectory.visible=false;return}renderedIndex=index;const pts=points,n=pts.length/4;ensure(n);const pa=geo.attributes.position as THREE.BufferAttribute,ca=geo.attributes.color as THREE.BufferAttribute,pos=pa.array as Float32Array,col=ca.array as Float32Array;for(let i=0;i<n;i++){const j=i*4,k=i*3,z=pts[j+2],h=THREE.MathUtils.clamp((z+3)/8,0,1);pos[k]=pts[j];pos[k+1]=pts[j+1];pos[k+2]=z;if(colorMode==='intensity'){
    const v=THREE.MathUtils.clamp(pts[j+3],0,1);col[k]=v;col[k+1]=v;col[k+2]=v;
  }else if(colorMode==='range'){
    const v=THREE.MathUtils.clamp(Math.hypot(pts[j],pts[j+1],z)/90,0,1);
    col[k]=v;col[k+1]=.8*(1-v);col[k+2]=1-v;
  }else{col[k]=.12+.65*h;col[k+1]=.7-.23*h;col[k+2]=.95-.25*h}}for(const a of [pa,ca]){a.clearUpdateRanges();a.addUpdateRange(0,n*3);a.needsUpdate=true}geo.setDrawRange(0,n);geo.boundingSphere=null;markers.clear();for(const note of notes.filter(x=>x.frame===index)){const m=new THREE.Mesh(markerGeo,markerMat);m.position.set(...note.position);markers.add(m)}el('count').textContent=n.toLocaleString();if(f.calibration)updateCameraProjection();updateAccumulation();updateTrajectory();const list=el('notes');list.replaceChildren();for(const note of notes){const row=document.createElement('div');row.className='annotation';row.textContent='#'+note.id+' · '+note.label+' · frame '+note.frame;list.append(row)}}
// Binary PCD → interleaved x,y,z,intensity, the KITTI .bin layout used everywhere else
function parsePCD(buf:ArrayBuffer){const text=new TextDecoder().decode(new Uint8Array(buf,0,Math.min(buf.byteLength,4096))),at=text.indexOf('\nDATA ');if(at<0)throw Error('Not a PCD file');const lines=text.slice(0,at).split('\n'),get=(k:string)=>lines.find(l=>l.startsWith(k+' '))?.trim().split(/\s+/).slice(1)??[];const eol=text.indexOf('\n',at+1),mode=text.slice(at+6,eol).trim();if(mode!=='binary')throw Error('Unsupported PCD data: '+mode);const fields=get('FIELDS'),size=get('SIZE').map(Number),type=get('TYPE'),count=get('COUNT').map(Number),n=Number(get('POINTS')[0]);let stride=0;const off:Record<string,number>={};fields.forEach((f,i)=>{off[f]=stride;stride+=size[i]*(count[i]||1)});const isF32=(f:string)=>{const i=fields.indexOf(f);return i>=0&&type[i]==='F'&&size[i]===4};if(!isF32('x')||!isF32('y')||!isF32('z'))throw Error('PCD needs float32 x, y, z');const hasI=isF32('intensity'),v=new DataView(buf,eol+1),out=new Float32Array(n*4);if(v.byteLength<n*stride)throw Error('PCD file is truncated');for(let p=0,b=0;p<n;p++,b+=stride){out[p*4]=v.getFloat32(b+off.x,true);out[p*4+1]=v.getFloat32(b+off.y,true);out[p*4+2]=v.getFloat32(b+off.z,true);out[p*4+3]=hasI?v.getFloat32(b+off.intensity,true):0}return out}
function setFrames(next:Frame[],mode:string,tracks:ObjectTrack[]=[]){setPlaying(false);shownCameraFrame=undefined;frames=next;accumulatedCloud.visible=false;selectedPoint.visible=false;(el('focus-selection') as HTMLButtonElement).disabled=true;notes=[];index=0;renderedIndex=-1;measurementFrame=-1;trackWorkbench.setRecording(next,tracks);cameraCache.reset(0);cache.reset(next[0]?.url||next[0]?.file?next.length:0);cameraCache.reset(next.length);accumulationDirty=true;(el('timeline') as HTMLInputElement).max=String(frames.length-1);el('mode').textContent=mode;el('recording-capabilities').textContent=[next.some(f=>f.url||f.file)?'LIDAR':'',next.some(f=>f.imageFile||f.imageUrl)?'RGB CAMERA':'',next.some(f=>f.calibration)?'CALIBRATED':'',next.some(f=>f.pose)?'POSES':'',tracks.length?tracks.length+' TRACKS':''].filter(Boolean).join(' · ');
  const matched=next.filter(f=>f.imageFile||f.imageUrl).length;
  el('camera-sync').textContent=matched+' / '+next.length+' MATCHED';
  geo.setDrawRange(0,0);el('count').textContent='—';draw()}
function setPlaying(p:boolean){playing=p;last=performance.now();el('play').textContent=p?'Ⅱ':'▶'}
function seekFrame(next:number){
  if(!frames.length)return;
  last=performance.now();
  index=Math.max(0,Math.min(frames.length-1,next));
  cache.seek(index);cameraCache.seek(index);
  draw();
}
el('prev-frame').onclick=()=>{setPlaying(false);seekFrame(index-1)};
el('next-frame').onclick=()=>{setPlaying(false);seekFrame(index+1)};
(el('playback-speed') as HTMLSelectElement).onchange=e=>{playbackSpeed=Number((e.target as HTMLSelectElement).value);last=performance.now()};
document.addEventListener('keydown',e=>{
  const target=e.target as HTMLElement;
  if(target.closest('input,textarea,select,button')||e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key==='ArrowLeft'){e.preventDefault();setPlaying(false);seekFrame(index-1)}
  else if(e.key==='ArrowRight'){e.preventDefault();setPlaying(false);seekFrame(index+1)}
  else if(e.code==='Space'){e.preventDefault();setPlaying(!playing)}
  else if(e.key.toLowerCase()==='f'&&selectedPoint.visible){e.preventDefault();el('focus-selection').click()}
});
let recordingRequest=0;
function streamOnline(){recordingRequest++;el('status').textContent='Connecting to '+STREAM.source;setFrames(Array.from({length:STREAM.count},(_,i)=>{const name=String(i).padStart(10,'0');return {time:i*.1,name,url:STREAM.base+name+'.pcd'}}),'ONLINE SAMPLE');setPlaying(true)}
el('load-manifest').onclick=async()=>{
  const request=++recordingRequest;
  const button=el('load-manifest') as HTMLButtonElement;
  try{
    button.disabled=true;
    const url=(el('manifest-url') as HTMLInputElement).value.trim();
    if(!url)throw Error('Enter an HTTPS manifest URL');
    const parsed=new URL(url);
    if(!['https:','http:'].includes(parsed.protocol))throw Error('Manifest URL must be HTTP(S)');
    el('status').textContent='Loading remote recording manifest…';
    const response=await fetch(parsed.href);
    if(!response.ok)throw Error('Manifest HTTP '+response.status);
    const result=validateManifest(await response.json(),parsed.href);
    if(request!==recordingRequest)return;setPlaying(false);setFrames(result.frames,result.name,result.tracks);
    el('status').textContent=result.frames.length+' remote frames indexed · '+result.frames.filter(f=>f.imageUrl).length+' camera frames · '+result.frames.filter(f=>f.pose).length+' poses';
  }catch(error){if(request===recordingRequest)el('status').textContent='Manifest error: '+String(error)}
  finally{button.disabled=false}
};
function loadPairedExample(){recordingRequest++;
  setPlaying(false);
  const base='https://raw.githubusercontent.com/azureology/kitti-velo2cam/master/';
  setFrames([{time:0,name:'000007',url:base+'data_object_velodyne/testing/velodyne/000007.bin',imageUrl:base+'data_object_image_2/testing/image_2/000007.png',calibration:SAMPLE_CALIBRATION}],'KITTI CAMERA + LIDAR');
  el('status').textContent='Loading paired KITTI example from azureology/kitti-velo2cam';
}
el('fusion').onclick=loadPairedExample;
async function loadShowcase(){
  const request=++recordingRequest;
  try{
    setPlaying(false);el('status').textContent='Loading real KITTI drive…';
    const url=new URL('demo/manifest.json',document.baseURI).href;
    const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('Dataset HTTP '+response.status);
    const result=validateManifest(await response.json(),url);if(request!==recordingRequest)return;
    setFrames(result.frames,result.name,result.tracks);setPlaying(true);
  }catch(error){if(request===recordingRequest){el('mode').textContent='SHOWCASE UNAVAILABLE';el('status').textContent=String(error)+' · Use recordings to retry or import data.';el('transport-status').textContent='DATA ERROR'}}
}
el('showcase').onclick=()=>void loadShowcase();
(el('calibration-files') as HTMLInputElement).onchange=async e=>{
  const request=recordingRequest,files=Array.from((e.target as HTMLInputElement).files??[]);
  try{
    const cam=files.find(f=>f.name==='calib_cam_to_cam.txt'),velo=files.find(f=>f.name==='calib_velo_to_cam.txt');
    const calibration=cam&&velo?readRawCalibration(await cam.text(),await velo.text()):files.length===1?readObjectCalibration(await files[0].text()):undefined;
    if(!calibration)throw Error('Select both Raw calibration files, or one Object calibration file');
    if(request!==recordingRequest)return;
    for(const frame of frames)frame.calibration=calibration;
    el('import-status').textContent='Calibration applied to '+frames.length+' frames';updateCameraProjection();updateBufferStatus();
  }catch(error){el('import-status').textContent=String(error)}
};
function annotate(p:THREE.Vector3){notes.push({id:nextId++,frame:index,label:(el('label') as HTMLInputElement).value||'object',position:[p.x,p.y,p.z]});draw()}
el('add').onclick=()=>annotate(new THREE.Vector3(0,0,0));
// Double click snaps to the nearest scan point under the cursor, otherwise to the ground plane
const ray=new THREE.Raycaster();ray.params.Points.threshold=.25;const ground=new THREE.Plane(new THREE.Vector3(0,0,1),-GROUND_Z);
let pointerStart:[number,number]=[0,0];
renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY]});
renderer.domElement.addEventListener('click',e=>{
  if(Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
  if(renderedIndex!==index||geo.drawRange.count===0||e.detail>1)return;
  const r=renderer.domElement.getBoundingClientRect();
  const mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);
  ray.setFromCamera(mouse,camera);
  if(toolMode==='inspect'&&!e.altKey&&trackWorkbench.pick(ray))return;
  const hit=ray.intersectObject(cloud)[0];
  if(hit?.index===undefined)return;
  const points=frames[index].points??cache.get(index);
  if(!points)return;
  const k=hit.index*4,p=new THREE.Vector3(points[k],points[k+1],points[k+2]);
  if(toolMode==='measure'){
    if(measurePoints.length===2)measurePoints=[];
    measurePoints.push(p);updateMeasure();
  }else{
    if(frames[index].calibration)selectProjectedPoint(hit.index,points);
    else el('inspection').textContent='Point #'+hit.index+' · X '+p.x.toFixed(3)+' m · Y '+p.y.toFixed(3)+' m · Z '+p.z.toFixed(3)+' m · Intensity '+points[k+3].toFixed(4)+' · Range '+p.length().toFixed(2)+' m';
  }
});
renderer.domElement.addEventListener('dblclick',e=>{const r=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(mouse,camera);geo.computeBoundingSphere();const hit=ray.intersectObject(cloud)[0];if(hit?.index!==undefined){const p=geo.attributes.position.array,k=hit.index*3;annotate(new THREE.Vector3(p[k],p[k+1],p[k+2]));return}const p=new THREE.Vector3();if(ray.ray.intersectPlane(ground,p))annotate(p)});
el('export').onclick=()=>{const blob=new Blob([JSON.stringify({schema:'rant/annotations/v1',notes},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rant-annotations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
el('play').onclick=()=>setPlaying(!playing);
el('stream').onclick=streamOnline;
(el('timeline') as HTMLInputElement).oninput=e=>{const next=Number((e.target as HTMLInputElement).value);if(next!==index)seekFrame(next)};
(el('folder') as HTMLInputElement).onchange=async e=>{const request=++recordingRequest;const files=Array.from((e.target as HTMLInputElement).files||[]);const scans=files.filter(f=>/velodyne_points\/data\/[^/]+\.bin$/i.test(f.webkitRelativePath)).sort((a,b)=>a.name.localeCompare(b.name));const images=new Map(files.filter(f=>/image_02\/data\/[^/]+\.(png|jpe?g)$/i.test(f.webkitRelativePath)).map(f=>[f.name.replace(/\.[^.]+$/,''),f]));if(!scans.length){el('status').textContent='No KITTI .bin scans found';return}setPlaying(false);
  const stampFile=files.find(f=>/velodyne_points\/timestamps\.txt$/i.test(f.webkitRelativePath));
  const lidarTimes=stampFile?parseKittiTimestamps(await stampFile.text(),false):undefined;
  const absoluteLidar=lidarTimes?.length===scans.length?lidarTimes:undefined;
  const seconds=absoluteLidar?.map(t=>t-absoluteLidar[0]);
  const cameraFiles=files.filter(f=>/image_02\/data\/[^/]+\.(png|jpe?g)$/i.test(f.webkitRelativePath)).sort((a,b)=>a.name.localeCompare(b.name));
  const cameraStampFile=files.find(f=>/image_02\/timestamps\.txt$/i.test(f.webkitRelativePath));
  const cameraTimes=cameraStampFile?parseKittiTimestamps(await cameraStampFile.text(),false):undefined;
  const absoluteCamera=cameraTimes?.length===cameraFiles.length?cameraTimes:undefined;
  const cameraByName=new Map(cameraFiles.map(f=>[f.name.replace(/\.[^.]+$/,''),f]));
  let calibration:KittiCalibration|undefined;
  const cameraCalib=files.find(f=>/(?:^|\/)calib_cam_to_cam\.txt$/i.test(f.webkitRelativePath));
  const veloCalib=files.find(f=>/(?:^|\/)calib_velo_to_cam\.txt$/i.test(f.webkitRelativePath));
  const objectCalib=files.find(f=>/(?:^|\/)calib\/[^/]+\.txt$/i.test(f.webkitRelativePath));
  try{
    if(cameraCalib&&veloCalib)calibration=readRawCalibration(await cameraCalib.text(),await veloCalib.text());
    else if(objectCalib)calibration=readObjectCalibration(await objectCalib.text());
  }catch(error){el('status').textContent='Calibration could not be parsed: '+String(error)}
  const poseFile=files.find(f=>/(?:^|\/)(?:poses|world_from_velodyne)\.txt$/i.test(f.webkitRelativePath));
  let poses:number[][]|undefined;
  if(poseFile){
    const parsed=(await poseFile.text()).trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/).map(Number));
    if(parsed.length===scans.length&&parsed.every(isRigidPose))poses=parsed;
    else el('status').textContent='Pose file ignored: expected one 3×4 world-from-Velodyne matrix per scan';
  }
  const next:Frame[]=scans.map((file,i)=>{
    const name=file.name.replace(/\.bin$/i,'');
    const cameraIndex=absoluteLidar&&absoluteCamera?nearestTimestampIndex(absoluteCamera,absoluteLidar[i],0.05):undefined;
    return {time:seconds?.[i]??i*.1,cameraTime:cameraIndex!==undefined&&absoluteCamera&&absoluteLidar?absoluteCamera[cameraIndex]-absoluteLidar[0]:undefined,file,imageFile:cameraIndex===undefined?(!absoluteLidar||!absoluteCamera?cameraByName.get(name):undefined):cameraFiles[cameraIndex],calibration,pose:poses?.[i],name};
  });
  if(request!==recordingRequest)return;setFrames(next,'KITTI RAW');el('status').textContent=frames.length+' scans indexed lazily · '+(seconds?.length?'KITTI timestamps':'assumed 10 Hz')+' · '+(calibration?'calibrated camera':'no camera calibration');};
new ResizeObserver(()=>{const v=el('view');if(v.clientWidth&&v.clientHeight){renderer.setSize(v.clientWidth,v.clientHeight);camera.aspect=v.clientWidth/v.clientHeight;camera.updateProjectionMatrix()}}).observe(el('view'));
new ResizeObserver(updateCameraProjection).observe(el('camera'));
// Playback waits on the next scan, so a slow stream buffers instead of skipping
let lastAccumulation=0;
function cameraReady(i:number){return !(frames[i]?.imageFile||frames[i]?.imageUrl)||!!cameraCache.get(i)?.naturalWidth||cameraCache.hasFailed(i)}
function loop(now:number){
  requestAnimationFrame(loop);
  let buffering=false;
  if(playing&&frames.length>1){
    const next=(index+1)%frames.length;
    const dt=next>index?frames[next].time-frames[index].time:frames[1].time-frames[0].time;
    const delay=Math.max(10,Math.min(2000,dt*1000/playbackSpeed));
    if(now-last>=delay){
      buffering=!(frames[next].points||cache.get(next))||!cameraReady(next)||renderedIndex!==index||!cameraReady(index);
      if(!buffering){last=now;index=next;cache.seek(next);cameraCache.seek(next);draw()}
    }
  }
  el('transport-status').textContent=buffering?'BUFFERING':playing?'PLAYING':frames.length?'PAUSED':el('mode').textContent==='SHOWCASE UNAVAILABLE'?'DATA ERROR':'CONNECTING';
  if(accumulationDirty&&now-lastAccumulation>120&&renderedIndex===index){updateAccumulation();lastAccumulation=now}
  controls.update();renderer.render(scene,camera);
}
if((globalThis as any).RANT_STREAM)streamOnline();else void loadShowcase();
requestAnimationFrame(loop);
