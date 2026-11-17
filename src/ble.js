// PiEEG XR / IronBCI over Web Bluetooth.
// Protocol (verified against our prototype on 2026-11-07): one notify characteristic, 24 bytes per
// sample = 8 channels × 3 bytes, 24-bit big-endian two's complement; one notification carries one or
// more samples (ours: 120 bytes = 5 samples). No pairing, no start command. 250 samples/s nominal.

export const SERVICE_UUID = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f';
export const NOTIFY_CHAR_UUID = '0000fe42-8e22-4541-9d4c-21edae82ed19';
export const CHANNELS = 8;
export const BYTES_PER_SAMPLE = CHANNELS * 3;
export const SAMPLE_RATE = 250;
const UV_PER_COUNT = 4.5 / 16777215 * 1e6;   // ≈ 0.268 µV, ADS1299 at gain 1 as PiEEG scales it

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function decodeSample(bytes, offset, out) {
  for (let ch = 0; ch < CHANNELS; ch++) {
    const i = offset + ch * 3;
    let raw = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    if (raw & 0x800000) raw -= 0x1000000;
    out[ch] = raw * UV_PER_COUNT;
  }
  return out;
}

/** Source contract shared by the BLE device and the simulator:
 *  start(onSamples) → onSamples(Float32Array[] samples, arrivalMs); stop(); name; stats. */
export class PiEEGDevice {
  constructor() {
    this.device = null;
    this.char = null;
    this.name = '';
    this.onSamples = null;
    this.onStatus = null;
    this.stats = { notifications: 0, samples: 0, lastLen: 0, oddBytes: 0 };
    this.maxReconnects = 5;           // visitor mode: Infinity
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  static supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }

  async start(onSamples) {
    this.onSamples = onSamples;
    this._status('Scanning for PiEEG…');
    // The chooser is answered by the host (main.js picks the first PiEEG/IronBCI it sees).
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'PiEEG' }, { namePrefix: 'IronBCI' }, { namePrefix: 'IRONBCI' }, { namePrefix: 'EAREEG' }],
      optionalServices: [SERVICE_UUID],
    });
    this.name = this.device.name || 'PiEEG';
    this.device.addEventListener('gattserverdisconnected', this._onDisconnect);
    this._stopping = false; this._starting = true;
    // Windows often drops the link in the first second (GATT "disconnected" while reading the services),
    // more so with a weak signal. Try a few times before giving up.
    try {
      for (let attempt = 1; ; attempt++) {
        try { this._status(`Connecting to ${this.name}…${attempt > 1 ? ` (try ${attempt} of 3)` : ''}`); await this._open(); break; }
        catch (e) {
          if (attempt >= 3 || this._stopping) {
            this._stopping = true; this.device.removeEventListener('gattserverdisconnected', this._onDisconnect);   // no reconnect loop for a device the engine has dropped
            try { this.device.gatt.disconnect(); } catch (_) { /* gone */ }
            throw e;
          }
          await wait(700);
        }
        if (this._stopping) { try { this.device.gatt.disconnect(); } catch (_) { /* gone */ } throw new Error('Stopped while connecting'); }
      }
    } finally { this._starting = false; }
    this._status(`Streaming from ${this.name}`);
  }

  /** GATT connect → the notify characteristic → notifications on. Also used to reconnect. */
  async _open() {
    this._opening = true;
    try {
      const server = await this.device.gatt.connect();
      const char = await this._findChar(server);
      this.char = char;
      char.removeEventListener('characteristicvaluechanged', this._onNotify);
      char.addEventListener('characteristicvaluechanged', this._onNotify);
      await char.startNotifications();
    } finally { this._opening = false; }
  }

  async _findChar(server) {
    let char = null;
    try {
      const service = await server.getPrimaryService(SERVICE_UUID);
      char = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    } catch (e) {
      // Fall back: scan every service for the notify characteristic by UUID.
      const services = await server.getPrimaryServices();
      for (const s of services) {
        const chars = await s.getCharacteristics();
        const found = chars.find((c) => c.uuid === NOTIFY_CHAR_UUID);
        if (found) { char = found; break; }
      }
      if (!char) throw new Error('Notify characteristic fe42 not found on this device');
    }
    return char;
  }

  async stop() {
    this._stopping = true;
    try { if (this.char) { this.char.removeEventListener('characteristicvaluechanged', this._onNotify); await this.char.stopNotifications(); } } catch (_) {}
    try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (_) {}
    this.char = null;
    this._status('Disconnected');
  }

  _onNotify(ev) {
    const dv = ev.target.value;
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const n = Math.floor(bytes.length / BYTES_PER_SAMPLE);
    this.stats.notifications++;
    this.stats.lastLen = bytes.length;
    this.stats.oddBytes += bytes.length - n * BYTES_PER_SAMPLE;
    if (n === 0) return;
    const samples = new Array(n);
    for (let s = 0; s < n; s++) samples[s] = decodeSample(bytes, s * BYTES_PER_SAMPLE, new Float32Array(CHANNELS));
    this.stats.samples += n;
    if (this.onSamples) this.onSamples(samples, performance.now());
  }

  /** The link dropped: try to come back on our own (maxReconnects tries, 5 by default over ~15 s; visitor mode
   *  sets Infinity and keeps trying every 10 s) before telling the engine. */
  async _onDisconnect() {
    this.char = null;
    if (this._stopping || this._starting || this._opening || this._reconnecting) return;
    this._reconnecting = true;
    try {
      const max = this.maxReconnects;
      for (let attempt = 1; attempt <= max && !this._stopping; attempt++) {
        this._status(`Signal lost · reconnecting (${Number.isFinite(max) ? `${attempt} of ${max}` : `try ${attempt}`})…`);
        await wait(attempt === 1 ? 500 : attempt <= 5 ? 3000 : 10000);
        if (this._stopping) return;
        try {
          await this._open();
          if (this._stopping) { try { this.device.gatt.disconnect(); } catch (_) { /* gone */ } return; }   // stopped while reconnecting
          this.stats.reconnects = (this.stats.reconnects || 0) + 1; this._status(`Streaming from ${this.name}`); if (this.onReconnected) this.onReconnected(); return;
        }
        catch (_) { /* next try */ }
      }
      if (!this._stopping) { this._status('Device disconnected'); if (this.onDisconnected) this.onDisconnected(); }
    } finally { this._reconnecting = false; }
  }

  _status(text) { if (this.onStatus) this.onStatus(text); }
}
