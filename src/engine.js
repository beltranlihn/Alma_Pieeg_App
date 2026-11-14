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

export const FOREHEAD = [2, 3, 4, 5];

export class Engine extends EventTarget {
  constructor() {
    super();
    this.fs = SAMPLE_RATE;
    this.rings = new Rings(this.fs, 60);
    this.clock = new SampleClock(this.fs);
    this.chains = Array.from({ length: CHANNELS }, () => new ChannelChain(this.fs));
    this.recorder = new Recorder();
    this.fft = new FFT(256, this.fs);
    this.blink = new BlinkDetector(this.fs, FOREHEAD);
    this.norms = Object.fromEntries(INDICES.map((i) => [i.id, new RollingNorm(60, 10)]));
    this.device = null;
    this.heart = null;
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
    if (this.heart) { const h = this.heart; f.heart.bpm = h.bpm; f.heart.rmssd = h.rmssd; f.heart.beat = h.lastBeat && now - h.lastBeat < 150 ? 1 : 0; f.heart.connected = h.connected ? 1 : 0; }
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
