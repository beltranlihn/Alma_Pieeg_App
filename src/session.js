// A session: one participant, from Start to End. Keeps a 10 Hz log of the derived features
// (bands, indices, blinks, heart, contact), computes the live results and writes three files:
//   <name>.raw.csv       raw µV per sample (PiEEG layout: timestamp, ch1..ch8, mark)
//   <name>.features.csv  one row per 100 ms with everything derived
//   <name>.summary.json  participant, notes, duration, per-signal mean / start / end / change, results
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';
import { GESTURES } from './face.js';

export const RESULT_METHODS = [
  { id: 'change', label: 'Change vs start', help: 'last 30 s vs first 30 s, ±%', fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} %` },
  { id: 'mean', label: 'Average', help: 'mean over the session, 0–100', fmt: (v) => v.toFixed(0) },
  { id: 'now', label: 'Now', help: 'last 3 s, 0–100', fmt: (v) => v.toFixed(0) },
  { id: 'peak', label: 'Best 10 s', help: 'highest 10 s window, 0–100', fmt: (v) => v.toFixed(0) },
  { id: 'time', label: 'Time above 60', help: '% of the session above 60', fmt: (v) => `${v.toFixed(0)} %` },
  { id: 'recovery', label: 'Recovery', help: 'median seconds to come back down after each rise', fmt: (v) => (v > 0 ? `${v.toFixed(1)} s` : '—') },
];
export const METHOD_BY_ID = Object.fromEntries(RESULT_METHODS.map((m) => [m.id, m]));

/** Columns of the features log, in order. The getters read engine.features. */
export const FEATURE_COLUMNS = [
  ...BANDS.map((b) => ({ id: `rel_${b.id}`, get: (f) => f.rel[b.id] })),
  ...INDICES.map((i) => ({ id: `idx_${i.id}`, get: (f) => f.idxNorm[i.id] })),
  ...INDICES.map((i) => ({ id: `raw_${i.id}`, get: (f) => f.idx[i.id] })),
  { id: 'blink_count', get: (f) => f.blinkCount },
  { id: 'heart_bpm', get: (f) => f.heart.bpm },
  { id: 'heart_rmssd', get: (f) => f.heart.rmssd },
  { id: 'heart_source', get: (f) => f.heart.source },
  { id: 'heart_eeg_bpm', get: (f) => (f.heartEEG.locked ? f.heartEEG.bpm : 0) },   // logged next to heart_bpm to validate it
  { id: 'heart_eeg_conf', get: (f) => f.heartEEG.confidence },
  { id: 'contact_good', get: (f) => f.contactGood },
  { id: 'dominant_hz', get: (f) => f.avg.dominant },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `strap${n}_bpm`, get: (f) => f.strap[n].bpm })),
  { id: 'cal_score', get: (f) => f.cal.score },
  { id: 'idx_faa', get: (f) => f.faaNorm },
  { id: 'faa', get: (f) => f.faa },
  { id: 'beta_surge', get: (f) => f.betaSurge },
  ...GESTURES.map((g) => ({ id: `face_${g.id}`, get: (f) => f.face[g.id] })),
  { id: 'gaze_x', get: (f) => f.gaze.x },
  { id: 'gaze_y', get: (f) => f.gaze.y },
  { id: 'gaze_side', get: (f) => f.gaze.side },
  { id: 'tension_jaw', get: (f) => f.tension.jaw },
  { id: 'tension_brow', get: (f) => f.tension.brow },
];

/**
 * Recovery (after PiEEG Premeditatio Malorum: a beta spike, then how fast it settles). On a 0–1 series at
 * 10 Hz: the baseline is the median, a rise is a stretch above baseline + max(0.15, 3 MAD) lasting 0.5 s or
 * more, and its recovery time runs from the peak to the first sample back within 20 % of the way from the
 * baseline to that peak. Returns the median recovery in seconds, or 0 when nothing rose and came back.
 */
export function recoveryTimes(s, hz = 10) {
  if (s.length < hz * 5) return [];
  const sorted = [...s].sort((a, b) => a - b), base = sorted[sorted.length >> 1];
  const mad = 1.4826 * [...s].map((x) => Math.abs(x - base)).sort((a, b) => a - b)[s.length >> 1];
  const thr = base + Math.max(0.15, 3 * mad), out = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] <= thr) { i++; continue; }
    let j = i, peak = i; while (j < s.length && s[j] > thr) { if (s[j] > s[peak]) peak = j; j++; }
    if (j - i >= hz * 0.5) {
      const back = base + 0.2 * (s[peak] - base); let k = peak;
      while (k < s.length && s[k] > back) k++;
      if (k < s.length) out.push((k - peak) / hz);
      i = Math.max(j, k);
    } else i = j;
  }
  return out;
}

const WINDOW_S = 30, HZ = 10;

/** The features-log column of a signal id (idx.calm → idx_calm), or null when the signal is not logged. */
export function columnOf(signalId) {
  const id = signalId === 'dominant' ? 'dominant_hz' : signalId.replace('.', '_');
  return FEATURE_COLUMNS.some((c) => c.id === id) ? id : null;
}

export class Session {
  constructor() { this.reset(); this.results = [{ signal: 'idx.calm', method: 'change' }, { signal: 'idx.focus', method: 'mean' }, { signal: 'idx.relax', method: 'now' }]; }
  reset() { this.active = false; this.participant = ''; this.notes = ''; this.startedAt = 0; this.rows = []; this.live = [0, 0, 0]; this.summary = null; }
  start(participant, notes) { this.reset(); this.active = true; this.participant = participant || ''; this.notes = notes || ''; this.startedAt = Date.now(); }
  get seconds() { return this.active ? (Date.now() - this.startedAt) / 1000 : this.rows.length / HZ; }

  /** Called at 10 Hz with the engine features; keeps the log and refreshes the live results. */
  log(f, signalById) {
    if (!this.active) return;
    const row = { t: Date.now(), v: FEATURE_COLUMNS.map((c) => c.get(f)) };
    this.rows.push(row);
    if (this.maxRows && this.rows.length > this.maxRows) this.rows.splice(0, this.rows.length - this.maxRows);
    this.results.forEach((r, k) => { this.live[k] = this.compute(r, signalById); });
  }

  /** Series of one signal over the log, 0–1 clamp (signals are read through the catalogue so any works). */
  _series(signalId, signalById) {
    const col = FEATURE_COLUMNS.findIndex((c) => c.id === columnOf(signalId));
    const sig = signalById[signalId];
    if (col < 0 || !sig) return [];
    const [lo, hi] = sig.range, span = hi - lo || 1;
    return this.rows.map((r) => Math.max(0, Math.min(1, (r.v[col] - lo) / span)));
  }
  compute(r, signalById) {
    const s = this._series(r.signal, signalById); if (s.length < HZ * 2) return 0;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    switch (r.method) {
      case 'mean': return 100 * mean(s);
      case 'now': return 100 * mean(s.slice(-HZ * 3));
      case 'peak': { let best = 0; for (let i = 0; i + HZ * 10 <= s.length; i += HZ) best = Math.max(best, mean(s.slice(i, i + HZ * 10))); return 100 * (best || mean(s)); }
      case 'time': return 100 * s.filter((v) => v > 0.6).length / s.length;
      case 'recovery': { const r = recoveryTimes(s, HZ).sort((a, b) => a - b); return r.length ? r[r.length >> 1] : 0; }
      case 'change': default: {
        const n = Math.min(WINDOW_S * HZ, Math.floor(s.length / 2));
        const first = mean(s.slice(0, n)), last = mean(s.slice(-n));
        return first > 1e-6 ? 100 * (last - first) / first : 0;
      }
    }
  }

  end(signalById) {
    this.active = false;
    const per = {};
    for (const c of FEATURE_COLUMNS) {
      const col = FEATURE_COLUMNS.indexOf(c), vals = this.rows.map((r) => r.v[col]).filter((v) => Number.isFinite(v));
      if (!vals.length) continue;
      const n = Math.min(WINDOW_S * HZ, Math.floor(vals.length / 2)) || 1;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      let lo = Infinity, hi = -Infinity; for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }   // no spread: hours of rows exceed the argument limit
      per[c.id] = { mean: +mean(vals).toFixed(4), start: +mean(vals.slice(0, n)).toFixed(4), end: +mean(vals.slice(-n)).toFixed(4), min: +lo.toFixed(4), max: +hi.toFixed(4) };
    }
    this.summary = {
      format: 'eeg-alma-center-summary:v1', participant: this.participant, notes: this.notes,
      started_at: new Date(this.startedAt).toISOString(), duration_sec: +this.seconds.toFixed(1), feature_rows: this.rows.length,
      results: this.results.map((r, k) => ({ signal: r.signal, method: r.method, value: +this.live[k].toFixed(2), label: METHOD_BY_ID[r.method]?.fmt(this.live[k]) })),
      signals: per,
    };
    return this.summary;
  }

  featuresCSV() {
    const head = ['timestamp', 'elapsed_s', ...FEATURE_COLUMNS.map((c) => c.id)].join(',');
    const lines = [head];
    for (const r of this.rows) lines.push([(r.t / 1000).toFixed(3), ((r.t - this.startedAt) / 1000).toFixed(1), ...r.v.map((v) => (Number.isFinite(v) ? +v.toFixed(4) : ''))].join(','));
    return lines.join('\n') + '\n';
  }
}
