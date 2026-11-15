// Facial gestures from the mask's electrodes. Ported from PiEEG's Face Trainer (MIT,
// PiEEG-server/dashboard/src/experiences/face-trainer + face-trainer-v2):
//   • every 100 ms, a 200 ms window of all 8 channels, common-average referenced (what is common to every
//     electrode — hum, motion, reference drift — cancels; what differs between electrodes stays);
//   • 5 features per channel: log RMS, log variance, log line length, slope-sign-change rate, log high-band RMS
//     → 40 numbers; the 5 of one channel are a "group";
//   • one detector per gesture: logistic regression with ridge (λ₂ = 1) and group-lasso (λg = 0.3) by Adam +
//     block soft-threshold, class-balanced, standardised on the training fold only. The group-lasso drives whole
//     channels to zero, so each detector also says which electrodes carry that gesture;
//   • the progressive 3-2-1 protocol of v2: the first recording has 3 cycles of rest → gesture, the second 2,
//     the next ones 1. Rest samples are negatives, the gesture (ramps included) positives;
//   • readiness = balanced accuracy, leaving one CYCLE out at a time (PiEEG leaves one recording out; a cycle is
//     the same idea with more folds, and still never splits samples that are next to each other in time).
// Differences: the features read a wide-band copy of the signal (1 Hz–Nyquist, mains notched) instead of the
// 1–40 Hz display trace, because smiles and clenches live above 40 Hz; the probabilities are smoothed (EMA 0.25)
// and turned into on/off events with hysteresis for OSC.
import { CHANNELS } from './ble.js';

export const GESTURES = [
  { id: 'clench', label: 'Clench', hint: 'Bite down, teeth together.', why: 'Masseter and temporalis: the temple electrodes hear it best.' },
  { id: 'jaw_open', label: 'Jaw open', hint: 'Drop the jaw, like saying “aah”.', why: 'Masseter and digastric, from the temples.' },
  { id: 'smile', label: 'Smile', hint: 'Pull the mouth corners up and back.', why: 'Zygomaticus: reaches the lower temple electrodes, if at all.' },
  { id: 'brows_up', label: 'Brows up', hint: 'Lift both eyebrows high.', why: 'Frontalis, right under the forehead electrodes.' },
  { id: 'frown', label: 'Frown', hint: 'Pull the brows down and together.', why: 'Corrugator, between the eyes: inner forehead.' },
  { id: 'blink_hard', label: 'Blink hard', hint: 'Squeeze both eyes shut.', why: 'Orbicularis oculi plus the eyes rolling up: every frontal electrode.' },
  { id: 'wink_left', label: 'Wink left', hint: 'Close the left eye only.', why: 'Needs the left side to differ from the right.' },
  { id: 'wink_right', label: 'Wink right', hint: 'Close the right eye only.', why: 'Needs the right side to differ from the left.' },
  { id: 'pucker', label: 'Pucker', hint: 'Push the lips forward, like a kiss.', why: 'Orbicularis oris, far from the mask: the hardest one.' },
];
export const GESTURE_BY_ID = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

export const FEATURES_PER_CHANNEL = 5;
export const FEATURE_DIM = CHANNELS * FEATURES_PER_CHANNEL;
export const WINDOW_SAMPLES = 50;          // 200 ms at 250 Hz
const HPF_WIN = 12, SSC_DEADBAND = 1e-3, EPS = 1e-6;

