import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Frame} from '../data/types';
import {sampleAt,objectPoint,projectedBox,projectedHull,inHull,presenceRanges,trackPath,estimatedSpeed,type ObjectTrack} from '../data/tracks';

const COLORS:Record<string,string>={Car:'#65d6e6',Van:'#74aaff',Pedestrian:'#ffab70',Cyclist:'#ce9aff'};
const SELECTED='#ffe08a';
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svgNode=(name:string)=>document.createElementNS('http://www.w3.org/2000/svg',name);

/** Owns annotation visualization, selection and follow state; never loads sensor data. */
export class TrackWorkbench {
  private frames:Frame[]=[];
  private tracks:ObjectTrack[]=[];
  private index=0;
  private selected:string|undefined;
  private boxes=new Map<string,{group:THREE.Group;mesh:THREE.Mesh;fill:THREE.MeshBasicMaterial;edge:THREE.LineBasicMaterial}>();
  private root=new THREE.Group();
  private boxGeometry=new THREE.BoxGeometry(1,1,1);
  private edgeGeometry=new THREE.EdgesGeometry(this.boxGeometry);
  private pathGeometry=new THREE.BufferGeometry();
  private path=new THREE.LineSegments(this.pathGeometry,new THREE.LineBasicMaterial({color:SELECTED,transparent:true,opacity:.8}));
  private select=node<HTMLSelectElement>('track-select');
  private follow=node<HTMLInputElement>('follow-track');
  private visible=node<HTMLInputElement>('show-tracks');
  private frameKey=-1;
  constructor(private scene:THREE.Scene,private camera:THREE.PerspectiveCamera,private controls:OrbitControls,private seek:(frame:number)=>void){
    this.scene.add(this.root,this.path);this.path.frustumCulled=false;
    this.select.onchange=()=>this.selectTrack(this.select.value||undefined);
    this.visible.onchange=()=>{this.frameKey=-1;this.update(this.index)};
    this.follow.onchange=()=>{if(this.follow.checked)this.focus();this.renderPanel()};
    node('focus-track').onclick=()=>this.focus();
    node('clear-track').onclick=()=>this.selectTrack(undefined);
    node('track-first').onclick=()=>{const t=this.currentTrack();if(t)this.seek(t.samples[0].frame)};
    node('track-last').onclick=()=>{const t=this.currentTrack();if(t)this.seek(t.samples.at(-1)!.frame)};
  }
  get hasAnnotations(){return this.tracks.length>0}
  private currentTrack(){return this.tracks.find(t=>t.id===this.selected)}
  setRecording(frames:Frame[],tracks:ObjectTrack[]){
    for(const box of this.boxes.values()){box.fill.dispose();box.edge.dispose()}
    this.root.clear();this.boxes.clear();this.frames=frames;this.tracks=tracks;this.selected=undefined;this.follow.checked=false;this.frameKey=-1;
    this.select.replaceChildren(new Option(tracks.length?'Select an annotated object':'No object annotations',''));
    for(const track of tracks){
      this.select.add(new Option(`${track.label} #${track.id} · ${track.samples[0].frame}–${track.samples.at(-1)!.frame}`,track.id));
      const color=COLORS[track.label]??'#9dd5c0';
      const group=new THREE.Group(),fill=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.025,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(this.boxGeometry,fill);mesh.position.z=track.size[2]/2;mesh.scale.set(...track.size);mesh.userData.trackId=track.id;
      const edge=new THREE.LineBasicMaterial({color,transparent:true,opacity:.95});
      const wire=new THREE.LineSegments(this.edgeGeometry,edge);wire.position.copy(mesh.position);wire.scale.copy(mesh.scale);
      group.add(mesh,wire);this.root.add(group);this.boxes.set(track.id,{group,mesh,fill,edge});
    }
    this.select.disabled=!tracks.length;this.visible.disabled=!tracks.length;
    this.renderRanges();this.update(0);
  }
  selectTrack(id:string|undefined){
    this.selected=this.tracks.some(t=>t.id===id)?id:undefined;this.select.value=this.selected??'';
    if(!this.selected)this.follow.checked=false;
    this.frameKey=-1;this.update(this.index);this.renderRanges();
  }
  stopFollowing(){this.follow.checked=false;this.renderPanel()}
  update(index:number){
    if(this.frameKey===index)return;
    this.index=index;this.frameKey=index;
    const enabled=this.visible.checked;this.root.visible=enabled;
    let active=0;
    for(const track of this.tracks){
      const sample=sampleAt(track,index),box=this.boxes.get(track.id)!;
      box.group.visible=!!sample;if(!sample)continue;active++;
      box.group.position.set(...sample.position);box.group.rotation.set(...sample.rotation,'ZYX');
      const color=track.id===this.selected?SELECTED:COLORS[track.label]??'#9dd5c0';
      box.fill.color.set(color);box.fill.opacity=track.id===this.selected ? .12 : .025;box.edge.color.set(color);
    }
    node('track-count').textContent=`${active} HERE / ${this.tracks.length} TOTAL`;
    const track=this.currentTrack();
    const segments=track?trackPath(track,this.frames,index):[];
    const vertices=new Float32Array(segments.length*6);
    segments.forEach(([a,b],i)=>{vertices.set(a,i*6);vertices.set(b,i*6+3)});
    // Reuse the bounded position buffer across frames; allocate only when the selected track changes size.
    let attr=this.pathGeometry.getAttribute('position') as THREE.BufferAttribute|undefined;
    if(!attr||attr.array.length<vertices.length){this.pathGeometry.dispose();attr=new THREE.BufferAttribute(new Float32Array(vertices.length),3);this.pathGeometry.setAttribute('position',attr)}
    (attr.array as Float32Array).set(vertices);attr.needsUpdate=true;this.pathGeometry.setDrawRange(0,vertices.length/3);
    this.path.visible=enabled&&vertices.length>0;
    if(this.follow.checked)this.focus();
    this.renderPanel();this.renderCamera();
  }
  private focus(){
    const track=this.currentTrack(),sample=track&&sampleAt(track,this.index);if(!track||!sample)return;
    const target=new THREE.Vector3(...objectPoint(sample,0,0,track.size[2]/2));
    const delta=target.clone().sub(this.controls.target);this.camera.position.add(delta);this.controls.target.copy(target);this.controls.update();
    node('track-focus-state').textContent='Centered in 3D';
  }
  private renderPanel(){
    const track=this.currentTrack(),sample=track&&sampleAt(track,this.index);
    this.follow.disabled=!track;
    for(const id of ['track-first','track-last','clear-track'])(node(id) as HTMLButtonElement).disabled=!track;
    (node('focus-track') as HTMLButtonElement).disabled=!sample;
    node('track-inspector').dataset.trackId=track?.id??'';
    node('track-inspector').dataset.present=String(!!sample);
    if(!track){node('track-inspector').textContent=this.tracks.length?'Select a box in either view, or choose an object above. Alt-click inspects individual LiDAR returns.':'This recording does not supply object annotations.';node('track-focus-state').textContent='';return}
    const speed=estimatedSpeed(track,this.index,this.frames);
    node('track-inspector').textContent=`${track.label} #${track.id} · dataset annotation\nL ${track.size[0].toFixed(2)} × W ${track.size[1].toFixed(2)} × H ${track.size[2].toFixed(2)} m\n`+
      (sample?`Sensor XYZ ${sample.position.map(v=>v.toFixed(2)).join(' / ')} m\nWorld speed (estimated) ${speed===undefined?'unavailable':speed.toFixed(1)+' m/s'} · ${sample.state===2?'keyframe':sample.state===1?'interpolated label':'supplied label'}`:'Not annotated in this frame. Jump to its first or last observation.');
    node('track-focus-state').textContent=this.follow.checked?(sample?'Following · orbit and zoom remain available':'Follow paused · object outside annotated interval'):'Follow off';
  }
  private renderRanges(){
    const ribbon=node('track-range'),track=this.currentTrack();ribbon.replaceChildren();
    ribbon.hidden=!track;
    if(!track){node('track-time-label').textContent='';return}
    for(const [first,last] of presenceRanges(track)){
      const range=document.createElement('span');range.style.left=`${first/this.frames.length*100}%`;range.style.width=`${(last-first+1)/this.frames.length*100}%`;range.title=`${track.label} #${track.id}: frames ${first}–${last}`;ribbon.append(range);
    }
    const first=track.samples[0].frame,last=track.samples.at(-1)!.frame;
    node('track-time-label').textContent=`#${track.id} · ${this.frames[first].time.toFixed(1)}–${this.frames[last].time.toFixed(1)} s`;
    ribbon.setAttribute('aria-label',`Selected object annotated in frames ${presenceRanges(track).map(r=>r.join(' to ')).join(', ')}`);
  }
  renderCamera(){
    const view=node('camera'),img=view.querySelector('img'),calibration=this.frames[this.index]?.calibration;
    view.querySelector('#track-projection')?.remove();
    if(!this.visible.checked||!img?.naturalWidth||!calibration||img.alt!=='Camera frame '+this.frames[this.index].name)return;
    const scale=Math.min(view.clientWidth/img.naturalWidth,view.clientHeight/img.naturalHeight),width=img.naturalWidth,height=img.naturalHeight;
    if(!scale)return;
    const svg=svgNode('svg');svg.id='track-projection';svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-label','Projected dataset object annotations');
    Object.assign(svg.style,{left:(view.clientWidth-width*scale)/2+'px',top:(view.clientHeight-height*scale)/2+'px',width:width*scale+'px',height:height*scale+'px'});
    // Selected object is painted last so it remains legible when boxes overlap.
    const sorted=[...this.tracks].sort((a,b)=>Number(a.id===this.selected)-Number(b.id===this.selected));
    for(const track of sorted){
      const sample=sampleAt(track,this.index);if(!sample)continue;
      const lines=projectedBox(track,sample,calibration),hull=projectedHull(lines);if(!hull.length)continue;
      const xs=hull.map(p=>p[0]),ys=hull.map(p=>p[1]);
      if(Math.max(...xs)<0||Math.min(...xs)>width||Math.max(...ys)<0||Math.min(...ys)>height)continue;
      const group=svgNode('g'),color=track.id===this.selected?SELECTED:COLORS[track.label]??'#9dd5c0';
      group.dataset.trackId=track.id;group.dataset.selected=String(track.id===this.selected);
      const path=svgNode('path');path.setAttribute('d',lines.map(l=>`M${l[0]},${l[1]}L${l[2]},${l[3]}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width',String((track.id===this.selected?2:1.2)/scale));group.append(path);
      const label=svgNode('text');label.setAttribute('x',String(Math.max(2,Math.min(width-140,Math.min(...xs)))));label.setAttribute('y',String(Math.max(14/scale,Math.min(height-4,Math.min(...ys)-4/scale))));label.setAttribute('font-size',String(11/scale));label.setAttribute('fill',color);label.setAttribute('stroke','#0a111c');label.setAttribute('stroke-width',String(3/scale));label.setAttribute('paint-order','stroke');label.textContent=`${track.label} #${track.id}`;group.append(label);svg.append(group);
    }
    view.append(svg);
  }
  pick(ray:THREE.Raycaster):boolean{
    if(!this.visible.checked)return false;
    this.root.updateMatrixWorld(true);
    const meshes=[...this.boxes.values()].filter(b=>b.group.visible).map(b=>b.mesh);
    const hit=ray.intersectObjects(meshes,false)[0];if(!hit)return false;
    this.selectTrack(hit.object.userData.trackId);return true;
  }
  pickCamera(x:number,y:number):boolean{
    const calibration=this.frames[this.index]?.calibration;if(!this.visible.checked||!calibration)return false;
    const candidates=this.tracks.map(t=>({track:t,sample:sampleAt(t,this.index)})).filter(t=>t.sample&&inHull(projectedHull(projectedBox(t.track,t.sample!,calibration)),x,y));
    candidates.sort((a,b)=>Math.hypot(...a.sample!.position)-Math.hypot(...b.sample!.position));
    if(!candidates.length)return false;this.selectTrack(candidates[0].track.id);return true;
  }
}
