// Real-time DSP, one stateful chain per channel: Hampel spike rejection → Butterworth band-pass
// (two biquad sections each side = 4th order) → optional 50/60 Hz notch.
// Same defaults PiEEG uses (Hampel 5/3σ, 1–40 Hz) so our traces match theirs.

export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this; }
  reset() { this.z1 = 0; this.z2 = 0; }
  process(x) {                       // transposed direct form II
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  static lowpass(fc, fs, q) {
    const w = 2 * Math.PI * fc / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    return new Biquad().set((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  static highpass(fc, fs, q) {
    const w = 2 * Math.PI * fc / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    return new Biquad().set((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  static notch(fc, fs, q) {
    const w = 2 * Math.PI * fc / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    return new Biquad().set(1, -2 * cs, 1, 1 + al, -2 * cs, 1 - al);
  }
}

// 4th-order Butterworth = two 2nd-order sections with Q = 0.5412 and 1.3066.
const BUTTER4_Q = [0.54119610, 1.30656296];

export class Hampel {
  constructor(window = 5, nSigma = 3) {
    this.n = window | 1; this.k = nSigma; this.buf = new Float64Array(this.n); this.fill = 0; this.idx = 0; this.replaced = 0;
  }
  process(x) {
    this.buf[this.idx] = x; this.idx = (this.idx + 1) % this.n; if (this.fill < this.n) this.fill++;
    if (this.fill < this.n) return x;
    const s = Array.from(this.buf).sort((a, b) => a - b);
    const med = s[this.n >> 1];
    const dev = s.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = 1.4826 * dev[this.n >> 1];
    if (mad > 0 && Math.abs(x - med) > this.k * mad) { this.replaced++; return med; }
    return x;
  }
}

export class ChannelChain {
  constructor(fs, opts = {}) {
    this.fs = fs;
    this.configure(opts);
  }
  configure({ hampel = true, bandpass = true, low = 1, high = 40, notch = 50 } = {}) {
    this.useHampel = hampel; this.useBand = bandpass; this.notchHz = notch;
    this.dc = undefined;
    this.hampel = new Hampel(5, 3);
    this.hp = BUTTER4_Q.map((q) => Biquad.highpass(low, this.fs, q));
    this.lp = BUTTER4_Q.map((q) => Biquad.lowpass(high, this.fs, q));
    this.notch = notch ? Biquad.notch(notch, this.fs, 30) : null;
  }
  process(x) {
    // Remove the electrode's DC offset (tens of mV) before the high-pass, so the filter does not
    // ring for a second on the first sample. The offset is re-estimated very slowly.
    if (this.dc === undefined) this.dc = x; else this.dc += (x - this.dc) * 0.0005;
    let y = x - this.dc;
    if (this.useHampel) y = this.hampel.process(y);
    if (this.useBand) { for (const b of this.hp) y = b.process(y); for (const b of this.lp) y = b.process(y); }
    if (this.notch) y = this.notch.process(y);
    return y;
  }
}

/** Goertzel power of one frequency over a window (for the mains-hum estimate). */
export function goertzelPower(buf, start, len, freq, fs) {
  const k = Math.round(len * freq / fs), w = 2 * Math.PI * k / len, c = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  const n = buf.length;
  for (let i = 0; i < len; i++) { s0 = buf[(start + i) % n] + c * s1 - s2; s2 = s1; s1 = s0; }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (len * len / 4);   // ≈ amplitude² of that tone
}

// ── Side chains for the face (0.8) ──────────────────────────────────────────
// The display chain (1–40 Hz) is right for EEG bands but hides what the face does: muscle lives above
// 20 Hz and the eyes below 1 Hz. Every sample also runs through these, whatever the display filters say.

/** Wide band for facial gestures (PiEEG Face Trainer features): DC out, high-pass 1 Hz, mains and its
 *  first harmonic notched, nothing cut on top (up to Nyquist, 125 Hz). */
export class WideChain {
  constructor(fs, mains = 50) { this.fs = fs; this.configure(mains); }
  configure(mains = 50) {
    this.dc = undefined;
    this.hp = BUTTER4_Q.map((q) => Biquad.highpass(1, this.fs, q));
    this.notches = [];
    if (mains) for (let f = mains; f < this.fs / 2 - 1; f += mains) this.notches.push(Biquad.notch(f, this.fs, 30));
  }
  process(x) {
    if (this.dc === undefined) this.dc = x; else this.dc += (x - this.dc) * 0.0005;
    let y = x - this.dc;
    for (const b of this.hp) y = b.process(y);
    for (const b of this.notches) y = b.process(y);
    return y;
  }
}

/** Muscle envelope: high-pass 20 Hz (the EMG band, no blinks or eye movements) → squared → 100 ms
 *  exponential average → √. Microvolts RMS of the muscle activity under the electrode. */
export class EmgEnvelope {
  constructor(fs, tauMs = 100) { this.fs = fs; this.hp = BUTTER4_Q.map((q) => Biquad.highpass(20, fs, q)); this.k = 1 - Math.exp(-1000 / (tauMs * fs)); this.ms = 0; }
  reset() { this.ms = 0; for (const b of this.hp) b.reset(); }
  process(wide) { let y = wide; for (const b of this.hp) y = b.process(y); this.ms += (y * y - this.ms) * this.k; return Math.sqrt(this.ms); }
  get value() { return Math.sqrt(this.ms); }
}

/** Slow band for gaze from EOG: the eyes' dipole moves the potential for as long as the eyes stay
 *  turned, so no 1 Hz high-pass here. DC follows at τ = 2 min (just to keep the numbers small),
 *  low-pass 8 Hz (4th order). The gaze model keeps its own centre on top of this. */
export class EogChain {
  constructor(fs) { this.fs = fs; this.k = 1 / (fs * 120); this.lp = BUTTER4_Q.map((q) => Biquad.lowpass(8, fs, q)); this.dc = undefined; this.value = 0; }
  reset() { this.dc = undefined; this.value = 0; for (const b of this.lp) b.reset(); }
  process(x) {
    if (this.dc === undefined) { this.dc = x; }
    else this.dc += (x - this.dc) * this.k;
    let y = x - this.dc;
    for (const b of this.lp) y = b.process(y);
    this.value = y; return y;
  }
}
