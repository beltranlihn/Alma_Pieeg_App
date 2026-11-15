// Session recording: raw µV per sample (same CSV layout as PiEEG: timestamp, ch1..ch8) plus a mark
// column, and a JSON sidecar with the metadata. Lives in memory until saved.
import { CHANNELS } from './ble.js';

export class Recorder {
  constructor() { this.reset(); }
  reset() { this.rows = []; this.marks = []; this.startedAt = null; this.active = false; this.pendingMark = null; }
  start() { this.reset(); this.active = true; this.startedAt = Date.now(); }
  stop() { this.active = false; }
  mark(text) {
    if (!this.active) return null;
    const m = { t: Date.now(), text: text || 'mark' };
    this.marks.push(m); this.pendingMark = m.text; return m;
  }
  push(tMs, raw) {
    if (!this.active) return;
    this.rows.push({ t: tMs, v: Float32Array.from(raw), mark: this.pendingMark });
    this.pendingMark = null;
  }
  get seconds() { return this.rows.length ? (this.rows[this.rows.length - 1].t - this.rows[0].t) / 1000 : 0; }
  toCSV() {
    const head = ['timestamp', ...Array.from({ length: CHANNELS }, (_, i) => `ch${i + 1}`), 'mark'].join(',');
    const lines = [head];
    for (const r of this.rows) {
      const vals = Array.from(r.v, (x) => x.toFixed(3)).join(',');
      lines.push(`${(r.t / 1000).toFixed(6)},${vals},${r.mark ? JSON.stringify(r.mark) : ''}`);
    }
    return lines.join('\n') + '\n';
  }
  toMeta(extra = {}) {
    return JSON.stringify({
      format: 'eeg-alma-center-session:v1', app: `EEG Alma Center ${(typeof window !== 'undefined' && window.alma && window.alma.version) || ''}`.trim(),
      started_at: new Date(this.startedAt).toISOString(), duration_sec: +this.seconds.toFixed(3), samples: this.rows.length,
      channels: CHANNELS, units: 'uV', columns: ['timestamp(unix s)', 'ch1..ch8 raw uV', 'mark'],
      electrode_map: ['left temple lower', 'left temple upper', 'left forehead', 'left forehead', 'right forehead', 'right forehead', 'right temple upper', 'right temple lower'],
      marks: this.marks.map((m) => ({ t: m.t / 1000, text: m.text })), ...extra,
    }, null, 2);
  }
}
