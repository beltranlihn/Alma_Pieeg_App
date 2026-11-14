import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder } from '../src/record.js';
import { SampleClock, Rings } from '../src/ring.js';

test('recorder writes PiEEG-compatible CSV with a mark column', () => {
  const r = new Recorder();
  r.start();
  const raw = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
  r.push(1700000000000, raw);
  r.mark('blink');
  r.push(1700000000004, raw);
  r.push(1700000000008, raw);
  r.stop();
  const csv = r.toCSV().trim().split('\n');
  assert.equal(csv[0], 'timestamp,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8,mark');
  assert.equal(csv.length, 4);
  assert.ok(csv[1].startsWith('1700000000.000000,1.000,2.000'));
  assert.ok(csv[2].endsWith(',"blink"'), 'mark lands on the next sample');
  assert.ok(csv[3].endsWith(','), 'no mark afterwards');
  const meta = JSON.parse(r.toMeta({ device: 'Simulator' }));
  assert.equal(meta.samples, 3);
  assert.equal(meta.marks.length, 1);
  assert.equal(meta.device, 'Simulator');
});

test('sample clock advances by 1/fs and jumps on a gap', () => {
  const c = new SampleClock(250);
  const a = c.stamp(0, 5);
  assert.equal(a.length, 5);
  assert.ok(Math.abs((a[4] - a[0]) - 16) < 1e-6);
  const before = c.n;
  c.stamp(0, 5);
  assert.equal(c.n, before + 5);
});

test('rings keep the newest samples', () => {
  const r = new Rings(250, 1);
  for (let i = 0; i < 300; i++) r.push(new Float32Array(8).fill(i), new Float32Array(8).fill(-i));
  assert.equal(r.count, 250);
  assert.equal(r.total, 300);
  assert.equal(r.raw[0][r.at(0)], 299);
  const { start, len } = r.startOfLast(10);
  assert.equal(len, 10);
  assert.equal(r.raw[0][start], 290);
});
