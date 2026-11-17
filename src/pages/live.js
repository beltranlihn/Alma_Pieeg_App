// Live: waves, spectrum or indices in real time, with the display settings and the recorder.
import { CHANNELS } from '../ble.js';
import { Scope, XR_FACE } from '../scope.js';
import { SpectrumView } from '../spectrum.js';
import { BandsView } from '../bands.js';
import { INDICES } from '../indices.js';
import { STATUS } from '../quality.js';
import { PALETTES, PALETTE_BY_ID, DEFAULT_CUSTOM } from '../palettes.js';
import { RESULT_METHODS, METHOD_BY_ID } from '../session.js';
import { SIGNALS, SIGNAL_BY_ID } from '../signals.js';
import { INDEX_COLOR, signalColor, FAA_COLOR, BAND_COLOR } from '../colors.js';

// Two more cards next to the band-ratio indices (0.8): they are not ratios of the forehead average.
const EXTRA = [
  { id: 'faa', label: 'Alpha asymmetry', formula: 'ln α right − ln α left', source: 'PiEEG Glitching Reality · forehead, left vs right', color: FAA_COLOR, norm: (f) => f.faaNorm, raw: (f) => f.faa, rawLabel: 'ln' },
  { id: 'surge', label: 'Beta surge', formula: 'β above its last ~20 s', source: 'PiEEG Premeditatio Malorum · use Recovery in the results', color: BAND_COLOR.beta, norm: (f) => f.betaSurge, raw: (f) => f.betaSurge, rawLabel: '0–1' },
];

const STATUS_DOT = { good: 'on', fair: 'warn', poor: 'bad', railed: 'bad', none: '', wait: '' };

