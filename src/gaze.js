// Gaze from the electro-oculogram. Idea from PiEEG's Eye Track (MIT, experiences/eye-track/EyeTrack.tsx):
// the eye is a dipole (cornea +, retina −), so turning the eyes shifts the potential on the electrodes around
// them for as long as the eyes stay turned.
//   horizontal  h = right temples − left temples   (Ch7, Ch8 − Ch1, Ch2)
//   vertical    v = forehead − temples              (Ch3–Ch6 − Ch1, Ch2, Ch7, Ch8)
// Both are differences between electrodes, so drift that is common to all of them cancels.
// Calibration: a dot visits centre, left, centre, right, centre, up, centre, down, centre. Each target is read
// against the two centre holds around it, so the slow drift of the electrodes (which looks like a gaze shift
// when the targets come in order) is taken out. A 2×2 ridge regression maps (Δh, Δv) to the target (x, y);
// PiEEG fits a degree-2 polynomial on five targets, which with five points mostly fits the noise.
// Live: a centre that follows the signal slowly (τ 20 s) while the eyes are near the middle and no blink is
// going on, so the reading does not wander off over minutes. Recentre sets it at once.
// What to expect (PiEEG's own notes and the literature): left / centre / right is dependable, up / down is
// weaker and blinks get in the way, fine pointing is not possible. The Quest 3 has no eye tracker, so this
// is the only gaze signal it has.
export const H_POS = [6, 7], H_NEG = [0, 1], V_POS = [2, 3, 4, 5], V_NEG = [0, 1, 6, 7];

export const GAZE_TARGETS = [
  { id: 'c', x: 0, y: 0 }, { id: 'l', x: -1, y: 0 }, { id: 'c', x: 0, y: 0 }, { id: 'r', x: 1, y: 0 }, { id: 'c', x: 0, y: 0 },
  { id: 'u', x: 0, y: -1 }, { id: 'c', x: 0, y: 0 }, { id: 'd', x: 0, y: 1 }, { id: 'c', x: 0, y: 0 },
];
export const GAZE_TIMING = { getReady: 2, move: 0.7, hold: 1.6 };
export const GAZE_STEP_S = GAZE_TIMING.move + GAZE_TIMING.hold;
export const GAZE_TOTAL_S = GAZE_TIMING.getReady + GAZE_TARGETS.length * GAZE_STEP_S;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/** h and v from the EOG value of every channel. `bad` (optional) leaves channels out of the averages. */
export function eogFeatures(eog, bad) {
  const avg = (chs) => { let s = 0, n = 0; for (const ch of chs) if (!bad || !bad[ch]) { s += eog[ch]; n++; } return n ? s / n : NaN; };
  return { h: avg(H_POS) - avg(H_NEG), v: avg(V_POS) - avg(V_NEG) };
}

/** Where the calibration is at `t` seconds: the target index, whether the eyes are still moving, the dot position. */
export function gazePhaseAt(t) {
  if (t < GAZE_TIMING.getReady) return { step: -1, phase: 'ready', target: GAZE_TARGETS[0], recording: false };
  const k = Math.floor((t - GAZE_TIMING.getReady) / GAZE_STEP_S);
  if (k >= GAZE_TARGETS.length) return { step: GAZE_TARGETS.length, phase: 'done', target: GAZE_TARGETS[GAZE_TARGETS.length - 1], recording: false };
  const u = t - GAZE_TIMING.getReady - k * GAZE_STEP_S;
  return { step: k, phase: u < GAZE_TIMING.move ? 'move' : 'hold', target: GAZE_TARGETS[k], recording: u >= GAZE_TIMING.move };
}

/** Solve the 2×2 ridge (X'X + λI) a = X'y for each output. X rows are [Δh, Δv]. */
function ridge2(rows, ys, lambda) {
  let a = 0, b = 0, d = 0, e = 0, f = 0;
  for (let i = 0; i < rows.length; i++) { const [p, q] = rows[i]; a += p * p; b += p * q; d += q * q; e += p * ys[i]; f += q * ys[i]; }
  a += lambda; d += lambda;
  const det = a * d - b * b; if (Math.abs(det) < 1e-12) return [0, 0];
  return [(d * e - b * f) / det, (a * f - b * e) / det];
}

/**
 * Fit from the holds: [{ target, h: [...], v: [...] }] in the order of GAZE_TARGETS.
 * Returns the model or null when a target is missing.
 */
