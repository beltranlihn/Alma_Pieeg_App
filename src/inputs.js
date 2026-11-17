// Inputs: what other software sends to the app. Markers (so the scene and the signal share one timeline) and a few
// commands, by OSC or plain text over UDP, or as JSON over any of the app's WebSocket ports.
//   OSC   /alma/mark [text]            a marker (stamped in the recording if one runs, and sent out as marker.pulse)
//         /alma/session/start [name]   start a session · /alma/session/stop
//         /alma/calibrate              start the calibration
//         /alma/cues/start · /alma/cues/stop
//   UDP   plain text                   the whole datagram is a marker
//   WS    {"mark": "text"} · {"cmd": "mark", "text": "…"} · PiEEG's commands: start_record, stop_record, set_filter
export const INPUT_DEFAULTS = { enabled: true, host: '127.0.0.1', port: 9001 };

export class Inputs {
  constructor(engine, { cues = null, compat = null } = {}) {
    this.engine = engine; this.cues = cues; this.compat = compat;
    this.cfg = { ...INPUT_DEFAULTS }; this.count = 0; this.ignored = 0; this.last = null;
    if (window.alma.onInput) window.alma.onInput((m) => this.handle(m));
    if (window.alma.onWsMessage) window.alma.onWsMessage((m) => this.handleWs(m));
  }
  configure(patch) { Object.assign(this.cfg, patch); this.cfg.port = Math.max(1, Math.min(65535, this.cfg.port | 0)); this.sync(); this.engine._emit('inputs'); }
  sync() { window.alma.inputSync?.({ ...this.cfg }); }

  /** One UDP message: { from, address, args } (OSC) or { from, text }. */
  handle(m) {
    if (m.text !== undefined) { if (m.text) this.mark(m.text.slice(0, 200), m.from); return; }
    const a = String(m.address || '').toLowerCase(), arg = m.args && m.args.length ? m.args[0] : null, e = this.engine;
    if (a === '/alma/mark' || a === '/mark') this.mark(arg != null ? String(arg) : 'mark', m.from);
    else if (a === '/alma/session/start') { if (e.state === 'streaming' && !e.recorder.active) e.startSession(arg != null ? String(arg) : ((document.getElementById('participant') || {}).value || '').trim(), 'started by OSC'); this._note(`session start (${m.from})`); }
    else if (a === '/alma/session/stop' || a === '/alma/session/end') { if (e.recorder.active) e.endSession(); this._note(`session stop (${m.from})`); }
    else if (a === '/alma/calibrate') { e.startCalibration(); this._note(`calibrate (${m.from})`); }
    else if (a === '/alma/cues/start') { this.cues?.start(); this._note(`cues start (${m.from})`); }
    else if (a === '/alma/cues/stop') { this.cues?.stop(); this._note(`cues stop (${m.from})`); }
    else { this.ignored++; this._note(`ignored ${m.address}`); }
  }

  /** A text frame from a WebSocket client: JSON markers and PiEEG-style commands. */
  handleWs({ port, text }) {
    let j = null; try { j = JSON.parse(text); } catch (_) { /* plain text */ }
    const e = this.engine;
    if (!j || typeof j !== 'object') { if (String(text).trim()) this.mark(String(text).trim().slice(0, 200), `ws:${port}`); return; }
    if (j.mark !== undefined) { this.mark(String(j.mark), `ws:${port}`); return; }
    switch (j.cmd) {
      case 'mark': this.mark(String(j.text ?? j.label ?? 'mark'), `ws:${port}`); break;
      case 'start_record': if (e.state === 'streaming' && !e.recorder.active) e.startSession(String(j.name || j.participant || 'ws-client'), 'started by WebSocket'); this.compat?.recordStatus(port); break;
      case 'stop_record': if (e.recorder.active) e.endSession(); setTimeout(() => this.compat?.recordStatus(port), 300); break;
      case 'set_filter': e.setFilters({ bandpass: j.enabled !== false, ...(Number.isFinite(+j.lowcut) ? { low: +j.lowcut } : {}), ...(Number.isFinite(+j.highcut) ? { high: +j.highcut } : {}) }); this._note(`filter set by ws:${port}`); break;
      default: this.ignored++; this._note(`ignored ${j.cmd || 'message'} (ws:${port})`);
    }
  }

  mark(text, from = '') {
    this.count++; this.last = { text, from, at: Date.now() };
    this.engine.markIn(text, from);
    this.engine._emit('inputs');
  }
  _note(t) { this.last = { text: t, from: '', at: Date.now(), command: true }; this.engine._emit('inputs'); }
  toJSON() { return { ...this.cfg }; }
  fromJSON(j) { if (j) this.configure({ ...INPUT_DEFAULTS, ...j }); else this.sync(); }
}
