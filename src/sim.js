// Simulated PiEEG XR: 8 channels at 250 Hz with the artifacts we care about.
// Keys while the simulator runs: B blink · J jaw clench · ← → eye movement · 1-8 toggle bad contact.
import { CHANNELS, SAMPLE_RATE } from './ble.js';

export class SimDevice {
  constructor() {
    this.name = 'Simulator';
    this.onSamples = null;
    this.onStatus = null;
    this.stats = { notifications: 0, samples: 0, lastLen: 120, oddBytes: 0 };
    this.t = 0;
    this.timer = null;
    this.offset = Array.from({ length: CHANNELS }, () => (Math.random() - 0.5) * 40000);
    this.hum = Array.from({ length: CHANNELS }, () => 2 + Math.random() * 6);
    this.bad = new Set();
    this.events = [];           // { kind, t0 }
    this.alphaPhase = Math.random() * 6;
    this._onKey = this._onKey.bind(this);
  }

  static supported() { return true; }

  async start(onSamples) {
    this.onSamples = onSamples;
    window.addEventListener('keydown', this._onKey);
    const dt = 1 / SAMPLE_RATE;
    this.timer = setInterval(() => {
      const samples = [];
      for (let i = 0; i < 5; i++) { samples.push(this._sample(this.t)); this.t += dt; }
      this.stats.notifications++;
      this.stats.samples += 5;
      if (this.onSamples) this.onSamples(samples, performance.now());
    }, 20);
    if (this.onStatus) this.onStatus('Simulator running · B blink · J jaw · ←/→ eyes · 1-8 bad contact');
  }

  async stop() {
    clearInterval(this.timer); this.timer = null;
    window.removeEventListener('keydown', this._onKey);
    if (this.onStatus) this.onStatus('Simulator stopped');
  }

  trigger(kind) { this.events.push({ kind, t0: this.t }); }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'b') this.trigger('blink');
    else if (k === 'j') this.trigger('jaw');
    else if (e.key === 'ArrowLeft') this.trigger('left');
    else if (e.key === 'ArrowRight') this.trigger('right');
    else if (/^[1-8]$/.test(k)) { const ch = +k - 1; this.bad.has(ch) ? this.bad.delete(ch) : this.bad.add(ch); }
  }

  _sample(t) {
    const out = new Float32Array(CHANNELS);
    const alphaAmp = 6 + 4 * Math.sin(t * 0.21 + this.alphaPhase);           // slow alpha waxing/waning
    const alpha = alphaAmp * Math.sin(2 * Math.PI * 10 * t);
    const theta = 3 * Math.sin(2 * Math.PI * 6.2 * t + 1);
    const beta = 2 * Math.sin(2 * Math.PI * 19 * t);
    const drift = 30 * Math.sin(2 * Math.PI * 0.08 * t);
    const pulse = 4 * Math.max(0, Math.sin(2 * Math.PI * 1.1 * t)) ** 8;    // tiny ballistic pulse
    this.events = this.events.filter((ev) => t - ev.t0 < 1.5);
    for (let ch = 0; ch < CHANNELS; ch++) {
      let v = this.offset[ch] + drift + alpha * (ch >= 2 && ch <= 5 ? 1 : 0.5) + theta + beta;
      v += (Math.random() - 0.5) * 6 + pulse;
      v += this.hum[ch] * Math.sin(2 * Math.PI * 50 * t);
      if (this.bad.has(ch)) v += 180 * Math.sin(2 * Math.PI * 50 * t) + (Math.random() - 0.5) * 60;
      for (const ev of this.events) {
        const dtv = t - ev.t0;
        if (ev.kind === 'blink' && dtv < 0.4) {
          const shape = Math.sin(Math.PI * dtv / 0.4) ** 2;                     // 400 ms hump
          v += shape * (ch >= 2 && ch <= 5 ? 220 : 90);
        } else if (ev.kind === 'jaw' && dtv < 1.0) {
          v += (Math.random() - 0.5) * (ch <= 1 || ch >= 6 ? 160 : 50);           // temples loudest
        } else if ((ev.kind === 'left' || ev.kind === 'right') && dtv < 1.2) {
          const sgn = ev.kind === 'left' ? -1 : 1;
          const env = dtv < 0.15 ? dtv / 0.15 : dtv > 0.9 ? Math.max(0, (1.2 - dtv) / 0.3) : 1;
          const side = ch <= 1 ? -1 : ch >= 6 ? 1 : ch <= 3 ? -0.4 : 0.4;
          v += sgn * side * 120 * env;
        }
      }
      out[ch] = v;
    }
    return out;
  }
}
