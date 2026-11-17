// Cue sheet: a list of timed cues (seconds from the start) that fire messages, for pieces with a score. It starts
// with each session (or by hand, or by OSC /alma/cues/start from the show), fires each cue once at its time, marks it
// in the recording and stops after the last one.
import { uid } from './router.js';

export class Cues {
  constructor(engine, router) {
    this.engine = engine; this.router = router;
    this.list = [];                     // { id, at (s), label, target, address, value, enabled }
    this.withSession = true;
    this.running = false; this.startedAt = 0; this.fired = new Set(); this._bySession = false;
    engine.addEventListener('session', () => {
      if (!this.withSession) return;
      const active = !!engine.features.sessionActive;
      if (active && !this.running && !this._sessionSeen) { this._sessionSeen = true; this.start(true); }
      if (!active) { this._sessionSeen = false; if (this.running && this._bySession) this.stop(); }
    });
    engine.addEventListener('features', () => this.tick());
  }
  add(c = {}) {
    const last = this.list.reduce((m, x) => Math.max(m, x.at), -10);
    const cue = { id: uid(), at: last + 10, label: `Cue ${this.list.length + 1}`, target: this.router.destinations[0]?.id || '', address: '/alma/cue', value: 1, enabled: true, ...c };
    this.list.push(cue); this.sort(); return cue;
  }
  remove(id) { this.list = this.list.filter((c) => c.id !== id); }
  sort() { this.list.sort((a, b) => a.at - b.at); }
  get elapsed() { return this.running ? (performance.now() - this.startedAt) / 1000 : 0; }
  get next() { return this.list.find((c) => c.enabled && !this.fired.has(c.id)) || null; }

  start(bySession = false) { this.running = true; this._bySession = bySession; this.startedAt = performance.now(); this.fired = new Set(); this.engine.features.cue.index = 0; this.engine._emit('cue', { type: 'start' }); }
  stop() { if (!this.running) return; this.running = false; this.engine._emit('cue', { type: 'stop' }); }

  tick() {
    if (!this.running) return;
    const t = this.elapsed;
    for (const c of this.list) {
      if (!c.enabled || this.fired.has(c.id) || t < c.at) continue;
      this.fired.add(c.id); this.fire(c);
    }
    if (!this.next) { this.running = false; this.engine._emit('cue', { type: 'done' }); }
  }
  fire(c) {
    const f = this.engine.features; f.cue.index = this.fired.size;
    if (c.target) this.router.sendTo(c.target, c.address || '/alma/cue', +c.value || 0, { cue: c.label });
    if (this.engine.recorder.active) this.engine.mark(`cue ${c.label}`);
    this.engine._emit('cue', { type: 'fired', id: c.id, label: c.label });
  }

  toJSON() { return { withSession: this.withSession, list: this.list.map((c) => ({ ...c })) }; }
  fromJSON(j) { if (!j) return; this.withSession = j.withSession !== false; if (Array.isArray(j.list)) { this.list = j.list.filter((c) => c && Number.isFinite(+c.at)).map((c) => ({ ...c, at: +c.at })); this.sort(); } }
}
