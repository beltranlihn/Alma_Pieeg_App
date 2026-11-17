// BDF+ export: the EDF family's 24-bit format (BioSemi), which keeps every bit of the ADS1299. One file per session
// with the 8 channels in µV and the marks as annotations. MNE (mne.io.read_raw_bdf), EEGLAB, EDFbrowser and
// PiEEG Studio read it. (Plain EDF is 16-bit: across the converter's ±2.25 V range that would be 69 µV per step.)
import { CHANNELS } from './ble.js';
import { parseRaw } from './replay.js';

const UV = 4.5 / 16777215 * 1e6;          // µV per count, as PiEEG scales it
const ANN_SAMPLES = 64;                   // 192 bytes of annotation text per one-second record

const field = (s, n) => { const t = String(s ?? '').replace(/[^\x20-\x7e]/g, '_'); return (t.length > n ? t.slice(0, n) : t + ' '.repeat(n - t.length)); };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n) => String(n).padStart(2, '0');

/** Build a BDF+ file. data: parseRaw() output; opts: { fs, participant, labels: [8 strings] }. Returns Uint8Array. */
export function buildBDF(data, { fs = 250, participant = '', labels = null } = {}) {
  const n = data.n, records = Math.max(1, Math.ceil(n / fs)), ns = CHANNELS + 1;
  const start = new Date(n ? data.t[0] * 1000 : Date.now());
  // header
  let h = '';
  h += field('_BIOSEMI', 8);                                             // version: 0xFF then BIOSEMI (byte 0 set below)
  h += field(`X X X ${(participant || 'X').replace(/\s+/g, '_')}`, 80);
  h += field(`Startdate ${p2(start.getDate())}-${MONTHS[start.getMonth()]}-${start.getFullYear()} X X EEG_Alma_Center PiEEG_XR`, 80);
  h += field(`${p2(start.getDate())}.${p2(start.getMonth() + 1)}.${p2(start.getFullYear() % 100)}`, 8);
  h += field(`${p2(start.getHours())}.${p2(start.getMinutes())}.${p2(start.getSeconds())}`, 8);
  h += field(256 * (ns + 1), 8);
  h += field('BDF+C', 44);
  h += field(records, 8);
  h += field(1, 8);
  h += field(ns, 4);
  const sig = (pick) => Array.from({ length: ns }, (_, k) => pick(k)).join('');
  const isAnn = (k) => k === CHANNELS;
  h += sig((k) => field(isAnn(k) ? 'BDF Annotations' : (labels && labels[k]) || `Ch${k + 1}`, 16));
  h += sig((k) => field(isAnn(k) ? '' : 'PiEEG XR dry electrode', 80));
  h += sig((k) => field(isAnn(k) ? '' : 'uV', 8));
  h += sig((k) => field(isAnn(k) ? -1 : -2250000, 8));
  h += sig((k) => field(isAnn(k) ? 1 : 2250000, 8));
  h += sig(() => field(-8388608, 8));
  h += sig(() => field(8388607, 8));
  h += sig((k) => field(isAnn(k) ? '' : 'None (raw, DC included)', 80));
  h += sig((k) => field(isAnn(k) ? ANN_SAMPLES : fs, 8));
  h += sig(() => field('', 32));
  const headBytes = 256 * (ns + 1), recBytes = (CHANNELS * fs + ANN_SAMPLES) * 3;
  const out = new Uint8Array(headBytes + records * recBytes);
  for (let i = 0; i < h.length; i++) out[i] = h.charCodeAt(i) & 0xff;
  out[0] = 0xff; for (let i = 0; i < 7; i++) out[1 + i] = 'BIOSEMI'.charCodeAt(i);   // "\xFFBIOSEMI"
  // marks by record (onset in seconds from the first sample)
  const t0 = n ? data.t[0] : 0, byRec = new Map();
  for (const [row, text] of data.marks) {
    const onset = n ? Math.max(0, data.t[row] - t0) : 0, r = Math.min(records - 1, Math.floor(row / fs));
    if (!byRec.has(r)) byRec.set(r, []); byRec.get(r).push({ onset, text });
  }
  let o = headBytes;
  for (let r = 0; r < records; r++) {
    for (let ch = 0; ch < CHANNELS; ch++) {
      for (let s = 0; s < fs; s++) {
        const i = r * fs + s, uv = i < n ? data.ch[i * CHANNELS + ch] : (n ? data.ch[(n - 1) * CHANNELS + ch] : 0);
        let d = Math.round(uv / UV); if (d > 8388607) d = 8388607; else if (d < -8388608) d = -8388608;
        const u = d < 0 ? d + 0x1000000 : d;
        out[o++] = u & 0xff; out[o++] = (u >> 8) & 0xff; out[o++] = (u >> 16) & 0xff;
      }
    }
    // annotations: the record's start time first (BDF+/EDF+ timekeeping), then this second's marks
    let tal = `+${r}\x14\x14\x00`;
    for (const m of byRec.get(r) || []) {
      const one = `+${m.onset.toFixed(3)}\x14${String(m.text).replace(/[\x00-\x1f]/g, ' ').slice(0, 60)}\x14\x00`;
      if (tal.length + one.length <= ANN_SAMPLES * 3) tal += one;
    }
    for (let k = 0; k < ANN_SAMPLES * 3; k++) out[o++] = k < tal.length ? tal.charCodeAt(k) & 0xff : 0;
  }
  return out;
}

/** From a session's raw CSV text to BDF+ bytes. */
export function rawCsvToBDF(text, opts) { return buildBDF(parseRaw(text), opts); }
