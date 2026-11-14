// Spectrum view: PSD of every channel (log scale, 0–60 Hz) with the bands shaded, and the relative
// band powers of the forehead average as bars on the right.
import { CHANNELS } from './ble.js';
import { BANDS } from './fft.js';
import { XR_FACE } from './scope.js';

export class SpectrumView {
  constructor(canvas, engine) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.engine = engine;
    this.visible = new Array(CHANNELS).fill(true); this.maxHz = 60; this.channelColors = null; this.lineWidth = 1;
    this._resize = this._resize.bind(this); window.addEventListener('resize', this._resize); this._resize();
  }
  _resize() {
    const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.w = r.width; this.h = r.height;
  }
  draw() {
    const { ctx, w, h } = this, f = this.engine.features, fft = this.engine.fft;
    ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, w, h);
    const left = 56, top = 24, bottom = 28, gap = 32, barsW = Math.min(300, w * 0.28);
    const plotW = w - left - gap - barsW - 16, plotH = h - top - bottom;
    const fx = (hz) => left + (hz / this.maxHz) * plotW;
    const lo = 1e-2, hi = 1e4;                               // µV²/Hz
    const fy = (p) => top + plotH - (Math.log10(Math.max(lo, Math.min(hi, p))) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * plotH;
    // band shading + labels
    ctx.font = '11px Geist, Inter, sans-serif'; ctx.textAlign = 'center';
    BANDS.forEach((b, i) => {
      const x0 = fx(b.lo), x1 = fx(Math.min(b.hi, this.maxHz));
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)'; ctx.fillRect(x0, top, x1 - x0, plotH);
      ctx.fillStyle = '#8C8C8C'; ctx.fillText(b.label, (x0 + x1) / 2, top - 8);
    });
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let hz = 0; hz <= this.maxHz; hz += 10) { ctx.beginPath(); ctx.moveTo(Math.round(fx(hz)) + 0.5, top); ctx.lineTo(Math.round(fx(hz)) + 0.5, top + plotH); ctx.stroke(); ctx.fillStyle = '#8C8C8C'; ctx.fillText(`${hz} Hz`, fx(hz), h - 10); }
    ctx.textAlign = 'right';
    for (let e = -2; e <= 4; e++) { const y = fy(10 ** e); ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(left + plotW, Math.round(y) + 0.5); ctx.stroke(); ctx.fillText(e < 0 ? `${10 ** e}` : `${10 ** e}`, left - 6, y + 4); }
    ctx.save(); ctx.translate(14, top + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('µV² / Hz', 0, 0); ctx.restore();
    // PSD lines
    const n = fft.half, df = fft.fs / fft.n, maxBin = Math.min(n, Math.round(this.maxHz / df));
    for (let ch = 0; ch < CHANNELS; ch++) {
      if (!this.visible[ch]) continue;
      const psd = f.psd[ch];
      ctx.strokeStyle = this.channelColors ? this.channelColors[ch] : `rgba(224,224,224,${0.35 + 0.5 * (ch / (CHANNELS - 1))})`; ctx.lineWidth = this.lineWidth; ctx.beginPath();
      for (let i = 1; i <= maxBin; i++) { const x = fx(i * df), y = fy(psd[i]); if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // legend
    ctx.textAlign = 'left'; let lx = left + 8;
    for (let ch = 0; ch < CHANNELS; ch++) { ctx.fillStyle = !this.visible[ch] ? '#4a4a4a' : this.channelColors ? this.channelColors[ch] : `rgba(224,224,224,${0.35 + 0.5 * (ch / 7)})`; ctx.fillText(XR_FACE[ch].id, lx, top + 14); lx += 34; }
    // band bars (relative, forehead average)
    const bx = left + plotW + gap, bw = barsW;
    ctx.fillStyle = '#8C8C8C'; ctx.textAlign = 'left'; ctx.fillText('Relative power · forehead average', bx, top - 8);
    const rowH = Math.min(44, plotH / BANDS.length);
    BANDS.forEach((b, i) => {
      const y = top + i * rowH, v = f.rel[b.id] || 0;
      ctx.fillStyle = '#E0E0E0'; ctx.font = '600 12px Geist, Inter, sans-serif'; ctx.fillText(b.label, bx, y + 14);
      ctx.fillStyle = '#B8B8B8'; ctx.font = '11px Geist, Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${(v * 100).toFixed(0)} %`, bx + bw, y + 14); ctx.textAlign = 'left';
      ctx.fillStyle = '#262626'; ctx.fillRect(bx, y + 20, bw, 6);
      ctx.fillStyle = '#E0E0E0'; ctx.fillRect(bx, y + 20, bw * Math.max(0, Math.min(1, v)), 6);
    });
    const y = top + BANDS.length * rowH + 8;
    ctx.fillStyle = '#8C8C8C'; ctx.font = '11px Geist, Inter, sans-serif';
    ctx.fillText(`Dominant ${f.avg.dominant.toFixed(1)} Hz · total ${f.avg.total.toFixed(0)} µV²`, bx, y + 12);
  }
}
