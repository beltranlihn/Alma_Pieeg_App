// Per-person calibration. Ported from PiEEG's Avatar Foundation (MIT, PiEEG-server/dashboard/src/experiences/
// avatar-foundation/neuro/engine.ts + TrainingOverlay.tsx):
//   get ready 5 s → REST (n s) → get ready 5 s → ACTIVE (n s) → rank every channel × band by Cohen's d on
//   log10 band power → the best features drive `cal.score`: 0 = this person's rest, 1 = this person's active.
// On top of PiEEG: the indices are normalised against the calibration (5th–95th percentile of both phases)
// instead of the rolling minute, channels with bad contact during the recording are left out of the ranking,
// and the result is saved with the session.
// The numbers describe how separable the two states were for this person, this placement, this session.
// They are not a clinical measure. With 1 s FFT windows polled at 10 Hz, 20 s are ≈ 20 independent windows.
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';

export const CAL_TASKS = [
  { id: 'eyes', label: 'Eyes closed', cue: 'Close your eyes and stay still. A tone tells you when to open them.' },
  { id: 'count', label: 'Count backwards', cue: 'Count back from 300 in sevens, in your head.' },
  { id: 'jaw', label: 'Jaw tense', cue: 'Clench your jaw gently and hold it.' },
  { id: 'own', label: 'Own cue', cue: 'Hold your own cue, the same way, the whole time.' },
];
export const TASK_BY_ID = Object.fromEntries(CAL_TASKS.map((t) => [t.id, t]));
export const REST_CUE = 'Eyes open, face relaxed, jaw loose. Look at one point.';
export const CAL_LENGTHS = [10, 20, 30, 60];
export const PREP_S = 5;
export const PHASE_LABEL = { prep1: 'Get ready', rest: 'Rest', prep2: 'Get ready', active: 'Active', done: 'Done' };

const BAND_IDS = BANDS.map((b) => b.id);
const INDEX_IDS = INDICES.map((i) => i.id);
const LOG_EPS = 1e-9;
const STAT_FLOOR = 0.05;           // PiEEG: minimum |active − rest| in log10 units to call a feature trained
const BAD_SHARE = 0.2;             // a channel with bad contact in more than 20 % of the frames is left out

// ── Welford running mean / variance (as PiEEG) ──
export const newStats = () => ({ n: 0, mean: 0, m2: 0 });
export function pushStat(s, x) { s.n += 1; const d = x - s.mean; s.mean += d / s.n; s.m2 += d * (x - s.mean); }
export const variance = (s) => (s.n > 1 ? s.m2 / (s.n - 1) : 0);
export const stddev = (s) => Math.sqrt(Math.max(variance(s), 0));
export const logPower = (p) => Math.log10(Math.max(p, 0) + LOG_EPS);

/** Cohen's d of ACTIVE vs REST with the pooled standard deviation. Positive: active > rest. */
export function cohenD(rest, active) {
  if (rest.n < 2 || active.n < 2) return 0;
  const pooled = Math.sqrt((variance(rest) + variance(active)) / 2);
  return pooled <= 1e-9 ? 0 : (active.mean - rest.mean) / pooled;
}

/** PiEEG's labels for |d|. Deliberately non-clinical: they describe this session's contrast. */
export function qualityFromD(absD, trained = true) {
  if (!trained) return { tier: 'untrained', label: 'untrained' };
  if (absD >= 1.2) return { tier: 'strong', label: 'strong' };
  if (absD >= 0.8) return { tier: 'usable', label: 'usable' };
  if (absD >= 0.4) return { tier: 'marginal', label: 'marginal' };
  return { tier: 'inconclusive', label: 'inconclusive' };
}

function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))] : 0; }

export class Calibration {
  constructor(channels = 8) {
    this.channels = channels;
    this.phase = 'idle';              // idle | prep1 | rest | prep2 | active (then back to idle with a result)
    this.result = null;
    this.selected = [];               // indices into result.ranking that drive the score
    this.settings = { seconds: 20, task: 'eyes' };
    this._score = 0;
  }

