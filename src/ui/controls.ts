import type { BackendType, Channel } from '../render/types';

export interface ControlEvents {
  onTogglePlay(): void;
  onSeek(index: number): void;
  onChannel(channel: Channel): void;
  onTrail(seconds: number): void;
  onBackend(type: BackendType): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Binds the playback bar (play/pause, scrubber, channel, trail, backend) and the status line in index.html. */
export class Controls {
  private readonly play = $<HTMLButtonElement>('play');
  private readonly scrubber = $<HTMLInputElement>('scrubber');
  private readonly frame = $<HTMLSpanElement>('frame');
  private readonly time = $<HTMLSpanElement>('time');
  private readonly channel = $<HTMLSelectElement>('channel');
  private readonly trail = $<HTMLSelectElement>('trail');
  private readonly status = $<HTMLDivElement>('status');
  private readonly backends: Record<BackendType, HTMLButtonElement> = {
    webgpu: $<HTMLButtonElement>('webgpu'),
    webgl2: $<HTMLButtonElement>('webgl2'),
  };

  constructor(frames: number, maxTrail: number, events: ControlEvents) {
    this.scrubber.max = String(frames - 1);
    for (let t = 0.2; t <= maxTrail + 1e-6; t += 0.2) this.trail.add(new Option(`Trail ${t.toFixed(1)} s`, t.toFixed(1)));
    this.play.onclick = () => events.onTogglePlay();
    this.scrubber.oninput = () => events.onSeek(Number(this.scrubber.value));
    this.channel.onchange = () => events.onChannel(Number(this.channel.value) as Channel);
    this.trail.onchange = () => events.onTrail(Number(this.trail.value));
    for (const [type, button] of Object.entries(this.backends)) button.onclick = () => events.onBackend(type as BackendType);
  }

  setBackends(active: BackendType, webgpuAvailable: boolean): void {
    for (const [type, button] of Object.entries(this.backends)) {
      button.classList.toggle('active', type === active);
      button.setAttribute('aria-pressed', String(type === active));
    }
    this.backends.webgpu.disabled = !webgpuAvailable;
    this.backends.webgpu.title = webgpuAvailable ? '' : 'WebGPU is not available in this browser';
  }

  setPlaying(playing: boolean): void {
    this.play.textContent = playing ? '❚❚' : '▶';
    this.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  setFrame(index: number, seconds: number): void {
    this.scrubber.value = String(index);
    this.frame.textContent = String(index).padStart(3, '0');
    this.time.textContent = seconds.toFixed(1) + ' s';
  }

  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }
}
