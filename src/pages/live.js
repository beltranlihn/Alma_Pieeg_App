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

const STATUS_DOT = { good: 'on', fair: 'warn', poor: 'bad', railed: 'bad', none: '', wait: '' };

export function mountLive(root, { engine, ui, saveConfig }) {
  root.innerHTML = `
    <section class="live">
      <div class="live-main">
        <div class="subtabs" id="views">
          <button class="subtab on" data-view="waves">Waves</button>
          <button class="subtab" data-view="bands">Bands</button>
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
        <h2>Channels</h2>
        <div class="rows contact" id="liveChannels"></div>


        <div id="wavesSettings">
          <h2>Waves</h2>
          <div class="rows">
            <div class="row"><div class="k">Window</div><div class="seg-group" data-set="seconds"><button class="seg" data-v="4">4 s</button><button class="seg on" data-v="8">8 s</button><button class="seg" data-v="16">16 s</button></div></div>
            <div class="row"><div class="k">Scale</div><div class="seg-group" data-set="scale"><button class="seg" data-v="50">50</button><button class="seg on" data-v="100">100</button><button class="seg" data-v="200">200</button><button class="seg" data-v="500">500 µV</button></div></div>
            <div class="row"><div class="k">Trace</div><div class="seg-group" data-set="source"><button class="seg on" data-v="filt">Filtered</button><button class="seg" data-v="raw">Raw</button></div></div>
          </div>
        </div>

        <h2>Filters</h2>
        <div class="rows">
          <div class="row"><div class="k">Band-pass 1–40 Hz</div><div class="seg-group" data-set="bandpass"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
          <div class="row"><div class="k">Notch</div><div class="seg-group" data-set="notch"><button class="seg on" data-v="50">50 Hz</button><button class="seg" data-v="60">60 Hz</button><button class="seg" data-v="0">Off</button></div></div>
          <div class="row"><div class="k">Spike rejection</div><div class="seg-group" data-set="hampel"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
        </div>

        <h2>Appearance</h2>
        <div class="rows">
          <div class="row"><div class="k">Palette</div><select id="palette" style="width:150px">${PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
          <div class="row" id="customRow"><div class="k">Channel colours</div><div class="swatches" id="swatches"></div></div>
          <div class="row"><div class="k">Line width</div><div class="seg-group" data-set="lineWidth"><button class="seg on" data-v="1">1</button><button class="seg" data-v="1.5">1.5</button><button class="seg" data-v="2">2 px</button></div></div>
          <div class="row"><div class="k">Time grid</div><div class="seg-group" data-set="grid"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
        </div>

        <h2>Session</h2>
        <div class="stack">
          <input type="text" id="participant" placeholder="Participant name">
          <input type="text" id="notes" placeholder="Notes (piece, condition, anything)">
          <div class="two"><button id="btnRecord" class="primary" disabled>Start session <kbd>R</kbd></button><button id="btnMark" disabled>Mark <kbd>M</kbd></button></div>
          <div class="rows">
            <div class="row"><div class="k">Elapsed</div><div class="v" id="recTime">—</div></div>
            <div class="row"><div class="k">Samples · marks</div><div class="v" id="recSamples">—</div></div>
          </div>
        </div>
        <h2>Results</h2>
        <div class="rows" id="resultsCfg"></div>
        <div class="hint">Each result is one signal and one way of reading it. They update live, go out by OSC as result1–3, and are written in the summary.</div>
        <h2>Last session</h2>
        <div class="rows" id="lastSession"><div class="row"><div class="k">—</div></div></div>
        <div class="hint">Three files per session in Documents / EEG Alma Center / sessions: raw µV, features at 10 Hz, summary.</div>
      </aside>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const scope = new Scope($('scope'), engine.rings);
  const spectrum = new SpectrumView($('spectrum'), engine);
  const bands = new BandsView($('bands'), engine);
  let view = ui.liveView || 'waves';
  ui.liveView = view;

  // ── settings (persisted) ──
  const settings = Object.assign({ seconds: 8, scale: 100, source: 'filt', bandpass: 1, notch: 50, hampel: 1, palette: 'mono', custom: [...DEFAULT_CUSTOM], lineWidth: 1, grid: 1 }, ui.display || {});
  function applySettings() {
    scope.seconds = settings.seconds; scope.scaleUv = settings.scale; scope.source = settings.source;
    const pal = PALETTE_BY_ID[settings.palette] || PALETTES[0];
    const colors = pal.colors || settings.custom;
    scope.channelColors = settings.palette === 'mono' ? null : colors; spectrum.channelColors = settings.palette === 'mono' ? null : colors;
    scope.lineWidth = settings.lineWidth; spectrum.lineWidth = settings.lineWidth; bands.lineWidth = settings.lineWidth; bands.colors = settings.palette === 'mono' ? null : colors; scope.grid = !!settings.grid;
    $('customRow').style.display = settings.palette === 'custom' ? '' : 'none';
    engine.setFilters({ hampel: !!settings.hampel, bandpass: !!settings.bandpass, notch: settings.notch });
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
    $('wavesSettings').style.display = v === 'waves' ? '' : 'none';
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

  // ── indices ──
  const idxEl = $('indices');
  const idxRows = INDICES.map((i) => {
    const el = document.createElement('div'); el.className = 'index';
    el.innerHTML = `<div class="index-head"><b>${i.label}</b><span class="formula">${i.formula}</span><span class="raw"></span></div><div class="meter"><div class="meter-fill"></div><div class="meter-mid"></div></div><div class="index-foot">${i.source} · 0–1 against this person's last minute</div>`;
    idxEl.appendChild(el); return el;
  });
  const blinkEl = document.createElement('div'); blinkEl.className = 'index index-blink';
  blinkEl.innerHTML = `<div class="index-head"><b>Blinks</b><span class="formula">frontal peak-to-peak · adaptive threshold</span><span class="raw"></span></div><div class="index-foot">Count this session · last blink · threshold</div>`;
  idxEl.appendChild(blinkEl);
  const note = document.createElement('div'); note.className = 'hint wide';
  note.textContent = 'These are band-power ratios, computed with the formulas PiEEG uses in its experiences. Focus rises with facial tension; alpha rises when the eyes close. Read them as relative spectral indicators, not as a reading of the mind.';
  idxEl.appendChild(note);

  function refreshIndices() {
    const f = engine.features;
    INDICES.forEach((i, k) => {
      const el = idxRows[k], n = f.idxNorm[i.id], r = f.idx[i.id];
      el.querySelector('.meter-fill').style.width = `${(n * 100).toFixed(1)}%`;
      el.querySelector('.raw').textContent = `${n.toFixed(2)} · raw ${r.toFixed(3)}`;
    });
    const b = engine.blink;
    blinkEl.querySelector('.raw').textContent = `${b.count} · ${b.lastBlink ? `${((performance.now() - b.lastBlink) / 1000).toFixed(0)} s ago` : '—'} · ${b.threshold.toFixed(0)} µV`;
  }

  // ── session ──
  const signalChoices = SIGNALS.filter((s) => s.kind !== 'event' && !s.id.startsWith('result') && !s.id.startsWith('session') && !s.id.startsWith('ch')).map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  const cfgEl = $('resultsCfg');
  engine.session.results = (ui.results || engine.session.results).map((r) => ({ ...r }));
  engine.session.results.forEach((r, k) => {
    const row = document.createElement('div'); row.className = 'row result-row';
    row.innerHTML = `<div class="k"><b>${k + 1}</b></div><select class="sig">${signalChoices}</select><select class="method">${RESULT_METHODS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select>`;
    const sig = row.querySelector('.sig'), method = row.querySelector('.method'); sig.value = r.signal; method.value = r.method;
    sig.addEventListener('change', () => { r.signal = sig.value; ui.results = engine.session.results; saveConfig(); renderResults(); });
    method.addEventListener('change', () => { r.method = method.value; ui.results = engine.session.results; saveConfig(); renderResults(); });
    cfgEl.appendChild(row);
  });
  const resultsEl = $('results');
  function renderResults() {
    const s = engine.session, f = engine.features;
    resultsEl.innerHTML = s.results.map((r, k) => {
      const sig = SIGNAL_BY_ID[r.signal], m = METHOD_BY_ID[r.method];
      const name = sig ? sig.label.split(' · ')[0] : r.signal;
      const val = s.active || s.summary ? (m ? m.fmt(s.live[k] || 0) : '—') : '—';
      return `<div class="result"><div class="result-name">${name}<span>${m ? m.label.split(' · ')[0].split(' (')[0] : ''}</span></div><div class="result-value">${val}</div></div>`;
    }).join('') + `<div class="result result-time"><div class="result-name">Session<span>${s.participant || (s.active ? 'no name' : '')}</span></div><div class="result-value">${s.active || s.summary ? fmtClock(s.seconds) : '—'}</div></div>`;
  }
  async function toggleRecord() {
    if (engine.state !== 'streaming') return;
    if (engine.session.active) {
      const r = await engine.endSession();
      const lines = [`<div class="row"><div class="k">${engine.session.participant || 'no name'}</div><div class="v">${fmtClock(engine.session.seconds)}</div></div>`]
        .concat(engine.session.results.map((x, k) => `<div class="row"><div class="k">${SIGNAL_BY_ID[x.signal]?.label.split(' · ')[0] || x.signal} · ${METHOD_BY_ID[x.method]?.label.split(' · ')[0] || ''}</div><div class="v">${METHOD_BY_ID[x.method]?.fmt(engine.session.live[k] || 0)}</div></div>`))
        .concat([`<div class="row"><div class="k dim" title="${(r.paths || []).join('\n')}">${r.name}.*</div><div class="v"><button class="seg" id="openFolder">Open folder</button></div></div>`]);
      $('lastSession').innerHTML = lines.join('');
      $('lastSession').querySelector('#openFolder')?.addEventListener('click', () => window.alma.openSessionsFolder());
    } else { engine.startSession($('participant').value.trim(), $('notes').value.trim()); scope.marks = []; }
    refreshRec(); renderResults();
  }
  function refreshRec() {
    const rec = engine.recorder, on = engine.session.active;
    $('btnRecord').innerHTML = on ? 'End session <kbd>R</kbd>' : 'Start session <kbd>R</kbd>'; $('btnRecord').className = on ? 'rec' : 'primary';
    $('btnRecord').disabled = engine.state !== 'streaming'; $('btnMark').disabled = !on;
    $('recTime').textContent = on ? fmtClock(engine.session.seconds) : '—';
    $('recSamples').textContent = on ? `${rec.rows.length} · ${rec.marks.length}` : '—';
  }
  engine.addEventListener('session', () => { if (!root.classList.contains('hidden')) renderResults(); });
  renderResults();
  function mark() { const m = engine.mark('mark'); if (m) scope.marks.push({ t: performance.now(), text: m.text }); }
  $('btnRecord').addEventListener('click', toggleRecord);
  $('btnMark').addEventListener('click', mark);
  const onKey = (e) => {
    if (root.classList.contains('hidden')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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
  engine.addEventListener('blink', () => { if (engine.recorder.active) scope.marks.push({ t: performance.now(), text: 'blink' }); });
  setView(view); refreshState(); refreshQuality();
  engine.addEventListener('state', () => { if (engine.state === 'connecting') bands.reset(); });
  return { onShow: () => { scope._resize(); spectrum._resize(); bands._resize(); } };
}

function fmtClock(sec) { const m = Math.floor(sec / 60), r = Math.floor(sec % 60); return `${m}:${String(r).padStart(2, '0')}`; }
