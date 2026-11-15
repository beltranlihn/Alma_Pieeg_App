import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeaturesCSV, signalOfColumn } from '../src/pages/sessions.js';

test('features CSV parses into time and columns; empty cells stay NaN', () => {
  const d = parseFeaturesCSV('timestamp,elapsed_s,idx_calm,gaze_side\n1.0,0.0,0.5,0\n1.1,0.1,,1\n');
  assert.deepEqual(Array.from(d.t), [0, 0.1].map((x) => Math.fround(x)));
  assert.equal(d.cols.idx_calm[0], 0.5); assert.ok(Number.isNaN(d.cols.idx_calm[1])); assert.equal(d.cols.gaze_side[1], 1);
  assert.equal(parseFeaturesCSV('timestamp,elapsed_s\n'), null);
});

test('columns find their catalogue signal', () => {
  assert.equal(signalOfColumn('idx_calm').id, 'idx.calm');
  assert.equal(signalOfColumn('face_jaw_open').id, 'face.jaw_open');
  assert.equal(signalOfColumn('faa').id, 'faa');
  assert.equal(signalOfColumn('dominant_hz').id, 'dominant');
  assert.equal(signalOfColumn('strap3_bpm').id, 'strap3.bpm');
  assert.equal(signalOfColumn('nothing_here'), null);
});
