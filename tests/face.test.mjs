import test from 'node:test';
import assert from 'node:assert/strict';
import { faceFeatures, fitDetector, predictProb, phaseAt, recordingSeconds, cyclesForRecording, GestureTrainer, FEATURE_DIM, FEATURES_PER_CHANNEL, WINDOW_SAMPLES } from '../src/face.js';
import { Gaze, fitGaze, GAZE_TARGETS, GAZE_TOTAL_S, gazePhaseAt } from '../src/gaze.js';
import { TensionGroup, TENSION_GROUPS, Tension, RANGE_TOTAL_S } from '../src/tension.js';
import { recoveryTimes } from '../src/session.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// a planted gesture: channels 6 and 7 (the right temple) shift by +2 sd on all 5 features while it is on
function sample(r, on, channels = [6, 7], effect = 2) {
  const x = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) x[i] = gauss(r);
  if (on) for (const ch of channels) for (let k = 0; k < FEATURES_PER_CHANNEL; k++) x[ch * FEATURES_PER_CHANNEL + k] += effect;
  return x;
}
function unit(r, nNeg, nPos, opts) {
  const rows = []; const ys = [];
  for (let i = 0; i < nNeg; i++) { rows.push(sample(r, false, opts?.channels, opts?.effect)); ys.push(0); }
  for (let i = 0; i < nPos; i++) { rows.push(sample(r, true, opts?.channels, opts?.effect)); ys.push(1); }
  const X = new Float32Array(rows.length * FEATURE_DIM); rows.forEach((row, n) => X.set(row, n * FEATURE_DIM));
  return { X, y: Uint8Array.from(ys), n: rows.length };
}

test('common-average reference: a signal shared by every electrode cancels, one that differs stays', () => {
  const size = 200, ring = Array.from({ length: 8 }, () => new Float32Array(size));
  const r = rng(3);
  for (let i = 0; i < size; i++) { const common = 300 * Math.sin(i * 0.3); for (let ch = 0; ch < 8; ch++) ring[ch][i] = common + (ch === 6 ? 40 * gauss(r) : 0.5 * gauss(r)); }
  const at = (back) => size - 1 - back;
  const x = faceFeatures(ring, at, size);
  const logRms = (ch) => x[ch * FEATURES_PER_CHANNEL];
  assert.ok(logRms(6) > logRms(0) + 1.5, `ch7 ${logRms(6)} vs ch1 ${logRms(0)}`);
  assert.ok(Math.exp(logRms(0)) < 10, `the 300 µV common sine should be gone, ch1 rms ${Math.exp(logRms(0))}`);
  assert.equal(faceFeatures(ring, at, WINDOW_SAMPLES - 1), null);
});

