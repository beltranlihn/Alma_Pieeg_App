// Blink detector. A blink is a ~400 ms hump of 30–200 µV on the forehead (the eyelid and the eyes rolling up),
// strongest above the eyes and weak on the temples. We read forehead − temples (from the montage), so whatever
// is common to all electrodes (a noisy reference, hum, motion) cancels: in the first real tests the forehead
// average alone counted 160+ blinks that never happened, while forehead − temples showed the real ones clean.
// Polled at 20–40 Hz: the newest 100 ms are averaged (a blink is slow; this drops the muscle buzz and most of
// theta), compared with the median of the last ~3 s (threshold 3.5 MAD, never below 15 µV, set on today's
// recordings: it found the blinks that the analysis saw, where the old one counted 160+); a blink is a crossing that lasts 60–600 ms
// (longer is a held gesture or movement), with 250 ms between blinks. Polarity does not matter.
export class BlinkDetector {
  constructor(fs, channels = [2, 3, 4, 5], minus = []) {
    this.fs = fs; this.channels = channels; this.minus = minus; this.smoothN = Math.round(fs * 0.1);
    this.hist = []; this.histMax = 90;
    this.count = 0; this.amplitude = 0; this.baseline = 0; this.threshold = 15; this.warmed = false;
    this.above = false; this.aboveSince = 0; this.lastBlink = 0; this.lastPulse = 0; this.peak = 0; this.value = 0;
  }
  reset() { this.hist = []; this.count = 0; this.above = false; this.warmed = false; this.lastBlink = 0; }
  setChannels(channels, minus = []) { this.channels = channels; this.minus = minus; this.hist = []; this.warmed = false; this.above = false; }
  _value(rings) {
    const n = Math.min(rings.count, this.smoothN); let acc = 0;
    for (let i = 0; i < n; i++) {
      const idx = rings.at(i);
      let v = 0; for (const ch of this.channels) v += rings.filt[ch][idx]; v /= this.channels.length || 1;
      if (this.minus.length) { let m = 0; for (const ch of this.minus) m += rings.filt[ch][idx]; v -= m / this.minus.length; }
      acc += v;
    }
    return n ? acc / n : 0;
  }
  /** Call at 20–40 Hz. Returns true on the poll where a blink is confirmed. */
  poll(rings, nowMs) {
    if (rings.count < this.smoothN || !this.channels.length) return false;
    const v = this._value(rings); this.value = v;
    if (!this.above) { this.hist.push(v); if (this.hist.length > this.histMax) this.hist.shift(); }   // the baseline learns from the quiet
    if (this.hist.length >= 30) {
      const sorted = [...this.hist].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const mad = 1.4826 * [...this.hist].map((x) => Math.abs(x - med)).sort((a, b) => a - b)[this.hist.length >> 1];
      this.baseline = med; this.threshold = Math.max(15, 3.5 * mad); this.warmed = true;
    }
    if (!this.warmed) return false;
    const d = Math.abs(v - this.baseline);
    let fired = false;
    if (!this.above && d > this.threshold && nowMs - this.lastBlink > 250) { this.above = true; this.aboveSince = nowMs; this.peak = d; }
    else if (this.above) {
      this.peak = Math.max(this.peak, d);
      if (d < this.threshold * 0.5) {
        const dur = nowMs - this.aboveSince; this.above = false;
        if (dur >= 60 && dur <= 600) { this.count++; this.lastBlink = nowMs; this.lastPulse = nowMs; this.amplitude = this.peak; fired = true; }
      } else if (nowMs - this.aboveSince > 600) this.above = false;      // too long: a held gesture or movement
    }
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