// ── features ──────────────────────────────────────────────────────────────
function featuresOf(win, n, out, o) {
  let mean = 0; for (let i = 0; i < n; i++) mean += win[i]; mean /= n;
  let sumSq = 0, lineLen = 0, ssc = 0, prevV = win[0] - mean, prevDelta = 0;
  for (let i = 1; i < n; i++) {
    const v = win[i] - mean, delta = v - prevV;
    sumSq += v * v; lineLen += Math.abs(delta);
    if (i >= 2 && Math.abs(delta) > SSC_DEADBAND && Math.abs(prevDelta) > SSC_DEADBAND && ((delta > 0) !== (prevDelta > 0))) ssc++;
    prevDelta = delta; prevV = v;
  }
  const variance = sumSq / n, rms = Math.sqrt(variance), sscRate = ssc / Math.max(1, n - 2);
  let hpSq = 0, hpCount = 0;
  for (let i = HPF_WIN; i < n; i++) {
    let ma = 0; for (let j = i - HPF_WIN; j < i; j++) ma += win[j] - mean; ma /= HPF_WIN;
    const r = (win[i] - mean) - ma; hpSq += r * r; hpCount++;
  }
  const hpRms = hpCount ? Math.sqrt(hpSq / hpCount) : 0;
  out[o] = Math.log(rms + EPS); out[o + 1] = Math.log(variance + EPS); out[o + 2] = Math.log(lineLen / n + EPS); out[o + 3] = sscRate; out[o + 4] = Math.log(hpRms + EPS);
}

const _wins = Array.from({ length: CHANNELS }, () => new Float64Array(WINDOW_SAMPLES));
/** The 40 features of the newest 200 ms of `ring` (an array of per-channel Float32Array rings), CAR first. */
export function faceFeatures(ring, at, count, out = new Float32Array(FEATURE_DIM)) {
  if (count < WINDOW_SAMPLES) return null;
  for (let s = 0; s < WINDOW_SAMPLES; s++) {
    const idx = at(WINDOW_SAMPLES - 1 - s);
    let m = 0; for (let ch = 0; ch < CHANNELS; ch++) { const v = ring[ch][idx]; _wins[ch][s] = v; m += v; }
    m /= CHANNELS; for (let ch = 0; ch < CHANNELS; ch++) _wins[ch][s] -= m;
  }
  for (let ch = 0; ch < CHANNELS; ch++) featuresOf(_wins[ch], WINDOW_SAMPLES, out, ch * FEATURES_PER_CHANNEL);
  return out;
}

// ── detector: L2 + group-lasso logistic regression (PiEEG detector.ts) ─────
const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

function standardise(X, N, F) {
  const mean = new Float64Array(F), std = new Float64Array(F);
  for (let n = 0; n < N; n++) for (let i = 0; i < F; i++) mean[i] += X[n * F + i];
  for (let i = 0; i < F; i++) mean[i] /= Math.max(1, N);
  for (let n = 0; n < N; n++) for (let i = 0; i < F; i++) { const d = X[n * F + i] - mean[i]; std[i] += d * d; }
  for (let i = 0; i < F; i++) std[i] = Math.sqrt(std[i] / Math.max(1, N - 1)) || 1;
  for (let n = 0; n < N; n++) for (let i = 0; i < F; i++) X[n * F + i] = (X[n * F + i] - mean[i]) / std[i];
  return { mean, std };
}

function groupProx(w, tau, g) {
  if (tau <= 0) return;
  for (let s = 0; s < w.length; s += g) {
    let sq = 0; for (let i = 0; i < g; i++) sq += w[s + i] * w[s + i];
    const norm = Math.sqrt(sq);
    if (norm <= tau) for (let i = 0; i < g; i++) w[s + i] = 0;
    else { const k = 1 - tau / norm; for (let i = 0; i < g; i++) w[s + i] *= k; }
  }
}

