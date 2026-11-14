// Bands view: the last minute of every band's relative power (forehead average) and of the indices,
// as lanes with a line each, plus the current value. This is the view for art: what is moving, slowly.
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';

const HISTORY_SEC = 60, HZ = 10;

export class BandsView {
  constructor(canvas, engine) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.engine = engine;
    this.lanes = [
      ...BANDS.map((b) => ({ id: `rel.${b.id}`, label: b.label, sub: 'relative power', get: (f) => f.rel[b.id], fmt: (v) => `${(v * 100).toFixed(0)} %` })),
      ...INDICES.map((i) => ({ id: `idx.${i.id}`, label: i.label, sub: i.formula, get: (f) => f.idxNorm[i.id], fmt: (v) => v.toFixed(2) })),
      { id: 'heart', label: 'Heart', sub: 'beats per minute', get: (f) => f.heart.bpm / 120, fmt: (v) => `${(v * 120).toFixed(0)} bpm` },
    ];
    this.hist = this.lanes.map(() => new Float32Array(HISTORY_SEC * HZ).fill(NaN));
    this.pos = 0; this.colors = null; this.lineWidth = 1;
    setInterval(() => this._sample(), 1000 / HZ);
    this._resize = this._resize.bind(this); window.addEventListener('resize', this._resize); this._resize();
  }
  _resize() {
    const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.w = r.width; this.h = r.height;
  }
  _sample() {
    if (this.engine.state !== 'streaming') return;
    const f = this.engine.features;
    this.lanes.forEach((l, i) => { this.hist[i][this.pos] = l.get(f); });
    this.pos = (this.pos + 1) % (HISTORY_SEC * HZ);
  }
  reset() { for (const h of this.hist) h.fill(NaN); }
  draw() {
    const { ctx, w, h } = this, f = this.engine.features, N = HISTORY_SEC * HZ;
    ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, w, h);
    const left = 170, right = 90, top = 16, bottom = 22, laneGap = 6;
    const laneH = (h - top - bottom) / this.lanes.length, plotW = w - left - right;
    ctx.font = '11px Geist, Inter, sans-serif';
    this.lanes.forEach((l, i) => {
      const y0 = top + i * laneH, y1 = y0 + laneH - laneGap;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(left, Math.round(y1) + 0.5); ctx.lineTo(left + plotW, Math.round(y1) + 0.5); ctx.stroke();
      ctx.fillStyle = '#E0E0E0'; ctx.font = '600 12px Geist, Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(l.label, 16, y0 + 14);
      ctx.fillStyle = '#8C8C8C'; ctx.font = '11px Geist, Inter, sans-serif'; ctx.fillText(l.sub, 16, y0 + 28);
      const hist = this.hist[i];
      ctx.strokeStyle = this.colors ? this.colors[i % this.colors.length] : '#E0E0E0'; ctx.lineWidth = this.lineWidth; ctx.beginPath(); let started = false;
      for (let k = 0; k < N; k++) {
        const v = hist[(this.pos + k) % N]; if (Number.isNaN(v)) { started = false; continue; }
        const x = left + (k / (N - 1)) * plotW, y = y1 - Math.max(0, Math.min(1, v)) * (laneH - laneGap - 4) - 2;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const cur = l.get(f);
      ctx.fillStyle = '#E0E0E0'; ctx.font = '600 13px Geist, Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(Number.isFinite(cur) ? l.fmt(cur) : '—', w - 16, y0 + laneH / 2 + 2);
    });
    ctx.fillStyle = '#8C8C8C'; ctx.font = '11px Geist, Inter, sans-serif'; ctx.textAlign = 'center';
    for (let s = 0; s <= HISTORY_SEC; s += 15) ctx.fillText(s === 0 ? 'now' : `-${s} s`, left + plotW - (s / HISTORY_SEC) * plotW, h - 7);
  }
}
