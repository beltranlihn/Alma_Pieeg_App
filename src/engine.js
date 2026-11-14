// The engine: one source (PiEEG or simulator) → DSP → rings → features. Pages subscribe to it.
import { PiEEGDevice, CHANNELS, SAMPLE_RATE } from './ble.js';
import { SimDevice } from './sim.js';
import { ChannelChain } from './dsp.js';
import { Rings, SampleClock } from './ring.js';
import { assessAll, STATUS } from './quality.js';
import { Recorder } from './record.js';
import { FFT, BANDS } from './fft.js';
import { BlinkDetector, envelope, rms } from './detect.js';
import { INDICES, rawIndices, RollingNorm } from './indices.js';
import { HeartDevice, SimHeart } from './heart.js';
import { Session } from './session.js';
import { SIGNAL_BY_ID } from './signals.js';

export const FOREHEAD = [2, 3, 4, 5];

function rmssdOf(rr) { if (rr.length < 3) return 0; let s = 0; for (let k = 1; k < rr.length; k++) { const d = rr[k].rr - rr[k - 1].rr; s += d * d; } return Math.sqrt(s / (rr.length - 1)); }

export class Engine extends EventTarget {
  constructor() {
    super();
    this.fs = SAMPLE_RATE;
    this.rings = new Rings(this.fs, 60);
    this.clock = new SampleClock(this.fs);
    this.chains = Array.from({ length: CHANNELS }, () => new ChannelChain(this.fs));
    this.recorder = new Recorder();
    this.session = new Session();
    this.liveLog = new Session(); this.liveLog.results = this.session.results;   // same result definitions
    this.liveLog.maxRows = 6000;                                                 // last 10 min at 10 Hz
    setInterval(() => {
      if (this.state !== 'streaming') return;
      this.liveLog.results = this.session.results;
      this.liveLog.log(this.features, SIGNAL_BY_ID);
      const src = this.session.active ? this.session : this.liveLog;
      if (this.session.active) this.session.log(this.features, SIGNAL_BY_ID);
      for (let k = 0; k < 3; k++) this.features.result[k] = src.live[k] || 0;
      this.features.sessionElapsed = this.session.active ? this.session.seconds : 0;
      this._emit('session');
    }, 100);
    this.fft = new FFT(256, this.fs);
    this.blink = new BlinkDetector(this.fs, FOREHEAD);
    this.norms = Object.fromEntries(INDICES.map((i) => [i.id, new RollingNorm(60, 10)]));
    this.device = null;
    this.heart = null;
    this.straps = new Map();          // ANT+ id → { id, bpm, rr: [], lastBeat, lastSeen, beatCount, rssi }
    this.strapSlots = {};             // slot (1..8) → ANT+ id, persisted
    this.ant = { state: 'idle', message: '' };
    if (window.alma.onAnt) window.alma.onAnt((ev) => this._onAnt(ev));
    this.state = 'idle';                       // idle | connecting | streaming | error
    this.statusText = 'No device';
    this.filters = { hampel: true, bandpass: true, low: 1, high: 40, notch: 50 };
    this.quality = null;
    this.features = this._emptyFeatures();
    this._filtTmp = new Float32Array(CHANNELS);
    this._rate = { samples: 0, t0: performance.now(), value: 0 };
    this.startedAt = 0;
    this._tick = this._tick.bind(this);
    setInterval(this._tick, 50);                // features at 20 Hz
    setInterval(() => this._slow(), 300);       // contact + rate
  }

