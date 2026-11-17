// The engine: one source (PiEEG or simulator) → DSP → rings → features. Pages subscribe to it.
import { PiEEGDevice, CHANNELS, SAMPLE_RATE } from './ble.js';
import { SimDevice } from './sim.js';
import { ChannelChain, WideChain, EmgEnvelope, EogChain } from './dsp.js';
import { Rings, SampleClock } from './ring.js';
import { assessAll, STATUS } from './quality.js';
import { Recorder } from './record.js';
import { FFT, BANDS } from './fft.js';
import { BlinkDetector, envelope, rms } from './detect.js';
import { INDICES, rawIndices, RollingNorm } from './indices.js';
import { HeartDevice, SimHeart } from './heart.js';
import { Session } from './session.js';
import { SIGNAL_BY_ID } from './signals.js';
import { Calibration } from './calibrate.js';
import { GestureTrainer, GESTURES, faceFeatures, FEATURE_DIM } from './face.js';
import { Gaze } from './gaze.js';
import { Tension } from './tension.js';

// Which channels are forehead / temples / left / right comes from the montage (montage.js), never fixed numbers.
import { groups, onMontage } from './montage.js';
const isBad = (q) => !q || q.status === STATUS.POOR || q.status === STATUS.RAILED || q.status === STATUS.NONE;

function rmssdOf(rr) { if (rr.length < 3) return 0; let s = 0; for (let k = 1; k < rr.length; k++) { const d = rr[k].rr - rr[k - 1].rr; s += d * d; } return Math.sqrt(s / (rr.length - 1)); }