  get running() { return this.phase !== 'idle'; }
  get recording() { return this.phase === 'rest' || this.phase === 'active'; }
  get applied() { return !!this.result && this.selected.length > 0; }
  get task() { return TASK_BY_ID[(this.result || this.settings).task] || CAL_TASKS[0]; }

  /** Begins the protocol at time `now` (ms). Keeps the previous result until the new one is ready. */
  start(now, { seconds, task, participant } = {}) {
    if (seconds) this.settings.seconds = seconds;
    if (task) this.settings.task = task;
    this._run = { participant: participant || '', seconds: this.settings.seconds, task: this.settings.task, rest: [], active: [] };
    this._enter('prep1', now);
  }
  cancel() { this.phase = 'idle'; this._run = null; }
  reset() { this.cancel(); this.result = null; this.selected = []; this._score = 0; }

  _duration(phase) { return phase === 'prep1' || phase === 'prep2' ? PREP_S : this._run.seconds; }
  _enter(phase, now) { this.phase = phase; this._t0 = now; }

  /** Progress within the current phase (0–1) and seconds left in it. */
  phaseProgress(now) { if (!this.running) return 0; return Math.min(1, (now - this._t0) / 1000 / this._duration(this.phase)); }
  remaining(now) { if (!this.running) return 0; return Math.max(0, Math.ceil(this._duration(this.phase) - (now - this._t0) / 1000)); }
  /** Progress over the whole protocol (0–1), for the bar drawn inside the button. */
  totalProgress(now) {
    if (!this.running) return 0;
    const order = ['prep1', 'rest', 'prep2', 'active'], durs = order.map((p) => this._duration(p));
    const k = order.indexOf(this.phase), done = durs.slice(0, k).reduce((a, b) => a + b, 0);
    return Math.min(1, (done + Math.min(durs[k], (now - this._t0) / 1000)) / durs.reduce((a, b) => a + b, 0));
  }

  /** Advances the phase machine. Returns the new phase when it changes ('rest', 'prep2', 'active', 'done'), else null. */
  tick(now) {
    if (!this.running || (now - this._t0) / 1000 < this._duration(this.phase)) return null;
    const next = { prep1: 'rest', rest: 'prep2', prep2: 'active', active: 'done' }[this.phase];
    if (next === 'done') { this._analyse(); this.phase = 'idle'; return 'done'; }
    this._enter(next, now); return next;
  }

  /**
   * One 10 Hz frame while recording: per-channel band powers ({delta…gamma}), the smoothed raw indices
   * ({focus…}) and which channels have bad contact right now.
   */
  feed(bands, idx, bad) {
    if (!this.recording) return;
    const lb = new Float32Array(this.channels * BAND_IDS.length);
    for (let ch = 0; ch < this.channels; ch++) for (let b = 0; b < BAND_IDS.length; b++) lb[ch * BAND_IDS.length + b] = logPower(bands[ch][BAND_IDS[b]]);
    const ix = new Float32Array(INDEX_IDS.length); INDEX_IDS.forEach((id, k) => { ix[k] = idx[id]; });
    const bd = new Uint8Array(this.channels); if (bad) for (let ch = 0; ch < this.channels; ch++) bd[ch] = bad[ch] ? 1 : 0;
    this._run[this.phase].push({ lb, ix, bd });
  }
  get frames() { return this._run ? { rest: this._run.rest.length, active: this._run.active.length } : { rest: 0, active: 0 }; }

