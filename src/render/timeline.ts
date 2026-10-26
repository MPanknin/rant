import { POINT_FLOATS, type DrawRange, type FrameUniforms, type PointCloudBacking } from './types';

export interface Sweep {
  key: number;
  time: number;
  /** x, y, z, intensity per point. */
  points: Float32Array;
}

interface Resident extends Sweep {
  slot: number;
}

/** Slot sizes stay a multiple of one WebGL2 texture row, so uploads take the bulk path. */
const SLOT_ALIGN = 4096;

/**
 * Backend-agnostic GPU timeline: a fixed pool of equally sized slots holding one sweep each.
 * `sync` mirrors a set of CPU-side sweeps onto the GPU; `render` draws the sweeps inside
 * [currentTime - trailDuration, currentTime], oldest first.
 */
export class PointCloudTimeline {
  private readonly resident = new Map<number, Resident>();
  private free: number[] = [];
  private slotPoints = 0;

  constructor(
    readonly backing: PointCloudBacking,
    private readonly slots: number,
    slotPoints: number,
  ) {
    this.allocate(slotPoints);
  }

  get residentCount(): number {
    return this.resident.size;
  }

  /** Uploads sweeps that are new (or whose data changed) and evicts those no longer listed. */
  sync(sweeps: Iterable<Sweep>): void {
    const wanted = new Map<number, Sweep>();
    for (const sweep of sweeps) wanted.set(sweep.key, sweep);
    for (const key of this.resident.keys()) {
      if (wanted.get(key)?.points !== this.resident.get(key)!.points) this.evict(key);
    }
    for (const sweep of wanted.values()) {
      if (!this.resident.has(sweep.key)) this.put(sweep);
    }
  }

  render(uniforms: FrameUniforms): number {
    const min = uniforms.currentTime - uniforms.trailDuration - 1e-6;
    const max = uniforms.currentTime + 1e-6;
    const ranges: DrawRange[] = [...this.resident.values()]
      .filter((r) => r.time >= min && r.time <= max)
      .sort((a, b) => a.time - b.time)
      .map((r) => ({ first: r.slot * this.slotPoints, count: r.points.length / POINT_FLOATS, time: r.time }));
    this.backing.render(uniforms, ranges);
    return ranges.reduce((sum, r) => sum + r.count, 0);
  }

  private put(sweep: Sweep): void {
    const count = sweep.points.length / POINT_FLOATS;
    if (count > this.slotPoints) this.allocate(count);
    const slot = this.free.pop();
    if (slot === undefined) throw new Error(`GPU timeline is full (${this.slots} slots)`);
    this.resident.set(sweep.key, { ...sweep, slot });
    this.backing.uploadPoints(slot * this.slotPoints, sweep.points);
  }

  private evict(key: number): void {
    const r = this.resident.get(key);
    if (!r) return;
    this.free.push(r.slot);
    this.resident.delete(key);
  }

  /** (Re)allocates the pool and re-uploads whatever is resident, e.g. when a sweep outgrows its slot. */
  private allocate(points: number): void {
    this.slotPoints = Math.max(SLOT_ALIGN, Math.ceil(points / SLOT_ALIGN) * SLOT_ALIGN);
    this.backing.allocate(this.slots * this.slotPoints);
    this.free = Array.from({ length: this.slots }, (_, i) => this.slots - 1 - i);
    for (const r of this.resident.values()) {
      r.slot = this.free.pop()!;
      this.backing.uploadPoints(r.slot * this.slotPoints, r.points);
    }
  }
}
