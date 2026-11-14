import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelChain, Biquad, Hampel, goertzelPower } from '../src/dsp.js';
import { decodeSample } from '../src/ble.js';

const FS = 250;
function toneRms(chain, hz, seconds = 4) {
  let sumsq = 0, n = 0;
  for (let i = 0; i < FS * seconds; i++) {
    const y = chain.process(100 * Math.sin(2 * Math.PI * hz * i / FS));
    if (i >= FS * 2) { sumsq += y * y; n++; }           // skip the settling time
  }
  return Math.sqrt(sumsq / n);
}
const ref = 100 / Math.SQRT2;   // rms of a 100 µV sine

test('band-pass keeps 10 Hz and removes drift and 70 Hz', () => {
  const mk = () => new ChannelChain(FS, { hampel: false, notch: 0 });
  assert.ok(Math.abs(toneRms(mk(), 10) - ref) < ref * 0.05, 'alpha passes');
  assert.ok(toneRms(mk(), 0.2) < ref * 0.05, 'drift removed');
  assert.ok(toneRms(mk(), 70) < ref * 0.1, '70 Hz removed');
});

test('notch 50 Hz kills mains and leaves 10 Hz', () => {
  const mk = () => new ChannelChain(FS, { hampel: false, bandpass: false, notch: 50 });
  assert.ok(toneRms(mk(), 50) < ref * 0.05, '50 Hz removed');
  assert.ok(Math.abs(toneRms(mk(), 10) - ref) < ref * 0.05, '10 Hz passes');
});

test('hampel replaces a lone spike', () => {
  const h = new Hampel(5, 3);
  const out = [1, 2, 1, 2, 1, 500, 1, 2].map((v) => h.process(v));
  assert.ok(out.every((v) => v < 10), `spike should be gone: ${out}`);
  assert.equal(h.replaced, 1);
});

test('goertzel measures a 50 Hz tone amplitude', () => {
  const buf = new Float32Array(FS);
  for (let i = 0; i < FS; i++) buf[i] = 30 * Math.sin(2 * Math.PI * 50 * i / FS);
  const amp = Math.sqrt(goertzelPower(buf, 0, FS, 50, FS));
  assert.ok(Math.abs(amp - 30) < 3, `amp ${amp}`);
});

test('decodeSample: 24-bit big-endian two\'s complement to µV', () => {
  const out = new Float32Array(8);
  const bytes = new Uint8Array(24);
  bytes.set([0x00, 0x00, 0x01], 0);      // +1 count
  bytes.set([0xFF, 0xFF, 0xFF], 3);      // -1 count
  bytes.set([0x80, 0x00, 0x00], 6);      // most negative
  decodeSample(bytes, 0, out);
  assert.ok(Math.abs(out[0] - 0.2682) < 1e-3);
  assert.ok(Math.abs(out[1] + 0.2682) < 1e-3);
  assert.ok(out[2] < -2.2e6);
});

test('biquad lowpass is unity at DC', () => {
  const b = Biquad.lowpass(40, FS, 0.707);
  let y = 0; for (let i = 0; i < 2000; i++) y = b.process(1);
  assert.ok(Math.abs(y - 1) < 1e-3);
});
