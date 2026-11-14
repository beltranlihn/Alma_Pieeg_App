import test from 'node:test';
import assert from 'node:assert/strict';
import { Calibration, cohenD, newStats, pushStat, qualityFromD, PREP_S } from '../src/calibrate.js';

const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const IDX = { focus: 1, relax: 0.5, calm: 0.5, engagement: 1, workload: 1, fatigue: 1, meditation: 0.5 };

// Deterministic noise so the test never flakes.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function frameBands(rand, alphaGainCh4) {
  return Array.from({ length: 8 }, (_, ch) => Object.fromEntries(BANDS.map((b) => {
    let p = 10 * (1 + 0.3 * (rand() - 0.5));                // ±15 % noise on every band
    if (b === 'alpha' && ch === 4) p *= alphaGainCh4;       // the planted effect: Ch5 alpha
    return [b, p];
  })));
}

function runProtocol(cal, { seconds, bad = [], effect = 4 }) {
  const rand = rng(7);
  let now = 0;
  cal.start(now, { seconds, task: 'eyes', participant: 'test' });
  const phases = [];
  while (cal.running) {
    now += 100;                                             // engine features at 10 Hz
    const ph = cal.tick(now); if (ph) phases.push(ph);
    const gain = cal.phase === 'active' ? effect : 1;
    const calm = cal.phase === 'active' ? 0.8 : 0.4;
    cal.feed(frameBands(rand, gain), { ...IDX, calm: calm + 0.02 * (rand() - 0.5) }, Array.from({ length: 8 }, (_, ch) => bad.includes(ch)));
  }
  return phases;
}

test('Welford and Cohen\'s d match the textbook values', () => {
  const r = newStats(), a = newStats();
  for (const x of [1, 2, 3, 4, 5]) pushStat(r, x);
  for (const x of [3, 4, 5, 6, 7]) pushStat(a, x);
  assert.equal(r.mean, 3); assert.equal(a.mean, 5);
  // both variances are 2.5 → pooled sd √2.5 → d = 2 / 1.5811
  assert.ok(Math.abs(cohenD(r, a) - 2 / Math.sqrt(2.5)) < 1e-9);
  assert.equal(qualityFromD(1.3).tier, 'strong');
  assert.equal(qualityFromD(0.9).tier, 'usable');
  assert.equal(qualityFromD(0.5).tier, 'marginal');
  assert.equal(qualityFromD(0.1).tier, 'inconclusive');
  assert.equal(qualityFromD(2, false).tier, 'untrained');
});

test('the protocol runs prep → rest → prep → active → done with the chosen length', () => {
  const cal = new Calibration(8);
  const phases = runProtocol(cal, { seconds: 10 });
  assert.deepEqual(phases, ['rest', 'prep2', 'active', 'done']);
  assert.equal(cal.running, false);
  // 10 s at 10 Hz per phase (±1 frame at the edges); nothing recorded during the two 5 s preps
  assert.ok(Math.abs(cal.result.frames.rest - 100) <= 1, `rest frames ${cal.result.frames.rest}`);
  assert.ok(Math.abs(cal.result.frames.active - 100) <= 1, `active frames ${cal.result.frames.active}`);
  assert.equal(PREP_S, 5);
});

test('the ranking finds the planted channel × band and the score reads rest as 0 and active as 1', () => {
  const cal = new Calibration(8);
  runProtocol(cal, { seconds: 20 });
  const best = cal.result.ranking[0];
  assert.equal(best.channel, 4); assert.equal(best.band, 'alpha');
  assert.ok(best.d > 3, `d ${best.d}`); assert.equal(best.quality, 'strong');
  assert.deepEqual(cal.selected, [0]); assert.ok(cal.applied);
  const rand = rng(99);
  let s = 0; for (let k = 0; k < 20; k++) s = cal.score(frameBands(rand, 1)); assert.ok(s < 0.2, `rest score ${s}`);
  for (let k = 0; k < 20; k++) s = cal.score(frameBands(rand, 4)); assert.ok(s > 0.8, `active score ${s}`);
});

test('indices are read against the calibration and report which ones moved', () => {
  const cal = new Calibration(8);
  runProtocol(cal, { seconds: 20 });
  const c = cal.result.indices.calm;
  assert.ok(c.d > 3 && c.quality === 'strong', `calm d ${c.d}`);
  assert.ok(cal.normIndex('calm', 0.4) < 0.1);
  assert.ok(cal.normIndex('calm', 0.8) > 0.9);
  assert.equal(cal.normIndex('focus', 1), null);            // flat during calibration → no range, fall back
});

test('a channel with bad contact during the recording is left out of the ranking', () => {
  const cal = new Calibration(8);
  runProtocol(cal, { seconds: 10, bad: [4] });
  assert.deepEqual(cal.result.excluded, [4]);
  assert.ok(cal.result.ranking.every((f) => f.channel !== 4));
});

test('no contrast: nothing is trained and nothing drives the score', () => {
  const cal = new Calibration(8);
  runProtocol(cal, { seconds: 10, effect: 1 });
  assert.ok(Math.abs(cal.result.ranking[0].d) < 0.8, `best d on pure noise ${cal.result.ranking[0].d}`);
  assert.ok(cal.result.ranking.every((f) => !f.trained), 'pure noise must not pass the 0.05 log10 floor');
  assert.equal(cal.applied, false);
  const json = cal.toJSON();
  assert.equal(json.task, 'eyes'); assert.equal(json.seconds_per_phase, 10);
  cal.reset(); assert.equal(cal.result, null); assert.equal(cal.applied, false); assert.equal(cal.score(frameBands(rng(1), 1)), 0);
});