export function fitGaze(holds) {
  const centres = holds.map((hd, k) => (hd.target.id === 'c' ? k : -1)).filter((k) => k >= 0);
  const rows = [], xs = [], ys = [], per = {};
  for (let k = 0; k < holds.length; k++) {
    const hd = holds[k]; if (hd.target.id === 'c' || hd.h.length < 3) continue;
    const before = [...centres].reverse().find((c) => c < k), after = centres.find((c) => c > k);
    const refs = [before, after].filter((c) => c != null && holds[c].h.length >= 3);
    if (!refs.length) continue;
    const ch = mean(refs.map((c) => mean(holds[c].h))), cv = mean(refs.map((c) => mean(holds[c].v)));
    const dh = hd.h.map((x) => x - ch), dv = hd.v.map((x) => x - cv);
    per[hd.target.id] = { dh: mean(dh), dv: mean(dv), sdh: sd(hd.h), sdv: sd(hd.v), n: dh.length };
    for (let i = 0; i < dh.length; i++) { rows.push([dh[i], dv[i]]); xs.push(hd.target.x); ys.push(hd.target.y); }
  }
  if (!per.l || !per.r || !per.u || !per.d) return null;
  // Scale λ to the data so the ridge means the same thing whatever the µV range is.
  const scale = mean(rows.map(([p, q]) => p * p + q * q)) || 1;
  const lambda = 0.01 * scale * rows.length;
  const ax = ridge2(rows, xs, lambda), ay = ridge2(rows, ys, lambda);
  // Separation: how far apart left/right (up/down) are, in units of the within-hold noise.
  const sepH = Math.abs(per.r.dh - per.l.dh) / (Math.sqrt((per.r.sdh ** 2 + per.l.sdh ** 2) / 2) || 1);
  const sepV = Math.abs(per.d.dv - per.u.dv) / (Math.sqrt((per.d.sdv ** 2 + per.u.sdv ** 2) / 2) || 1);
  const centre = holds[centres[centres.length - 1]];
  return { ax, ay, sepH, sepV, quality: { h: sepQuality(sepH), v: sepQuality(sepV) }, per, centre: { h: mean(centre.h), v: mean(centre.v) }, at: Date.now() };
}

export const sepQuality = (s) => (s >= 3 ? 'strong' : s >= 2 ? 'usable' : s >= 1 ? 'marginal' : 'inconclusive');

const SIDE_IN = 0.5, SIDE_OUT = 0.3, FOLLOW_TAU_S = 20, SMOOTH = 0.35;

export class Gaze {
  constructor() { this.model = null; this.centre = { h: 0, v: 0 }; this.x = 0; this.y = 0; this.side = 0; this.rec = null; this.h = 0; this.v = 0; this.follow = true; }
  get calibrating() { return !!this.rec; }
  get ready() { return !!this.model; }

  start(now) { this.rec = { t0: now, holds: GAZE_TARGETS.map((target) => ({ target, h: [], v: [] })), step: -2 }; }
  cancel() { this.rec = null; }
  phase(now) { return this.rec ? gazePhaseAt((now - this.rec.t0) / 1000) : null; }

  /** Feed one EOG frame (call at 20 Hz). `blinking` freezes the reading. Returns the calibration phase when it changes. */
  update(now, eog, { blinking = false, bad = null, dt = 0.05 } = {}) {
    const { h, v } = eogFeatures(eog, bad);
    if (!Number.isFinite(h) || !Number.isFinite(v)) return null;
    this.h = h; this.v = v;
    let changed = null;
    if (this.rec) {
      const ph = gazePhaseAt((now - this.rec.t0) / 1000);
      if (ph.step !== this.rec.step || ph.phase !== this.rec.phase) { changed = ph; this.rec.step = ph.step; this.rec.phase = ph.phase; }
      if (ph.recording && !blinking) { const hd = this.rec.holds[ph.step]; hd.h.push(h); hd.v.push(v); }
      if (ph.phase === 'done') {
        const m = fitGaze(this.rec.holds); this.rec = null;
        if (m) { this.model = m; this.centre = { ...m.centre }; }
        return { ...ph, done: true, ok: !!m };
      }
      return changed;
    }
    if (!this.model || blinking) return null;
    const dh = h - this.centre.h, dv = v - this.centre.v;
    const x = this.model.ax[0] * dh + this.model.ax[1] * dv, y = this.model.ay[0] * dh + this.model.ay[1] * dv;
    this.x += (Math.max(-1.5, Math.min(1.5, x)) - this.x) * SMOOTH;
    this.y += (Math.max(-1.5, Math.min(1.5, y)) - this.y) * SMOOTH;
    if (this.side === 0 && Math.abs(this.x) > SIDE_IN) this.side = Math.sign(this.x);
    else if (this.side !== 0 && (Math.abs(this.x) < SIDE_OUT || Math.sign(this.x) !== this.side)) this.side = Math.abs(this.x) > SIDE_IN ? Math.sign(this.x) : 0;
    // the centre follows slowly while the eyes are near the middle (drift), never while they are turned
    if (this.follow && Math.abs(this.x) < SIDE_OUT && Math.abs(this.y) < SIDE_OUT) {
      const k = 1 - Math.exp(-dt / FOLLOW_TAU_S);
      this.centre.h += (h - this.centre.h) * k; this.centre.v += (v - this.centre.v) * k;
    }
    return null;
  }

  recentre() { this.centre = { h: this.h, v: this.v }; this.x = 0; this.y = 0; this.side = 0; }
  reset() { this.model = null; this.rec = null; this.x = 0; this.y = 0; this.side = 0; }

  toJSON() { return this.model ? { ax: this.model.ax, ay: this.model.ay, sepH: this.model.sepH, sepV: this.model.sepV, quality: this.model.quality, at: this.model.at } : null; }
  fromJSON(j) { if (j && Array.isArray(j.ax) && Array.isArray(j.ay)) this.model = { ...j, per: {}, centre: { h: 0, v: 0 } }; }
  summary() { return this.model ? { separation_h: +this.model.sepH.toFixed(2), separation_v: +this.model.sepV.toFixed(2), quality: this.model.quality } : null; }
}