export function mountLive(root, { engine, ui, saveConfig }) {
  root.innerHTML = `
    <section class="live">
      <div class="live-main">
        <div class="subtabs" id="views">
          <button class="subtab" data-view="bands">Bands</button>
          <button class="subtab" data-view="waves">Waves</button>
          <button class="subtab" data-view="spectrum">Spectrum</button>
          <button class="subtab" data-view="indices">Indices</button>
          <div class="subtabs-right" id="liveStatus"></div>
        </div>
        <div class="results" id="results"></div>
        <div class="view" id="viewWaves"><canvas id="scope"></canvas></div>
        <div class="view hidden" id="viewBands"><canvas id="bands"></canvas></div>
        <div class="view hidden" id="viewSpectrum"><canvas id="spectrum"></canvas></div>
        <div class="view hidden" id="viewIndices"><div class="indices" id="indices"></div></div>
        <div class="empty" id="liveEmpty"><b>Nothing streaming</b><div>Connect on Home, or start the Simulator.</div></div>
      </div>
      <aside class="live-side">
        <div data-for="bands">
          <h2>Bands and indices</h2>
          <div class="rows contact" id="laneRows"></div>
        </div>
        <div data-for="indices">
          <h2>Indices</h2>
          <div class="rows contact" id="indexRows"></div>
        </div>
        <div data-for="waves spectrum">
          <h2>Channels</h2>
          <div class="rows contact" id="liveChannels"></div>
        </div>
        <div data-for="waves">
          <h2>Waves</h2>
          <div class="rows">
            <div class="row"><div class="k">Window</div><div class="seg-group" data-set="seconds"><button class="seg" data-v="4">4 s</button><button class="seg on" data-v="8">8 s</button><button class="seg" data-v="16">16 s</button></div></div>
            <div class="row"><div class="k">Scale</div><div class="seg-group" data-set="scale"><button class="seg" data-v="50">50</button><button class="seg on" data-v="100">100</button><button class="seg" data-v="200">200</button><button class="seg" data-v="500">500 µV</button></div></div>
            <div class="row"><div class="k">Trace</div><div class="seg-group" data-set="source"><button class="seg on" data-v="filt">Filtered</button><button class="seg" data-v="raw">Raw</button></div></div>
            <div class="row"><div class="k">Time grid</div><div class="seg-group" data-set="grid"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
          </div>
        </div>
        <div data-for="spectrum">
          <h2>Spectrum</h2>
          <div class="rows">
            <div class="row"><div class="k">Range</div><div class="seg-group" data-set="maxHz"><button class="seg" data-v="30">0–30 Hz</button><button class="seg on" data-v="60">0–60 Hz</button><button class="seg" data-v="100">0–100 Hz</button></div></div>
          </div>
        </div>
        <div data-for="waves spectrum">
          <h2>Channel colours</h2>
          <div class="rows">
            <div class="row"><div class="k">Palette</div><select id="palette" style="width:150px">${PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
            <div class="row" id="customRow"><div class="k">Custom</div><div class="swatches" id="swatches"></div></div>
          </div>
        </div>
        <div data-for="bands waves spectrum">
          <h2>Lines</h2>
          <div class="rows">
            <div class="row"><div class="k">Line width</div><div class="seg-group" data-set="lineWidth"><button class="seg on" data-v="1">1</button><button class="seg" data-v="2">2</button><button class="seg" data-v="3">3 px</button></div></div>
          </div>
        </div>
        <div data-for="waves spectrum">
          <h2>Filters</h2>
          <div class="rows">
            <div class="row"><div class="k">Band-pass 1–40 Hz</div><div class="seg-group" data-set="bandpass"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
            <div class="row"><div class="k">Notch</div><div class="seg-group" data-set="notch"><button class="seg on" data-v="50">50 Hz</button><button class="seg" data-v="60">60 Hz</button><button class="seg" data-v="0">Off</button></div></div>
            <div class="row"><div class="k">Spike rejection</div><div class="seg-group" data-set="hampel"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
            <div class="row" title="Average reference: each channel minus the mean of the channels with contact. Use it when the reference is noisy: what all channels share goes away (also some EEG that every channel shares)."><div class="k">Reference</div><div class="seg-group" data-set="car"><button class="seg on" data-v="0">As recorded</button><button class="seg" data-v="1">Average</button></div></div>
          </div>
        </div>

        <div id="calPanel"></div>
        <h2>Results</h2>
        <div class="rows" id="resultsCfg"></div>
        <h2>Last session</h2>
        <div class="rows" id="lastSession"><div class="row"><div class="k">—</div></div></div>
        <div class="hint">Saved in Documents / EEG Alma Center / sessions.</div>
      </aside>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const scope = new Scope($('scope'), engine.rings);
  const spectrum = new SpectrumView($('spectrum'), engine);
  const bands = new BandsView($('bands'), engine);
  let view = ui.liveView || 'bands';
  ui.liveView = view;

  // ── settings (persisted) ──
  const settings = Object.assign({ seconds: 8, scale: 100, source: 'filt', bandpass: 1, notch: 50, hampel: 1, car: 0, palette: 'mono', custom: [...DEFAULT_CUSTOM], lineWidth: 1, grid: 1, maxHz: 60 }, ui.display || {});
  function applySettings() {
    scope.seconds = settings.seconds; scope.scaleUv = settings.scale; scope.source = settings.source;
    const pal = PALETTE_BY_ID[settings.palette] || PALETTES[0];
    const colors = pal.colors || settings.custom;
    scope.channelColors = settings.palette === 'mono' ? null : colors; spectrum.channelColors = settings.palette === 'mono' ? null : colors;
    spectrum.maxHz = settings.maxHz;
    scope.lineWidth = settings.lineWidth; spectrum.lineWidth = settings.lineWidth; bands.lineWidth = settings.lineWidth; bands.colors = settings.palette === 'mono' ? null : colors; scope.grid = !!settings.grid;
    $('customRow').style.display = settings.palette === 'custom' ? '' : 'none';
    engine.setFilters({ hampel: !!settings.hampel, bandpass: !!settings.bandpass, notch: settings.notch, car: !!settings.car }); scope.car = !!settings.car;
    ui.display = { ...settings }; saveConfig();
  }
  root.querySelectorAll('.seg-group').forEach((group) => {
    const key = group.dataset.set;
    group.querySelectorAll('button').forEach((btn) => {
      if (String(settings[key]) === btn.dataset.v) { group.querySelectorAll('button').forEach((b) => b.classList.remove('on')); btn.classList.add('on'); }
      btn.addEventListener('click', () => { group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn)); const v = btn.dataset.v; settings[key] = isNaN(+v) ? v : +v; applySettings(); });
    });
  });
  $('palette').value = settings.palette;
  $('palette').addEventListener('change', (e) => { settings.palette = e.target.value; applySettings(); });
  const sw = $('swatches');
  settings.custom.forEach((c, ch) => {
    const input = document.createElement('input'); input.type = 'color'; input.value = c; input.title = XR_FACE[ch].id;
    input.addEventListener('input', () => { settings.custom[ch] = input.value; applySettings(); });
    sw.appendChild(input);
  });
  applySettings();

  // ── views ──
  function setView(v) {
    view = v; ui.liveView = v; saveConfig();
    root.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('viewWaves').classList.toggle('hidden', v !== 'waves'); $('viewBands').classList.toggle('hidden', v !== 'bands'); $('viewSpectrum').classList.toggle('hidden', v !== 'spectrum'); $('viewIndices').classList.toggle('hidden', v !== 'indices');
    root.querySelectorAll('[data-for]').forEach((el) => { el.style.display = el.dataset.for.split(' ').includes(v) ? '' : 'none'; });
    scope._resize(); spectrum._resize(); bands._resize();
  }
  root.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // ── channels ──
  const visible = new Array(CHANNELS).fill(true);
  const chRows = XR_FACE.map((e, ch) => {
    const row = document.createElement('div'); row.className = 'row clickable';
    row.innerHTML = `<div class="dot"></div><div class="k"><b>${e.id}</b> · ${e.place}</div><div class="v"></div>`;
    row.addEventListener('click', () => { visible[ch] = !visible[ch]; row.classList.toggle('off', !visible[ch]); scope.visible = visible; spectrum.visible = visible; });
    $('liveChannels').appendChild(row); return row;
  });
  scope.visible = visible;

  // ── bands lanes and index cards: click to hide/show (persisted) ──
  const hiddenLanes = new Set(ui.hiddenLanes || []), hiddenIdx = new Set(ui.hiddenIndices || []);
  bands.hidden = hiddenLanes;
  bands.lanes.forEach((l) => {
    const row = document.createElement('div'); row.className = 'row clickable' + (hiddenLanes.has(l.id) ? ' off' : '');
    row.innerHTML = `<i class="swatch" style="background:${l.color}"></i><div class="k"><b>${l.label}</b> · ${l.sub}</div>`;
    row.addEventListener('click', () => { hiddenLanes.has(l.id) ? hiddenLanes.delete(l.id) : hiddenLanes.add(l.id); row.classList.toggle('off', hiddenLanes.has(l.id)); ui.hiddenLanes = [...hiddenLanes]; saveConfig(); });
    $('laneRows').appendChild(row);
  });

  // ── indices ──
  const idxEl = $('indices');
  const idxRows = INDICES.map((i) => {
    const el = document.createElement('div'); el.className = 'index';
    el.innerHTML = `<div class="index-head"><i class="swatch" style="background:${INDEX_COLOR[i.id]}"></i><b>${i.label}</b><span class="formula">${i.formula}</span><span class="raw"></span></div><canvas class="spark"></canvas><div class="meter"><div class="meter-fill" style="background:${INDEX_COLOR[i.id]}"></div><div class="meter-mid"></div></div><div class="index-foot">${i.source} · 0–1 against this person's <span class="norm-mode">last minute</span> · last 60 s</div>`;
    idxEl.appendChild(el); return el;
  });
  const extraRows = EXTRA.map((x) => {
    const el = document.createElement('div'); el.className = 'index';
    el.innerHTML = `<div class="index-head"><i class="swatch" style="background:${x.color}"></i><b>${x.label}</b><span class="formula">${x.formula}</span><span class="raw"></span></div><canvas class="spark"></canvas><div class="meter"><div class="meter-fill" style="background:${x.color}"></div><div class="meter-mid"></div></div><div class="index-foot">${x.source} · last 60 s</div>`;
    idxEl.appendChild(el); return el;
  });
  const blinkEl = document.createElement('div'); blinkEl.className = 'index index-blink';
  blinkEl.innerHTML = `<div class="index-head"><b>Blinks</b><span class="formula">frontal peak-to-peak · adaptive threshold</span><span class="raw"></span></div><div class="index-foot">Count this session · last blink · threshold</div>`;
  idxEl.appendChild(blinkEl);
  const note = document.createElement('div'); note.className = 'hint wide';
  note.textContent = 'These are band-power ratios, computed with the formulas PiEEG uses in its experiences. Focus rises with facial tension; alpha rises when the eyes close. Read them as relative spectral indicators, not as a reading of the mind.';
  idxEl.appendChild(note);
  INDICES.forEach((i, k) => {
    idxRows[k].style.display = hiddenIdx.has(i.id) ? 'none' : '';
    const row = document.createElement('div'); row.className = 'row clickable' + (hiddenIdx.has(i.id) ? ' off' : '');
    row.innerHTML = `<i class="swatch" style="background:${INDEX_COLOR[i.id]}"></i><div class="k"><b>${i.label}</b> · ${i.formula}</div>`;
    row.addEventListener('click', () => { hiddenIdx.has(i.id) ? hiddenIdx.delete(i.id) : hiddenIdx.add(i.id); row.classList.toggle('off', hiddenIdx.has(i.id)); idxRows[k].style.display = hiddenIdx.has(i.id) ? 'none' : ''; ui.hiddenIndices = [...hiddenIdx]; saveConfig(); });
    $('indexRows').appendChild(row);
  });

  const sparkHist = Object.fromEntries(INDICES.map((i) => [i.id, []]).concat(EXTRA.map((x) => [x.id, []])));
  setInterval(() => {
    if (engine.state !== 'streaming') return;
    const push = (id, v) => { const h = sparkHist[id]; h.push(v); if (h.length > 600) h.shift(); };
    for (const i of INDICES) push(i.id, engine.features.idxNorm[i.id]);
    for (const x of EXTRA) push(x.id, x.norm(engine.features));
  }, 100);
  function drawSpark(cv, hist, color) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
    if (hist.length < 2) return;
    g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
    hist.forEach((v, k) => { const x = w - (hist.length - 1 - k) / 599 * w, y = h - 2 - v * (h - 4); k ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  function refreshIndices() {
    const f = engine.features;
    INDICES.forEach((i, k) => {
      const el = idxRows[k], n = f.idxNorm[i.id], r = f.idx[i.id];
      el.querySelector('.meter-fill').style.width = `${(n * 100).toFixed(1)}%`;
      el.querySelector('.raw').innerHTML = `<b>${n.toFixed(2)}</b> <span>ratio ${r.toFixed(2)}</span>`;
      drawSpark(el.querySelector('.spark'), sparkHist[i.id], INDEX_COLOR[i.id]);
    });
    EXTRA.forEach((x, k) => {
      const el = extraRows[k], n = x.norm(f), r = x.raw(f);
      el.querySelector('.meter-fill').style.width = `${(n * 100).toFixed(1)}%`;
      el.querySelector('.raw').innerHTML = `<b>${n.toFixed(2)}</b> <span>${x.rawLabel} ${r.toFixed(2)}</span>`;
      drawSpark(el.querySelector('.spark'), sparkHist[x.id], x.color);
    });
    const b = engine.blink;
    blinkEl.querySelector('.raw').textContent = `${b.count} · ${b.lastBlink ? `${((performance.now() - b.lastBlink) / 1000).toFixed(0)} s ago` : '—'} · ${b.threshold.toFixed(0)} µV`;
  }

  // ── session ──
  const short = (s) => s.id.startsWith('idx.') ? s.label.split(' · ')[0] : s.id.startsWith('raw.') ? `${s.label.split(' · ')[0]} (raw)` : s.id.startsWith('rel.') ? `${s.label.split(' · ')[0]} relative` : s.id.startsWith('abs.') ? `${s.label.split(' · ')[0]} absolute` : s.label.split(' · ').slice(0, 2).join(' · ');
  const signalChoices = SIGNALS.filter((s) => s.kind !== 'event' && !s.id.startsWith('result') && !s.id.startsWith('session') && !s.id.startsWith('ch') && !s.id.startsWith('strap')).map((s) => `<option value="${s.id}">${short(s)}</option>`).join('');
  const cfgEl = $('resultsCfg');
  engine.session.results = (ui.results || engine.session.results).map((r) => ({ ...r }));
  engine.session.results.forEach((r, k) => {
    const row = document.createElement('div'); row.className = 'row result-row';
    row.innerHTML = `<div class="k"><b>${k + 1}</b></div><select class="sig">${signalChoices}</select><select class="method">${RESULT_METHODS.map((m) => `<option value="${m.id}" title="${m.help}">${m.label}</option>`).join('')}</select>`;
    const sig = row.querySelector('.sig'), method = row.querySelector('.method'); sig.value = r.signal; method.value = r.method;
    sig.addEventListener('change', () => { r.signal = sig.value; ui.results = engine.session.results; saveConfig(); renderResults(); });
    method.addEventListener('change', () => { r.method = method.value; ui.results = engine.session.results; saveConfig(); renderResults(); });
    cfgEl.appendChild(row);
  });
  const resultsEl = $('results');
  function renderResults() {
    const s = engine.session, f = engine.features, src = s.active ? s : engine.liveLog, streaming = engine.state === 'streaming';
    resultsEl.innerHTML = s.results.map((r, k) => {
      const sig = SIGNAL_BY_ID[r.signal], m = METHOD_BY_ID[r.method];
      const name = sig ? sig.label.split(' · ')[0] : r.signal;
      const val = streaming && src.rows.length >= 20 ? (m ? m.fmt(src.live[k] || 0) : '—') : '—';
      return `<div class="result" style="--c:${signalColor(r.signal)}"><div class="result-name"><i class="swatch"></i>${name}<span>${m ? m.label : ''}</span></div><div class="result-value${val === '—' ? ' is-empty' : ''}">${val}</div></div>`;
    }).join('') + `<div class="result result-time"><div class="result-name">${s.active ? 'Session' : 'Live'}<span>${s.active ? (s.participant || 'no name') : 'since connected · no session'}</span></div><div class="result-value">${s.active ? fmtClock(s.seconds) : streaming ? fmtClock(src.rows.length / 10) : '—'}</div></div>`;
  }
  async function toggleRecord() {
    if (engine.state !== 'streaming') return;
    if (engine.session.active) {
      const r = await engine.endSession();
      const lines = [`<div class="row"><div class="k">${engine.session.participant || 'no name'}</div><div class="v">${fmtClock(engine.session.seconds)}</div></div>`]
        .concat(engine.session.results.map((x, k) => `<div class="row"><div class="k">${SIGNAL_BY_ID[x.signal]?.label.split(' · ')[0] || x.signal} · ${METHOD_BY_ID[x.method]?.label || ''}</div><div class="v">${METHOD_BY_ID[x.method]?.fmt(engine.session.live[k] || 0)}</div></div>`))
        .concat([`<div class="row"><div class="k dim" title="${(r.paths || []).join('\n')}">${r.name}.*</div><div class="v"><button class="seg" id="openFolder">Open folder</button></div></div>`]);
      $('lastSession').innerHTML = lines.join('');
      $('lastSession').querySelector('#openFolder')?.addEventListener('click', () => window.alma.openSessionsFolder());
    } else { engine.startSession(document.getElementById('participant').value.trim(), document.getElementById('notes').value.trim()); scope.marks = []; }
    refreshRec(); renderResults();
  }
  window.almaToggleSession = toggleRecord;
  function refreshRec() {
    const rec = engine.recorder, on = engine.session.active, bar = document.getElementById('btnSession');
    bar.innerHTML = on ? 'End session <kbd>R</kbd>' : 'Start session <kbd>R</kbd>'; bar.className = 'action ' + (on ? 'rec' : 'primary');
    bar.disabled = engine.state !== 'streaming'; document.getElementById('btnMark').disabled = !on;
    document.getElementById('sessionClock').textContent = on ? fmtClock(engine.session.seconds) : '';
    document.getElementById('sessionMeta').textContent = on ? `${rec.rows.length} samples · ${rec.marks.length} marks` : '';
  }
  engine.addEventListener('session', () => { if (!root.classList.contains('hidden')) renderResults(); });
  renderResults();
  function mark() { const m = engine.mark('mark'); if (m) scope.marks.push({ t: performance.now(), text: m.text }); }
  document.getElementById('btnSession').addEventListener('click', toggleRecord);
  document.getElementById('btnMark').addEventListener('click', mark);
  const onKey = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key.toLowerCase() === 'm') mark();
    if (e.key.toLowerCase() === 'r') toggleRecord();
  };
  window.addEventListener('keydown', onKey);

  // ── loops ──
  function frame() {
    if (!root.classList.contains('hidden')) {
      if (view === 'waves') scope.draw(performance.now());
      else if (view === 'spectrum') spectrum.draw();
      else if (view === 'bands') bands.draw();
      if (engine.session.active) refreshRec();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  function refreshState() {
    const streaming = engine.state === 'streaming';
    $('liveEmpty').style.display = streaming ? 'none' : '';
    $('liveStatus').innerHTML = streaming ? `<div class="dot on"></div>${engine.deviceName} · ${engine.features.rate.toFixed(0)} /s` : `<div class="dot"></div>${engine.statusText}`;
    refreshRec();
  }
  function refreshQuality() {
    scope.quality = engine.quality;
    XR_FACE.forEach((_, ch) => {
      const q = engine.quality ? engine.quality[ch] : null, s = q ? q.status : 'wait';
      chRows[ch].children[0].className = 'dot ' + STATUS_DOT[s];
      chRows[ch].children[2].textContent = q && s !== 'wait' ? `${q.rms.toFixed(0)} µV` : '';
    });
    refreshState();
  }
  engine.addEventListener('state', refreshState); engine.addEventListener('quality', refreshQuality); engine.addEventListener('recording', refreshRec);
  engine.addEventListener('features', () => { if (view === 'indices' && !root.classList.contains('hidden')) refreshIndices(); });
  engine.addEventListener('calib', () => root.querySelectorAll('.norm-mode').forEach((el) => { el.textContent = engine.calib.result ? 'calibration' : 'last minute'; }));
  engine.addEventListener('blink', () => { if (engine.recorder.active) scope.marks.push({ t: performance.now(), text: 'blink' }); });
  setView(view); refreshState(); refreshQuality();
  engine.addEventListener('state', () => { if (engine.state === 'connecting') bands.reset(); });
  return { onShow: () => { scope._resize(); spectrum._resize(); bands._resize(); } };
}

function fmtClock(sec) { const m = Math.floor(sec / 60), r = Math.floor(sec % 60); return `${m}:${String(r).padStart(2, '0')}`; }