test('a planted gesture trains to a high leave-one-cycle-out score and names its electrodes', () => {
  const r = rng(11);
  const units = Array.from({ length: 6 }, () => unit(r, 16, 30));
  const d = fitDetector(units);
  assert.ok(d.cv > 0.9, `cv ${d.cv}`);
  assert.equal(d.folds, 6);
  const top = d.importance.map((v, ch) => [v, ch]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((p) => p[1]).sort();
  assert.deepEqual(top, [6, 7]);
  const others = d.importance.filter((_, ch) => ch !== 6 && ch !== 7);
  assert.ok(Math.max(...others) < 0.35, `group-lasso should quiet the other electrodes, max ${Math.max(...others)}`);
  const avgP = (on) => { let s = 0; for (let k = 0; k < 50; k++) s += predictProb(d, sample(r, on)); return s / 50; };
  assert.ok(avgP(true) > 0.8, `on ${avgP(true)}`);
  assert.ok(avgP(false) < 0.2, `off ${avgP(false)}`);
});

test('pure noise does not pass for a gesture', () => {
  const r = rng(5);
  const units = Array.from({ length: 6 }, () => unit(r, 16, 30, { effect: 0 }));
  const d = fitDetector(units);
  assert.ok(d.cv < 0.7, `cv on noise ${d.cv}`);
  assert.equal(fitDetector(units.slice(0, 1)), null, 'one cycle cannot be cross-validated');
});

test('the 3-2-1 protocol: 3 cycles, then 2, then 1, rest negative, gesture positive', () => {
  assert.deepEqual([1, 2, 3, 4].map(cyclesForRecording), [3, 2, 1, 1]);
  assert.equal(recordingSeconds(3), 17);
  let pos = 0, neg = 0;
  for (let t = 0; t < recordingSeconds(3); t += 0.1) { const p = phaseAt(t + 1e-6, 3); pos += p.pos; neg += p.neg; }
  assert.ok(Math.abs(pos - 90) <= 2, `positive frames ${pos}`);          // 3 cycles × 3 s (ramps + hold) at 10 Hz
  assert.ok(Math.abs(neg - 56) <= 3, `negative frames ${neg}`);          // 3 × 1.6 s + 0.8 s
  assert.equal(phaseAt(0.5, 3).phase, 'ready');
  assert.equal(phaseAt(3.5, 3).phase, 'hold');
  assert.equal(phaseAt(3.5, 3).cycleLabel, 3);
  assert.equal(phaseAt(17.1, 3).phase, 'done');
});

test('the trainer records, fits and then detects live with hysteresis', () => {
  const r = rng(21), tr = new GestureTrainer();
  for (let k = 0; k < 2; k++) {
    tr.start('clench', 0);
    let now = 0, out;
    do { now += 100; const ph = phaseAt(now / 1000, tr.rec.cycles); out = tr.step(now, sample(r, ph.pos)); } while (!out.done);
  }
  const m = tr.models.clench;
  assert.ok(m && m.cv > 0.9, `cv ${m && m.cv}`); assert.equal(m.cycles, 5); assert.equal(tr.recordings.clench, 2);
  for (let k = 0; k < 15; k++) tr.predict(sample(r, false));
  assert.equal(tr.on.clench, 0);
  for (let k = 0; k < 15; k++) tr.predict(sample(r, true));
  assert.equal(tr.on.clench, 1);
  const json = JSON.parse(JSON.stringify(tr.toJSON()));
  const back = new GestureTrainer(); back.fromJSON(json);
  assert.ok(back.trained('clench'));
  const x = sample(r, true); assert.ok(Math.abs(predictProb(back.models.clench, x) - predictProb(m, x)) < 1e-3);
});

// ── gaze ──
function gazeHolds(r, { drift = 0.4, gainH = 60, gainV = 40, noise = 6, cross = 0.15 } = {}) {
  let t = 0;
  return GAZE_TARGETS.map((target) => {
    const h = [], v = [];
    for (let i = 0; i < 32; i++) { t += 0.05; const d = drift * t * 10; h.push(gainH * target.x + cross * gainV * -target.y + d + noise * gauss(r)); v.push(-gainV * target.y + d * 0.5 + noise * gauss(r)); }
    t += 0.7;
    return { target, h, v };
  });
}

test('gaze calibration reads each target against the centre around it, so drift does not fool it', () => {
  const r = rng(8), m = fitGaze(gazeHolds(r));
  assert.ok(m, 'model');
  const map = (dh, dv) => [m.ax[0] * dh + m.ax[1] * dv, m.ay[0] * dh + m.ay[1] * dv];
  const [xr] = map(60, 0), [xl] = map(-60, 0), [, yu] = map(6, 40);   // looking up: v +40, a little crosstalk into h
  assert.ok(xr > 0.8 && xr < 1.2, `right ${xr}`); assert.ok(xl < -0.8 && xl > -1.2, `left ${xl}`);
  assert.ok(yu < -0.7, `up ${yu}`);
  assert.equal(m.quality.h, 'strong'); assert.ok(m.sepH > m.sepV);
  assert.equal(fitGaze(gazeHolds(r).map((hd) => (hd.target.id === 'l' ? { ...hd, h: [], v: [] } : hd))), null, 'a missing target gives no model');
});

test('live gaze: side with hysteresis, frozen during a blink, recentre', () => {
  assert.ok(Math.abs(GAZE_TOTAL_S - (2 + 9 * 2.3)) < 1e-9);
  assert.equal(gazePhaseAt(0.5).phase, 'ready'); assert.equal(gazePhaseAt(2.2).phase, 'move'); assert.equal(gazePhaseAt(3.0).phase, 'hold');
  const g = new Gaze(), r = rng(4);
  g.model = { ax: [1 / 60, 0], ay: [0, -1 / 40], sepH: 9, sepV: 5, quality: { h: 'strong', v: 'strong' } };
  const eog = (h, v) => { const e = new Float64Array(8); e[6] = e[7] = h / 2; e[0] = e[1] = -h / 2; for (const ch of [2, 3, 4, 5]) e[ch] = v; return e; };
  for (let k = 0; k < 20; k++) g.update(k * 50, eog(60 + gauss(r), 0));
  assert.equal(g.side, 1); assert.ok(g.x > 0.9);
  for (let k = 0; k < 3; k++) g.update(k * 50, eog(-60, 0), { blinking: true });
  assert.equal(g.side, 1, 'a blink does not move the gaze');
  for (let k = 0; k < 20; k++) g.update(k * 50, eog(-60, 0));
  assert.equal(g.side, -1);
  for (let k = 0; k < 20; k++) g.update(k * 50, eog(0, 0));
  assert.equal(g.side, 0);
  g.update(0, eog(30, 0)); g.recentre(); assert.equal(g.x, 0);
  for (let k = 0; k < 10; k++) g.update(k * 50, eog(30, 0));
  assert.ok(Math.abs(g.x) < 0.05, `after recentre ${g.x}`);
});

// ── tension ──
test('tension: relaxed floor, squeeze ceiling, on above 0.6 and off below 0.4', () => {
  const g = new TensionGroup(TENSION_GROUPS[0]), emg = (v) => Float32Array.from({ length: 8 }, () => v);
  for (let k = 0; k < 100; k++) g.push(emg(4));
  assert.ok(g.value < 0.1); assert.equal(g.on, 0);
  for (let k = 0; k < 10; k++) g.push(emg(30));
  assert.ok(g.value > 0.9, `squeeze ${g.value}`); assert.equal(g.on, 1);
  for (let k = 0; k < 10; k++) g.push(emg(4));
  assert.equal(g.on, 0);
  for (let k = 0; k < 100; k++) g.push(emg(5));
  assert.ok(g.value < 0.25, 'a small rise stays small: the ceiling is at least 3× the floor');
  const bad = [false, false, false, false, false, false, true, true];
  g.push(Float32Array.from([4, 4, 0, 0, 0, 0, 400, 400]), bad);
  assert.ok(g.raw === 4, 'bad electrodes are left out');
});

test('tension range measurement fixes floor and ceiling per group', () => {
  const t = new Tension(); t.startRange(0);
  let now = 0, done = null;
  while (!done) {
    now += 100;
    const step = Math.floor(now / 100);
    const sec = now / 1000, kind = sec < 4 ? 'relax' : sec < 7 ? 'jaw' : sec < 10 ? 'relax' : sec < 13 ? 'brow' : 'relax';
    const emg = Float32Array.from({ length: 8 }, (_, ch) => (kind === 'jaw' && [0, 1, 6, 7].includes(ch) ? 40 : kind === 'brow' && [2, 3, 4, 5].includes(ch) ? 25 : 3) + (step % 3) * 0.1);
    t.push(emg); const out = t.stepRange(now); if (out && out.done) done = out;
  }
  assert.ok(Math.abs(now / 1000 - RANGE_TOTAL_S) < 0.2);
  const j = t.groups.jaw.fixed, b = t.groups.brow.fixed;
  assert.ok(j.floor < 4 && j.ceil > 35, JSON.stringify(j));
  assert.ok(b.floor < 4 && b.ceil > 20 && b.ceil < 30, JSON.stringify(b));
});

// ── recovery ──
test('recovery: seconds from each peak back to within 20 % of baseline', () => {
  const s = [];
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 100; i++) s.push(0.2);                               // 10 s of baseline
    for (let i = 0; i < 10; i++) s.push(0.2 + 0.7 * (i + 1) / 10);           // 1 s rise to 0.9
    for (let i = 0; i < 80; i++) s.push(0.2 + 0.7 * Math.exp(-i / 10 / 2));  // τ = 2 s decay → 80 % back at 2·ln5 ≈ 3.2 s
  }
  const r = recoveryTimes(s);
  assert.equal(r.length, 3);
  for (const x of r) assert.ok(Math.abs(x - 3.2) < 0.25, `recovery ${x}`);
  assert.deepEqual(recoveryTimes(new Array(200).fill(0.3)), []);
});
