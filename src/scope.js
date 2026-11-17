// Oscilloscope: 8 stacked traces on one canvas, drawn every animation frame from the ring buffers.
import { CHANNELS } from './ble.js';
import { isBad } from './quality.js';

// Channel labels follow the montage (montage.js): Home › Electrodes says which site each input is on.
export { XR_FACE } from './montage.js';
import { XR_FACE } from './montage.js';

export class Scope {
  constructor(canvas, rings) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.rings = rings;
    this.car = false; this.seconds = 8; this.scaleUv = 100; this.source = 'filt'; this.quality = null; this.marks = []; this.visible = null; this.channelColors = null; this.lineWidth = 1; this.grid = true;
    this.colors = { bg: '#111111', line: 'rgba(255,255,255,0.10)', lineSoft: 'rgba(255,255,255,0.05)', ink: '#E0E0E0', ink3: '#8C8C8C', dim: '#6D6D6D', trace: '#E0E0E0', traceBad: '#8C8C8C', mark: '#E5B567' };
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.w = r.width; this.h = r.height;
  }

  draw(nowMs) {
    const { ctx, w, h, rings } = this;
    const fs = rings.fs, n = Math.min(rings.count, Math.round(this.seconds * fs));
    const left = 150, right = 16, top = 20, bottom = 22;
    const plotW = w - left - right, laneH = (h - top - bottom) / CHANNELS;
    ctx.fillStyle = this.colors.bg; ctx.fillRect(0, 0, w, h);
    // time grid: one line per second
    ctx.strokeStyle = this.colors.lineSoft; ctx.lineWidth = 1;
    for (let s = 0; this.grid && s <= this.seconds; s++) {
      const x = left + plotW - (s / this.seconds) * plotW;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, h - bottom); ctx.stroke();
    }
    ctx.fillStyle = this.colors.ink3; ctx.font = '11px Geist, Inter, sans-serif'; ctx.textAlign = 'center';
    for (let s = 0; s <= this.seconds; s += this.seconds >= 12 ? 2 : 1) {
      const x = left + plotW - (s / this.seconds) * plotW;
      ctx.fillText(s === 0 ? 'now' : `-${s}s`, x, h - 7);
    }
    const buf = this.source === 'raw' ? rings.raw : rings.filt;
    const size = rings.size, start = (rings.write - n + size) % size;
    const step = Math.max(1, Math.floor(n / plotW));          // never draw more points than pixels
    let carRef = null;
    if (this.car && this.source !== 'raw' && n > 1) {          // average reference: minus the mean of the channels with contact
      const use = []; for (let ch = 0; ch < CHANNELS; ch++) if (!this.quality || !isBad(this.quality[ch])) use.push(ch);
      if (use.length >= 3) { carRef = new Float64Array(Math.ceil(n / step)); for (let i = 0, j = 0; i < n; i += step, j++) { const k = (start + i) % size; let s = 0; for (const ch of use) s += buf[ch][k]; carRef[j] = s / use.length; } }
    }
    for (let ch = 0; ch < CHANNELS; ch++) {
      const y0 = top + laneH * (ch + 0.5);
      ctx.strokeStyle = this.colors.line; ctx.beginPath(); ctx.moveTo(left, Math.round(top + laneH * (ch + 1)) + 0.5); ctx.lineTo(w - right, Math.round(top + laneH * (ch + 1)) + 0.5); ctx.stroke();
      const q = this.quality ? this.quality[ch] : null;
      ctx.textAlign = 'left'; ctx.fillStyle = this.colors.ink; ctx.font = '600 12px Geist, Inter, sans-serif';
      ctx.fillText(XR_FACE[ch].id, 14, y0 - 2);
      ctx.fillStyle = this.colors.ink3; ctx.font = '11px Geist, Inter, sans-serif';
      ctx.fillText(XR_FACE[ch].place, 14, y0 + 12);
      if (q && q.status !== 'wait') { ctx.textAlign = 'right'; ctx.fillStyle = this.colors.dim; ctx.fillText(`${q.rms.toFixed(0)} µV`, left - 10, y0 + 4); }
      if (n < 2 || (this.visible && !this.visible[ch])) continue;
      const arr = buf[ch];
      let mean = 0;
      if (this.source === 'raw') { for (let i = 0; i < n; i += step) mean += arr[(start + i) % size]; mean /= Math.ceil(n / step); }
      const gain = (laneH * 0.45) / this.scaleUv;
      const bad = q && isBad(q);
      ctx.strokeStyle = bad ? this.colors.traceBad : (this.channelColors ? this.channelColors[ch] : this.colors.trace);
      ctx.lineWidth = this.lineWidth; ctx.beginPath();
      for (let i = 0, j = 0; i < n; i += step, j++) {
        const v = arr[(start + i) % size] - mean - (carRef ? carRef[j] : 0);
        const x = left + (i / n) * plotW, y = y0 - Math.max(-laneH * 0.5, Math.min(laneH * 0.5, v * gain));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // marks (recording events) as thin amber lines
    const tNow = nowMs, span = this.seconds * 1000;
    for (const m of this.marks) {
      const age = tNow - m.t; if (age < 0 || age > span) continue;
      const x = left + plotW - (age / span) * plotW;
      ctx.strokeStyle = this.colors.mark; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, h - bottom); ctx.stroke();
      ctx.fillStyle = this.colors.mark; ctx.textAlign = 'left'; ctx.font = '11px Geist, Inter, sans-serif'; ctx.fillText(m.text, x + 4, top + 11);
    }
    // scale legend (top right, out of the way of the time axis)
    ctx.textAlign = 'right'; ctx.fillStyle = this.colors.ink3; ctx.font = '11px Geist, Inter, sans-serif';
    ctx.fillText(`±${this.scaleUv} µV per lane · ${this.source === 'raw' ? 'raw, mean removed' : this.car ? 'filtered, average reference' : 'filtered'}`, w - right, top + 2);
  }
}