  _emptyFeatures() {
    return {
      t: 0, rms: new Float32Array(CHANNELS), env: new Float32Array(CHANNELS),
      psd: Array.from({ length: CHANNELS }, () => new Float32Array(129)),
      bands: Array.from({ length: CHANNELS }, () => ({ delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0, total: 0, dominant: 0 })),
      avg: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0, total: 0, dominant: 0 },
      rel: { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 },
      calm: 0, blinkCount: 0, blinkPulse: 0, blinkAmp: 0, contactGood: 0, contactOk: 0, rate: 0,
      idx: Object.fromEntries(INDICES.map((i) => [i.id, 0])),       // raw ratios (smoothed)
      idxNorm: Object.fromEntries(INDICES.map((i) => [i.id, 0.5])), // 0–1 against the last minute
      heart: { bpm: 0, rmssd: 0, beat: 0, connected: 0 },
      strap: Array.from({ length: 9 }, () => ({ bpm: 0, beat: 0, rmssd: 0, on: 0 })),   // index = slot, 0 unused
      result: [0, 0, 0], sessionElapsed: 0, sessionActive: 0,
    };
  }

  setFilters(patch) { Object.assign(this.filters, patch); for (const c of this.chains) c.configure(this.filters); this._emit('filters'); }

  _setState(state, text) { this.state = state; if (text) this.statusText = text; this._emit('state'); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect(kind = 'ble') {
    if (this.device) await this.disconnect();
    if (kind === 'ble' && !PiEEGDevice.supported()) { this._setState('error', 'Web Bluetooth is not available in this window'); return false; }
    const dev = kind === 'ble' ? new PiEEGDevice() : new SimDevice();
    this.device = dev;
    dev.onStatus = (t) => { this.statusText = t; this._emit('state'); };
    dev.onDisconnected = () => { this._setState('error', `${dev.name} disconnected`); this.device = null; this._emit('disconnected'); };
    this.rings.reset(); this.clock.reset(); this.blink.reset(); for (const n of Object.values(this.norms)) n.reset();
    for (const c of this.chains) c.configure(this.filters);
    this.features = this._emptyFeatures(); this.quality = null;
    this._setState('connecting', kind === 'ble' ? 'Scanning for PiEEG…' : 'Starting simulator…');
    try {
      await dev.start((samples, arrival) => this._onSamples(samples, arrival));
    } catch (e) {
      this.device = null;
      const msg = e && e.name === 'NotFoundError' ? 'No PiEEG found. Is it powered, within 5 m, and free (not taken by BodyPress or Cloud)?' : `Could not connect: ${e.message || e}`;
      this._setState('error', msg); return false;
    }
    this.startedAt = Date.now();
    this.liveLog.start('', '');
    if (kind === 'sim' && !this.heart) this.connectHeart('sim');
    this._rate = { samples: 0, t0: performance.now(), value: 0 };
    this._setState('streaming', `${dev.name} · streaming`);
    return true;
  }

  async disconnect() {
    if (!this.device) return;
    if (this.recorder.active) await this.stopRecording();
    const d = this.device; this.device = null;
    await d.stop();
    this._setState('idle', 'No device');
  }

  // ── Heart rate (second source) ─────────────────────────────────────────
  async connectHeart(kind = 'ble') {
    if (this.heart) await this.disconnectHeart();
    const h = kind === 'ble' ? new HeartDevice() : new SimHeart();
    this.heart = h;
    h.addEventListener('state', () => this._emit('heart'));
    h.addEventListener('beat', (e) => this._emit('beat', e.detail));
    try { if (kind === 'ble') window.alma.bleKind('heart'); await h.connect(); }
    catch (e) { this.heart = null; this.statusText = e && e.name === 'NotFoundError' ? 'No heart-rate device found' : `Heart rate: ${e.message || e}`; this._emit('state'); return false; }
    finally { window.alma.bleKind('pieeg'); }
    this._emit('heart'); return true;
  }
  async disconnectHeart() { if (!this.heart) return; const h = this.heart; this.heart = null; await h.disconnect(); this.features.heart = { bpm: 0, rmssd: 0, beat: 0, connected: 0 }; this._emit('heart'); }
  get heartName() { return this.heart ? this.heart.name : ''; }

  // ── ANT+ straps (USB stick, main process) ───────────────────────────────
  async antStart() { this.ant = await window.alma.antStart(); this._emit('ant'); return this.ant; }
  async antStop() { this.ant = await window.alma.antStop(); this._emit('ant'); return this.ant; }
  _onAnt(ev) {
    if (ev.type === 'status') { this.ant = ev.payload; this._emit('ant'); return; }
    if (ev.type !== 'data') return;
    const d = ev.payload, now = performance.now();
    let st = this.straps.get(d.id);
    if (!st) { st = { id: d.id, bpm: 0, rr: [], lastBeat: 0, lastSeen: 0, beatCount: -1, rssi: null, firstSeen: Date.now() }; this.straps.set(d.id, st); }
    const newBeat = d.beatCount !== st.beatCount;
    st.bpm = d.bpm; st.lastSeen = Date.now(); st.rssi = d.rssi;
    if (newBeat) {
      if (st.beatCount >= 0) { const rr = d.rr || (d.bpm ? 60000 / d.bpm : 0); if (rr) { st.rr.push({ t: now, rr }); st.rr = st.rr.filter((x) => now - x.t < 60000); } }
      st.beatCount = d.beatCount; st.lastBeat = now;
      this._emit('beat', { id: d.id, bpm: d.bpm });
    }
    this._emit('strap', st);
  }
  assignStrap(slot, id) { if (id == null || id === '') delete this.strapSlots[slot]; else { for (const k of Object.keys(this.strapSlots)) if (this.strapSlots[k] === id) delete this.strapSlots[k]; this.strapSlots[slot] = id; } this._emit('ant'); }
  slotOf(id) { for (const k of Object.keys(this.strapSlots)) if (this.strapSlots[k] === id) return +k; return 0; }

  get deviceName() { return this.device ? this.device.name : ''; }
  get stats() { return this.device ? this.device.stats : { notifications: 0, samples: 0, lastLen: 0, oddBytes: 0 }; }
  get spikesReplaced() { return this.chains.reduce((a, c) => a + c.hampel.replaced, 0); }

  _onSamples(samples, arrival) {
    const stamps = this.clock.stamp(arrival, samples.length);
    for (let s = 0; s < samples.length; s++) {
      const raw = samples[s];
      for (let ch = 0; ch < CHANNELS; ch++) this._filtTmp[ch] = this.chains[ch].process(raw[ch]);
      this.rings.push(raw, this._filtTmp);
      this.recorder.push(stamps[s], raw);
    }
    this._rate.samples += samples.length;
  }

  _tick() {
    if (!this.device || this.rings.count < this.fs) return;
    const f = this.features, now = performance.now(), r = this.rings;
    if (this.blink.poll(r, now)) this._emit('blink', { count: this.blink.count, amplitude: this.blink.amplitude });
    f.blinkCount = this.blink.count; f.blinkPulse = this.blink.pulse(now); f.blinkAmp = this.blink.amplitude;
    for (let ch = 0; ch < CHANNELS; ch++) { f.rms[ch] = rms(r, ch, this.fs); f.env[ch] = envelope(r, ch, this.fs); }
    // spectrum of every channel every 100 ms (two ticks)
    if (!this._fftPhase) this._fftPhase = 0;
    if (++this._fftPhase % 2 === 0) {
      const n = this.fft.n, base = r.at(n - 1);
      const avg = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0, total: 0, dominant: 0 };
      for (let ch = 0; ch < CHANNELS; ch++) {
        const arr = r.filt[ch], size = r.size;
        this.fft.compute((i) => arr[(base + i) % size]);
        f.psd[ch].set(this.fft.psd);
        f.bands[ch] = this.fft.bandPowers();
      }
      let used = 0;
      for (const ch of FOREHEAD) { const q = this.quality && this.quality[ch]; if (q && (q.status === STATUS.POOR || q.status === STATUS.RAILED || q.status === STATUS.NONE)) continue; for (const b of BANDS) avg[b.id] += f.bands[ch][b.id]; avg.total += f.bands[ch].total; avg.dominant += f.bands[ch].dominant; used++; }
      if (used) { for (const b of BANDS) avg[b.id] /= used; avg.total /= used; avg.dominant /= used; }
      f.avg = avg;
      for (const b of BANDS) f.rel[b.id] = avg.total > 0 ? avg[b.id] / avg.total : 0;
      const raw = rawIndices(avg);
      for (const i of INDICES) {
        const prev = f.idx[i.id] || raw[i.id];
        f.idx[i.id] = prev + (raw[i.id] - prev) * 0.18;                 // same EMA PiEEG uses
        f.idxNorm[i.id] = this.norms[i.id].push(f.idx[i.id]);
      }
      f.calm = f.idx.calm;
    }
    // straps by slot
    const wall = Date.now();
    for (let slot = 1; slot <= 8; slot++) {
      const st = this.straps.get(this.strapSlots[slot]); const fs = f.strap[slot];
      if (st && wall - st.lastSeen < 8000) { fs.on = 1; fs.bpm = st.bpm; fs.beat = st.lastBeat && now - st.lastBeat < 150 ? 1 : 0; fs.rmssd = rmssdOf(st.rr); }
      else { fs.on = 0; fs.bpm = 0; fs.beat = 0; fs.rmssd = 0; }
    }
    // the main heart: slot 1 strap if alive, else the Bluetooth heart device
    if (f.strap[1].on) { f.heart.bpm = f.strap[1].bpm; f.heart.rmssd = f.strap[1].rmssd; f.heart.beat = f.strap[1].beat; f.heart.connected = 1; }
    else if (this.heart) { const h = this.heart; f.heart.bpm = h.bpm; f.heart.rmssd = h.rmssd; f.heart.beat = h.lastBeat && now - h.lastBeat < 150 ? 1 : 0; f.heart.connected = h.connected ? 1 : 0; }
    else { f.heart.bpm = 0; f.heart.rmssd = 0; f.heart.beat = 0; f.heart.connected = 0; }
    f.t = now;
    this._emit('features');
  }

  _slow() {
    if (!this.device) return;
    this.quality = assessAll(this.rings, this.fs);
    const good = this.quality.filter((q) => q.status === STATUS.GOOD).length;
    this.features.contactGood = good; this.features.contactOk = good === CHANNELS ? 1 : 0;
    const now = performance.now(), dt = (now - this._rate.t0) / 1000;
    if (dt >= 1) { this._rate.value = this._rate.samples / dt; this._rate.samples = 0; this._rate.t0 = now; }
    this.features.rate = this._rate.value;
    this._emit('quality');
  }

  // ── Session (participant + results + files) ────────────────────────────
  startSession(participant, notes) {
    this.session.start(participant, notes); this.features.sessionActive = 1; this.features.result = [0, 0, 0];
    this.recorder.start(); this._emit('recording'); this._emit('session');
  }
  async endSession() {
    const summary = this.session.end(SIGNAL_BY_ID); this.features.sessionActive = 0;
    this.recorder.stop(); this._emit('recording');
    const d = new Date(this.session.startedAt), pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const who = (this.session.participant || 'session').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
    const name = `${who}_${stamp}`;
    const meta = JSON.parse(this.recorder.toMeta({ device: this.deviceName, sample_rate: this.fs, filters: { ...this.filters }, contact_at_end: this.quality }));
    const files = { '.raw.csv': this.recorder.toCSV(), '.features.csv': this.session.featuresCSV(), '.summary.json': JSON.stringify({ ...summary, device: this.deviceName, sample_rate: this.fs, filters: { ...this.filters }, marks: meta.marks, raw_samples: meta.samples }, null, 2) };
    let paths = [];
    try { paths = await window.alma.saveFiles(name, files); } catch (e) { this._emit('error', e); }
    this._emit('session'); this._emit('saved', { name, path: paths[0] || '', paths });
    return { name, paths, summary };
  }

  // ── Recording ──────────────────────────────────────────────────────────────
  startRecording() { this.recorder.start(); this._emit('recording'); }
  mark(text) { const m = this.recorder.mark(text); if (m) this._emit('mark', m); return m; }
  async stopRecording(name) {
    const rec = this.recorder; rec.stop(); this._emit('recording');
    if (!rec.rows.length) return null;
    const d = new Date(rec.startedAt), pad = (n) => String(n).padStart(2, '0');
    const auto = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const full = name ? `${name}_${auto}` : `session_${auto}`;
    const meta = rec.toMeta({ device: this.deviceName, sample_rate: this.fs, filters: { ...this.filters }, contact_at_end: this.quality });
    const path = await window.alma.saveSession(full, rec.toCSV(), meta);
    this._emit('saved', { name: full, path });
    return { name: full, path };
  }
}