export function fitLogistic(X, y, N, F, { lambda = 1.0, lambdaGroup = 0.3, maxIter = 300, groupSize = FEATURES_PER_CHANNEL } = {}) {
  let nPos = 0; for (let i = 0; i < N; i++) if (y[i]) nPos++;
  const nNeg = N - nPos, wPos = nPos ? N / (2 * nPos) : 1, wNeg = nNeg ? N / (2 * nNeg) : 1;
  const w = new Float64Array(F), m = new Float64Array(F), v = new Float64Array(F), gW = new Float64Array(F);
  let b = 0, mb = 0, vb = 0;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = 0.1, tau = lambdaGroup > 0 ? (lambdaGroup * lr) / Math.sqrt(Math.max(1, N)) : 0;
  for (let it = 1; it <= maxIter; it++) {
    gW.fill(0); let gB = 0;
    for (let n = 0; n < N; n++) {
      const row = n * F; let z = b; for (let i = 0; i < F; i++) z += w[i] * X[row + i];
      const err = (y[n] ? wPos : wNeg) * (sigmoid(z) - y[n]);
      for (let i = 0; i < F; i++) gW[i] += err * X[row + i]; gB += err;
    }
    for (let i = 0; i < F; i++) gW[i] = gW[i] / N + (lambda / N) * w[i]; gB /= N;
    const c1 = 1 - Math.pow(b1, it), c2 = 1 - Math.pow(b2, it);
    for (let i = 0; i < F; i++) { m[i] = b1 * m[i] + (1 - b1) * gW[i]; v[i] = b2 * v[i] + (1 - b2) * gW[i] * gW[i]; w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps); }
    mb = b1 * mb + (1 - b1) * gB; vb = b2 * vb + (1 - b2) * gB * gB; b -= lr * (mb / c1) / (Math.sqrt(vb / c2) + eps);
    groupProx(w, tau, groupSize);
  }
  return { w, b };
}

export function balancedAccuracy(yTrue, yPred) {
  let tp = 0, fn = 0, tn = 0, fp = 0;
  for (let i = 0; i < yTrue.length; i++) { const t = yTrue[i], p = yPred[i]; if (t && p) tp++; else if (t) fn++; else if (!p) tn++; else fp++; }
  return ((tp + fn ? tp / (tp + fn) : 0) + (tn + fp ? tn / (tn + fp) : 0)) / 2;
}

function channelImportance(w) {
  const out = new Array(CHANNELS).fill(0); let max = 0;
  for (let c = 0; c < CHANNELS; c++) { let sq = 0; for (let i = 0; i < FEATURES_PER_CHANNEL; i++) sq += w[c * FEATURES_PER_CHANNEL + i] ** 2; out[c] = Math.sqrt(sq); max = Math.max(max, out[c]); }
  return out.map((x) => (max > 0 ? x / max : 0));
}

function stack(units, F) {
  const N = units.reduce((a, u) => a + u.n, 0), X = new Float32Array(N * F), y = new Uint8Array(N);
  let off = 0; for (const u of units) { X.set(u.X.subarray(0, u.n * F), off * F); y.set(u.y.subarray(0, u.n), off); off += u.n; }
  return { X, y, N };
}

/** Fit one detector from labelled units (cycles), with leave-one-unit-out balanced accuracy. */
export function fitDetector(units, F = FEATURE_DIM, opts = {}) {
  const all = stack(units, F);
  if (all.N < 20 || units.length < 2) return null;
  const Xfit = new Float32Array(all.X), { mean, std } = standardise(Xfit, all.N, F);
  const { w, b } = fitLogistic(Xfit, all.y, all.N, F, opts);
  let sum = 0, folds = 0;
  for (let k = 0; k < units.length; k++) {
    const train = stack(units.filter((_, j) => j !== k), F), test = units[k];
    let pos = 0; for (let i = 0; i < train.N; i++) pos += train.y[i];
    if (!test.n || pos === 0 || pos === train.N) continue;
    let tpos = 0; for (let i = 0; i < test.n; i++) tpos += test.y[i];
    if (tpos === 0 || tpos === test.n) continue;              // a fold needs both classes to score honestly
    const { mean: mt, std: st } = standardise(train.X, train.N, F);
    const fold = fitLogistic(train.X, train.y, train.N, F, opts);
    const pred = new Uint8Array(test.n);
    for (let n = 0; n < test.n; n++) { let z = fold.b; for (let i = 0; i < F; i++) z += fold.w[i] * (test.X[n * F + i] - mt[i]) / st[i]; pred[n] = sigmoid(z) >= 0.5 ? 1 : 0; }
    sum += balancedAccuracy(test.y.subarray(0, test.n), pred); folds++;
  }
  return { w: Array.from(w), b, mean: Array.from(mean), std: Array.from(std), cv: folds ? sum / folds : 0, folds, samples: all.N, importance: channelImportance(w) };
}

