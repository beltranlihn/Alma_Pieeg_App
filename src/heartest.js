// Heart rate estimated from the EEG electrodes · EXPERIMENTAL, for art, not for health.
//
// Two traces of the heart can reach a face mask: the pulse wave of the temporal artery, which moves the temple
// electrodes a little at every beat (0.7–3 Hz), and the heart's own electric field (QRS, 10–25 Hz, a few µV on the
// head). In the first real recordings (2026-11-17) neither was strong enough to trust: a recording with no head at
// all showed periodicities almost as strong. So this estimator is strict about saying "I don't know":
//   • every second, the last 12 s of each channel with contact, minus the median of all channels (what the
//     reference adds goes away), band-passed 0.7–3 Hz both ways (no phase shift), down to 50 Hz;
//   • autocorrelation between 40 and 150 beats per minute; per channel, the strongest lag and how strong it is;
//   • it locks only when several channels agree (±8 bpm), their peak is clearly above what noise gives (0.45) and
//     the last estimates are steady. Otherwise bpm stays at its last value with "searching", or 0.
// The beat pulse it gives is a metronome at that rate, not a detected beat.
// To validate it: wear a strap too and record a session; the features file logs heart_bpm (strap) and
// heart_eeg_bpm side by side.
import { Biquad } from './dsp.js';

const WIN_S = 12, DECIM = 5, MIN_BPM = 40, MAX_BPM = 150;
const LOCK_PEAK = 0.45, AGREE_BPM = 8, STEADY_SD = 6;

function filtfilt(x, sections) {
  const run = (arr) => { for (const make of sections) { const b = make(); for (let i = 0; i < arr.length; i++) arr[i] = b.process(arr[i]); } };
  const y = Float64Array.from(x); run(y); y.reverse(); run(y); y.reverse(); return y;
}

/** Remove the mean and the straight-line trend of a window, in place. */
function detrend(x) {
  const n = x.length; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxy += i * x[i]; sxx += i * i; }
  const den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n;
  for (let i = 0; i < n; i++) x[i] -= icpt + slope * i;
}

/** Strongest autocorrelation lag in the heart-rate range: { bpm, peak }. x is at fs / DECIM. */
export function autocorrBpm(x, fsd) {
  const n = x.length; let mean = 0; for (const v of x) mean += v; mean /= n;
  const d = x.map((v) => v - mean); let e0 = 0; for (const v of d) e0 += v * v; if (e0 <= 1e-12) return { bpm: 0, peak: 0 };
  const lo = Math.floor(fsd * 60 / MAX_BPM), hi = Math.ceil(fsd * 60 / MIN_BPM);
  let best = -1, bestLag = 0, prev = null, rising = false;
  for (let lag = lo; lag <= hi && lag < n - 1; lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    const r = s / e0;
    if (prev !== null && r > prev) rising = true;
    if (rising && r > best) { best = r; bestLag = lag; }       // the first rise avoids the lag-0 shoulder
    prev = r;
  }
  if (bestLag <= 0) return { bpm: 0, peak: 0 };
  // parabolic refinement of the lag
  const r = (lag) => { let s = 0; for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag]; return s / e0; };
  const a = r(bestLag - 1), b = best, c = r(bestLag + 1), den = a - 2 * b + c, shift = den ? 0.5 * (a - c) / den : 0;
  return { bpm: 60 * fsd / (bestLag + Math.max(-0.5, Math.min(0.5, shift))), peak: best };
}

export class HeartFromEEG {
  constructor(fs) { this.fs = fs; this.reset(); }
  reset() { this.bpm = 0; this.confidence = 0; this.locked = false; this.agree = 0; this.recent = []; this.lastBeat = 0; }

  /** Call about once a second. rings: raw rings; bad: per-channel mask (skip those). */
  update(rings, bad) {
    const fs = this.fs, n = Math.min(rings.count, WIN_S * fs); if (n < 8 * fs) return this;
    const start = (rings.write - n + rings.size) % rings.size, use = [];
    for (let ch = 0; ch < rings.raw.length; ch++) if (!bad || !bad[ch]) use.push(ch);
    if (use.length < 3) { this.locked = false; this.confidence = 0; return this; }
    // own part of each channel: minus the median of all channels at each sample
    const own = use.map(() => new Float64Array(n)), col = new Array(use.length);
    for (let i = 0; i < n; i++) {
      const k = (start + i) % rings.size;
      for (let j = 0; j < use.length; j++) col[j] = rings.raw[use[j]][k];
      const s = [...col].sort((a, b) => a - b), med = s[s.length >> 1];
      for (let j = 0; j < use.length; j++) own[j][i] = col[j] - med;
    }
    const sections = [() => Biquad.highpass(0.7, fs, 0.7071), () => Biquad.lowpass(3, fs, 0.7071)];
    const fsd = fs / DECIM, per = [];
    for (const x of own) {
      detrend(x);                                   // electrodes sit tens of mV apart: without this the filter's start-up swamps the pulse
      const y = filtfilt(x, sections), m = Math.floor(n / DECIM), dec = new Float64Array(m);
      for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < DECIM; k++) s += y[i * DECIM + k]; dec[i] = s / DECIM; }
      per.push(autocorrBpm(dec.subarray(Math.floor(fsd)), fsd));        // skip the first second (filter edges)
    }
    const strong = per.filter((p) => p.peak > 0.25).sort((a, b) => b.peak - a.peak);
    if (!strong.length) { this.locked = false; this.confidence = 0; this.agree = 0; return this; }
    const bpms = strong.map((p) => p.bpm).sort((a, b) => a - b), medBpm = bpms[bpms.length >> 1];
    const agreeing = strong.filter((p) => Math.abs(p.bpm - medBpm) <= AGREE_BPM);
    this.agree = agreeing.length / use.length;
    this.confidence = agreeing.reduce((s, p) => s + p.peak, 0) / agreeing.length;
    const est = agreeing.reduce((s, p) => s + p.bpm * p.peak, 0) / agreeing.reduce((s, p) => s + p.peak, 0);
    this.recent.push(est); if (this.recent.length > 5) this.recent.shift();
    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const sd = Math.sqrt(this.recent.reduce((s, v) => s + (v - mean) ** 2, 0) / this.recent.length);
    this.locked = agreeing.length >= 2 && this.confidence >= LOCK_PEAK && this.recent.length >= 3 && sd <= STEADY_SD;
    if (this.locked) this.bpm = this.bpm ? this.bpm + (est - this.bpm) * 0.4 : est;
    return this;
  }

  /** A 150 ms pulse at the estimated rate (a metronome, not a detected beat). */
  beat(nowMs) {
    if (!this.locked || !this.bpm) return 0;
    const period = 60000 / this.bpm;
    if (nowMs - this.lastBeat >= period) this.lastBeat = this.lastBeat && nowMs - this.lastBeat < 2 * period ? this.lastBeat + period : nowMs;
    return nowMs - this.lastBeat < 150 ? 1 : 0;
  }
}
