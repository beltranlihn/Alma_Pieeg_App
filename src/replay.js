// A saved session played back as if it were the mask: the raw samples of a .raw.csv go through the same engine
// (filters, contact, detectors, routing) at 0.5–2× speed, looping, with the session's marks coming back as markers.
// To rehearse a patch, tune rules or show a piece without anyone wearing the mask.
import { CHANNELS } from './ble.js';

/** Parse a raw CSV (timestamp, ch1…ch8[, mark]) into { n, t: Float64Array, ch: Float32Array(n·8), marks: Map(row → text) }. */
export function parseRaw(text) {
  const lines = String(text || '').split(/\r?\n/);
  const head = (lines[0] || '').split(',').map((s) => s.trim().toLowerCase());
  const ti = head.indexOf('timestamp'), ci = Array.from({ length: CHANNELS }, (_, k) => head.indexOf(`ch${k + 1}`)), mi = head.indexOf('mark');
  if (ti < 0 || ci.some((i) => i < 0)) return { n: 0, t: new Float64Array(0), ch: new Float32Array(0), marks: new Map() };
  const t = new Float64Array(lines.length), ch = new Float32Array(lines.length * CHANNELS), marks = new Map();
  let n = 0;
  for (let l = 1; l < lines.length; l++) {
    const line = lines[l]; if (!line) continue;
    const c = line.split(','); const ts = parseFloat(c[ti]); if (!Number.isFinite(ts)) continue;
    t[n] = ts;
    for (let k = 0; k < CHANNELS; k++) { const v = parseFloat(c[ci[k]]); ch[n * CHANNELS + k] = Number.isFinite(v) ? v : 0; }
    if (mi >= 0 && c[mi] && c[mi].trim()) marks.set(n, c.slice(mi).join(',').trim().replace(/^"|"$/g, ''));
    n++;
  }
  return { n, t: t.subarray(0, n), ch: ch.subarray(0, n * CHANNELS), marks };
}

export class ReplayDevice {
  constructor({ base, text, speed = 1, label = '' }) {
    this.base = base; this.speed = Math.max(0.25, Math.min(4, +speed || 1));
    this.name = `Replay · ${label || base}`;
    this.data = parseRaw(text);
    this.stats = { notifications: 0, samples: 0, lastLen: 120, oddBytes: 0 };
    this.onStatus = null; this.onMark = null; this.onDisconnected = null; this.onReconnected = null;
    this.i = 0; this.loops = 0; this.timer = null;
  }
  get duration() { return this.data.n / 250; }
  get progress() { return this.data.n ? this.i / this.data.n : 0; }
  async start(onSamples) {
    if (!this.data.n) throw new Error('this session has no raw samples to play');
    this.cb = onSamples; this._acc = 0; this._t = performance.now();
    this.timer = setInterval(() => this._step(), 20);
    if (this.onStatus) this.onStatus(`Replaying ${this.base} at ${this.speed}× · loops at the end`);
  }
  _step() {
    const now = performance.now(), dt = Math.min(200, now - this._t); this._t = now;
    this._acc += (dt / 1000) * 250 * this.speed;
    let k = Math.floor(this._acc); this._acc -= k; if (!k) return;
    const out = [];
    while (k-- > 0) {
      const i = this.i; out.push(this.data.ch.subarray(i * CHANNELS, (i + 1) * CHANNELS));
      const m = this.data.marks.get(i); if (m && this.onMark) this.onMark(m);
      if (++this.i >= this.data.n) { this.i = 0; this.loops++; }
    }
    this.stats.notifications++; this.stats.samples += out.length;
    this.cb(out, performance.now());
  }
  async stop() { clearInterval(this.timer); this.timer = null; if (this.onStatus) this.onStatus('Replay stopped'); }
}
