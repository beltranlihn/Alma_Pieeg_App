// Sessions: the saved sessions, newest first. Open one to see the whole session at once (the features log at
// 10 Hz as lines, the marks, the results and per-signal numbers from the summary), and lay a second session
// over it to compare. Reads the files in Documents / EEG Alma Center / sessions; nothing here writes.
import { SIGNAL_BY_ID } from '../signals.js';
import { METHOD_BY_ID } from '../session.js';
import { signalColor } from '../colors.js';

/** features.csv → { t: [s], cols: { id: Float32Array } } */
export function parseFeaturesCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) return null;
  const head = lines[0].split(','), n = lines.length - 1, cols = {}, t = new Float32Array(n);
  const ti = head.indexOf('elapsed_s');
  head.forEach((h, k) => { if (h !== 'timestamp' && h !== 'elapsed_s') cols[h] = new Float32Array(n).fill(NaN); });
  for (let r = 0; r < n; r++) {
    const v = lines[r + 1].split(',');
    t[r] = ti >= 0 ? +v[ti] : r / 10;
    head.forEach((h, k) => { if (cols[h] && v[k] !== '' && v[k] !== undefined) cols[h][r] = +v[k]; });
  }
  return { t, cols };
}

/** The catalogue signal behind a features column (idx_calm → idx.calm), or null. */
export function signalOfColumn(col) {
  if (SIGNAL_BY_ID[col]) return SIGNAL_BY_ID[col];
  const k = col.indexOf('_'); if (k > 0 && SIGNAL_BY_ID[col.slice(0, k) + '.' + col.slice(k + 1)]) return SIGNAL_BY_ID[col.slice(0, k) + '.' + col.slice(k + 1)];
  if (col === 'dominant_hz') return SIGNAL_BY_ID.dominant;
  return null;
}
const columnOf = (signalId) => signalId.replace('.', '_');
function labelOf(col) { const s = signalOfColumn(col); if (!s) return col; const p = s.label.split(' · '); return s.id.startsWith('raw.') ? `${p[0]} (raw)` : s.id.startsWith('rel.') ? `${p[0]} relative` : s.id.startsWith('abs.') ? `${p[0]} absolute` : p[0]; }
const fmtClock = (sec) => { const m = Math.floor(sec / 60), r = Math.floor(sec % 60); return `${m}:${String(r).padStart(2, '0')}`; };
const fmtDate = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export function mountSessions(root, { ui, saveConfig }) {
  root.innerHTML = `
    <section class="live sessions">
      <div class="live-main">
        <div class="results" id="ssHead"></div>
        <div class="view ss-view">
          <canvas id="ssChart"></canvas>
          <div class="empty" id="ssEmpty"><b>No session open</b><div>Pick one on the right.</div></div>
        </div>
        <div class="ss-bottom">
          <div class="ss-chips" id="ssChips"></div>
          <div class="ss-stats" id="ssStats"></div>
        </div>
      </div>
      <aside class="live-side">
        <h2><span>Sessions<span class="count" id="ssCount"></span></span><span><button class="seg" id="ssReload">Reload</button> <button class="seg" id="ssFolder">Folder</button></span></h2>
        <div class="rows contact" id="ssList"></div>
        <h2>Compare</h2>
        <div class="rows"><div class="row"><div class="k">Lay over</div><select id="ssCompare" style="width:200px"></select></div></div>
        <div class="hint">The second session is drawn dashed, from its own start.</div>
      </aside>
    </section>`;
  const $ = (id) => root.querySelector('#' + id);
  let index = [], current = null, other = null, data = null, otherData = null;
  let chosen = Array.isArray(ui.sessionSignals) && ui.sessionSignals.length ? [...ui.sessionSignals] : null;
  const cache = new Map();

  async function load(base) {
    if (cache.has(base)) return cache.get(base);
    const text = await window.alma.sessionFeatures(base); const d = text ? parseFeaturesCSV(text) : null;
    cache.set(base, d); return d;
  }

  async function refreshIndex() {
    index = await window.alma.sessionsIndex();
    $('ssCount').textContent = index.length ? `${index.length}` : 'none yet';
    const list = $('ssList'); list.innerHTML = '';
    if (!index.length) list.innerHTML = '<div class="row"><div class="k">Sessions appear here after End session.</div></div>';
    for (const s of index) {
      const row = document.createElement('div'); row.className = 'row clickable' + (current && current.base === s.base ? ' sel' : '');
      const flags = [s.calibrated ? 'calibrated' : '', s.face && s.face.gestures && Object.keys(s.face.gestures.gestures || {}).length ? 'gestures' : ''].filter(Boolean).join(' · ');
      row.innerHTML = `<div class="k"><b>${esc(s.participant || 'no name')}</b> · ${fmtDate(s.started_at)}${flags ? ` · <span class="dim">${flags}</span>` : ''}</div><div class="v">${fmtClock(s.duration_sec || 0)}</div>`;
      row.title = s.notes || s.base;
      row.addEventListener('click', () => open(s.base));
      list.appendChild(row);
    }
    $('ssCompare').innerHTML = `<option value="">Nothing</option>` + index.filter((s) => !current || s.base !== current.base).map((s) => `<option value="${esc(s.base)}">${esc(s.participant || 'no name')} · ${fmtDate(s.started_at)}</option>`).join('');
    $('ssCompare').value = other ? other.base : '';
    if (!current && index.length && ui.sessionOpen && index.some((s) => s.base === ui.sessionOpen)) open(ui.sessionOpen);
  }

  async function open(base) {
    current = index.find((s) => s.base === base) || null; if (!current) return;
    ui.sessionOpen = base; saveConfig();
    if (other && other.base === base) { other = null; otherData = null; }
    data = await load(base);
    if (!chosen) chosen = defaultSignals(current, data);
    refreshIndex(); render();
  }
  function defaultSignals(s, d) {
    const fromResults = (s.results || []).map((r) => columnOf(r.signal)).filter((c) => d && d.cols[c]);
    const out = [...new Set(fromResults.length ? fromResults : ['idx_calm', 'idx_focus'].filter((c) => d && d.cols[c]))];
    return out.length ? out : Object.keys(d ? d.cols : {}).slice(0, 2);
  }

  $('ssCompare').addEventListener('change', async (e) => {
    const base = e.target.value; other = base ? index.find((s) => s.base === base) || null : null;
    otherData = other ? await load(other.base) : null; render();
  });
  $('ssReload').addEventListener('click', () => { cache.clear(); refreshIndex(); });
  $('ssFolder').addEventListener('click', () => (current ? window.alma.revealSession(current.base) : window.alma.openSessionsFolder()));

  function render() {
    const s = current;
    $('ssEmpty').style.display = s ? 'none' : '';
    if (!s) { $('ssHead').innerHTML = ''; $('ssChips').innerHTML = ''; $('ssStats').innerHTML = ''; drawChart(); return; }
    const results = (s.results || []).map((r) => { const sig = SIGNAL_BY_ID[r.signal], m = METHOD_BY_ID[r.method]; return `<div class="result" style="--c:${signalColor(r.signal)}"><div class="result-name"><i class="swatch"></i>${sig ? sig.label.split(' · ')[0] : r.signal}<span>${m ? m.label : r.method}</span></div><div class="result-value">${esc(r.label ?? (m ? m.fmt(r.value) : r.value))}</div></div>`; }).join('');
    $('ssHead').innerHTML = `<div class="result result-time"><div class="result-name">${esc(s.participant || 'no name')}<span>${fmtDate(s.started_at)}${s.notes ? ` · ${esc(s.notes)}` : ''}</span></div><div class="result-value">${fmtClock(s.duration_sec || 0)}</div></div>${results}`;
    // chips
    const chips = $('ssChips'); chips.innerHTML = '';
    for (const col of chosen) {
      const sig = signalOfColumn(col), c = document.createElement('button'); c.className = 'seg chip';
      c.innerHTML = `<i class="swatch" style="background:${signalColor(sig ? sig.id : '')}"></i>${esc(labelOf(col))} <span>×</span>`;
      c.title = 'Remove from the chart'; c.addEventListener('click', () => { chosen = chosen.filter((x) => x !== col); persist(); render(); });
      chips.appendChild(c);
    }
    const add = document.createElement('select'); add.className = 'ss-add';
    const cols = data ? Object.keys(data.cols).filter((c) => !chosen.includes(c)) : [];
    add.innerHTML = `<option value="">+ Signal</option>` + cols.map((c) => `<option value="${c}">${esc(labelOf(c))}</option>`).join('');
    add.addEventListener('change', () => { if (add.value) { chosen.push(add.value); persist(); render(); } });
    chips.appendChild(add);
    // per-signal numbers from the summaries
    const sumOf = (sess, col) => (sess && sess.signals ? sess.signals[col] : null);
    const f = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
    $('ssStats').innerHTML = `<div class="ss-row ss-thead"><div>Signal</div><div>Start</div><div>End</div><div>Change</div><div>Mean</div><div>Min</div><div>Max</div>${other ? '<div>Mean · other</div>' : ''}</div>` + chosen.map((col) => {
      const a = sumOf(s, col), b = sumOf(other, col), sig = signalOfColumn(col);
      const ch = a && Math.abs(a.start) > 1e-6 ? `${a.end >= a.start ? '+' : ''}${(100 * (a.end - a.start) / Math.abs(a.start)).toFixed(0)} %` : '—';
      return `<div class="ss-row"><div><i class="swatch" style="background:${signalColor(sig ? sig.id : '')}"></i>${esc(labelOf(col))}</div><div>${f(a?.start)}</div><div>${f(a?.end)}</div><div>${ch}</div><div>${f(a?.mean)}</div><div>${f(a?.min)}</div><div>${f(a?.max)}</div>${other ? `<div>${f(b?.mean)}</div>` : ''}</div>`;
    }).join('');
    drawChart();
  }
  function persist() { ui.sessionSignals = [...chosen]; saveConfig(); }

  const cv = $('ssChart');
  function drawChart() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = '#111111'; g.fillRect(0, 0, w, h);
    if (!current || !data) return;
    const padL = 24, padR = 24, padT = 20, padB = 28, W = w - padL - padR, H = h - padT - padB;
    const dur = Math.max(data.t[data.t.length - 1] || 1, otherData ? otherData.t[otherData.t.length - 1] || 0 : 0, 1);
    const X = (t) => padL + (t / dur) * W;
    // time grid: every minute (or 10 s for short sessions)
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((x) => dur / x <= 12) || 600;   // 4–12 ticks
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.fillStyle = '#6d6d6d'; g.font = '400 11px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.beginPath(); for (let t = 0; t <= dur + 0.01; t += step) { const x = Math.round(X(t)) + 0.5; g.moveTo(x, padT); g.lineTo(x, padT + H); g.fillText(fmtClock(t), x, padT + H + 8); } g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.strokeRect(padL + 0.5, padT + 0.5, W - 1, H - 1);
    // marks (amber, the one place it is used)
    const t0 = Date.parse(current.started_at);
    for (const m of current.marks || []) {
      const raw = +(m.t ?? m.time ?? 0);   // unix seconds (the recorder), unix ms, or seconds from the start
      const tm = raw > 1e11 ? (raw - t0) / 1000 : raw > 1e8 ? raw - t0 / 1000 : raw;
      if (!(tm >= 0 && tm <= dur)) continue;
      const x = Math.round(X(tm)) + 0.5; g.strokeStyle = 'rgba(229,181,103,0.55)'; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + H); g.stroke();
    }
    // lines: each signal in its catalogue range (or its own min–max when it has none)
    const line = (d, col, dashed) => {
      const arr = d.cols[col]; if (!arr) return;
      const sig = signalOfColumn(col);
      let lo = sig ? sig.range[0] : Infinity, hi = sig ? sig.range[1] : -Infinity;
      if (!sig) for (const v of arr) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const span = hi - lo || 1, Y = (v) => padT + H - Math.max(0, Math.min(1, (v - lo) / span)) * H;
      g.strokeStyle = signalColor(sig ? sig.id : ''); g.lineWidth = 1.5; g.globalAlpha = dashed ? 0.55 : 1; g.setLineDash(dashed ? [4, 4] : []);
      g.beginPath(); let pen = false;
      const stride = Math.max(1, Math.floor(arr.length / (W * 1.5)));
      for (let i = 0; i < arr.length; i += stride) { const v = arr[i]; if (!Number.isFinite(v)) { pen = false; continue; } const x = X(d.t[i]), y = Y(v); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1; g.lineWidth = 1;
    };
    if (otherData) for (const col of chosen) line(otherData, col, true);
    for (const col of chosen) line(data, col, false);
  }
  window.addEventListener('resize', () => { if (!root.classList.contains('hidden')) drawChart(); });

  return { onShow: () => { refreshIndex().then(render); } };
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
