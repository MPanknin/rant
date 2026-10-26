import type { BackingStats } from './render/types';

export interface MetricsSnapshot {
  frameMs: number;
  /** CPU time spent recording and submitting a frame (timeline.render). */
  cpuMs: number;
  /** Mean GPU time per frame, or null when no timer is available / no result has arrived. */
  gpuMs: number | null;
  gpuTimer: boolean;
  points: number;
  draws: number;
  /** Mean CPU time per upload call and the resulting throughput; null without uploads in the interval. */
  uploadMs: number | null;
  uploadGBps: number | null;
  allocatedBytes: number;
  residentBytes: number;
}

type Counters = Pick<BackingStats, 'uploadCalls' | 'uploadedBytes' | 'uploadMs' | 'gpuMs' | 'gpuSamples'>;

/**
 * Accumulates per-frame measurements and backing counters, emitting averaged snapshots
 * every `interval` ms. Counter baselines reset when the backing (and so its stats object) changes.
 */
export class Metrics {
  private frames = 0;
  private frameMs = 0;
  private cpuMs = 0;
  private points = 0;
  private draws = 0;
  private start = performance.now();
  private stats?: BackingStats;
  private base: Counters = { uploadCalls: 0, uploadedBytes: 0, uploadMs: 0, gpuMs: 0, gpuSamples: 0 };

  constructor(private readonly interval = 500) {}

  frame(frameMs: number, cpuMs: number, points: number, draws: number): void {
    this.frames++;
    this.frameMs += frameMs;
    this.cpuMs += cpuMs;
    this.points += points;
    this.draws += draws;
  }

  /** Returns a snapshot once per interval, otherwise null. */
  sample(now: number, stats: BackingStats, residentBytes: number): MetricsSnapshot | null {
    if (stats !== this.stats) this.rebase(stats, now);
    if (now - this.start < this.interval || this.frames === 0) return null;

    const uploads = stats.uploadCalls - this.base.uploadCalls;
    const uploadMs = stats.uploadMs - this.base.uploadMs;
    const gpuSamples = stats.gpuSamples - this.base.gpuSamples;
    const snapshot: MetricsSnapshot = {
      frameMs: this.frameMs / this.frames,
      cpuMs: this.cpuMs / this.frames,
      gpuMs: gpuSamples > 0 ? (stats.gpuMs - this.base.gpuMs) / gpuSamples : null,
      gpuTimer: stats.gpuTimer,
      points: this.points / this.frames,
      draws: this.draws / this.frames,
      uploadMs: uploads > 0 ? uploadMs / uploads : null,
      uploadGBps: uploads > 0 && uploadMs > 0 ? (stats.uploadedBytes - this.base.uploadedBytes) / uploadMs / 1e6 : null,
      allocatedBytes: stats.allocatedBytes,
      residentBytes,
    };
    this.rebase(stats, now);
    return snapshot;
  }

  private rebase(stats: BackingStats, now: number): void {
    this.stats = stats;
    this.base = { uploadCalls: stats.uploadCalls, uploadedBytes: stats.uploadedBytes, uploadMs: stats.uploadMs, gpuMs: stats.gpuMs, gpuSamples: stats.gpuSamples };
    this.frames = this.frameMs = this.cpuMs = this.points = this.draws = 0;
    this.start = now;
  }
}
