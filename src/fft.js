// Radix-2 FFT with a Hann window → one-sided PSD (µV²/Hz) and band powers. Same bands as PiEEG.
export const BANDS = [
  { id: 'delta', label: 'δ delta', lo: 0.5, hi: 4 },
  { id: 'theta', label: 'θ theta', lo: 4, hi: 8 },
  { id: 'alpha', label: 'α alpha', lo: 8, hi: 13 },
  { id: 'beta', label: 'β beta', lo: 13, hi: 30 },
  { id: 'gamma', label: 'γ gamma', lo: 30, hi: 100 },
];

export class FFT {
  constructor(n, fs) {
    this.n = n; this.fs = fs; this.half = n / 2;
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.win = new Float64Array(n); let wsum = 0;
    for (let i = 0; i < n; i++) { this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); wsum += this.win[i] * this.win[i]; }
    this.scale = 2 / (fs * wsum);                 // one-sided PSD normalisation
    this.rev = new Uint32Array(n); const bits = Math.log2(n) | 0;
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1); this.rev[i] = r; }
    this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = -Math.sin(2 * Math.PI * i / n); }
    this.psd = new Float32Array(this.half + 1);
    this.freqs = new Float32Array(this.half + 1); for (let i = 0; i <= this.half; i++) this.freqs[i] = i * fs / n;
  }
  /** `get(i)` returns the i-th most recent sample (0 = oldest of the window). Fills this.psd. */
  compute(get) {
    const { n, re, im, win, rev } = this;
    let mean = 0; for (let i = 0; i < n; i++) mean += get(i); mean /= n;
    for (let i = 0; i < n; i++) { re[rev[i]] = (get(i) - mean) * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const halfSize = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < halfSize; j++, k += step) {
          const tr = re[i + j + halfSize] * this.cos[k] - im[i + j + halfSize] * this.sin[k];
          const ti = re[i + j + halfSize] * this.sin[k] + im[i + j + halfSize] * this.cos[k];
          re[i + j + halfSize] = re[i + j] - tr; im[i + j + halfSize] = im[i + j] - ti;
          re[i + j] += tr; im[i + j] += ti;
        }
      }
    }
    for (let i = 0; i <= this.half; i++) this.psd[i] = (re[i] * re[i] + im[i] * im[i]) * this.scale;
    this.psd[0] *= 0.5; this.psd[this.half] *= 0.5;
    return this.psd;
  }
  bandPowers(psd = this.psd) {
    const df = this.fs / this.n, out = {}; let total = 0;
    for (const b of BANDS) {
      let p = 0;
      for (let i = 1; i <= this.half; i++) { const f = this.freqs[i]; if (f >= b.lo && f < b.hi) p += psd[i] * df; }
      out[b.id] = p; total += p;
    }
    out.total = total;
    let peak = 1, best = 0; for (let i = 1; i <= this.half; i++) if (psd[i] > best) { best = psd[i]; peak = i; }
    out.dominant = this.freqs[peak];
    return out;
  }
}
