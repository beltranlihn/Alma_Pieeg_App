// Event detectors on the filtered rings. The blink detector follows PiEEG's useBlink: peak-to-peak
// over a 100 ms window polled at 40 Hz, adaptive baseline (median + MAD over ~3 s), duration gate
// 60–600 ms, refractory 300 ms. Frontal channels on the XR mask are Ch3–Ch6 (indices 2..5).
export class BlinkDetector {
  constructor(fs, channels = [2, 3, 4, 5]) {
    this.fs = fs; this.channels = channels; this.windowN = Math.round(fs * 0.1);
    this.hist = []; this.histMax = 120;             // ~3 s at 40 Hz
    this.count = 0; this.amplitude = 0; this.baseline = 0; this.threshold = 25; this.warmed = false;
    this.above = false; this.aboveSince = 0; this.lastBlink = 0; this.lastPulse = 0;
  }
  reset() { this.hist = []; this.count = 0; this.above = false; this.warmed = false; this.lastBlink = 0; }
  /** Call at ~40 Hz. Returns true on the poll where a blink is confirmed. */
  poll(rings, nowMs) {
    const n = Math.min(rings.count, this.windowN); if (n < this.windowN) return false;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      let v = 0; for (const ch of this.channels) v += rings.filt[ch][rings.at(i)];
      v /= this.channels.length; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const p2p = hi - lo; this.amplitude = p2p;
    this.hist.push(p2p); if (this.hist.length > this.histMax) this.hist.shift();
    if (this.hist.length >= 32) {
      const s = [...this.hist].sort((a, b) => a - b), med = s[s.length >> 1];
      const mad = 1.4826 * [...this.hist].map((x) => Math.abs(x - med)).sort((a, b) => a - b)[s.length >> 1];
      this.baseline = med; this.threshold = Math.max(25, med + Math.max(5 * mad, 8)); this.warmed = true;
    }
    if (!this.warmed) return false;
    const release = this.baseline + 0.6 * (this.threshold - this.baseline);
    let fired = false;
    if (!this.above && p2p > this.threshold && nowMs - this.lastBlink > 300) { this.above = true; this.aboveSince = nowMs; }
    else if (this.above && p2p < release) {
      const dur = nowMs - this.aboveSince; this.above = false;
      if (dur >= 60 && dur <= 600) { this.count++; this.lastBlink = nowMs; this.lastPulse = nowMs; fired = true; }
    } else if (this.above && nowMs - this.aboveSince > 600) { this.above = false; }     // too long: muscle, not a blink
    return fired;
  }
  /** 1 for 150 ms after each blink, else 0 (handy for OSC). */
  pulse(nowMs) { return nowMs - this.lastPulse < 150 ? 1 : 0; }
}

/** Rectified moving-average envelope over the last `ms` of a filtered channel (PiEEG's artifact envelope). */
export function envelope(rings, ch, fs, ms = 80) {
  const n = Math.min(rings.count, Math.round(fs * ms / 1000)); if (n < 2) return 0;
  let s = 0; for (let i = 0; i < n; i++) s += Math.abs(rings.filt[ch][rings.at(i)]);
  return s / n;
}

export function rms(rings, ch, fs, ms = 1000) {
  const n = Math.min(rings.count, Math.round(fs * ms / 1000)); if (n < 2) return 0;
  let s = 0, q = 0; for (let i = 0; i < n; i++) { const v = rings.filt[ch][rings.at(i)]; s += v; q += v * v; }
  const m = s / n; return Math.sqrt(Math.max(0, q / n - m * m));
}
