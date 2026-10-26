import type { MetricsSnapshot } from '../metrics';

const MB = 1024 * 1024;
const ms = (v: number) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) + ' ms';

/** Renders metric snapshots into the `#metrics` list in index.html. */
export class MetricsPanel {
  private readonly root = document.getElementById('metrics') as HTMLDListElement;
  private readonly values = new Map<string, HTMLElement>();

  constructor() {
    for (const label of ['GPU', 'CPU', 'Frame', 'Points', 'Upload call', 'Memory', 'Switch']) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = '—';
      this.root.append(dt, dd);
      this.values.set(label, dd);
    }
  }

  /** Records how long the last backend switch took, including re-uploading the resident sweeps. */
  setSwitch(totalMs: number, reuploadMs: number, bytes: number): void {
    this.set('Switch', `${ms(totalMs)} (re-upload ${(bytes / MB).toFixed(0)} MB in ${ms(reuploadMs)})`);
  }

  update(m: MetricsSnapshot): void {
    this.set('GPU', m.gpuMs !== null ? ms(m.gpuMs) : m.gpuTimer ? 'pending' : 'n/a (no timer query)');
    this.set('CPU', ms(m.cpuMs) + ' encode + submit');
    this.set('Frame', `${ms(m.frameMs)} (${Math.round(1000 / m.frameMs)} fps)`);
    this.set('Points', `${(m.points / 1e6).toFixed(2)} M in ${Math.round(m.draws)} draw${Math.round(m.draws) === 1 ? '' : 's'}`);
    const throughput = m.uploadGBps !== null ? ` · ${m.uploadGBps.toFixed(1)} GB/s` : '';
    const rate = m.uploadMs !== null ? `${ms(m.uploadMs)} / sweep${throughput}` : 'idle';
    this.set('Upload call', rate);
    this.set('Memory', `${(m.residentBytes / MB).toFixed(0)} / ${(m.allocatedBytes / MB).toFixed(0)} MB used`);
  }

  private set(label: string, text: string): void {
    const el = this.values.get(label)!;
    if (el.textContent !== text) el.textContent = text;
  }
}
