// The OSC router: destinations × mappings, evaluated from the engine's features and sent through the
// host at each destination's rate. Events (blink pulse, contact flips) go out at once.
import { SIGNAL_BY_ID } from './signals.js';

let nextId = 1;
export const uid = () => `${Date.now().toString(36)}${(nextId++).toString(36)}`;

export class Router {
  constructor(engine) {
    this.engine = engine;
    this.destinations = [];     // { id, name, host, port, rate, enabled }
    this.mappings = [];         // { id, signal, address, destination, type, inMin, inMax, outMin, outMax, smooth, enabled }
    this.enabled = true;
    this.live = new Map();      // mapping id → last value sent
    this._last = new Map();     // destination id → last send time
    this._smooth = new Map();   // mapping id → smoothed value
    this._lastEvent = new Map();
    this.sent = 0;
    engine.addEventListener('features', () => this._tick());
  }

  addDestination(d = {}) {
    const dest = { id: uid(), name: 'New destination', host: '127.0.0.1', port: 9000, rate: 20, enabled: true, ...d };
    this.destinations.push(dest); return dest;
  }
  removeDestination(id) { this.destinations = this.destinations.filter((d) => d.id !== id); this.mappings = this.mappings.filter((m) => m.destination !== id); }
  addMapping(m = {}) {
    const sig = SIGNAL_BY_ID[m.signal || 'calm'];
    const map = { id: uid(), signal: 'calm', address: '/alma/calm', destination: this.destinations[0]?.id || null, type: 'f',
      inMin: sig.range[0], inMax: sig.range[1], outMin: 0, outMax: 1, smooth: 0.5, enabled: true, ...m };
    this.mappings.push(map); return map;
  }
  removeMapping(id) { this.mappings = this.mappings.filter((m) => m.id !== id); }
  loadPreset(preset) {
    const dest = this.addDestination({ ...preset.destination });
    for (const m of preset.mappings) {
      const sig = SIGNAL_BY_ID[m.signal];
      this.addMapping({ ...m, destination: dest.id, inMin: sig.range[0], inMax: sig.range[1] });
    }
    return dest;
  }

  toJSON() { return { enabled: this.enabled, destinations: this.destinations, mappings: this.mappings }; }
  fromJSON(j) {
    if (!j) return;
    this.enabled = j.enabled !== false;
    this.destinations = (j.destinations || []).map((d) => ({ ...d }));
    this.mappings = (j.mappings || []).filter((m) => SIGNAL_BY_ID[m.signal]).map((m) => ({ ...m }));
  }

  /** The value a mapping would send now (after range, clamp and smoothing). */
  evaluate(m, f) {
    const sig = SIGNAL_BY_ID[m.signal]; if (!sig) return 0;
    const raw = sig.get(f);
    const span = (m.inMax - m.inMin) || 1;
    let v = (raw - m.inMin) / span;
    v = Math.max(0, Math.min(1, v));
    v = m.outMin + v * (m.outMax - m.outMin);
    if (sig.kind === 'event' || !(m.smooth > 0)) { this._smooth.set(m.id, v); return v; }
    const prev = this._smooth.has(m.id) ? this._smooth.get(m.id) : v;
    const s = prev + (v - prev) * (1 - Math.min(0.95, m.smooth));
    this._smooth.set(m.id, s); return s;
  }

  _tick() {
    const f = this.engine.features, now = performance.now();
    if (!this.enabled || this.engine.state !== 'streaming') { for (const m of this.mappings) this.live.set(m.id, this.evaluate(m, f)); return; }
    const batch = [];
    for (const d of this.destinations) {
      if (!d.enabled) continue;
      const due = now - (this._last.get(d.id) || 0) >= 1000 / Math.max(1, d.rate);
      for (const m of this.mappings) {
        if (!m.enabled || m.destination !== d.id) continue;
        const v = this.evaluate(m, f); this.live.set(m.id, v);
        const sig = SIGNAL_BY_ID[m.signal];
        let send = due;
        if (sig.kind === 'event') { const prev = this._lastEvent.get(m.id); if (prev !== v) { send = true; this._lastEvent.set(m.id, v); } }
        if (send) batch.push({ host: d.host, port: d.port, address: m.address, args: [{ type: m.type === 'i' ? 'i' : 'f', value: v }] });
      }
      if (due) this._last.set(d.id, now);
    }
    if (batch.length) { window.alma.oscSend(batch); this.sent += batch.length; }
  }

  /** Send one test value to a destination so the receiver can confirm the path. */
  test(dest, address = '/alma/test', value = 1) { window.alma.oscSend([{ host: dest.host, port: dest.port, address, args: [{ type: 'f', value }] }]); }
}
