import test from 'node:test';
import assert from 'node:assert/strict';
import { montage, groups, setMontage, usePreset, validateMontage, XR_FACE, onMontage, inputAt, montageJSON, montageWarnings } from '../src/montage.js';
import { eogFeatures } from '../src/gaze.js';
import { TENSION_GROUPS } from '../src/tension.js';
import { assessWindow, FULL_SCALE_UV } from '../src/quality.js';
import { BlinkDetector } from '../src/detect.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

test('the documentation montage gives the expected groups and labels', () => {
  usePreset('pieeg-docs');
  assert.deepEqual(groups.forehead, [2, 3, 4, 5]); assert.deepEqual(groups.temples, [0, 1, 6, 7]);
  assert.deepEqual(groups.leftForehead, [2, 3]); assert.deepEqual(groups.rightTemples, [6, 7]);
  assert.equal(XR_FACE[0].place, 'left temple · lower');
  assert.equal(inputAt('c_left'), 'Ref'); assert.equal(inputAt('c_right'), 'Bias');
});

test('a prototype wired differently: groups, labels and gaze follow the map', () => {
  // ours (2026-11-17): Ref on the right forehead inner site, Bias on the lower right temple; centre discs are channels
  let fired = 0; const off = onMontage(() => fired++);
  assert.ok(montageWarnings({ channels: ['lf_out', 'lf_in', 'c_left', 'c_right', 'rf_in', 'rf_out', 'rt_up', 'rt_low'], ref: 'lt_low', bias: 'lt_up' }).some((w) => /one side/.test(w)));
  const m = { preset: 'custom', name: 'Our prototype', channels: ['lt_low', 'lt_up', 'lf_out', 'lf_in', 'c_left', 'rf_out', 'rt_up', 'c_right'], ref: 'rf_in', bias: 'rt_low' };
  assert.deepEqual(setMontage(m), []);
  assert.equal(fired, 1); off();
  assert.equal(XR_FACE[4].place, 'centre · left'); assert.equal(XR_FACE[7].place, 'centre · right');
  assert.deepEqual(groups.rightTemples, [6]);                 // only E7 is on a right temple now
  assert.deepEqual(groups.forehead, [2, 3, 4, 5, 7]);
  assert.deepEqual(TENSION_GROUPS[0].channels, [0, 1, 6]);    // jaw = the temple channels of this map
  const eog = Float64Array.from([-30, -30, 0, 0, 0, 0, 30, 999]); // E8 is no longer a temple: it must not count in h
  assert.equal(eogFeatures(eog).h, 30 - (-30));
  assert.deepEqual(montageJSON().channels, m.channels);
  usePreset('pieeg-docs');
});

test('an impossible map is refused with a sentence, and nothing changes', () => {
  usePreset('pieeg-docs');
  const errs = setMontage({ channels: ['lt_low', 'lt_low', 'lf_out', 'lf_in', 'rf_in', 'rf_out', 'rt_up', 'rt_low'], ref: 'c_left', bias: 'c_right' });
  assert.ok(errs.length && /E1 and E2/.test(errs[0]), errs.join(' '));
  assert.equal(montage.preset, 'pieeg-docs');
  assert.ok(validateMontage({ channels: ['x'], ref: 'c_left', bias: 'c_left' }).length >= 2);
});

// ── contact: own noise per electrode and the reference ──
function window(fn) {
  const r = rng(3), n = 250, raw = [], filt = [];
  const shared = Array.from({ length: n }, () => gauss(r));
  for (let ch = 0; ch < 8; ch++) {
    const f = new Float64Array(n), w = new Float64Array(n);
    for (let i = 0; i < n; i++) { const { common, own, offset } = fn(ch); f[i] = common * shared[i] + own * gauss(r); w[i] = offset + f[i]; }
    raw.push(w); filt.push(f);
  }
  return assessWindow(raw, filt, 250);
}

