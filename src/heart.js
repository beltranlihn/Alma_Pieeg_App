// Heart rate over Bluetooth: the standard Heart Rate service (0x180D) that chest straps (Polar H10,
// Garmin HRM) and many watches broadcast. Gives beats per minute and, when the strap sends them,
// RR intervals → beat events and HRV (RMSSD over the last minute).
const HR_SERVICE = 0x180d, HR_MEASUREMENT = 0x2a37;

export class HeartDevice extends EventTarget {
  constructor() {
    super();
    this.device = null; this.name = ''; this.connected = false;
    this.bpm = 0; this.rr = [];          // RR intervals in ms (last 60 s worth)
    this.lastBeat = 0; this.lastUpdate = 0; this.beats = 0;
    this._onValue = this._onValue.bind(this);
  }
  static supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
    this.name = this.device.name || 'Heart rate';
    this.device.addEventListener('gattserverdisconnected', () => { this.connected = false; this._emit('state'); });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(HR_SERVICE);
    const ch = await service.getCharacteristic(HR_MEASUREMENT);
    ch.addEventListener('characteristicvaluechanged', this._onValue);
    await ch.startNotifications();
    this.connected = true; this._emit('state');
  }
  async disconnect() { try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (_) {} this.connected = false; this._emit('state'); }
  _onValue(ev) {
    const dv = ev.target.value; const flags = dv.getUint8(0); let i = 1;
    this.bpm = flags & 0x01 ? dv.getUint16(i, true) : dv.getUint8(i); i += flags & 0x01 ? 2 : 1;
    if (flags & 0x08) i += 2;                                      // energy expended
    const now = performance.now();
    if (flags & 0x10) {
      while (i + 1 < dv.byteLength) { const rr = dv.getUint16(i, true) / 1024 * 1000; i += 2; this.rr.push({ t: now, rr }); this.beats++; this.lastBeat = now; this._emit('beat', { rr }); }
      this.rr = this.rr.filter((x) => now - x.t < 60000);
    }
    this.lastUpdate = now; this._emit('hr');
  }
  /** Root mean square of successive RR differences over the last minute (ms); 0 without RR data. */
  get rmssd() {
    if (this.rr.length < 3) return 0;
    let s = 0; for (let k = 1; k < this.rr.length; k++) { const d = this.rr[k].rr - this.rr[k - 1].rr; s += d * d; }
    return Math.sqrt(s / (this.rr.length - 1));
  }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

/** Simulated heart for the simulator: ~62 bpm with respiratory sinus arrhythmia. */
export class SimHeart extends EventTarget {
  constructor() { super(); this.name = 'Simulated heart'; this.connected = false; this.bpm = 0; this.rr = []; this.lastBeat = 0; this.lastUpdate = 0; this.beats = 0; this._t = 0; }
  async connect() { this.connected = true; this._timer = setInterval(() => this._tick(), 50); this._emit('state'); }
  async disconnect() { clearInterval(this._timer); this.connected = false; this._emit('state'); }
  _tick() {
    const now = performance.now(); this._t += 0.05;
    const bpm = 62 + 4 * Math.sin(2 * Math.PI * this._t / 5);
    if (now - this.lastBeat >= 60000 / bpm) { const rr = now - (this.lastBeat || now - 60000 / bpm); this.lastBeat = now; this.beats++; this.rr.push({ t: now, rr }); this.rr = this.rr.filter((x) => now - x.t < 60000); this.bpm = Math.round(60000 / rr); this.lastUpdate = now; this._emit('beat', { rr }); this._emit('hr'); }
  }
  get rmssd() { if (this.rr.length < 3) return 0; let s = 0; for (let k = 1; k < this.rr.length; k++) { const d = this.rr[k].rr - this.rr[k - 1].rr; s += d * d; } return Math.sqrt(s / (this.rr.length - 1)); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