export class Engine extends EventTarget {
  constructor() {
    super();
    this.fs = SAMPLE_RATE;
    this.rings = new Rings(this.fs, 60);
    this.clock = new SampleClock(this.fs);
    this.chains = Array.from({ length: CHANNELS }, () => new ChannelChain(this.fs));
    // side chains for the face, independent of the display filters (0.8)
    this.wideChains = Array.from({ length: CHANNELS }, () => new WideChain(this.fs, 50));
    this.emgEnv = Array.from({ length: CHANNELS }, () => new EmgEnvelope(this.fs));
    this.eogChains = Array.from({ length: CHANNELS }, () => new EogChain(this.fs));
    this._wideTmp = new Float32Array(CHANNELS);
    this.eog = new Float64Array(CHANNELS);
    this.faceX = new Float32Array(FEATURE_DIM); this.faceReady = false;
    this.gestures = new GestureTrainer();     // PiEEG Face Trainer
    this.gaze = new Gaze();                   // PiEEG Eye Track, EOG
    this.tension = new Tension();             // PiEEG artifact envelopes
    this.faaNorm = new RollingNorm(60, 10);
    this._faa = { l: 0, r: 0, n: 0 }; this._beta = { ema: 0, base: 0, n: 0 };
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
    this.blink = new BlinkDetector(this.fs, groups.forehead, groups.temples);
    // A real map change moves the groups: what was measured on the old ones goes (gaze model, tension range, alpha
    // asymmetry and index baselines, the calibration's index ranges). Gesture models stay: they belong to inputs,
    // and the inputs are still the same electrodes.
    onMontage(() => {
      this.blink.setChannels(groups.forehead, groups.temples);
      this.tension.reset(); this.tension.clearRange();
      if (this.gaze.ready || this.gaze.calibrating) this.gaze.reset();
      this._faa = { l: 0, r: 0, n: 0 }; this.faaNorm.reset(); for (const n of Object.values(this.norms)) n.reset();
      if (this.calib.result || this.calib.running) this.resetCalibration();
      this._emit('montage'); this._emit('face-model');
    });
    this.norms = Object.fromEntries(INDICES.map((i) => [i.id, new RollingNorm(60, 10)]));
    this.calib = new Calibration(CHANNELS);   // per-person REST / ACTIVE calibration (PiEEG Avatar Foundation)
    this.device = null;
    this.heart = null;
    this.straps = new Map();          // ANT+ id → { id, bpm, rr: [], lastBeat, lastSeen, beatCount, rssi }
    this.strapSlots = {};             // slot (1..8) → ANT+ id, persisted
    this.ant = { state: 'idle', message: '' };
    if (window.alma.onAnt) window.alma.onAnt((ev) => this._onAnt(ev));
    this.state = 'idle';                       // idle | connecting | streaming | error
    this.statusText = 'No device';
    // car: average reference for the analysis (bands, indices, calibration) and the Waves view. The rings keep the
    // signal as recorded, so the contact check still sees a noisy reference for what it is.
    this.filters = { hampel: true, bandpass: true, low: 1, high: 40, notch: 50, car: false };
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
      calm: 0, blinkCount: 0, blinkPulse: 0, blinkAmp: 0, contactGood: 0, contactOk: 0, rate: 0, refOk: 0, refCommon: 0,
      idx: Object.fromEntries(INDICES.map((i) => [i.id, 0])),       // raw ratios (smoothed)
      idxNorm: Object.fromEntries(INDICES.map((i) => [i.id, 0.5])), // 0–1 against the last minute
      heart: { bpm: 0, rmssd: 0, beat: 0, connected: 0 },
      strap: Array.from({ length: 9 }, () => ({ bpm: 0, beat: 0, rmssd: 0, on: 0 })),   // index = slot, 0 unused
      result: [0, 0, 0], sessionElapsed: 0, sessionActive: 0,
      cal: { score: 0, ready: this.calib && this.calib.result ? 1 : 0 },
      face: Object.fromEntries(GESTURES.map((g) => [g.id, 0])), faceOn: Object.fromEntries(GESTURES.map((g) => [g.id, 0])),
      gaze: { x: 0, y: 0, side: 0, ready: this.gaze && this.gaze.ready ? 1 : 0 },
      emg: new Float32Array(CHANNELS),
      tension: { jaw: 0, brow: 0, jawOn: 0, browOn: 0 },
      faa: 0, faaNorm: 0.5, betaSurge: 0,
    };
  }

  setFilters(patch) {
    const before = { ...this.filters };
    Object.assign(this.filters, patch);
    if (['hampel', 'bandpass', 'low', 'high', 'notch'].some((k) => before[k] !== this.filters[k])) for (const c of this.chains) c.configure(this.filters);
    if (before.notch !== this.filters.notch) for (const c of this.wideChains) c.configure(this.filters.notch);
    this._emit('filters');
  }
  /** One protocol at a time: calibration, a gesture recording, the gaze dots or the tension range. */
  get busy() { return this.calib.running || this.gestures.recording || this.gaze.calibrating || this.tension.measuring; }

  _setState(state, text) { this.state = state; if (text) this.statusText = text; this._emit('state'); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect(kind = 'ble') {
    if (this.device) await this.disconnect();
    if (kind === 'ble' && !PiEEGDevice.supported()) { this._setState('error', 'Web Bluetooth is not available in this window'); return false; }
    const dev = kind === 'ble' ? new PiEEGDevice() : new SimDevice();
    this.device = dev;
    dev.onStatus = (t) => { this.statusText = t; this._emit('state'); };
    dev.onReconnected = () => { this.statusText = `${dev.name} · streaming`; this._emit('state'); };
    dev.onDisconnected = () => { this._setState('error', `${dev.name} disconnected`); this.device = null; this.cancelCalibration(); this.cancelFaceProtocols(); this._emit('disconnected'); };
    this.rings.reset(); this.clock.reset(); this.blink.reset(); for (const n of Object.values(this.norms)) n.reset();
    for (const c of this.chains) c.configure(this.filters);
    for (const c of this.wideChains) c.configure(this.filters.notch); for (const e of this.emgEnv) e.reset(); for (const e of this.eogChains) e.reset();
    // The simulator gets a clean face model; the person's real one is kept aside and comes back with the PiEEG.
    if (kind === 'sim' && this.sourceKind !== 'sim') { this._realFace = this.faceModelJSON(); this._clearFaceModels(); }
    else if (kind !== 'sim' && this.sourceKind === 'sim' && this._realFace) { this._clearFaceModels(); this.loadFaceModel(this._realFace); this._realFace = null; }
    this.sourceKind = kind; this.gestures.resetLive();
    this.tension.reset(); this.faaNorm.reset(); this._faa = { l: 0, r: 0, n: 0 }; this._beta = { ema: 0, base: 0, n: 0 }; this.faceReady = false;
    this.features = this._emptyFeatures(); this.quality = null;
    this._setState('connecting', kind === 'ble' ? 'Scanning for PiEEG…' : 'Starting simulator…');
    try {
      await dev.start((samples, arrival) => this._onSamples(samples, arrival));
    } catch (e) {
      this.device = null;
      const gatt = /GATT|disconnected|NetworkError/i.test(String(e && (e.message || e)));
      const msg = e && e.name === 'NotFoundError' ? 'No PiEEG found. Is it powered, within 5 m, and free (not taken by BodyPress or Cloud)?'
        : gatt ? 'The PiEEG dropped the link while connecting (tried 3 times). Bring it closer to this computer and press Connect again.'
        : `Could not connect: ${e.message || e}`;
      this._setState('error', msg); return false;
    }
    this.startedAt = Date.now();
    this.liveLog.start('', '');
    if (kind === 'sim' && !this.heart) this.connectHeart('sim');
    this._rate = { samples: 0, t0: performance.now(), value: 0 };
    this._recentreAt = performance.now() + 2500; this.startedAtPerf = performance.now(); this._lastSampleAt = 0; this._stalled = false;   // the EOG chains start again: put the saved gaze model back on centre
    this._setState('streaming', `${dev.name} · streaming`);
    return true;
  }

  async disconnect() {
    if (!this.device) return;
    if (this.recorder.active) await this.stopRecording();
    const d = this.device; this.device = null; this.cancelCalibration(); this.cancelFaceProtocols();
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
      for (let ch = 0; ch < CHANNELS; ch++) {
        const x = raw[ch];
        this._filtTmp[ch] = this.chains[ch].process(x);
        const w = this.wideChains[ch].process(x); this._wideTmp[ch] = w;
        this.emgEnv[ch].process(w);
        this.eog[ch] = this.eogChains[ch].process(x);
      }
      this.rings.push(raw, this._filtTmp, this._wideTmp);
      this.recorder.push(stamps[s], raw);
    }
    this._rate.samples += samples.length;
    this._lastSampleAt = performance.now();
    if (this._stalled) { this._stalled = false; this.statusText = `${this.deviceName} · streaming`; this._emit('state'); }
  }

  _tick() {
    if (!this.device || this.rings.count < this.fs) return;
    const f = this.features, now = performance.now(), r = this.rings;
    const calPhase = this.calib.tick(now); if (calPhase) this._onCalPhase(calPhase);
    if (this.blink.poll(r, now)) this._emit('blink', { count: this.blink.count, amplitude: this.blink.amplitude });
    f.blinkCount = this.blink.count; f.blinkPulse = this.blink.pulse(now); f.blinkAmp = this.blink.amplitude;
    for (let ch = 0; ch < CHANNELS; ch++) { f.rms[ch] = rms(r, ch, this.fs); f.env[ch] = envelope(r, ch, this.fs); f.emg[ch] = this.emgEnv[ch].value; }
    const bad = this.quality ? this.quality.map(isBad) : null;
    // face: gesture probabilities (20 Hz) and gaze (20 Hz)
    this.faceReady = !!faceFeatures(r.wide, (back) => r.at(back), r.count, this.faceX);
    const probs = this.gestures.predict(this.faceReady ? this.faceX : null);
    for (const g of GESTURES) {
      f.face[g.id] = probs[g.id];
      const on = this.gestures.on[g.id];
      if (on !== f.faceOn[g.id]) { f.faceOn[g.id] = on; if (on && this.recorder.active) this.mark(`face_${g.id}`); this._emit('gesture', { type: on ? 'on' : 'off', id: g.id }); }
    }
    if (this._recentreAt && now > this._recentreAt) { this._recentreAt = 0; if (this.gaze.model && !this.gaze.calibrating) this.gaze.recentre(); }
    const gz = this.gaze.update(now, this.eog, { blinking: this.blink.above, bad, dt: 0.05 });
    if (gz) { if (gz.done && this.recorder.active) this.mark('gaze_done'); this._emit('gaze', gz.done ? { type: 'done', ok: gz.ok } : { type: 'phase', ...gz }); if (gz.done) this._emit('face-model'); }
    if (this.gaze.side !== f.gaze.side) this._emit('gaze', { type: 'side', side: this.gaze.side });
    f.gaze.x = this.gaze.x; f.gaze.y = this.gaze.y; f.gaze.side = this.gaze.side; f.gaze.ready = this.gaze.ready ? 1 : 0;
    // spectrum of every channel every 100 ms (two ticks)
    if (!this._fftPhase) this._fftPhase = 0;
    if (++this._fftPhase % 2 === 0) {
      const n = this.fft.n, base = r.at(n - 1);
      const avg = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0, total: 0, dominant: 0 };
      let carRef = null;
      if (this.filters.car) {          // average of the channels with contact, sample by sample
        const use = []; for (let ch = 0; ch < CHANNELS; ch++) if (!bad || !bad[ch]) use.push(ch);
        if (use.length >= 3) { carRef = new Float64Array(n); for (let i = 0; i < n; i++) { const k = (base + i) % r.size; let s = 0; for (const ch of use) s += r.filt[ch][k]; carRef[i] = s / use.length; } }
      }
      for (let ch = 0; ch < CHANNELS; ch++) {
        const arr = r.filt[ch], size = r.size;
        this.fft.compute(carRef ? (i) => arr[(base + i) % size] - carRef[i] : (i) => arr[(base + i) % size]);
        f.psd[ch].set(this.fft.psd);
        f.bands[ch] = this.fft.bandPowers();
      }
      let used = 0;
      for (const ch of groups.forehead) { const q = this.quality && this.quality[ch]; if (q && (q.status === STATUS.POOR || q.status === STATUS.RAILED || q.status === STATUS.NONE)) continue; for (const b of BANDS) avg[b.id] += f.bands[ch][b.id]; avg.total += f.bands[ch].total; avg.dominant += f.bands[ch].dominant; used++; }
      if (used) { for (const b of BANDS) avg[b.id] /= used; avg.total /= used; avg.dominant /= used; }
      f.avg = avg;
      for (const b of BANDS) f.rel[b.id] = avg.total > 0 ? avg[b.id] / avg.total : 0;
      const raw = rawIndices(avg);
      for (const i of INDICES) {
        const prev = f.idx[i.id] || raw[i.id];
        f.idx[i.id] = prev + (raw[i.id] - prev) * 0.18;                 // same EMA PiEEG uses
        const rolling = this.norms[i.id].push(f.idx[i.id]);           // keeps learning, used when not calibrated
        const own = this.calib.result ? this.calib.normIndex(i.id, f.idx[i.id]) : null;
        f.idxNorm[i.id] = own == null ? rolling : own;
      }
      f.calm = f.idx.calm;
      if (this.calib.recording) this.calib.feed(f.bands, f.idx, this.quality && this.quality.map((q) => q.status === STATUS.POOR || q.status === STATUS.RAILED || q.status === STATUS.NONE));
      f.cal.score = this.calib.score(f.bands); f.cal.ready = this.calib.result ? 1 : 0;
      // gesture recording (10 Hz, as PiEEG's capture)
      if (this.gestures.recording) {
        const id = this.gestures.rec.id, st = this.gestures.step(now, this.faceReady ? this.faceX : null);
        if (st && st.changed) {
          if (st.done && this.recorder.active) this.mark(`train_${id}_done`);
          this._emit('gesture', { type: st.done ? 'trained' : 'phase', id, phase: st.phase, cycleLabel: st.cycleLabel });
          if (st.done) this._emit('face-model');
        }
      }
      // muscle tension (10 Hz)
      this.tension.push(f.emg, bad);
      const tj = this.tension.groups.jaw, tb = this.tension.groups.brow;
      if (tj.on !== f.tension.jawOn || tb.on !== f.tension.browOn) this._emit('tension', { type: 'on' });
      f.tension.jaw = tj.value; f.tension.brow = tb.value; f.tension.jawOn = tj.on; f.tension.browOn = tb.on;
      if (this.tension.measuring) { const st = this.tension.stepRange(now); if (st) { this._emit('tension', { type: st.done ? 'range' : 'step', ...st }); if (st.done) this._emit('face-model'); } }
      // frontal alpha asymmetry: ln α right − ln α left (PiEEG Glitching Reality), and the beta surge against
      // a ~20 s baseline (PiEEG Premeditatio Malorum): how far beta jumps above the person's recent level
      const side = (chs) => { let s = 0, n = 0; for (const ch of chs) if (!bad || !bad[ch]) { s += f.bands[ch].alpha; n++; } return n ? s / n : null; };
      const aL = side(groups.leftForehead), aR = side(groups.rightForehead);
      if (aL != null && aR != null) {
        if (!this._faa.n++) { this._faa.l = aL; this._faa.r = aR; }
        this._faa.l += (aL - this._faa.l) * 0.22; this._faa.r += (aR - this._faa.r) * 0.22;
        f.faa = Math.log(Math.max(this._faa.r, 1e-9)) - Math.log(Math.max(this._faa.l, 1e-9));
        f.faaNorm = this.faaNorm.push(f.faa);
      }
      // the baseline is a plain running mean for the first 20 s, then an EMA of ~20 s
      const B = this._beta;
      if (!B.n++) { B.ema = avg.beta; B.base = avg.beta; }
      B.ema += (avg.beta - B.ema) * 0.18; B.base += (B.ema - B.base) * Math.max(0.005, 1 / B.n);
      f.betaSurge = B.base > 1e-9 ? Math.max(0, Math.min(1, (B.ema - B.base) / B.base)) : 0;
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
    // Connected but silent: the PiEEG can keep the link and stop sending (seen after a signal loss; a fresh
    // connection does not help, only power). Say so instead of showing stale contact as if it were live.
    const silentMs = performance.now() - (this._lastSampleAt || this.startedAtPerf || performance.now());
    if (this.state === 'streaming' && silentMs > 5000 && !/reconnecting/i.test(this.statusText)) {
      if (!this._stalled) { this._stalled = true; this.quality = null; this.features.contactGood = 0; this.features.contactOk = 0; this._emit('quality'); }
      this.statusText = `Connected, but no data for ${Math.round(silentMs / 1000)} s. Unplug the PiEEG box for 5 s, plug it back, then Connect.`;
      this.features.rate = 0; this._emit('state'); return;
    }
    this.quality = assessAll(this.rings, this.fs);
    const ref = this.quality.ref || { status: 'wait', common: 0 };
    this.features.refOk = ref.status === 'good' ? 1 : 0; this.features.refCommon = ref.common;
    const good = this.quality.filter((q) => q.status === STATUS.GOOD).length;
    this.features.contactGood = good; this.features.contactOk = good === CHANNELS ? 1 : 0;
    const now = performance.now(), dt = (now - this._rate.t0) / 1000;
    if (dt >= 1) { this._rate.value = this._rate.samples / dt; this._rate.samples = 0; this._rate.t0 = now; }
    this.features.rate = this._rate.value;
    this._emit('quality');
  }

  // ── Calibration (REST / ACTIVE, per person) ────────────────────────────
  startCalibration(opts = {}) {
    if (this.state !== 'streaming' || this.busy) return false;
    const participant = opts.participant ?? ((document.getElementById('participant') || {}).value || '').trim();
    this.calib.start(performance.now(), { ...opts, participant });
    if (this.recorder.active) this.mark('cal_start');
    this._emit('calib', { phase: this.calib.phase }); return true;
  }
  cancelCalibration() { if (!this.calib.running) return; this.calib.cancel(); if (this.recorder.active) this.mark('cal_cancel'); this._emit('calib', { phase: 'cancelled' }); }
  resetCalibration() { this.cancelCalibration(); this.calib.reset(); this.features.cal.score = 0; this.features.cal.ready = 0; this._emit('calib', { phase: 'reset' }); }
  selectCalibration(list) { this.calib.select(list); this._emit('calib', { phase: 'selected' }); }
  _onCalPhase(phase) {
    if (this.recorder.active && (phase === 'rest' || phase === 'active' || phase === 'done')) this.mark(`cal_${phase}`);
    this._emit('calib', { phase });
  }

  // ── Face: gestures, gaze, tension range ─────────────────────────────────
  startGesture(id) {
    if (this.state !== 'streaming' || this.busy) return false;
    const who = ((document.getElementById('participant') || {}).value || '').trim();
    if (who) this.gestures.participant = who;
    const cycles = this.gestures.start(id, performance.now());
    if (this.recorder.active) this.mark(`train_${id}_start`);
    this._emit('gesture', { type: 'start', id, cycles }); return true;
  }
  cancelGesture() { if (!this.gestures.recording) return; const id = this.gestures.rec.id; this.gestures.cancel(); this._emit('gesture', { type: 'cancelled', id }); }
  clearGesture(id) { if (this.gestures.rec && this.gestures.rec.id === id) this.gestures.cancel(); this.gestures.clear(id); this._emit('gesture', { type: 'cleared', id }); this._emit('face-model'); }
  clearGestures() { this.gestures.cancel(); this.gestures.clearAll(); this._emit('gesture', { type: 'cleared' }); this._emit('face-model'); }
  startGaze() { if (this.state !== 'streaming' || this.busy) return false; this.gaze.start(performance.now()); if (this.recorder.active) this.mark('gaze_start'); this._emit('gaze', { type: 'start' }); return true; }
  recentreGaze() { this.gaze.recentre(); this._emit('gaze', { type: 'recentre' }); }
  resetGaze() { this.gaze.reset(); this._emit('gaze', { type: 'reset' }); this._emit('face-model'); }
  startTensionRange() { if (this.state !== 'streaming' || this.busy) return false; this.tension.startRange(performance.now()); this._emit('tension', { type: 'start' }); return true; }
  clearTensionRange() { this.tension.clearRange(); this._emit('tension', { type: 'cleared' }); this._emit('face-model'); }
  cancelFaceProtocols() {
    this.cancelGesture();
    if (this.gaze.calibrating) { this.gaze.cancel(); this._emit('gaze', { type: 'cancelled' }); }
    if (this.tension.measuring) { this.tension.cancelRange(); this._emit('tension', { type: 'cancelled' }); }
  }
  _clearFaceModels() { this.gestures.cancel(); this.gestures.clearAll(); this.gaze.reset(); this.tension.clearRange(); }
  /** The face model that belongs to a person (never the simulator's). */
  get savedFaceModel() { return this.sourceKind === 'sim' ? this._realFace : this.faceModelJSON(); }
  faceModelJSON() { return { gestures: this.gestures.toJSON(), gaze: this.gaze.toJSON(), tension: this.tension.toJSON() }; }
  loadFaceModel(j) { if (!j) return; this.gestures.fromJSON(j.gestures); this.gaze.fromJSON(j.gaze); this.tension.fromJSON(j.tension); }

  // ── Session (participant + results + files) ────────────────────────────
  startSession(participant, notes) {
    this.session.start(participant, notes); this.features.sessionActive = 1;
    const field = document.getElementById('participant'); if (field && !field.value && participant) field.value = participant; this.features.result = [0, 0, 0];
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
    const files = { '.raw.csv': this.recorder.toCSV(), '.features.csv': this.session.featuresCSV(), '.summary.json': JSON.stringify({ ...summary, calibrated: !!this.calib.result, calibration: this.calib.toJSON(), face: { gestures: this.gestures.summary(), gaze: this.gaze.summary(), tension: this.tension.toJSON() }, device: this.deviceName, sample_rate: this.fs, filters: { ...this.filters }, marks: meta.marks, raw_samples: meta.samples }, null, 2) };
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
