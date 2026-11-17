// Simulated PiEEG XR: 8 channels at 250 Hz with the artifacts we care about.
// Keys while the simulator runs: B blink · J jaw clench · ← → eye movement · E eyes closed (alpha up) · 1-8 toggle bad contact.
// It can also hold a facial gesture (setGesture) and a gaze direction (setGaze), so the Face page can be
// trained and checked end to end without the mask. The patterns are plausible, not measured: replace them
// with recordings of the real PiEEG XR once there are some.
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
    this.eyes = false;          // eyes closed: alpha ×2.5, as a calibration target
    this.gesture = null; this.gestureAmp = 0;     // facial gesture held now (id), ramped in and out
    this.gazeXY = { x: 0, y: 0 }; this.gazeNow = { x: 0, y: 0 };
    this.chDrift = Array.from({ length: CHANNELS }, () => ({ a: 8 + Math.random() * 10, ph: Math.random() * 6.28 }));
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
    if (this.onStatus) this.onStatus('Simulator running · B blink · J jaw · ←/→ eyes · E eyes closed · 1-8 bad contact');
  }

  async stop() {
    clearInterval(this.timer); this.timer = null;
    window.removeEventListener('keydown', this._onKey);
    if (this.onStatus) this.onStatus('Simulator stopped');
  }

  trigger(kind) { this.events.push({ kind, t0: this.t }); }
  setEyes(closed) { this.eyes = !!closed; }
  setGesture(id) { this.gesture = id || null; }
  setGaze(x, y) { this.gazeXY = { x: x || 0, y: y || 0 }; }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'b') this.trigger('blink');
    else if (k === 'j') this.trigger('jaw');
    else if (k === 'e') this.setEyes(!this.eyes);
    else if (e.key === 'ArrowLeft') this.trigger('left');
    else if (e.key === 'ArrowRight') this.trigger('right');
    else if (/^[1-8]$/.test(k)) { const ch = +k - 1; this.bad.has(ch) ? this.bad.delete(ch) : this.bad.add(ch); }
  }

  _sample(t) {
    const out = new Float32Array(CHANNELS);
    const alphaAmp = (6 + 4 * Math.sin(t * 0.21 + this.alphaPhase)) * (this.eyes ? 2.5 : 1);   // slow alpha waxing/waning
    const alpha = alphaAmp * Math.sin(2 * Math.PI * 10 * t);
    const theta = 3 * Math.sin(2 * Math.PI * 6.2 * t + 1);
    const beta = 2 * Math.sin(2 * Math.PI * 19 * t);
    const drift = 30 * Math.sin(2 * Math.PI * 0.08 * t);
    const pulse = 4 * Math.max(0, Math.sin(2 * Math.PI * 1.1 * t)) ** 8;    // tiny ballistic pulse
    this.events = this.events.filter((ev) => t - ev.t0 < 1.5);
    this.gestureAmp += ((this.gesture ? 1 : 0) - this.gestureAmp) * 0.02;           // ~80 ms ramp at 250 Hz
    this.gazeNow.x += (this.gazeXY.x - this.gazeNow.x) * 0.08; this.gazeNow.y += (this.gazeXY.y - this.gazeNow.y) * 0.08;   // saccade ≈ 50 ms
    const pattern = GESTURE_PATTERN[this.gesture] || this._lastPattern;
    if (this.gesture) this._lastPattern = pattern;
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
      // the temple arteries: a small pulse wave on the temples only (what the heart-from-electrodes estimate looks for)
      if (ch <= 1 || ch >= 6) v += 7 * Math.max(0, Math.sin(2 * Math.PI * 1.15 * t)) ** 3;
      // slow drift of each electrode on its own (what the gaze calibration has to see through)
      const cd = this.chDrift[ch]; v += cd.a * Math.sin(2 * Math.PI * 0.012 * t + cd.ph);
      // gaze: the eye dipole, sustained while the eyes stay turned
      const side = ch <= 1 ? -1 : ch >= 6 ? 1 : ch <= 3 ? -0.3 : 0.3;
      v += side * 110 * this.gazeNow.x + (ch >= 2 && ch <= 5 ? -70 : -12) * this.gazeNow.y;
      // a facial gesture: broadband muscle noise with its own spatial pattern, plus the eyes for blinks/winks
      if (pattern && this.gestureAmp > 0.01) {
        const a = this.gestureAmp;
        v += (Math.random() - 0.5) * 2 * pattern.emg[ch] * a;
        if (pattern.eog) v += pattern.eog[ch] * a;
      }
      out[ch] = v;
    }
    return out;
  }
}

// Per gesture: muscle amplitude (µV, uniform noise half-range) on Ch1…Ch8, and a sustained eye offset for blinks.
// Ch1-2 left temple, Ch3-4 left forehead, Ch5-6 right forehead, Ch7-8 right temple.
const GESTURE_PATTERN = {
  clench: { emg: [70, 55, 12, 10, 10, 12, 55, 70] },
  jaw_open: { emg: [45, 22, 6, 5, 5, 6, 22, 45] },
  smile: { emg: [30, 12, 4, 3, 3, 4, 12, 30] },
  brows_up: { emg: [8, 18, 45, 40, 40, 45, 18, 8] },
  frown: { emg: [4, 6, 15, 38, 38, 15, 6, 4] },
  blink_hard: { emg: [10, 16, 25, 22, 22, 25, 16, 10], eog: [40, 60, 180, 200, 200, 180, 60, 40] },
  wink_left: { emg: [18, 22, 30, 20, 6, 4, 4, 4], eog: [40, 60, 150, 120, 30, 20, 10, 8] },
  wink_right: { emg: [4, 4, 6, 4, 20, 30, 22, 18], eog: [8, 10, 20, 30, 120, 150, 60, 40] },
  pucker: { emg: [10, 6, 4, 4, 4, 4, 6, 10] },
};
