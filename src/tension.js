// Muscle tension: the EMG envelope (µV RMS above 20 Hz, 100 ms) of a group of electrodes, read 0–1 against
// this person. After PiEEG's artifact envelopes (avatar-foundation/neuro/useArtifactEnvelopes.ts,
// engine-artifact.ts): baseline from rest, a threshold 60 % of the way from baseline to the peaks, hysteresis.
// Here the range sets itself while the person wears the mask: the floor is the 10th percentile of the last
// minute (relaxed face), the ceiling the highest level seen, which decays over two minutes so one hard clench
// does not flatten everything after it. "Set range" replaces both with a measured relax / squeeze.
// On above 0.6, off below 0.4. Over 20 Hz, blinks and eye movements do not count as tension.
export const TENSION_GROUPS = [
  { id: 'jaw', label: 'Jaw', channels: [0, 1, 6, 7], where: 'temples', cue: 'Clench your teeth' },
  { id: 'brow', label: 'Brow', channels: [2, 3, 4, 5], where: 'forehead', cue: 'Raise your eyebrows' },
];
const ON = 0.6, OFF = 0.4, MIN_SPAN = 3;          // the ceiling stays at least 3× the floor (µV RMS)
const HZ = 10, FLOOR_S = 60, CEIL_TAU_S = 120;

export class TensionGroup {
  constructor(def) { this.def = def; this.reset(); }
  reset() { this.hist = []; this.floor = 0; this.ceil = 0; this.raw = 0; this.value = 0; this.on = 0; this.fixed = null; }
  /** One frame (10 Hz): `emg` = per-channel µV RMS, `bad` = channels to leave out. */
  push(emg, bad) {
    let s = 0, n = 0; for (const ch of this.def.channels) if (!bad || !bad[ch]) { s += emg[ch]; n++; }
    if (!n) { this.value += (0 - this.value) * 0.3; this.on = 0; return this.value; }
    const x = s / n; this.raw = x;
    this.hist.push(x); if (this.hist.length > FLOOR_S * HZ) this.hist.shift();
    if (this.fixed) { this.floor = this.fixed.floor; this.ceil = this.fixed.ceil; }
    else {
      const sorted = [...this.hist].sort((a, b) => a - b);
      this.floor = sorted[Math.floor(sorted.length * 0.1)];
      const decay = Math.exp(-1 / (HZ * CEIL_TAU_S));
      this.ceil = Math.max(x, this.ceil * decay, this.floor * MIN_SPAN);
    }
    const span = this.ceil - this.floor;
    const v = span > 1e-9 ? Math.max(0, Math.min(1, (x - this.floor) / span)) : 0;
    this.value += (v - this.value) * 0.5;
    if (!this.on && this.value > ON) this.on = 1; else if (this.on && this.value < OFF) this.on = 0;
    return this.value;
  }
  /** Fix the range from a measured relax (µV list) and squeeze (µV list). */
  setRange(relax, squeeze) {
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
    const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)] || 0; };
    const floor = med(relax), ceil = Math.max(p90(squeeze), floor * 1.5);
    this.fixed = { floor, ceil, at: Date.now() };
    return this.fixed;
  }
  clearRange() { this.fixed = null; this.ceil = 0; }
  toJSON() { return this.fixed; }
  fromJSON(j) { if (j && j.ceil > j.floor) this.fixed = { ...j }; }
}

/** The quick range measurement: relax 4 s, then the group's squeeze 3 s, for each group in turn. */
export const RANGE_STEPS = [
  { kind: 'relax', s: 4, cue: 'Relax your whole face' },
  { kind: 'jaw', s: 3, cue: 'Clench your teeth' },
  { kind: 'relax', s: 3, cue: 'Relax' },
  { kind: 'brow', s: 3, cue: 'Raise your eyebrows' },
  { kind: 'relax', s: 2, cue: 'Relax' },
];
export const RANGE_TOTAL_S = RANGE_STEPS.reduce((a, s) => a + s.s, 0);
export function rangeStepAt(t) {
  let acc = 0;
  for (let k = 0; k < RANGE_STEPS.length; k++) { if (t < acc + RANGE_STEPS[k].s) return { k, ...RANGE_STEPS[k], left: Math.ceil(acc + RANGE_STEPS[k].s - t), settle: t - acc < 0.6 }; acc += RANGE_STEPS[k].s; }
  return { k: RANGE_STEPS.length, kind: 'done', s: 0, cue: '', left: 0, settle: false };
}

export class Tension {
  constructor() { this.groups = Object.fromEntries(TENSION_GROUPS.map((g) => [g.id, new TensionGroup(g)])); this.range = null; }
  push(emg, bad) { for (const g of Object.values(this.groups)) g.push(emg, bad); }
  reset() { for (const g of Object.values(this.groups)) g.reset(); }
  get measuring() { return !!this.range; }
  startRange(now) { this.range = { t0: now, k: -1, relax: { jaw: [], brow: [] }, squeeze: { jaw: [], brow: [] } }; }
  cancelRange() { this.range = null; }
  /** Call at 10 Hz while measuring. Returns the step when it changes, { done } at the end. */
  stepRange(now) {
    const r = this.range; if (!r) return null;
    const st = rangeStepAt((now - r.t0) / 1000);
    const changed = st.k !== r.k; r.k = st.k;
    if (st.kind === 'done') {
      for (const id of Object.keys(this.groups)) { const g = this.groups[id]; if (r.relax[id].length > 5 && r.squeeze[id].length > 5) g.setRange(r.relax[id], r.squeeze[id]); }
      this.range = null; return { ...st, done: true };
    }
    if (!st.settle) for (const id of Object.keys(this.groups)) { const raw = this.groups[id].raw; if (st.kind === 'relax') r.relax[id].push(raw); else if (st.kind === id) r.squeeze[id].push(raw); }
    return changed ? st : null;
  }
  clearRange() { for (const g of Object.values(this.groups)) g.clearRange(); }
  toJSON() { return Object.fromEntries(Object.entries(this.groups).map(([id, g]) => [id, g.toJSON()])); }
  fromJSON(j) { if (!j) return; for (const [id, r] of Object.entries(j)) this.groups[id]?.fromJSON(r); }
}
