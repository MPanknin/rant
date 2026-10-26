import { Channel } from '../render/types';

export interface ControlEvents {
  onTogglePlay(): void;
  onSeek(index: number): void;
  onChannel(channel: Channel): void;
  onTrail(seconds: number): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Binds the playback bar (play/pause, scrubber, channel, trail) and the status line in index.html. */
export class Controls {
  private readonly play = $<HTMLButtonElement>('play');
  private readonly scrubber = $<HTMLInputElement>('scrubber');
  private readonly frame = $<HTMLSpanElement>('frame');
  private readonly time = $<HTMLSpanElement>('time');
  private readonly channel = $<HTMLSelectElement>('channel');
  private readonly trail = $<HTMLSelectElement>('trail');
  private readonly status = $<HTMLDivElement>('status');

  constructor(frames: number, maxTrail: number, events: ControlEvents) {
    this.scrubber.max = String(frames - 1);
    for (let t = 0.2; t <= maxTrail + 1e-6; t += 0.2) this.trail.add(new Option(`Trail ${t.toFixed(1)} s`, t.toFixed(1)));
    this.play.onclick = () => events.onTogglePlay();
    this.scrubber.oninput = () => events.onSeek(Number(this.scrubber.value));
    this.channel.onchange = () => events.onChannel(Number(this.channel.value) as Channel);
    this.trail.onchange = () => events.onTrail(Number(this.trail.value));
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