test('a noisy reference is the reference, not eight bad electrodes', () => {
  const q = window(() => ({ common: 50, own: 5, offset: -30000 }));
  assert.equal(q.ref.status, 'noisy'); assert.ok(q.ref.common > 40, `common ${q.ref.common}`);
  assert.ok(q.every((c) => c.status === 'good'), JSON.stringify(q.map((c) => c.status)));
});

test('one electrode off the skin is that electrode; a big offset is not railed; the converter limit is', () => {
  const q = window((ch) => ({ common: 5, own: ch === 3 ? 120 : 5, offset: ch === 6 ? 600000 : -20000 }));
  assert.equal(q.ref.status, 'good');
  assert.equal(q[3].status, 'poor'); assert.equal(q[6].status, 'good');
  const r = window((ch) => ({ common: 5, own: 5, offset: ch < 5 ? FULL_SCALE_UV * 0.99 : 0 }));
  assert.equal(r[0].status, 'railed'); assert.equal(r.ref.status, 'lost');
});

test('blinks: forehead − temples counts a hump, ignores what all channels share', () => {
  const fs = 250, n = fs * 20, r = rng(9), filt = Array.from({ length: 8 }, () => new Float32Array(n));
  const blinksAt = [5, 9, 13];
  for (let i = 0; i < n; i++) {
    const t = i / fs, common = 50 * Math.sin(2 * Math.PI * 1.7 * t) + 20 * gauss(r);     // a noisy reference
    let hump = 0; for (const b of blinksAt) { const d = t - b; if (d >= 0 && d < 0.4) hump += 60 * Math.sin(Math.PI * d / 0.4) ** 2; }
    for (let ch = 0; ch < 8; ch++) filt[ch][i] = common + 3 * gauss(r) + ([2, 3, 4, 5].includes(ch) ? hump : hump * 0.2);
  }
  const det = new BlinkDetector(fs, [2, 3, 4, 5], [0, 1, 6, 7]), ring = { count: 0, filt, at: (b) => ring.count - 1 - b };
  const seen = [];
  for (let i = 12; i < n; i += 12) { ring.count = i; if (det.poll(ring, (i / fs) * 1000)) seen.push(+(i / fs).toFixed(1)); }
  assert.equal(seen.length, 3, JSON.stringify(seen));
  seen.forEach((s, k) => assert.ok(Math.abs(s - blinksAt[k] - 0.3) < 0.4, `blink ${k} at ${s}`));
});

test('review fixes: same map is a no-op, a junk config is refused, warnings, messages name the right input', () => {
  usePreset('pieeg-docs');
  let fired = 0; const off = onMontage(() => fired++);
  assert.deepEqual(setMontage({ ...montageJSON() }), []); assert.equal(fired, 0, 'applying the same map changes nothing');
  assert.ok(setMontage({ channels: 5, ref: 'c_left', bias: 'c_right' }).length > 0);
  assert.ok(setMontage(null).length > 0);
  off();
  const short = validateMontage({ channels: ['lt_low', 'lt_low'], ref: 'c_left', bias: 'c_right' });
  assert.ok(short.some((e) => /E1 and E2/.test(e)), short.join(' '));
  assert.ok(!short.some((e) => /Ref and/.test(e)));
});

test('no signal at all is not a quiet reference', () => {
  const q = window(() => ({ common: 0, own: 0, offset: 0 }));
  assert.equal(q.ref.status, 'flat');
});

test('a held gesture is not a blink when it ends', () => {
  const fs = 250, n = fs * 12, filt = Array.from({ length: 8 }, () => new Float32Array(n)), r = rng(2);
  for (let i = 0; i < n; i++) { const t = i / fs, held = t > 5 && t < 6.2 ? 80 : 0; for (let ch = 0; ch < 8; ch++) filt[ch][i] = 2 * gauss(r) + ([2, 3, 4, 5].includes(ch) ? held : 0); }
  const det = new BlinkDetector(fs, [2, 3, 4, 5], [0, 1, 6, 7]), ring = { count: 0, filt, at: (b) => ring.count - 1 - b };
  let count = 0; for (let i = 12; i < n; i += 12) { ring.count = i; if (det.poll(ring, (i / fs) * 1000)) count++; }
  assert.equal(count, 0);
});