export function predictProb(d, x) {
  let z = d.b; for (let i = 0; i < d.w.length; i++) z += d.w[i] * (x[i] - d.mean[i]) / (d.std[i] || 1);
  return sigmoid(z);
}

export function readiness(cv) { return cv >= 0.85 ? 'ready' : cv >= 0.7 ? 'improving' : 'weak'; }

// ── the 3-2-1 recording protocol (PiEEG face-trainer-v2/prompts-v2.ts) ─────
export const TIMING = { getReady: 1, rest: 2.0, rampUp: 0.5, hold: 2.0, rampDown: 0.5, restFinal: 1.0 };
export const CYCLE_S = TIMING.rest + TIMING.rampUp + TIMING.hold + TIMING.rampDown;
export const cyclesForRecording = (k) => (k <= 1 ? 3 : k === 2 ? 2 : 1);          // k = 1-based recording number
export const recordingSeconds = (cycles) => TIMING.getReady + cycles * CYCLE_S + TIMING.restFinal;

/** Phase at `t` seconds into a recording of `cycles` cycles. label = the cycle number counting down (3, 2, 1). */
export function phaseAt(t, cycles) {
  const T = TIMING;
  if (t < T.getReady) return { phase: 'ready', amp: 0, pos: false, neg: false, cycle: 0, cycleLabel: cycles };
  t -= T.getReady;
  for (let c = 0; c < cycles; c++) {
    if (t < CYCLE_S) {
      const label = cycles - c;
      if (t < T.rest) return { phase: 'rest', amp: 0, pos: false, neg: t > 0.4, cycle: c, cycleLabel: label };
      let u = t - T.rest;
      if (u < T.rampUp) return { phase: 'up', amp: u / T.rampUp, pos: true, neg: false, cycle: c, cycleLabel: label };
      u -= T.rampUp;
      if (u < T.hold) return { phase: 'hold', amp: 1, pos: true, neg: false, cycle: c, cycleLabel: label };
      u -= T.hold;
      return { phase: 'down', amp: Math.max(0, 1 - u / T.rampDown), pos: true, neg: false, cycle: c, cycleLabel: label };
    }
    t -= CYCLE_S;
  }
  if (t < T.restFinal) return { phase: 'rest', amp: 0, pos: false, neg: t > 0.2, cycle: cycles - 1, cycleLabel: 0 };
  return { phase: 'done', amp: 0, pos: false, neg: false, cycle: cycles - 1, cycleLabel: 0 };
}

// ── the trainer: recordings, detectors, live probabilities ─────────────────
const ON = 0.7, OFF = 0.4, EMA = 0.25;

export class GestureTrainer {
  constructor() {
    this.models = {};             // id → detector (fitDetector output) + { recordings, trainedAt }
    this.units = {};              // id → [{ X, y, n }] cycles recorded this run (not saved)
    this.recordings = {};         // id → recordings made this run
    this.prob = Object.fromEntries(GESTURES.map((g) => [g.id, 0]));
    this.on = Object.fromEntries(GESTURES.map((g) => [g.id, 0]));
    this.rec = null;              // { id, t0, cycles, units: [], phase }
    this.participant = '';
  }
  get recording() { return !!this.rec; }
  trained(id) { return !!this.models[id]; }
  get trainedIds() { return GESTURES.filter((g) => this.models[g.id]).map((g) => g.id); }

