// Visitor mode, for a piece that runs all day: the app notices when someone puts the mask on (most electrodes in
// contact for 3 s) and when they take it off (contact gone for 5 s). Each visitor gets a fresh start (the indices,
// blinks and tension learn them from zero) and a short baseline while they settle; until that ends, and while nobody
// wears the mask, every continuous output eases to a safe value instead of sending noise. Optional: one session per
// visitor. The Bluetooth link keeps trying to come back for as long as the mode is on.
import { groups } from './montage.js';

export const VISITOR_DEFAULTS = { enabled: false, baseline: 45, idle: 'zero', record: false };
const ARRIVE_MS = 3000, LEAVE_MS = 5000;
const STATE_CODE = { idle: 0, baseline: 1, active: 2 };

export class Visitor {
  constructor(engine) {
    this.engine = engine; this.cfg = { ...VISITOR_DEFAULTS };
    this.state = 'idle'; this.count = 0; this.startedAt = 0; this._okSince = null; this._badSince = null; this._autoSession = false;   // null = not now
    engine.addEventListener('quality', () => this.check());
    engine.addEventListener('features', () => this.publish());
    engine.addEventListener('state', () => this._persist());
    engine.addEventListener('disconnected', () => { if (this.state !== 'idle') this._leave('link lost'); });
  }
  configure(patch) {
    Object.assign(this.cfg, patch);
    if (!this.cfg.enabled && this.state !== 'idle') this._leave('mode off');
    this._persist(); this.engine._emit('visitor', { type: 'config' });
  }
  _persist() { const d = this.engine.device; if (d && 'maxReconnects' in d) d.maxReconnects = this.cfg.enabled ? Infinity : 5; }

  /** Someone is wearing it: at least half of the connected electrodes (and two) good or fair, reference not lost. */
  wearing() {
    const q = this.engine.quality; if (!q) return false;
    const ok = q.filter((x) => x.status === 'good' || x.status === 'fair').length, need = Math.max(2, Math.ceil(groups.connected.length / 2));
    return ok >= need && !!q.ref && q.ref.status !== 'lost' && q.ref.status !== 'flat';
  }
  check(now = performance.now()) {
    if (!this.cfg.enabled || this.engine.state !== 'streaming') return;
    const w = this.wearing();
    if (w) { this._badSince = null; if (this._okSince === null) this._okSince = now; } else { this._okSince = null; if (this._badSince === null) this._badSince = now; }
    if (this.state === 'idle') { if (this._okSince !== null && now - this._okSince >= ARRIVE_MS) this._arrive(now); return; }
    if (this._badSince !== null && now - this._badSince >= LEAVE_MS) { this._leave('mask off'); return; }
    if (this.state === 'baseline' && now - this.startedAt >= this.cfg.baseline * 1000) {
      this.state = 'active'; if (this.engine.recorder.active) this.engine.mark('visitor_live'); this.engine._emit('visitor', { type: 'live', count: this.count });
    }
  }
  _arrive(now) {
    const e = this.engine; this.count++; this.state = 'baseline'; this.startedAt = now;
    e.resetForVisitor();
    if (this.cfg.record && !e.recorder.active && e.state === 'streaming') { e.startSession(`visitor-${this.count}`, 'visitor mode'); this._autoSession = true; }
    if (e.recorder.active) e.mark('visitor_arrive');
    e._emit('visitor', { type: 'arrive', count: this.count });
  }
  _leave(why) {
    const e = this.engine; this.state = 'idle'; this._okSince = null; this._badSince = null;
    if (this._autoSession && e.recorder.active) { this._autoSession = false; e.endSession(); }
    else { this._autoSession = false; if (e.recorder.active) e.mark('visitor_leave'); }
    e._emit('visitor', { type: 'leave', why });
  }
  publish(now = performance.now()) {
    const v = this.engine.features.visitor;
    v.present = this.state === 'idle' ? 0 : 1; v.state = STATE_CODE[this.state]; v.count = this.count;
    v.elapsed = this.state === 'idle' ? 0 : (now - this.startedAt) / 1000;
  }
  /** What continuous outputs do now: null = live; 'zero' | 'middle' | 'hold' while idle or in the baseline. */
  idlePolicy() { return this.cfg.enabled && this.state !== 'active' ? this.cfg.idle : null; }
  get text() {
    if (!this.cfg.enabled) return 'Off';
    if (this.state === 'idle') return this.count ? `Waiting · ${this.count} visitor${this.count === 1 ? '' : 's'} so far` : 'Waiting for the first visitor';
    const s = Math.round((performance.now() - this.startedAt) / 1000);
    return this.state === 'baseline' ? `Visitor ${this.count} · settling ${Math.max(0, this.cfg.baseline - s)} s` : `Visitor ${this.count} · live ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  toJSON() { return { ...this.cfg }; }
  fromJSON(j) { if (j) this.configure({ ...VISITOR_DEFAULTS, ...j }); }
}
