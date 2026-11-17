// Inputs with no disc (a mask with fewer discs than inputs) and the heart rate from the electrodes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groups, setMontage, usePreset, validateMontage, montageWarnings, XR_FACE, inputAt } from '../src/montage.js';
import { assessWindow, isBad } from '../src/quality.js';
import { HeartFromEEG } from '../src/heartest.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// a made-up mask with eight discs: Ref and Bias take two of them, so E3 and E4 have none
const EIGHT_DISCS = { preset: 'custom', name: 'Eight discs', channels: ['lt_low', 'lt_up', '', '', 'rf_out', 'lf_out', 'rt_up', 'lf_in'], ref: 'rf_in', bias: 'rt_low' };

test('a channel can be "not connected": left out of the groups, labelled, warned', () => {
  assert.deepEqual(validateMontage(EIGHT_DISCS), []);
  assert.deepEqual(setMontage(EIGHT_DISCS), []);
  assert.deepEqual(groups.off, [2, 3]); assert.deepEqual(groups.connected, [0, 1, 4, 5, 6, 7]);
  assert.ok(!groups.forehead.includes(2) && !groups.forehead.includes(3));
  assert.equal(XR_FACE[2].place, 'not connected');
  assert.equal(inputAt('c_left'), ''); assert.equal(inputAt('rf_in'), 'Ref');
  assert.match(montageWarnings(EIGHT_DISCS).join(' '), /Not connected: E3, E4/);
  usePreset('pieeg-docs');
  assert.deepEqual(groups.off, []);
});

test('Ref and Bias always need a disc, and two channels at least', () => {
  assert.match(validateMontage({ ...EIGHT_DISCS, ref: '' }).join(' '), /Ref has no site/);
  assert.match(validateMontage({ ...EIGHT_DISCS, channels: ['lt_low', '', '', '', '', '', '', ''] }).join(' '), /At least two/);
});

test('floating inputs do not spoil the contact check of the others', () => {
  const r = rng(5), n = 250, raw = [], filt = [];
  const shared = Array.from({ length: n }, () => gauss(r));
  for (let ch = 0; ch < 8; ch++) {
    const floating = ch === 2 || ch === 3, f = new Float64Array(n), w = new Float64Array(n);
    for (let i = 0; i < n; i++) { f[i] = floating ? 400 * gauss(r) : 5 * shared[i] + 5 * gauss(r); w[i] = (floating ? 900000 : -20000) + f[i]; }
    raw.push(w); filt.push(f);
  }
  const q = assessWindow(raw, filt, 250, [2, 3]);
  assert.equal(q[2].status, 'off'); assert.ok(isBad(q[3]));
  assert.ok([0, 1, 4, 5, 6, 7].every((ch) => q[ch].status === 'good'), JSON.stringify(q.map((c) => c.status)));
  assert.equal(q.ref.status, 'good');
});

/** Rings like the engine's, filled with `secs` of signal from gen(ch, t). */
function rings(secs, gen, fs = 250) {
  const size = fs * 20, raw = Array.from({ length: 8 }, () => new Float32Array(size)), n = Math.min(size, secs * fs);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 8; ch++) raw[ch][i] = gen(ch, i / fs);
  return { raw, size, count: n, write: n % size };
}

test('heart from the electrodes: locks on a temple pulse, says nothing on noise', () => {
  const r = rng(9), noise = () => 6 * gauss(r);
  const pulse = rings(14, (ch, t) => -30000 + ch * 5000 + noise() + (ch <= 1 || ch >= 6 ? 7 * Math.max(0, Math.sin(2 * Math.PI * 1.2 * t)) ** 3 : 0));
  const h = new HeartFromEEG(250);
  for (let k = 0; k < 4; k++) h.update(pulse, null);
  assert.ok(h.locked, `confidence ${h.confidence}`); assert.ok(Math.abs(h.bpm - 72) < 3, `bpm ${h.bpm}`);
  const quiet = rings(14, (ch) => -30000 + ch * 5000 + noise()), q = new HeartFromEEG(250);
  for (let k = 0; k < 4; k++) q.update(quiet, null);
  assert.ok(!q.locked); assert.equal(q.bpm, 0);
});
