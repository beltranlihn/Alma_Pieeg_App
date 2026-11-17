// Face: what the mask reads from the face rather than the brain. Three views, as in Live:
//   Gestures  record each gesture 2–3 times; a detector per gesture (PiEEG Face Trainer), live probability
//   Gaze      9 dots → left / centre / right and a rough up / down from the EOG (PiEEG Eye Track)
//   Tension   jaw and brow muscle, 0–1 against this person (PiEEG artifact envelopes)
// Every number here is also a signal in Routing (face.*, gaze.*, tension.*).
import { GESTURES, GESTURE_BY_ID, readiness, recordingSeconds, cyclesForRecording } from '../face.js';
import { GAZE_TOTAL_S } from '../gaze.js';
import { TENSION_GROUPS, RANGE_TOTAL_S, rangeStepAt } from '../tension.js';
import { XR_FACE } from '../scope.js';
import { GAZE_COLOR, TENSION_COLOR, FACE_COLOR } from '../colors.js';
import { cues } from '../tones.js';

const READY_COLOR = { ready: 'var(--toggle-on)', improving: 'var(--auto-ovr)', weak: 'var(--danger)', 'record again': 'var(--ink-3)' };
import { groups, onMontage } from '../montage.js';
// left temple · left forehead · right forehead · right temple, as the montage says
const elecGroups = () => [groups.leftTemples, groups.leftForehead, groups.rightForehead, groups.rightTemples].filter((g) => g.length);