  /** Begin a recording of gesture `id` at `now` (ms). Returns the number of cycles. */
  start(id, now) {
    const k = (this.recordings[id] || 0) + 1, cycles = cyclesForRecording(k);
    this.rec = { id, t0: now, cycles, units: Array.from({ length: cycles }, () => ({ rows: [], ys: [] })), phase: null, k };
    return cycles;
  }
  cancel() { this.rec = null; }
  elapsed(now) { return this.rec ? (now - this.rec.t0) / 1000 : 0; }
  progress(now) { return this.rec ? Math.min(1, this.elapsed(now) / recordingSeconds(this.rec.cycles)) : 0; }

  /** Advance the recording with the newest feature vector (call at 10 Hz). Returns { phase, changed, done }. */
  step(now, x) {
    const r = this.rec; if (!r) return null;
    const ph = phaseAt(this.elapsed(now), r.cycles), changed = ph.phase !== r.phase;
    r.phase = ph.phase;
    if (x && (ph.pos || ph.neg)) { const u = r.units[ph.cycle]; u.rows.push(Float32Array.from(x)); u.ys.push(ph.pos ? 1 : 0); }
    if (ph.phase === 'done') { this._finish(); return { ...ph, changed: true, done: true }; }
    return { ...ph, changed, done: false };
  }

  _finish() {
    const r = this.rec; this.rec = null;
    const units = (this.units[r.id] = this.units[r.id] || []);
    for (const u of r.units) {
      if (!u.rows.length) continue;
      const X = new Float32Array(u.rows.length * FEATURE_DIM); u.rows.forEach((row, n) => X.set(row, n * FEATURE_DIM));
      units.push({ X, y: Uint8Array.from(u.ys), n: u.rows.length });
    }
    this.recordings[r.id] = r.k;
    this.refit(r.id);
  }

  refit(id) {
    const d = fitDetector(this.units[id] || []);
    if (d) this.models[id] = { ...d, recordings: this.recordings[id] || 0, cycles: (this.units[id] || []).length, trainedAt: Date.now() };
    return this.models[id] || null;
  }

  clear(id) { delete this.models[id]; delete this.units[id]; delete this.recordings[id]; this.prob[id] = 0; this.on[id] = 0; }
  clearAll() { for (const g of GESTURES) this.clear(g.id); }

  /** Live: smoothed probability and on/off per trained gesture from one feature vector (call at 10–20 Hz). */
  predict(x) {
    for (const g of GESTURES) {
      const d = this.models[g.id];
      if (!d || !x) { this.prob[g.id] += (0 - this.prob[g.id]) * EMA; if (!d) { this.prob[g.id] = 0; this.on[g.id] = 0; } continue; }
      const p = predictProb(d, x);
      this.prob[g.id] += (p - this.prob[g.id]) * EMA;
      if (!this.on[g.id] && this.prob[g.id] > ON) this.on[g.id] = 1;
      else if (this.on[g.id] && this.prob[g.id] < OFF) this.on[g.id] = 0;
    }
    return this.prob;
  }

  toJSON() {
    const r4 = (a) => a.map((v) => +(+v).toFixed(5));
    return { participant: this.participant, models: Object.fromEntries(Object.entries(this.models).map(([id, d]) => [id, { w: r4(d.w), b: +d.b.toFixed(5), mean: r4(d.mean), std: r4(d.std), cv: +d.cv.toFixed(4), folds: d.folds, samples: d.samples, importance: r4(d.importance), recordings: d.recordings, cycles: d.cycles, trainedAt: d.trainedAt }])) };
  }
  fromJSON(j) {
    if (!j || !j.models) return;
    this.participant = j.participant || '';
    for (const [id, d] of Object.entries(j.models)) if (GESTURE_BY_ID[id] && d.w && d.w.length === FEATURE_DIM) this.models[id] = { ...d };
  }
  /** What goes into the session summary. */
  summary() {
    return { participant: this.participant, gestures: Object.fromEntries(Object.entries(this.models).map(([id, d]) => [id, { readiness: +d.cv.toFixed(3), cycles: d.cycles, channels: d.importance.map((v, ch) => (v > 0.05 ? ch + 1 : 0)).filter(Boolean) }])) };
  }
}
