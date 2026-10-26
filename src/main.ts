import './style.css';
import { POINT_RADIUS, SLOT_POINTS, SOURCE, WINDOW } from './config';
import { SweepStream } from './data/stream';
import { Metrics } from './metrics';
import { createSurface } from './render/create';
import { PointCloudTimeline } from './render/timeline';
import { Channel, type BackendType, type BackingOptions } from './render/types';
import { Controls } from './ui/controls';
import { MetricsPanel } from './ui/metrics';
import { OrbitCamera } from './view/camera';

const viewport = document.getElementById('viewport')!;
// Experiment switches: ?backend=webgl2, ?timers=off, ?upload=staging
const params = new URLSearchParams(location.search);
const preferred: BackendType = params.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const options: BackingOptions = {
  timers: params.get('timers') !== 'off',
  upload: params.get('upload') === 'staging' ? 'staging' : 'writeBuffer',
};
let { canvas, backing } = await createSurface(preferred, options);
viewport.append(canvas);

// Controls listen on the viewport, so they survive canvas swaps when the backend changes.
const camera = new OrbitCamera(viewport);
const stream = new SweepStream(SOURCE, WINDOW, () => timeline.sync(stream.loaded()));
const timeline = new PointCloudTimeline(backing, stream.capacity, SLOT_POINTS);

const state = { index: 0, playing: true, channel: Channel.Height, trail: 0, lastStep: 0 };

const controls = new Controls(stream.length, WINDOW.maxBehind * SOURCE.period, {
  onTogglePlay: () => setPlaying(!state.playing),
  onSeek: (index) => {
    setPlaying(false);
    seek(index);
  },
  onChannel: (channel) => (state.channel = channel),
  onTrail: (seconds) => {
    state.trail = seconds;
    stream.setTrail(seconds / SOURCE.period);
  },
  onBackend: (type) => void switchBackend(type),
});
controls.setBackends(backing.backendType, !!navigator.gpu);
const metrics = new Metrics();
const panel = new MetricsPanel();

let switching = false;

/** Swaps the backing at runtime; the timeline re-uploads the resident sweeps to the new one. */
async function switchBackend(type: BackendType): Promise<void> {
  if (switching || type === backing.backendType) return;
  switching = true;
  try {
    const start = performance.now();
    const surface = await createSurface(type, options);
    canvas.replaceWith(surface.canvas);
    ({ canvas, backing } = surface);
    resize();
    const reupload = performance.now();
    timeline.setBacking(backing);
    const end = performance.now();
    panel.setSwitch(end - start, end - reupload, timeline.residentBytes);
  } finally {
    switching = false;
    controls.setBackends(backing.backendType, !!navigator.gpu);
  }
}

function setPlaying(playing: boolean): void {
  state.playing = playing;
  controls.setPlaying(playing);
}

function seek(index: number): void {
  state.index = index;
  stream.seek(index);
  controls.setFrame(index, stream.timeOf(index));
}

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.floor(viewport.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.clientHeight * dpr));
  backing.resize(canvas.width, canvas.height);
  camera.setAspect(canvas.width / canvas.height);
}

let lastFrame = performance.now();

// Playback steps at the sweep period but waits for the next sweep instead of skipping it.
function frame(now: number): void {
  requestAnimationFrame(frame);
  const frameMs = now - lastFrame;
  lastFrame = now;
  if (state.playing && now - state.lastStep >= SOURCE.period * 1000) {
    const next = (state.index + 1) % stream.length;
    if (stream.isLoaded(next)) {
      state.lastStep = now;
      seek(next);
    }
  }
  camera.update();
  const cpuStart = performance.now();
  const drawn = timeline.render({
    viewProjection: camera.viewProjection,
    cameraRight: camera.right,
    cameraUp: camera.up,
    pointSize: POINT_RADIUS,
    currentTime: stream.timeOf(state.index),
    trailDuration: state.trail,
    channel: state.channel,
  });
  metrics.frame(frameMs, performance.now() - cpuStart, drawn.points, drawn.draws);
  const snapshot = metrics.sample(now, backing.stats, timeline.residentBytes);
  if (snapshot) panel.update(snapshot);
  controls.setStatus(
    stream.error
      ? `Stream stopped: ${stream.error.message}`
      : `${backing.backendType.toUpperCase()} · buffered ${stream.loadedCount()}/${stream.capacity} sweeps`,
  );
}

new ResizeObserver(resize).observe(viewport);
resize();
setPlaying(true);
seek(0);
requestAnimationFrame(frame);
