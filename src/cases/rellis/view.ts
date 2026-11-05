import './style.css';
import {projectScan, type Rig, type Mode} from './projection';

interface Pair {
  image: string;
  points: string;
  scan: number;
  camera: number;
  lidarTime: number | null;
  cameraTime: number;
}
interface Recording {
  rig: Rig;
  reference: Pair;
  drive: Pair[];
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('scene');
const context = canvas.getContext('2d')!;
const source = byId<HTMLSelectElement>('source');
const seek = byId<HTMLInputElement>('seek');
const overlay = byId<HTMLInputElement>('overlay');
const play = byId<HTMLButtonElement>('play');
const assets = new URL('../../rellis/', document.baseURI);
let recording: Recording;
let mode: Mode = 'reported';
let active: {pair: Pair; image: ImageBitmap; xyz: Float32Array} | undefined;
let pending: AbortController | undefined;
let playing = false;
let timer = 0;

async function asset(name: string, signal?: AbortSignal) {
  const response = await fetch(new URL(name, assets), {signal});
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  return response;
}

function render() {
  for (const name of ['reported','corrected']) byId(name).setAttribute('aria-pressed', String(name === mode));
  byId('path').textContent = mode === 'corrected' ? 'Velodyne → Ouster → Basler' : 'Ouster → Basler';
  byId('explanation').textContent = mode === 'corrected'
    ? 'Map the Velodyne returns into the Ouster frame first.'
    : 'The input points are in the Velodyne frame. This transform expects Ouster points.';
  canvas.dataset.mode = mode;
  if (!active) return;
  const {image, xyz} = active;
  const {rig} = recording;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dots = projectScan(xyz, rig, mode);
  if (overlay.checked) {
    const sx = canvas.width/rig.width, sy = canvas.height/rig.height;
    for (const {u,v,range} of dots) {
      context.fillStyle = `hsl(${Math.min(1, range/70)*230} 100% 59%)`;
      context.fillRect(u*sx-1, v*sy-1, 2.3, 2.3);
    }
  }
  byId('visible-count').textContent = overlay.checked ? dots.length.toLocaleString()+' projected returns' : 'Camera only';
  canvas.dataset.count = String(dots.length);
}

function setPlaying(value: boolean) {
  playing = value;
  window.clearTimeout(timer);
  play.textContent = value ? 'Pause' : 'Play';
  play.setAttribute('aria-label', value ? 'Pause excerpt' : 'Play excerpt');
}
function schedule(index: number) {
  if (!playing) return;
  const next = index+1;
  if (next >= recording.drive.length) { setPlaying(false); return; }
  const delay = (recording.drive[next].cameraTime-recording.drive[index].cameraTime)*1000;
  timer = window.setTimeout(() => void show(next), Math.max(20, delay));
}

async function show(index: number) {
  if (!recording) return;
  pending?.abort();
  const request = new AbortController();
  pending = request;
  const isDrive = source.value === 'drive';
  const pair = isDrive ? recording.drive[index] : recording.reference;
  seek.value = String(index);
  byId('transport').hidden = !isDrive;
  byId('status').textContent = 'Loading pair…';
  try {
    const [blob,bytes] = await Promise.all([
      asset(pair.image, request.signal).then(r => r.blob()),
      asset(pair.points, request.signal).then(r => r.arrayBuffer()),
    ]);
    const image = await createImageBitmap(blob);
    if (request.signal.aborted) { image.close(); return; }
    active?.image.close();
    active = {pair, image, xyz:new Float32Array(bytes)};
    canvas.width = image.width;
    canvas.height = image.height;
    byId('frame-label').textContent = isDrive ? 'Scan '+pair.scan+' · Image '+pair.camera : 'Frame 000104';
    byId('timing').textContent = isDrive
      ? `Camera ${(pair.cameraTime-recording.drive[0].cameraTime).toFixed(2)} s · LiDAR − camera ${((pair.lidarTime!-pair.cameraTime)*1000).toFixed(0)} ms`
      : 'Published example pair · 1920 × 1200 sensor image';
    byId('status').textContent = '';
    render();
    canvas.dataset.frame = pair.points;
    if (isDrive) schedule(index);
  } catch (error) {
    if (request.signal.aborted) return;
    setPlaying(false);
    active?.image.close(); active = undefined;
    context.clearRect(0,0,canvas.width,canvas.height);
    delete canvas.dataset.frame;
    byId('visible-count').textContent = '';
    byId('timing').textContent = '';
    byId('frame-label').textContent = 'Unavailable';
    byId('status').textContent = 'Could not load this pair. '+String(error);
  }
}
byId('reported').onclick = () => {mode='reported'; render()};
byId('corrected').onclick = () => {mode='corrected'; render()};
overlay.onchange = render;
source.onchange = () => {setPlaying(false); void show(0)};
seek.oninput = () => {setPlaying(false); void show(Number(seek.value))};
play.onclick = () => {
  if (playing) {setPlaying(false); return}
  setPlaying(true);
  const index = Number(seek.value);
  void show(index === recording.drive.length-1 ? 0 : index);
};
async function start() {
  source.disabled = true;
  try {
    recording = await (await asset('case.json')).json();
    seek.max = String(recording.drive.length-1);
    await show(0);
    source.disabled = false;
  } catch (error) {byId('status').textContent = 'Recording unavailable. '+String(error)}
}
void start();
