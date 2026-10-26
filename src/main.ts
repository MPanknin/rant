import './style.css';
import { POINT_RADIUS, SLOT_POINTS, SOURCE, WINDOW } from './config';
import { SweepStream } from './data/stream';
import { createSurface } from './render/create';
import { PointCloudTimeline } from './render/timeline';
import { Channel, type BackendType } from './render/types';
import { Controls } from './ui/controls';
import { OrbitCamera } from './view/camera';

const viewport = document.getElementById('viewport')!;
const preferred = new URLSearchParams(location.search).get('backend') as BackendType | null;
let { canvas, backing } = await createSurface(preferred ?? 'webgpu');
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

let switching = false;

/** Swaps the backing at runtime; the timeline re-uploads the resident sweeps to the new one. */
async function switchBackend(type: BackendType): Promise<void> {
  if (switching || type === backing.backendType) return;
  switching = true;
  try {
    const surface = await createSurface(type);
    canvas.replaceWith(surface.canvas);
    ({ canvas, backing } = surface);
    resize();
    timeline.setBacking(backing);
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

// Playback steps at the sweep period but waits for the next sweep instead of skipping it.
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (state.playing && now - state.lastStep >= SOURCE.period * 1000) {
    const next = (state.index + 1) % stream.length;
    if (stream.isLoaded(next)) {
      state.lastStep = now;
      seek(next);
    }
  }
  camera.update();
  const drawn = timeline.render({
    viewProjection: camera.viewProjection,
    cameraRight: camera.right,
    cameraUp: camera.up,
    pointSize: POINT_RADIUS,
    currentTime: stream.timeOf(state.index),
    trailDuration: state.trail,
    channel: state.channel,
  });
  controls.setStatus(
    stream.error
      ? `Stream stopped: ${stream.error.message}`
      : `${backing.backendType.toUpperCase()} · ${drawn.toLocaleString()} points · buffered ${stream.loadedCount()}/${stream.capacity}`,
  );
}

new ResizeObserver(resize).observe(viewport);
resize();
setPlaying(true);
seek(0);
requestAnimationFrame(frame);
