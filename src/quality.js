// Contact quality per channel, judged from the signal (the ADS1299 as PiEEG wires it has no impedance
// measurement). Updated a few times per second over the last second.
import { CHANNELS } from './ble.js';
import { goertzelPower } from './dsp.js';

export const STATUS = { GOOD: 'good', FAIR: 'fair', POOR: 'poor', RAILED: 'railed', NONE: 'none', WAIT: 'wait' };
const RAIL_UV = 150000;          // full scale is ≈187 mV; anything near it is a lost reference

export function assessChannel(rings, ch, fs) {
  const { start, len } = rings.startOfLast(fs);
  if (len < fs * 0.8) return { status: STATUS.WAIT, rms: 0, line: 0, railed: false };
  const raw = rings.raw[ch], filt = rings.filt[ch], n = rings.size;
  let railed = false, sum = 0, sumsq = 0, rawMean = 0;
  for (let i = 0; i < len; i++) { const r = raw[(start + i) % n]; rawMean += r; if (Math.abs(r) > RAIL_UV) railed = true; }
  rawMean /= len;
  for (let i = 0; i < len; i++) { const v = filt[(start + i) % n]; sum += v; sumsq += v * v; }
  const mean = sum / len, rms = Math.sqrt(Math.max(0, sumsq / len - mean * mean));
  // Mains hum on the raw signal (the chain may have notched it): amplitude of the 50 and 60 Hz tones.
  const tmp = new Float32Array(len);
  for (let i = 0; i < len; i++) tmp[i] = raw[(start + i) % n] - rawMean;
  const line = Math.sqrt(Math.max(goertzelPower(tmp, 0, len, 50, fs), goertzelPower(tmp, 0, len, 60, fs)));
  let status;
  if (railed) status = STATUS.RAILED;
  else if (rms < 0.5) status = STATUS.NONE;
  else if (rms <= 60 && line < 25) status = STATUS.GOOD;
  else if (rms <= 150 && line < 80) status = STATUS.FAIR;
  else status = STATUS.POOR;
  return { status, rms, line, railed };
}

export function assessAll(rings, fs) {
  const out = new Array(CHANNELS);
  for (let ch = 0; ch < CHANNELS; ch++) out[ch] = assessChannel(rings, ch, fs);
  return out;
}
