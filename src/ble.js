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
    this._status(`Connecting to ${this.name}…`);
    const server = await this.device.gatt.connect();
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
    this.char = char;
    char.addEventListener('characteristicvaluechanged', this._onNotify);
    await char.startNotifications();
    this._status(`Streaming from ${this.name}`);
  }

  async stop() {
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

  _onDisconnect() {
    this.char = null;
    this._status('Device disconnected');
    if (this.onDisconnected) this.onDisconnected();
  }

  _status(text) { if (this.onStatus) this.onStatus(text); }
}