  _analyse() {
    const { rest, active, seconds, task, participant } = this._run, nb = BAND_IDS.length;
    const all = rest.concat(active);
    const excluded = [];
    for (let ch = 0; ch < this.channels; ch++) { const badCount = all.reduce((a, f) => a + f.bd[ch], 0); if (!all.length || badCount / all.length > BAD_SHARE) excluded.push(ch); }
    const ranking = [];
    for (let ch = 0; ch < this.channels; ch++) {
      if (excluded.includes(ch)) continue;
      for (let b = 0; b < nb; b++) {
        const r = newStats(), a = newStats(), k = ch * nb + b;
        for (const f of rest) if (Number.isFinite(f.lb[k])) pushStat(r, f.lb[k]);
        for (const f of active) if (Number.isFinite(f.lb[k])) pushStat(a, f.lb[k]);
        const d = cohenD(r, a); if (Math.abs(d) < 1e-9) continue;
        const trained = r.n > 4 && a.n > 4 && Math.abs(a.mean - r.mean) > STAT_FLOOR;
        ranking.push({ channel: ch, band: BAND_IDS[b], d, rest: r.mean, active: a.mean, restSd: stddev(r), activeSd: stddev(a), trained, quality: qualityFromD(Math.abs(d), trained).tier });
      }
    }
    ranking.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const indices = {};
    INDEX_IDS.forEach((id, k) => {
      const r = newStats(), a = newStats();
      for (const f of rest) if (Number.isFinite(f.ix[k])) pushStat(r, f.ix[k]);
      for (const f of active) if (Number.isFinite(f.ix[k])) pushStat(a, f.ix[k]);
      const vals = all.map((f) => f.ix[k]).filter(Number.isFinite).sort((x, y) => x - y);
      const d = cohenD(r, a);
      indices[id] = { rest: r.mean, active: a.mean, d, quality: qualityFromD(Math.abs(d), r.n > 4 && a.n > 4).tier, lo: percentile(vals, 0.05), hi: percentile(vals, 0.95) };
    });
    this.result = { at: Date.now(), participant, task, seconds, frames: { rest: rest.length, active: active.length }, excluded, ranking, indices };
    const firstTrained = ranking.findIndex((f) => f.trained);
    this.selected = firstTrained >= 0 ? [firstTrained] : [];
    this._score = 0; this._run = null;
  }

  /** Choose which ranked features drive the score (PiEEG lets the user pick; the best one by default). */
  select(list) { this.selected = (list || []).filter((k) => this.result && this.result.ranking[k] && this.result.ranking[k].trained); this._score = 0; }

  /** 0 = this person's rest, 1 = their active, averaged over the selected features, smoothed at 10 Hz. */
  score(bands) {
    if (!this.applied) { this._score = 0; return 0; }
    let sum = 0;
    for (const k of this.selected) {
      const f = this.result.ranking[k], x = logPower(bands[f.channel][f.band]);
      sum += Math.max(0, Math.min(1, (x - f.rest) / (f.active - f.rest)));
    }
    const v = sum / this.selected.length;
    this._score = this._score * 0.5 + v * 0.5;
    return this._score;
  }

  /** An index read against this person's calibration: 0–1 between the 5th and 95th percentile of both phases. */
  normIndex(id, v) {
    const c = this.result && this.result.indices[id];
    if (!c || !(c.hi - c.lo > 1e-9)) return null;
    return Math.max(0, Math.min(1, (v - c.lo) / (c.hi - c.lo)));
  }

  /** What goes into the session summary. */
  toJSON() {
    if (!this.result) return null;
    const r = this.result, rd = (x) => +x.toFixed(4);
    return {
      at: new Date(r.at).toISOString(), participant: r.participant, task: r.task, seconds_per_phase: r.seconds, frames: r.frames,
      excluded_channels: r.excluded.map((ch) => ch + 1),
      selected: this.selected.map((k) => ({ channel: r.ranking[k].channel + 1, band: r.ranking[k].band, d: rd(r.ranking[k].d) })),
      ranking: r.ranking.slice(0, 10).map((f) => ({ channel: f.channel + 1, band: f.band, d: rd(f.d), quality: f.quality, rest_log10: rd(f.rest), active_log10: rd(f.active) })),
      indices: Object.fromEntries(Object.entries(r.indices).map(([id, c]) => [id, { d: rd(c.d), quality: c.quality, rest: rd(c.rest), active: rd(c.active), lo: rd(c.lo), hi: rd(c.hi) }])),
    };
  }
}
