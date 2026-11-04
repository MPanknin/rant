import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { TimelineCache } from './data/timeline-cache';
import { parseKittiTimestamps, nearestTimestampIndex } from './data/synchronization';

type Frame={time:number;points?:Float32Array;url?:string;file?:File;image?:string;imageFile?:File;name:string};
type Note={id:number;frame:number;label:string;position:[number,number,number]};
// Online sample: consecutive HDL-64 street scans (binary PCD, KITTI-derived) from Udacity's SFND course repo, served by GitHub with CORS.
// A host page can point the stream elsewhere by defining window.RANT_STREAM before this script runs.
const STREAM:{base:string;count:number;source:string}=(globalThis as any).RANT_STREAM??{base:'https://raw.githubusercontent.com/udacity/SFND_Lidar_Obstacle_Detection/ef15da2bc172359e7d6edfdd156a2a243d10977e/src/sensors/data/pcd/data_2/',count:154,source:'udacity/SFND_Lidar_Obstacle_Detection on GitHub'};
const AHEAD=20,BEHIND=4,PARALLEL=4;// 128 MiB decoded-frame budget plus a playhead-centered prefetch window
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<header><b>◉ RANT <span>/ ROBOT SENSOR CONSOLE</span></b><a href="https://www.cvlibs.net/datasets/kitti/raw_data.php" target="_blank" rel="noopener">KITTI RAW DATA ↗</a></header><main><section id="viewport"><div id="view"></div><div class="float pane">SPATIAL VIEW · <span id="count">—</span> POINTS</div><div class="hint">Drag orbit · Scroll zoom · Right drag pan · Click inspect / measure · Double click annotate</div><div class="tools"><button id="inspect-mode" class="selected">INSPECT</button><button id="measure-mode">MEASURE</button><button id="clear-measure">CLEAR</button></div><div id="measure-overlay" class="measure-overlay">Click a point to inspect its XYZ and intensity.</div></section><aside><div class="pane">CAMERA / IMAGE_02</div><div id="camera" class="camera"><div class="empty">NO CAMERA FRAME<br/>Import KITTI images to inspect</div></div><div class="pane">DATASET / <span id="mode">SYNTHETIC</span></div><div class="panel"><p>Streams ${STREAM.count} consecutive HDL-64 scans from ${STREAM.source}, buffering about 2 s ahead. Or select a local KITTI Raw sync folder containing velodyne_points/data and optionally image_02/data.</p><div class="actions"><button id="stream" class="upload">STREAM ONLINE SAMPLE</button><label class="upload">IMPORT KITTI FOLDER<input id="folder" type="file" webkitdirectory multiple /></label></div><p id="status"></p></div><div class="pane">POINT INSPECTOR</div><div class="panel" id="inspection">Select a point in the 3D view.</div><div class="pane">ANNOTATIONS</div><div class="panel"><input id="label" type="text" value="object" placeholder="Label"/><button id="add">ADD AT ORIGIN</button> <button id="export">EXPORT JSON</button><div id="notes"></div></div><div class="pane">COORDINATES</div><div class="panel"><p>KITTI Velodyne: X forward, Y left, Z up. Camera projection and ego-motion compensation are not implemented.</p></div></aside></main><footer><button id="play">▶</button><span id="frame">FRAME 000</span><input id="timeline" type="range" min="0" max="23" value="0"/><span id="time">0.0 s</span></footer>`;
const el=(id:string)=>document.getElementById(id)!;
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0a111c);el('view').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x0a111c,.007);
const camera=new THREE.PerspectiveCamera(58,1,.1,1200);camera.up.set(0,0,1);camera.position.set(24,-30,19);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(12,0,0);controls.enableDamping=true;controls.update();
const grid=new THREE.GridHelper(140,70,0x36516a,0x1d2c40);grid.rotateX(Math.PI/2);scene.add(grid,new THREE.AxesHelper(4));
const GROUND_Z=-1.73;// KITTI Velodyne sits ~1.73 m above the road
// One reusable point buffer: grows to the largest frame, afterwards only its contents are updated
const geo=new THREE.BufferGeometry();let cap=0;
function ensure(n:number){if(n<=cap)return;cap=Math.ceil(n*1.1);geo.dispose();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(cap*3),3));geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(cap*3),3))}
const cloud=new THREE.Points(geo,new THREE.PointsMaterial({size:.095,vertexColors:true}));cloud.frustumCulled=false;
const markerGeo=new THREE.SphereGeometry(.35,10,8),markerMat=new THREE.MeshBasicMaterial({color:0xffbd70});
const markers=new THREE.Group();scene.add(cloud,markers);
const measurement=new THREE.Group();scene.add(measurement);
const measureMaterial=new THREE.LineBasicMaterial({color:0xffc46b,depthTest:false});
const measurePointMaterial=new THREE.MeshBasicMaterial({color:0xffc46b,depthTest:false});
let toolMode:'inspect'|'measure'='inspect';
let measurePoints:THREE.Vector3[]=[];
function clearMeasure(){measurePoints=[];measurement.clear();el('measure-overlay').textContent='Click two LiDAR points to measure their distance.'}
function updateMeasure(){
  measurement.clear();
  for(const p of measurePoints){const m=new THREE.Mesh(new THREE.SphereGeometry(.18,8,6),measurePointMaterial);m.position.copy(p);measurement.add(m)}
  if(measurePoints.length===2){
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePoints),measureMaterial);
    line.renderOrder=5;measurement.add(line);
    const delta=measurePoints[1].clone().sub(measurePoints[0]);
    el('measure-overlay').textContent='Distance '+delta.length().toFixed(3)+' m · ΔX '+delta.x.toFixed(2)+' · ΔY '+delta.y.toFixed(2)+' · ΔZ '+delta.z.toFixed(2);
  }else el('measure-overlay').textContent='Select second point to measure distance.';
}
el('inspect-mode').onclick=()=>{toolMode='inspect';el('inspect-mode').classList.add('selected');el('measure-mode').classList.remove('selected');el('measure-overlay').textContent='Click a LiDAR point to inspect XYZ and intensity.'};
el('measure-mode').onclick=()=>{toolMode='measure';el('measure-mode').classList.add('selected');el('inspect-mode').classList.remove('selected');clearMeasure()};
el('clear-measure').onclick=clearMeasure;

let frames:Frame[]=[];
let index=0,playing=false,last=0,nextId=1;let notes:Note[]=[];
const cache=new TimelineCache<Float32Array>({
  ahead:AHEAD,behind:BEHIND,concurrency:PARALLEL,maxResidentBytes:128*1024*1024,
  sizeOf:points=>points.byteLength,
  load:async(i,signal)=>{
    const f=frames[i];
    let buf:ArrayBuffer;
    if(f.file){buf=await f.file.arrayBuffer();if(signal.aborted)throw new DOMException('Aborted','AbortError');if(buf.byteLength%16)throw Error('Invalid Velodyne binary: '+f.name)}
    else {const r=await fetch(f.url!,{signal});if(!r.ok)throw Error('HTTP '+r.status+' for scan '+f.name);buf=await r.arrayBuffer()}
    return {value:f.file?new Float32Array(buf):parsePCD(buf),bytes:buf.byteLength};
  },
  onChange:()=>{updateBufferStatus();if(frames[index]&&cache.get(index)&&renderedIndex!==index)draw()},
  onError:(i,error)=>{setPlaying(false);el('status').textContent='Frame '+frames[i]?.name+' failed: '+String(error)}
});
let renderedIndex=-1;let lastImageFrame:Frame|undefined;let measurementFrame=-1;
function updateBufferStatus(){const stats=cache.stats;const source=frames[0]?.file?'local KITTI folder':STREAM.source;el('status').textContent=`${stats.resident} / ${frames.length} cached · ${(stats.residentBytes/1048576).toFixed(1)} / 128 MiB resident · ${stats.active} active · ${(stats.bytesRead/1048576).toFixed(1)} MiB read · hits ${stats.hits} / misses ${stats.misses} · last seek ${stats.lastSeekMs.toFixed(0)} ms · ${stats.failures} failed · ${source}`;}
function draw(){if(!frames.length)return;if(measurementFrame!==index){clearMeasure();measurementFrame=index}const f=frames[index];if(lastImageFrame&&lastImageFrame!==f&&lastImageFrame.image){URL.revokeObjectURL(lastImageFrame.image);lastImageFrame.image=undefined}lastImageFrame=f;el('frame').textContent='FRAME '+String(index).padStart(3,'0');el('time').textContent=f.time.toFixed(2)+' s';(el('timeline') as HTMLInputElement).value=String(index);const points=f.points??cache.get(index);if(!points){renderedIndex=-1;geo.setDrawRange(0,0);markers.clear();el('count').textContent='LOADING';el('camera').textContent='LOADING FRAME';return}renderedIndex=index;const pts=points,n=pts.length/4;ensure(n);const pa=geo.attributes.position as THREE.BufferAttribute,ca=geo.attributes.color as THREE.BufferAttribute,pos=pa.array as Float32Array,col=ca.array as Float32Array;for(let i=0;i<n;i++){const j=i*4,k=i*3,z=pts[j+2],h=THREE.MathUtils.clamp((z+3)/8,0,1);pos[k]=pts[j];pos[k+1]=pts[j+1];pos[k+2]=z;col[k]=.12+.65*h;col[k+1]=.7-.23*h;col[k+2]=.95-.25*h}for(const a of [pa,ca]){a.clearUpdateRanges();a.addUpdateRange(0,n*3);a.needsUpdate=true}geo.setDrawRange(0,n);markers.clear();for(const note of notes.filter(x=>x.frame===index)){const m=new THREE.Mesh(markerGeo,markerMat);m.position.set(...note.position);markers.add(m)}el('count').textContent=n.toLocaleString();const view=el('camera');view.replaceChildren();if(f.imageFile&&!f.image)f.image=URL.createObjectURL(f.imageFile);if(f.image){const img=document.createElement('img');img.src=f.image;img.alt='Camera frame '+f.name;view.append(img)}else view.textContent='NO CAMERA FRAME';const list=el('notes');list.replaceChildren();for(const note of notes){const row=document.createElement('div');row.className='annotation';row.textContent='#'+note.id+' · '+note.label+' · frame '+note.frame;list.append(row)}}
// Binary PCD → interleaved x,y,z,intensity, the KITTI .bin layout used everywhere else
function parsePCD(buf:ArrayBuffer){const text=new TextDecoder().decode(new Uint8Array(buf,0,Math.min(buf.byteLength,4096))),at=text.indexOf('\nDATA ');if(at<0)throw Error('Not a PCD file');const lines=text.slice(0,at).split('\n'),get=(k:string)=>lines.find(l=>l.startsWith(k+' '))?.trim().split(/\s+/).slice(1)??[];const eol=text.indexOf('\n',at+1),mode=text.slice(at+6,eol).trim();if(mode!=='binary')throw Error('Unsupported PCD data: '+mode);const fields=get('FIELDS'),size=get('SIZE').map(Number),type=get('TYPE'),count=get('COUNT').map(Number),n=Number(get('POINTS')[0]);let stride=0;const off:Record<string,number>={};fields.forEach((f,i)=>{off[f]=stride;stride+=size[i]*(count[i]||1)});const isF32=(f:string)=>{const i=fields.indexOf(f);return i>=0&&type[i]==='F'&&size[i]===4};if(!isF32('x')||!isF32('y')||!isF32('z'))throw Error('PCD needs float32 x, y, z');const hasI=isF32('intensity'),v=new DataView(buf,eol+1),out=new Float32Array(n*4);if(v.byteLength<n*stride)throw Error('PCD file is truncated');for(let p=0,b=0;p<n;p++,b+=stride){out[p*4]=v.getFloat32(b+off.x,true);out[p*4+1]=v.getFloat32(b+off.y,true);out[p*4+2]=v.getFloat32(b+off.z,true);out[p*4+3]=hasI?v.getFloat32(b+off.intensity,true):0}return out}
function setFrames(next:Frame[],mode:string){if(lastImageFrame?.image){URL.revokeObjectURL(lastImageFrame.image);lastImageFrame.image=undefined}lastImageFrame=undefined;frames=next;notes=[];index=0;renderedIndex=-1;measurementFrame=-1;cache.reset(next[0]?.url||next[0]?.file?next.length:0);(el('timeline') as HTMLInputElement).max=String(frames.length-1);el('mode').textContent=mode;geo.setDrawRange(0,0);el('count').textContent='—';draw()}
function setPlaying(p:boolean){playing=p;el('play').textContent=p?'Ⅱ':'▶'}
function streamOnline(){el('status').textContent='Connecting to '+STREAM.source;setFrames(Array.from({length:STREAM.count},(_,i)=>{const name=String(i).padStart(10,'0');return {time:i*.1,name,url:STREAM.base+name+'.pcd'}}),'ONLINE SAMPLE');setPlaying(true)}
function annotate(p:THREE.Vector3){notes.push({id:nextId++,frame:index,label:(el('label') as HTMLInputElement).value||'object',position:[p.x,p.y,p.z]});draw()}
el('add').onclick=()=>annotate(new THREE.Vector3(0,0,0));
// Double click snaps to the nearest scan point under the cursor, otherwise to the ground plane
const ray=new THREE.Raycaster();ray.params.Points.threshold=.25;const ground=new THREE.Plane(new THREE.Vector3(0,0,1),-GROUND_Z);
renderer.domElement.addEventListener('click',e=>{
  if(renderedIndex!==index||geo.drawRange.count===0||e.detail>1)return;
  const r=renderer.domElement.getBoundingClientRect();
  const mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);
  ray.setFromCamera(mouse,camera);
  const hit=ray.intersectObject(cloud)[0];
  if(hit?.index===undefined)return;
  const points=frames[index].points??cache.get(index);
  if(!points)return;
  const k=hit.index*4,p=new THREE.Vector3(points[k],points[k+1],points[k+2]);
  if(toolMode==='measure'){
    if(measurePoints.length===2)measurePoints=[];
    measurePoints.push(p);updateMeasure();
  }else{
    el('inspection').textContent='Point #'+hit.index+' · X '+p.x.toFixed(3)+' m · Y '+p.y.toFixed(3)+' m · Z '+p.z.toFixed(3)+' m · Intensity '+points[k+3].toFixed(4)+' · Range '+p.length().toFixed(2)+' m';
  }
});
renderer.domElement.addEventListener('dblclick',e=>{const r=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(mouse,camera);geo.computeBoundingSphere();const hit=ray.intersectObject(cloud)[0];if(hit?.index!==undefined){const p=geo.attributes.position.array,k=hit.index*3;annotate(new THREE.Vector3(p[k],p[k+1],p[k+2]));return}const p=new THREE.Vector3();if(ray.ray.intersectPlane(ground,p))annotate(p)});
el('export').onclick=()=>{const blob=new Blob([JSON.stringify({schema:'rant/annotations/v1',notes},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rant-annotations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
el('play').onclick=()=>setPlaying(!playing);
el('stream').onclick=streamOnline;
(el('timeline') as HTMLInputElement).oninput=e=>{const next=Number((e.target as HTMLInputElement).value);if(next===index)return;index=next;cache.seek(next);if(renderedIndex!==next)draw()};
(el('folder') as HTMLInputElement).onchange=async e=>{const files=Array.from((e.target as HTMLInputElement).files||[]);const scans=files.filter(f=>/velodyne_points\/data\/[^/]+\.bin$/i.test(f.webkitRelativePath)).sort((a,b)=>a.name.localeCompare(b.name));const images=new Map(files.filter(f=>/image_02\/data\/[^/]+\.(png|jpe?g)$/i.test(f.webkitRelativePath)).map(f=>[f.name.replace(/\.[^.]+$/,''),f]));if(!scans.length){el('status').textContent='No KITTI .bin scans found';return}setPlaying(false);
  const stampFile=files.find(f=>/velodyne_points\/timestamps\.txt$/i.test(f.webkitRelativePath));
  const lidarTimes=stampFile?parseKittiTimestamps(await stampFile.text(),false):undefined;
  const absoluteLidar=lidarTimes?.length===scans.length?lidarTimes:undefined;
  const seconds=absoluteLidar?.map(t=>t-absoluteLidar[0]);
  const cameraFiles=files.filter(f=>/image_02\/data\/[^/]+\.(png|jpe?g)$/i.test(f.webkitRelativePath)).sort((a,b)=>a.name.localeCompare(b.name));
  const cameraStampFile=files.find(f=>/image_02\/timestamps\.txt$/i.test(f.webkitRelativePath));
  const cameraTimes=cameraStampFile?parseKittiTimestamps(await cameraStampFile.text(),false):undefined;
  const absoluteCamera=cameraTimes?.length===cameraFiles.length?cameraTimes:undefined;
  const cameraByName=new Map(cameraFiles.map(f=>[f.name.replace(/\.[^.]+$/,''),f]));
  const next:Frame[]=scans.map((file,i)=>{
    const name=file.name.replace(/\.bin$/i,'');
    const cameraIndex=absoluteLidar&&absoluteCamera?nearestTimestampIndex(absoluteCamera,absoluteLidar[i],0.05):undefined;
    return {time:seconds?.[i]??i*.1,file,imageFile:cameraIndex===undefined?(!absoluteLidar||!absoluteCamera?cameraByName.get(name):undefined):cameraFiles[cameraIndex],name};
  });
  setFrames(next,'KITTI RAW');el('status').textContent=frames.length+' scans indexed lazily · '+(seconds?.length?'KITTI timestamps':'assumed 10 Hz');};
new ResizeObserver(()=>{const v=el('view');if(v.clientWidth&&v.clientHeight){renderer.setSize(v.clientWidth,v.clientHeight);camera.aspect=v.clientWidth/v.clientHeight;camera.updateProjectionMatrix()}}).observe(el('view'));
// Playback waits on the next scan, so a slow stream buffers instead of skipping
function loop(now:number){requestAnimationFrame(loop);if(playing&&frames.length&&now-last>=100){const next=(index+1)%frames.length;if(frames[next].points||cache.get(next)){last=now;index=next;cache.seek(next);if(renderedIndex!==next)draw()}}controls.update();renderer.render(scene,camera)}streamOnline();requestAnimationFrame(loop);
