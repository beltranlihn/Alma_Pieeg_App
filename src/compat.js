// Compatibility with PiEEG's own software (docs.pieeg.com, read 2026-11-17), so their tools plug into this app:
//   • PiEEG WebSocket on port 1616: one JSON frame per sample, {"t": <unix s>, "n": <counter>, "channels": [8 × µV]},
//     a welcome message on connect, and their commands (start_record, stop_record, set_filter; see inputs.js).
//     Their Unity plugin (com.pieeg.unity) and dashboard tools connect to ws://<this computer>:1616 unchanged.
//   • VRChat avatar parameters: /avatar/parameters/EEG_Delta … EEG_Gamma, 0–1, to 127.0.0.1:9000 every 0.25 s.
//   • PiEEG-style band values for any mapping (pieeg.delta … pieeg.gamma, pieeg.focus = β / (α + θ)): forehead band
//     power over its own maximum of the last 10 s, as their Unity plugin and VRChat bridge normalise.
const BANDS5 = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export class RollingMax {
  constructor(n) { this.n = n; this.buf = []; }
  push(v) {
    if (!Number.isFinite(v)) v = 0;
    this.buf.push(v); if (this.buf.length > this.n) this.buf.shift();
    let m = 0; for (const x of this.buf) if (x > m) m = x;
    return m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
  }
  reset() { this.buf = []; }
}

export const COMPAT_DEFAULTS = { pieegWs: false, pieegHost: '0.0.0.0', pieegPort: 1616, vrchat: false, vrchatHost: '127.0.0.1', vrchatPort: 9000 };

/** The frame PiEEG's server sends for one sample. */
export const pieegFrame = (t, n, raw) => JSON.stringify({ t: +(+t).toFixed(6), n, channels: Array.from(raw, (v) => +(+v).toFixed(3)) });

export class Compat {
  constructor(engine, router) {
    this.engine = engine; this.router = router; this.cfg = { ...COMPAT_DEFAULTS };
    this.n = 0; this.queue = []; this._k = 0; this._vrAt = 0; this.sentFrames = 0;
    this.norm = Object.fromEntries([...BANDS5, 'focus'].map((k) => [k, new RollingMax(100)]));   // 10 s at 10 Hz
    engine.addEventListener('features', () => this.tick());
    engine.addEventListener('filters', () => this.syncListeners());
    engine.addEventListener('state', () => { if (this.cfg.pieegWs) this.syncListeners(); });   // the welcome names the device
  }
  configure(patch) {
    Object.assign(this.cfg, patch);
    this.cfg.pieegPort = Math.max(1, Math.min(65535, this.cfg.pieegPort | 0)); this.cfg.vrchatPort = Math.max(1, Math.min(65535, this.cfg.vrchatPort | 0));
    this.engine.rawTap = this.cfg.pieegWs ? (tMs, raw) => { if (this.queue.length < 2500) this.queue.push(pieegFrame(tMs / 1000, this.n++, raw)); } : null;   // the engine stamps in ms; PiEEG sends Unix seconds
    if (!this.cfg.pieegWs) this.queue = [];
    this.syncListeners(); this.engine._emit('compat');
  }
  welcome() {
    const e = this.engine, f = e.filters;
    return JSON.stringify({ status: 'connected', sample_rate: e.fs, channels: 8, filter: { enabled: !!f.bandpass, lowcut: f.low, highcut: f.high, notch: f.notch },
      recording: !!e.recorder.active, engine: 'EEG Alma Center', device: e.deviceName || '', spike_config: { enabled: !!f.hampel }, hampel_config: { enabled: !!f.hampel, window: 5, n_sigmas: 3 } });
  }
  syncListeners() { this.router.extraListeners = this.cfg.pieegWs ? [{ host: this.cfg.pieegHost, port: this.cfg.pieegPort, welcome: this.welcome() }] : []; this.router.syncOutputs(); }
  recordStatus(port) { window.alma.wsSend?.([{ host: this.cfg.pieegHost, port: port || this.cfg.pieegPort, text: JSON.stringify({ type: 'record_status', recording: !!this.engine.recorder.active }) }]); }

  tick(now = performance.now()) {
    const f = this.engine.features;
    if (++this._k % 2 === 0) {                                   // 10 Hz
      for (const b of BANDS5) f.pieeg[b] = this.norm[b].push(f.avg[b]);
      f.pieeg.focus = this.norm.focus.push(f.avg.beta / Math.max(1e-9, f.avg.alpha + f.avg.theta));
    }
    if (this.cfg.pieegWs && this.queue.length) {
      const { pieegHost: host, pieegPort: port } = this.cfg;
      window.alma.wsSend?.(this.queue.map((text) => ({ host, port, text }))); this.sentFrames += this.queue.length; this.queue = [];
    }
    if (this.cfg.vrchat && this.engine.state === 'streaming' && now >= this._vrAt) {
      this._vrAt = now + 250;
      const { vrchatHost: host, vrchatPort: port } = this.cfg;
      window.alma.oscSend(BANDS5.map((b) => ({ host, port, address: `/avatar/parameters/EEG_${cap(b)}`, args: [{ type: 'f', value: f.pieeg[b] }] })));
    }
  }
  reset() { for (const n of Object.values(this.norm)) n.reset(); }
  toJSON() { return { ...this.cfg }; }
  fromJSON(j) { this.configure({ ...COMPAT_DEFAULTS, ...(j || {}) }); }
}