export function mountFace(root, { engine, ui, saveConfig }) {
  root.innerHTML = `
    <section class="live face">
      <div class="live-main">
        <div class="subtabs" id="faceViews">
          <button class="subtab" data-view="gestures">Gestures</button>
          <button class="subtab" data-view="gaze">Gaze</button>
          <button class="subtab" data-view="tension">Tension</button>
          <div class="subtabs-right" id="faceStatus"></div>
        </div>
        <div class="face-cue hidden" id="faceCue">
          <div class="fc-phase"></div><div class="fc-text"></div><div class="fc-steps"></div>
          <button class="seg" id="fcCancel">Cancel <kbd>Esc</kbd></button>
          <div class="fc-bar"><i></i></div>
        </div>
        <div class="view" id="fvGestures"><div class="gesture-list" id="gestureList"></div></div>
        <div class="view hidden" id="fvGaze"><canvas id="gazeCanvas"></canvas></div>
        <div class="view hidden" id="fvTension"><canvas id="tensionCanvas"></canvas></div>
        <div class="empty" id="faceEmpty"><b>Nothing streaming</b><div>Connect on Home, or start the Simulator.</div></div>
      </div>
      <aside class="live-side">
        <div data-for="gestures">
          <h2><span>Gestures<span class="count" id="gCount"></span></span><button class="seg danger" id="gClearAll">Clear all</button></h2>
          <div class="hint">Record each gesture two or three times. Ready from 0.85: the share of moments it got right on a cycle it had not seen.</div>
          <h2>Electrodes</h2>
          <div class="rows contact" id="gElecLegend"></div>
          <div class="hint">Bright = the detector uses that electrode. A gesture the electrodes cannot hear stays weak however many times it is recorded.</div>
        </div>
        <div data-for="gaze">
          <h2><span>Gaze<span class="count" id="zState"></span></span><button class="seg danger" id="zReset">Reset</button></h2>
          <div class="rows">
            <div class="row"><div class="k">Calibrate</div><button class="seg" id="zCal">9 dots · ${Math.round(GAZE_TOTAL_S)} s <kbd>G</kbd></button></div>
            <div class="row"><div class="k">Centre</div><button class="seg" id="zRecentre">Recentre <kbd>0</kbd></button></div>
            <div class="row"><div class="k">Follow slow drift</div><div class="seg-group" id="zFollow"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
          </div>
          <h2>Separation</h2>
          <div class="rows contact" id="zQuality"></div>
          <h2>Live</h2>
          <div class="rows contact" id="zLive"></div>
          <div class="hint">From the eye's own dipole on the temples and forehead. Left, centre and right are dependable; up and down less so. Keep the head still while the dots run.</div>
        </div>
        <div data-for="tension">
          <h2><span>Tension<span class="count" id="tState"></span></span><button class="seg danger" id="tClear">Auto</button></h2>
          <div class="rows">
            <div class="row"><div class="k">Measure the range</div><button class="seg" id="tRange">Relax, clench, brows · ${RANGE_TOTAL_S} s</button></div>
          </div>
          <div class="rows contact" id="tRows"></div>
          <div class="hint">Muscle only (above 20 Hz): blinks and eye movements do not count. On above 0.6, off below 0.4.</div>
        </div>
      </aside>
    </section>
    <div class="gaze-overlay hidden" id="gazeOverlay"><div class="go-cue"></div><div class="go-dot"></div><button class="seg" id="goCancel">Cancel <kbd>Esc</kbd></button></div>`;

  const $ = (id) => root.querySelector('#' + id);
  let view = ui.faceView || 'gestures';

  // ── views ──
  function setView(v) {
    view = v; ui.faceView = v; saveConfig();
    root.querySelectorAll('#faceViews .subtab').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('fvGestures').classList.toggle('hidden', v !== 'gestures'); $('fvGaze').classList.toggle('hidden', v !== 'gaze'); $('fvTension').classList.toggle('hidden', v !== 'tension');
    root.querySelectorAll('[data-for]').forEach((el) => { el.style.display = el.dataset.for.split(' ').includes(v) ? '' : 'none'; });
  }
  root.querySelectorAll('#faceViews .subtab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // ── gestures list ──
  const list = $('gestureList');
  list.innerHTML = `<div class="g-row g-head"><div>Gesture</div><div>Readiness</div><div>Electrodes</div><div>Live</div><div></div></div>`;
  const rows = {};
  for (const g of GESTURES) {
    const row = document.createElement('div'); row.className = 'g-row'; row.dataset.id = g.id; row.title = g.why;
    row.innerHTML = `
      <div class="g-name"><b>${g.label}</b><span>${g.hint}</span></div>
      <div class="g-ready"><div class="meter"><div class="meter-fill"></div></div><span class="g-score"></span></div>
      <div class="g-elec">${elecGroups().map((grp) => `<span>${grp.map((ch) => `<i data-ch="${ch}" title="${XR_FACE[ch].id} · ${XR_FACE[ch].place}"></i>`).join('')}</span>`).join('')}</div>
      <div class="g-live"><div class="meter"><div class="meter-fill" style="background:${FACE_COLOR}"></div></div><div class="dot"></div></div>
      <div class="g-actions"><button class="seg g-rec">Record</button><button class="seg danger g-clear">Clear</button></div>`;
    row.querySelector('.g-rec').addEventListener('click', () => { if (engine.gestures.recording && engine.gestures.rec.id === g.id) engine.cancelGesture(); else if (engine.startGesture(g.id)) cues.start(); });
    row.querySelector('.g-clear').addEventListener('click', () => engine.clearGesture(g.id));
    list.appendChild(row); rows[g.id] = row;
  }
  $('gClearAll').addEventListener('click', () => engine.clearGestures());
  function renderElecLegend() {
    $('gElecLegend').innerHTML = elecGroups().map((grp) => `<div class="row"><div class="k"><b>${grp.map((ch) => XR_FACE[ch].id).join(' ')}</b> · ${XR_FACE[grp[0]].place.split(' · ')[0]}</div></div>`).join('');
    for (const g of GESTURES) rows[g.id].querySelector('.g-elec').innerHTML = elecGroups().map((grp) => `<span>${grp.map((ch) => `<i data-ch="${ch}" title="${XR_FACE[ch].id} · ${XR_FACE[ch].place}"></i>`).join('')}</span>`).join('');
  }
  renderElecLegend();
  onMontage(() => { renderElecLegend(); renderGestures(); });

  function renderGestures() {
    const tr = engine.gestures, rec = tr.rec;
    let trained = 0;
    for (const g of GESTURES) {
      const row = rows[g.id], m = tr.models[g.id], busyHere = rec && rec.id === g.id;
      row.classList.toggle('recording', !!busyHere);
      row.classList.toggle('trained', !!m);
      const score = row.querySelector('.g-score'), fill = row.querySelector('.g-ready .meter-fill');
      if (m) {
        trained++;
        const tier = readiness(m.cv, m.recordings);
        fill.style.width = `${(Math.max(0, (m.cv - 0.5) / 0.5) * 100).toFixed(0)}%`; fill.style.background = READY_COLOR[tier];
        score.innerHTML = `<b>${m.cv.toFixed(2)}</b> ${tier} · ${m.cycles} cycles`;
      } else { fill.style.width = '0%'; score.textContent = busyHere ? 'recording' : (tr.units[g.id] || []).length ? 'needs one more' : 'not trained'; }
      row.querySelectorAll('.g-elec i').forEach((cell) => { const v = m ? m.importance[+cell.dataset.ch] : 0; cell.style.opacity = m ? (0.12 + 0.88 * v).toFixed(2) : '0.12'; cell.style.background = m && v > 0.05 ? FACE_COLOR : 'var(--ink-3)'; });
      const n = tr.recordings[g.id] || 0;
      const btn = row.querySelector('.g-rec');
      btn.textContent = busyHere ? 'Stop' : n ? `Again · ${cyclesForRecording(n + 1)}` : 'Record · 3';
      btn.title = busyHere ? 'Stop this recording (nothing is kept)' : `${cyclesForRecording(n + 1)} cycles, ${recordingSeconds(cyclesForRecording(n + 1))} s`;
      btn.disabled = engine.state !== 'streaming' || (engine.busy && !busyHere);
      row.querySelector('.g-clear').style.visibility = m || (tr.units[g.id] || []).length ? '' : 'hidden';
    }
    $('gCount').textContent = trained ? `${trained} trained${tr.participant ? ` · ${tr.participant}` : ''}` : 'none trained';
    $('gClearAll').style.visibility = trained ? '' : 'hidden';
  }
  function renderLiveGestures() {
    const f = engine.features;
    for (const g of GESTURES) {
      const row = rows[g.id], m = engine.gestures.models[g.id];
      row.querySelector('.g-live .meter-fill').style.width = m ? `${(f.face[g.id] * 100).toFixed(1)}%` : '0%';
      row.querySelector('.g-live .dot').className = 'dot' + (m && f.faceOn[g.id] ? ' on' : '');
      row.classList.toggle('on', !!(m && f.faceOn[g.id]));
    }
  }

  // ── cue strip (gesture recordings and the tension range) ──
  const cue = $('faceCue');
  function showCue(on) { cue.classList.toggle('hidden', !on); }
  function setCue(phase, text, steps, p) {
    cue.querySelector('.fc-phase').textContent = phase; cue.querySelector('.fc-text').textContent = text;
    cue.querySelector('.fc-steps').innerHTML = steps || ''; cue.querySelector('.fc-bar i').style.width = `${(p * 100).toFixed(1)}%`;
  }
  const cancelAll = () => engine.cancelFaceProtocols();
  let curLabel = 0;
  $('fcCancel').addEventListener('click', cancelAll);
  $('goCancel').addEventListener('click', cancelAll);

  function gestureCue(now) {
    const tr = engine.gestures, rec = tr.rec; if (!rec) return;
    const g = GESTURE_BY_ID[rec.id], ph = rec.phase || 'ready';
    const label = ph === 'ready' ? 'Get ready' : ph === 'rest' ? 'Rest' : g.label;
    const text = ph === 'ready' ? `${g.label} · ${rec.cycles} ${rec.cycles === 1 ? 'time' : 'times'}` : ph === 'rest' ? 'Face relaxed, still.' : g.hint;
    const steps = Array.from({ length: rec.cycles }, (_, k) => { const lab = rec.cycles - k; return `<i class="${lab === curLabel ? 'on' : curLabel && lab > curLabel ? 'done' : ''}">${lab}</i>`; }).join('');
    setCue(label, text, steps, tr.progress(now));
    cue.classList.toggle('go', ph === 'up' || ph === 'hold' || ph === 'down');
  }
  function tensionCue(now) {
    const r = engine.tension.range; if (!r) return;
    const st = rangeStepAt((now - r.t0) / 1000);
    setCue(st.kind === 'relax' ? 'Relax' : st.kind === 'jaw' ? 'Clench' : st.kind === 'brow' ? 'Brows up' : 'Done', st.cue, `<i class="on">${st.left}</i>`, Math.min(1, (now - r.t0) / 1000 / RANGE_TOTAL_S));
    cue.classList.toggle('go', st.kind === 'jaw' || st.kind === 'brow');
  }

  engine.addEventListener('gesture', (e) => {
    const d = e.detail || {};
    if (d.type === 'start' || d.type === 'phase') {
      showCue(true); curLabel = d.type === 'start' || d.phase === 'ready' ? 0 : (d.cycleLabel || -1);   // -1: the last rest, all cycles done
      if (d.phase === 'rest') cues.rest(); else if (d.phase === 'up') cues.go();
    }
    if (d.type === 'trained') { cues.done(); showCue(false); }
    if (d.type === 'cancelled' || d.type === 'cleared') showCue(engine.tension.measuring);
    if (d.type !== 'on' && d.type !== 'off') renderGestures();
  });
  engine.addEventListener('tension', (e) => {
    const d = e.detail || {};
    if (d.type === 'start') { showCue(true); cues.start(); }
    if (d.type === 'step') { if (d.kind === 'relax') cues.rest(); else cues.go(); }
    if (d.type === 'range') { cues.done(); showCue(false); }
    if (d.type === 'cancelled') showCue(engine.gestures.recording);
    renderTensionSide();
  });

  // ── gaze ──
  const overlay = $('gazeOverlay'), dot = overlay.querySelector('.go-dot'), goCue = overlay.querySelector('.go-cue');
  $('zCal').addEventListener('click', startGaze);
  $('zRecentre').addEventListener('click', () => engine.recentreGaze());
  $('zReset').addEventListener('click', () => engine.resetGaze());
  const follow = $('zFollow');
  engine.gaze.follow = ui.gazeFollow !== false;
  function paintFollow() { follow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === engine.gaze.follow)); }
  follow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { engine.gaze.follow = b.dataset.v === '1'; ui.gazeFollow = engine.gaze.follow; saveConfig(); paintFollow(); }));
  paintFollow();
  function startGaze() { if (engine.startGaze()) cues.start(); }
  function placeDot(t) { dot.style.left = `${50 + t.x * 42}%`; dot.style.top = `${50 + t.y * 38}%`; }
  engine.addEventListener('gaze', (e) => {
    const d = e.detail || {};
    if (d.type === 'start') { overlay.classList.remove('hidden'); dot.classList.remove('hold'); placeDot({ x: 0, y: 0 }); goCue.innerHTML = '<b>Follow the dot with your eyes</b><span>Head still. It visits nine places.</span>'; }
    if (d.type === 'phase') {
      if (d.phase === 'move') { placeDot(d.target); cues.move(); dot.classList.remove('hold'); goCue.innerHTML = ''; }
      else if (d.phase === 'hold') dot.classList.add('hold');
    }
    if (d.type === 'done') { overlay.classList.add('hidden'); dot.classList.remove('hold'); gazeFailed = !d.ok; if (d.ok) cues.done(); }
    if (d.type === 'start' || d.type === 'reset') gazeFailed = false;
    if (d.type === 'cancelled') overlay.classList.add('hidden');
    renderGazeSide();
  });
  let gazeFailed = false;
  function renderGazeSide() {
    const m = engine.gaze.model;
    $('zState').textContent = engine.gaze.calibrating ? 'calibrating' : m ? 'calibrated' : 'not calibrated';
    $('zReset').style.visibility = m ? '' : 'hidden';
    $('zCal').disabled = engine.state !== 'streaming' || engine.busy;
    $('zRecentre').disabled = !m;
    $('zQuality').innerHTML = m
      ? `<div class="row"><div class="k"><b>Left – right</b></div><div class="v">${m.sepH.toFixed(1)} · ${m.quality.h}</div></div><div class="row"><div class="k"><b>Up – down</b></div><div class="v">${m.sepV.toFixed(1)} · ${m.quality.v}</div></div>`
      : `<div class="row"><div class="k">${gazeFailed ? 'Some dots had no clean reading (blinks or contact). Run them again.' : 'Run the 9 dots to see how well the eyes separate.'}</div></div>`;
  }
  function renderGazeLive() {
    const g = engine.gaze;
    $('zLive').innerHTML = `<div class="row"><div class="k"><b>Side</b></div><div class="v">${g.model ? ['Left', 'Centre', 'Right'][g.side + 1] : '—'}</div></div><div class="row"><div class="k"><b>x · y</b></div><div class="v">${g.model ? `${g.x.toFixed(2)} · ${g.y.toFixed(2)}` : '—'}</div></div><div class="row"><div class="k"><b>EOG</b> h · v</div><div class="v">${g.h.toFixed(0)} · ${g.v.toFixed(0)} µV</div></div>`;
  }

  const gazeCv = $('gazeCanvas'), trail = [];
  function drawGaze() {
    const { g, w, h } = fit(gazeCv); if (!g) return;
    g.fillStyle = '#111111'; g.fillRect(0, 0, w, h);
    const pad = 32, W = w - pad * 2, H = h - pad * 2, cx = pad + W / 2, cy = pad + H / 2;
    const gz = engine.gaze, side = gz.model ? gz.side : null;
    // three zones
    const zx = [pad, pad + W * 0.35, pad + W * 0.65, pad + W];
    for (let k = 0; k < 3; k++) { if (side === k - 1) { g.fillStyle = '#1b1b1b'; g.fillRect(zx[k], pad, zx[k + 1] - zx[k], H); } }
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.strokeRect(pad + 0.5, pad + 0.5, W - 1, H - 1);
    g.beginPath(); for (const x of [zx[1], zx[2]]) { g.moveTo(Math.round(x) + 0.5, pad); g.lineTo(Math.round(x) + 0.5, pad + H); } g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(pad, Math.round(cy) + 0.5); g.lineTo(pad + W, Math.round(cy) + 0.5); g.stroke();
    g.font = '600 13px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    ['Left', 'Centre', 'Right'].forEach((lab, k) => { g.fillStyle = side === k - 1 ? '#e0e0e0' : '#6d6d6d'; g.fillText(lab, (zx[k] + zx[k + 1]) / 2, pad + H - 14); });
    if (!gz.model) {
      g.fillStyle = '#8c8c8c'; g.font = '600 14px Geist, system-ui, sans-serif'; g.textBaseline = 'middle';
      g.fillText(engine.state === 'streaming' ? 'Not calibrated · press G and follow the dots' : '', cx, cy);
      trail.length = 0; return;
    }
    const px = cx + Math.max(-1.2, Math.min(1.2, gz.x)) * (W / 2) * 0.84, py = cy + Math.max(-1.2, Math.min(1.2, gz.y)) * (H / 2) * 0.76;
    trail.push([px, py]); if (trail.length > 30) trail.shift();
    trail.forEach(([x, y], k) => { g.globalAlpha = (k / trail.length) * 0.35; g.fillStyle = GAZE_COLOR; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); });
    g.globalAlpha = 1; g.fillStyle = GAZE_COLOR; g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fill();
  }

  // ── tension ──
  $('tRange').addEventListener('click', () => engine.startTensionRange());
  $('tClear').addEventListener('click', () => engine.clearTensionRange());
  const tHist = { jaw: [], brow: [] };
  setInterval(() => { if (engine.state !== 'streaming') return; for (const t of TENSION_GROUPS) { const h = tHist[t.id]; h.push(engine.features.tension[t.id]); if (h.length > 600) h.shift(); } }, 100);
  function renderTensionSide() {
    const fixed = TENSION_GROUPS.some((t) => engine.tension.groups[t.id].fixed);
    $('tState').textContent = engine.tension.measuring ? 'measuring' : fixed ? 'measured range' : 'auto range';
    $('tClear').style.visibility = fixed ? '' : 'hidden';
    $('tRange').disabled = engine.state !== 'streaming' || engine.busy;
  }
  function renderTensionLive() {
    $('tRows').innerHTML = TENSION_GROUPS.map((t) => {
      const g = engine.tension.groups[t.id];
      return `<div class="row"><i class="swatch" style="background:${TENSION_COLOR[t.id]}"></i><div class="k"><b>${t.label}</b> · ${t.where}</div><div class="v">${g.raw.toFixed(1)} µV · ${g.floor.toFixed(1)}–${g.ceil.toFixed(1)}</div></div>`;
    }).join('');
  }
  const tCv = $('tensionCanvas');
  function drawTension() {
    const { g, w, h } = fit(tCv); if (!g) return;
    g.fillStyle = '#111111'; g.fillRect(0, 0, w, h);
    const padL = 24, padR = 24, top = 16, laneH = Math.max(80, (h - top - 150) / 2), x0 = padL + 150, x1 = w - padR;
    TENSION_GROUPS.forEach((t, k) => {
      const y0 = top + k * (laneH + 16), y1 = y0 + laneH, gr = engine.tension.groups[t.id], col = TENSION_COLOR[t.id];
      g.strokeStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(padL, y0 + 0.5); g.lineTo(x1, y0 + 0.5); g.stroke();
      g.fillStyle = '#e0e0e0'; g.font = '600 13px Geist, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(t.label, padL, y0 + 10);
      g.fillStyle = '#8c8c8c'; g.font = '400 11px Geist, system-ui, sans-serif'; g.fillText(t.where, padL, y0 + 28);
      g.fillStyle = gr.on ? col : '#b8b8b8'; g.font = '600 27px Geist, system-ui, sans-serif'; g.fillText(gr.value.toFixed(2), padL, y0 + 46);
      // threshold lines
      const yv = (v) => y1 - 6 - v * (laneH - 16);
      g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); for (const v of [0.6, 0.4]) { g.moveTo(x0, Math.round(yv(v)) + 0.5); g.lineTo(x1, Math.round(yv(v)) + 0.5); } g.stroke(); g.setLineDash([]);
      const hist = tHist[t.id]; if (hist.length < 2) return;
      const step = (x1 - x0) / 599;
      g.beginPath(); hist.forEach((v, i) => { const x = x1 - (hist.length - 1 - i) * step, y = yv(v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1;
      g.lineTo(x1, yv(0)); g.lineTo(x1 - (hist.length - 1) * step, yv(0)); g.closePath(); g.globalAlpha = 0.10; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
    });
    // per-electrode muscle bars
    const yb = top + 2 * (laneH + 16), bh = h - yb - 24;
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(padL, yb + 0.5); g.lineTo(x1, yb + 0.5); g.stroke();
    g.fillStyle = '#e0e0e0'; g.font = '600 13px Geist, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('Electrodes', padL, yb + 10);
    g.fillStyle = '#8c8c8c'; g.font = '400 11px Geist, system-ui, sans-serif'; g.fillText('muscle, µV', padL, yb + 28);
    const emg = engine.features.emg, max = Math.max(20, ...emg) * 1.1, bw = (x1 - x0) / 8;
    for (let ch = 0; ch < 8; ch++) {
      const v = emg[ch], hh = Math.max(1, (v / max) * (bh - 30)), x = x0 + ch * bw + 8, col = ch <= 1 || ch >= 6 ? TENSION_COLOR.jaw : TENSION_COLOR.brow;
      g.fillStyle = '#262626'; g.fillRect(x, yb + 12, bw - 16, bh - 30);
      g.fillStyle = col; g.globalAlpha = 0.85; g.fillRect(x, yb + 12 + (bh - 30) - hh, bw - 16, hh); g.globalAlpha = 1;
      g.fillStyle = '#8c8c8c'; g.textAlign = 'center'; g.fillText(`${XR_FACE[ch].id} · ${v.toFixed(0)}`, x + (bw - 16) / 2, yb + bh - 14);
    }
  }

  // ── keys ──
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'Escape' && engine.busy && !engine.calib.running) cancelAll();
    if (root.classList.contains('hidden')) return;
    if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) { setView('gaze'); startGaze(); }
    if (e.key === '0') engine.recentreGaze();
  });

  // ── loops ──
  function frame() {
    const now = performance.now();
    if (engine.gestures.recording) gestureCue(now); else if (engine.tension.measuring) tensionCue(now);
    if (!root.classList.contains('hidden')) {
      if (view === 'gestures') renderLiveGestures();
      else if (view === 'gaze') drawGaze();
      else if (view === 'tension') drawTension();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => { if (root.classList.contains('hidden')) return; if (view === 'gaze') renderGazeLive(); if (view === 'tension') renderTensionLive(); }, 200);
  function refreshState() {
    const streaming = engine.state === 'streaming';
    $('faceEmpty').style.display = streaming ? 'none' : '';
    $('faceStatus').innerHTML = streaming ? `<div class="dot on"></div>${engine.deviceName} · ${engine.features.contactGood}/${engine.features.contactOf} contact` : `<div class="dot"></div>${engine.statusText}`;
    renderGestures(); renderGazeSide(); renderTensionSide();
  }
  for (const ev of ['state', 'quality', 'calib', 'disconnected']) engine.addEventListener(ev, refreshState);
  setView(view); refreshState();
  return { onShow: () => { refreshState(); } };
}

function fit(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return {};
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w, h };
}

