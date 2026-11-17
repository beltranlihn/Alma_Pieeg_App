// Rules → events: "when this signal stays above (or below) a value for N seconds, send this", with a cooldown.
// The event goes to a destination (an OSC message, a WebSocket JSON event or a MIDI note), or as an HTTP POST to a
// webhook (lights, Home Assistant, IFTTT, a show controller), and is marked in the recording. After PiEEG's
// webhook triggers (band power / amplitude / band ratio above or below), with any signal of the app and a hold time.
// A rule fires once per crossing: it re-arms only after the condition goes false again.
import { SIGNAL_BY_ID } from './signals.js';
import { uid } from './router.js';

export class Rules {
  constructor(engine, router) {
    this.engine = engine; this.router = router;
    this.list = [];                      // { id, name, signal, op: 'above'|'below', value, hold, cooldown, target, address, url, enabled }
    this.state = new Map();              // id → { since (null = condition false), armed, last, count, value, result }
    this.fired = 0; this._pulseEnd = 0;
    engine.addEventListener('features', () => this.tick());
  }
  add(r = {}) {
    const rule = { id: uid(), name: `Rule ${this.list.length + 1}`, signal: 'idx.calm', op: 'above', value: 0.7, hold: 2, cooldown: 10, target: this.router.destinations[0]?.id || '', address: '/alma/rule', url: '', enabled: true, ...r };
    this.list.push(rule); return rule;
  }
  remove(id) { this.list = this.list.filter((r) => r.id !== id); this.state.delete(id); }
  stateOf(id) { return this.state.get(id) || { since: null, armed: true, last: null, count: 0, value: 0, result: '' }; }

  tick(now = performance.now()) {
    const f = this.engine.features;
    if (f.rule.pulse && now > this._pulseEnd) f.rule.pulse = 0;
    if (this.engine.state !== 'streaming') return;
    for (const r of this.list) {
      const sig = SIGNAL_BY_ID[r.signal]; if (!r.enabled || !sig) continue;
      let st = this.state.get(r.id); if (!st) { st = { since: null, armed: true, last: null, count: 0, value: 0, result: '' }; this.state.set(r.id, st); }
      const v = sig.get(f); st.value = v;
      const cond = r.op === 'below' ? v < r.value : v > r.value;
      if (!cond) { st.since = null; st.armed = true; continue; }
      if (st.since === null) st.since = now;
      if (st.armed && now - st.since >= r.hold * 1000 && (st.last === null || now - st.last >= r.cooldown * 1000)) {
        st.armed = false; st.last = now; st.count++; this.fire(r, v, st, now);
      }
    }
  }

  fire(r, v, st = this.stateOf(r.id), now = performance.now()) {
    const f = this.engine.features;
    this.fired++; f.rule.count = this.fired; f.rule.pulse = 1; this._pulseEnd = now + 150;
    if (this.engine.recorder.active) this.engine.mark(`rule ${r.name}`);
    // the same fields as PiEEG's webhook_event, so a receiver written for theirs reads ours
    const payload = { rule_id: r.id, rule_name: r.name, trigger_type: `${r.signal} ${r.op}`, value: +(+v).toFixed(4), threshold: r.value, ts: Date.now() / 1000 };
    if (r.target === 'http') {
      if (r.url && window.alma.httpPost) window.alma.httpPost(r.url, payload).then((res) => { st.result = res.ok ? `sent (${res.status})` : `failed: ${res.error || res.status}`; this.engine._emit('rule', { id: r.id }); });
    } else if (r.target) {
      this.router.sendTo(r.target, r.address || '/alma/rule', 1, { event: r.name, ...payload });
      st.result = 'sent';
    }
    this.engine._emit('rule', { id: r.id, name: r.name, value: v });
  }

  toJSON() { return this.list.map((r) => ({ ...r })); }
  fromJSON(a) { if (Array.isArray(a)) this.list = a.filter((r) => r && SIGNAL_BY_ID[r.signal]).map((r) => ({ ...r })); }
}
