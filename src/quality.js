// Contact quality, judged from the signal (the ADS1299 as PiEEG wires it has no impedance measurement).
// Updated a few times per second over the last second.
//
// Every channel is "its electrode minus the reference", so a problem at the reference shows up in all eight at
// once and looks like eight bad electrodes. The first real tests did exactly that: 8 channels "fair" at ~55 µV,
// correlated 0.99, while each electrode on its own carried 5–8 µV. So each channel is split in two:
//   common  = the median of the 8 channels, sample by sample  → belongs to the reference (and the bias)
//   own     = the channel minus that median                   → belongs to that electrode
// Channels are judged by their own part; the reference gets its own verdict from the common part.
// Railed means the converter is at its limit: ±2.25 V in our units (24-bit counts × 0.268 µV). The old limit of
// 150 mV flagged plain electrode offsets (a few hundred mV are normal with dry or freshly wetted electrodes).
import { CHANNELS } from './ble.js';
import { goertzelPower } from './dsp.js';

export const STATUS = { GOOD: 'good', FAIR: 'fair', POOR: 'poor', RAILED: 'railed', NONE: 'none', WAIT: 'wait', NOISY: 'noisy' };
export const FULL_SCALE_UV = 2.25e6;
const RAIL_UV = 0.95 * FULL_SCALE_UV;
// thresholds (µV), set against today's recordings and PiEEG's own reference dataset (see tests/quality.test.mjs)
export const LIMITS = { ownGood: 25, ownFair: 60, lineGood: 20, lineFair: 60, refCommon: 25, refLine: 25 };

const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const rmsOf = (a) => { let s = 0, q = 0; for (const v of a) { s += v; q += v * v; } const m = s / a.length; return Math.sqrt(Math.max(0, q / a.length - m * m)); };
function hum(a, fs) { const m = a.reduce((x, y) => x + y, 0) / a.length; const c = a.map((v) => v - m); return Math.sqrt(Math.max(goertzelPower(c, 0, c.length, 50, fs), goertzelPower(c, 0, c.length, 60, fs))); }
function corr(a, b) { let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0; const n = a.length; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; } const ma = sa / n, mb = sb / n; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; } return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0; }

/**
 * Judge one window. raw and filt: arrays of 8 Float32Array/Arrays of the same length (filt = the 1–40 Hz trace).
 * Returns an array of per-channel { status, rms (own, µV), total, line (own hum), railed } with a .ref property:
 * { status: good | noisy | lost, common (µV), line (µV), corr }.
 */
export function assessWindow(raw, filt, fs) {
  const n = filt[0].length, chs = raw.length;
  // each electrode has its own DC offset (tens or hundreds of mV): take it out first, or the median would jump
  // between channels with close offsets and the jumps would read as hum
  const rawMean = raw.map((r) => { let s = 0; for (let i = 0; i < n; i++) s += r[i]; return s / n; });
  const common = new Float64Array(n), rawMed = new Float64Array(n), col = new Array(chs);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < chs; ch++) col[ch] = filt[ch][i]; common[i] = median(col);
    for (let ch = 0; ch < chs; ch++) col[ch] = raw[ch][i] - rawMean[ch]; rawMed[i] = median(col);
  }
  const out = [];
  let railedCount = 0;
  for (let ch = 0; ch < chs; ch++) {
    let railed = false; for (let i = 0; i < n; i++) if (Math.abs(raw[ch][i]) > RAIL_UV) { railed = true; break; }
    const own = new Float64Array(n), rawOwn = new Float64Array(n);
    for (let i = 0; i < n; i++) { own[i] = filt[ch][i] - common[i]; rawOwn[i] = raw[ch][i] - rawMean[ch] - rawMed[i]; }
    const total = rmsOf(filt[ch]), ownRms = rmsOf(own), line = hum(Array.from(rawOwn), fs);
    let status;
    if (railed) { status = STATUS.RAILED; railedCount++; }
    else if (total < 0.5) status = STATUS.NONE;
    else if (ownRms <= LIMITS.ownGood && line < LIMITS.lineGood) status = STATUS.GOOD;
    else if (ownRms <= LIMITS.ownFair && line < LIMITS.lineFair) status = STATUS.FAIR;
    else status = STATUS.POOR;
    out.push({ status, rms: ownRms, total, line, railed });
  }
  let cs = 0, cn = 0; for (let a = 0; a < chs; a++) for (let b = a + 1; b < chs; b++) { cs += corr(filt[a], filt[b]); cn++; }
  const commonRms = rmsOf(common), commonLine = hum(Array.from(rawMed), fs), meanCorr = cn ? cs / cn : 0;
  const status = railedCount >= chs / 2 ? 'lost' : commonRms > LIMITS.refCommon || commonLine > LIMITS.refLine ? 'noisy' : 'good';
  out.ref = { status, common: commonRms, line: commonLine, corr: meanCorr };
  return out;
}

export function assessAll(rings, fs) {
  const { start, len } = rings.startOfLast(fs);
  if (len < fs * 0.8) { const w = Array.from({ length: CHANNELS }, () => ({ status: STATUS.WAIT, rms: 0, total: 0, line: 0, railed: false })); w.ref = { status: 'wait', common: 0, line: 0, corr: 0 }; return w; }
  const n = rings.size, raw = [], filt = [];
  for (let ch = 0; ch < CHANNELS; ch++) {
    const r = new Float64Array(len), f = new Float64Array(len);
    for (let i = 0; i < len; i++) { const k = (start + i) % n; r[i] = rings.raw[ch][k]; f[i] = rings.filt[ch][k]; }
    raw.push(r); filt.push(f);
  }
  return assessWindow(raw, filt, fs);
}

/** Channels that should be left out of averages right now. */
export const isBad = (q) => !q || q.status === STATUS.POOR || q.status === STATUS.RAILED || q.status === STATUS.NONE;
