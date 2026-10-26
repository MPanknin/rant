import { parsePCD } from './pcd';
import type { Sweep } from '../render/timeline';

export interface StreamSource {
  /** URL prefix; sweep i is fetched from `${base}${i padded to 10 digits}.pcd`. */
  base: string;
  count: number;
  /** Seconds between sweeps. */
  period: number;
}

export interface StreamWindow {
  /** Sweeps prefetched past the cursor. */
  ahead: number;
  /** Upper bound for sweeps kept behind the cursor (the trail). */
  maxBehind: number;
  /** Concurrent fetches. */
  parallel: number;
}

interface Entry {
  time: number;
  url: string;
  points?: Float32Array;
  loading: boolean;
}

/**
 * Streams a sequence of PCD sweeps, keeping only a window around the cursor in memory:
 * the cursor sweep first, then the trail behind it, then `ahead` sweeps of prefetch (wrapping for
 * loop playback). Everything else is dropped. Calls `onChange` whenever the set of loaded sweeps changes.
 */
export class SweepStream {
  readonly length: number;
  error?: Error;
  private readonly entries: Entry[];
  private cursor = 0;
  private behind = 0;

  constructor(
    source: StreamSource,
    private readonly window: StreamWindow,
    private readonly onChange: () => void,
  ) {
    this.length = source.count;
    this.entries = Array.from({ length: source.count }, (_, i) => ({
      time: i * source.period,
      url: source.base + String(i).padStart(10, '0') + '.pcd',
      loading: false,
    }));
  }

  /** Maximum number of sweeps held at once. */
  get capacity(): number {
    return Math.min(this.length, this.window.ahead + this.window.maxBehind + 1);
  }

  timeOf(index: number): number {
    return this.entries[index].time;
  }

  isLoaded(index: number): boolean {
    return !!this.entries[index].points;
  }

  loadedCount(): number {
    return this.entries.filter((e) => e.points).length;
  }

  /** Loaded sweeps inside the window, keyed by index. */
  *loaded(): Iterable<Sweep> {
    for (const [key, e] of this.entries.entries()) {
      if (e.points) yield { key, time: e.time, points: e.points };
    }
  }

  /** Sets how many sweeps behind the cursor are kept, clamped to `maxBehind`. */
  setTrail(sweeps: number): void {
    this.behind = Math.min(Math.max(0, Math.round(sweeps)), this.window.maxBehind);
    this.pump();
  }

  seek(index: number): void {
    this.cursor = index;
    this.pump();
  }

  private inWindow(i: number): boolean {
    const n = this.length;
    return (i - this.cursor + n) % n <= this.window.ahead || (this.cursor - i + n) % n <= this.behind;
  }

  private pump(): void {
    let dropped = false;
    this.entries.forEach((e, i) => {
      if (e.points && !this.inWindow(i)) {
        e.points = undefined;
        dropped = true;
      }
    });
    if (dropped) this.onChange();
    if (this.error) return;
    const n = this.length;
    const trail = Array.from({ length: this.behind }, (_, k) => -k - 1);
    const ahead = Array.from({ length: this.window.ahead }, (_, k) => k + 1);
    let busy = this.entries.filter((e) => e.loading).length;
    for (const d of [0, ...trail, ...ahead]) {
      if (busy >= this.window.parallel) break;
      const i = (((this.cursor + d) % n) + n) % n;
      const e = this.entries[i];
      if (!e.points && !e.loading) {
        busy++;
        void this.load(i);
      }
    }
  }

  private async load(i: number): Promise<void> {
    const e = this.entries[i];
    e.loading = true;
    try {
      const response = await fetch(e.url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for sweep ${i}`);
      const points = parsePCD(await response.arrayBuffer());
      if (this.inWindow(i)) e.points = points;
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      e.loading = false;
    }
    this.onChange();
    this.pump();
  }
}
