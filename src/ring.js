// Per-channel ring buffers (raw and filtered) plus the sample clock.
import { CHANNELS } from './ble.js';

export class Rings {
  constructor(fs, seconds = 60) {
    this.fs = fs; this.size = fs * seconds; this.write = 0; this.count = 0; this.total = 0;
    this.raw = Array.from({ length: CHANNELS }, () => new Float32Array(this.size));
    this.filt = Array.from({ length: CHANNELS }, () => new Float32Array(this.size));
  }
  push(raw, filt) {
    for (let ch = 0; ch < CHANNELS; ch++) { this.raw[ch][this.write] = raw[ch]; this.filt[ch][this.write] = filt[ch]; }
    this.write = (this.write + 1) % this.size; if (this.count < this.size) this.count++; this.total++;
  }
  /** Index of the sample `back` samples before the newest one. */
  at(back) { return (this.write - 1 - back + this.size * 2) % this.size; }
  startOfLast(n) { n = Math.min(n, this.count); return { start: (this.write - n + this.size) % this.size, len: n }; }
  reset() { this.write = 0; this.count = 0; this.total = 0; }
}

/** Timestamps: t = anchor + n/fs, re-anchored gently to the wall clock so long sessions don't drift. */
export class SampleClock {
  constructor(fs) { this.fs = fs; this.anchor = null; this.n = 0; }
  stamp(arrivalMs, countInBurst) {
    const wall = Date.now() - (countInBurst - 1) * 1000 / this.fs;    // first sample of the burst
    if (this.anchor === null) { this.anchor = wall; this.n = 0; }
    const t = this.anchor + this.n * 1000 / this.fs;
    const err = wall - t;
    if (Math.abs(err) > 500) { this.anchor += err; }                    // gap or reconnect: jump
    else this.anchor += err * 0.002;                                    // otherwise drift slowly
    const stamps = [];
    for (let i = 0; i < countInBurst; i++) { stamps.push(this.anchor + this.n * 1000 / this.fs); this.n++; }
    return stamps;
  }
  reset() { this.anchor = null; this.n = 0; }
}
