// Home: is the sensor on, connected, streaming, touching the skin, and does it see blinks?
import { HeadView } from '../head.js';
import { CHANNELS } from '../ble.js';
import { STATUS } from '../quality.js';
import { XR_FACE } from '../scope.js';
import { mountMontageEditor } from '../montageview.js';
import { montage, refSite, biasSite, onMontage } from '../montage.js';
import { BANDS } from '../fft.js';

const STATUS_LABEL = { good: 'good', fair: 'fair', poor: 'poor', railed: 'at the converter limit', none: 'flat', wait: '…', off: 'no disc' };
const REF_LABEL = { good: 'quiet', noisy: 'noisy', lost: 'lost', flat: 'no signal', wait: '…' };
const STATUS_DOT = { good: 'on', fair: 'warn', poor: 'bad', railed: 'bad', none: '', wait: '', off: '' };

export function mountHome(root, { engine, ui, saveConfig, visitor }) {
  root.innerHTML = `
    <section class="home">
      <div class="home-face">
        <div class="home-visual"><div class="vis-cell"><div class="stage head-wrap" id="homeFace"></div><div class="vis-caption"><div class="dot" id="capHeadDot"></div><b>PiEEG XR</b><span id="capHead">not connected</span><span class="sep"></span><div class="dot" id="capHandDot"></div><b>Heart</b><span id="capHand">no strap</span></div></div></div><div class="head-tools"><div class="seg-group" id="headMode"><button class="seg on" data-v="contact">Contact</button>${BANDS.map((b) => `<button class="seg" data-v="${b.id}">${b.label}</button>`).join('')}<button class="seg" data-v="total">Activity</button></div><button class="seg" id="homeResetView">Reset view</button></div>
        <div class="home-status"><div class="dot" id="homeDot"></div><div id="homeText">No device</div></div>
        <div class="home-actions">
          <button class="primary" id="homeConnect">Connect PiEEG</button>
          <button id="homeSim">Simulator</button>
          <button id="homeDisconnect" disabled>Disconnect</button>
        </div>
        <div class="hint">Battery or headset power only. Connect, then keep still for a few seconds.</div>
      </div>
      <div class="home-side">
        <h2>Ready to start</h2>
        <div class="rows" id="checks"></div>
        <h2>Contact</h2>
        <div class="rows contact" id="homeRef"></div>
        <div class="rows contact" id="homeContact"></div>
        <div class="hint" id="homeContactSummary"></div>
        <h2><span>Electrodes<span class="count" id="homeMapName"></span></span><button class="seg" id="homeMapEdit">Edit map</button></h2>
        <div class="rows contact" id="homeMap"></div>
        <h2>Heart rate <button class="seg" id="antBtn">Start ANT+ stick</button></h2>
        <div class="rows" id="straps"></div>
        <div class="hint" id="antHint"></div>
        <div class="rows"><div class="row"><div class="k">Bluetooth strap</div><div class="v"><button class="seg" id="hHeartBtn">Connect</button></div></div></div>
        <div class="rows">
          <div class="row"><div class="k">Heart from</div><div class="seg-group" id="hSource"><button class="seg" data-v="auto">Auto</button><button class="seg" data-v="strap">Strap</button><button class="seg" data-v="eeg">Electrodes</button></div></div>
          <div class="row"><div class="k">Electrode estimate</div><div class="v" id="hEEG">—</div></div>
        </div>
        <div class="hint">Electrodes (experimental): the pulse of the temple arteries, when the mask presses well. It says a number only when the rhythm is clear; record a session with a strap on too to compare. Auto uses the strap when there is one.</div>

        <h2><span>Visitor mode<span class="count" id="vState"></span></span></h2>
        <div class="rows">
          <div class="row"><div class="k">For installations</div><div class="seg-group" id="vOn"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
          <div class="row"><div class="k">Settling time</div><div class="seg-group" id="vBase"><button class="seg" data-v="30">30</button><button class="seg" data-v="45">45</button><button class="seg" data-v="60">60 s</button></div></div>
          <div class="row"><div class="k">Outputs while nobody wears it</div><div class="seg-group" id="vIdle"><button class="seg" data-v="zero">Zero</button><button class="seg" data-v="middle">Middle</button><button class="seg" data-v="hold">Hold</button></div></div>
          <div class="row"><div class="k">Record each visitor</div><div class="seg-group" id="vRec"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
        </div>
        <div class="hint">The app sees someone put the mask on (contact for 3 s) and take it off (5 s without). Each visitor starts fresh and settles before the outputs go live; until then, and between visitors, outputs ease to the value chosen above. Bluetooth keeps reconnecting on its own.</div>

        <h2>Stream</h2>
        <div class="rows">
          <div class="row"><div class="k">Device</div><div class="v" id="hDevice">—</div></div>
          <div class="row"><div class="k">Samples per second</div><div class="v" id="hRate">—</div></div>
          <div class="row"><div class="k">Lost on Bluetooth</div><div class="v" id="hLoss">—</div></div>
          <div class="row"><div class="k">Packets</div><div class="v" id="hPackets">—</div></div>
          <div class="row"><div class="k">Streaming for</div><div class="v" id="hUptime">—</div></div>
          <div class="row"><div class="k">Sessions folder</div><div class="v"><button class="seg" id="hFolder">Open</button></div></div>
        </div>
      </div>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const face = new HeadView($('homeFace'));
  if ((window.alma.flags || {}).probe) window.almaHead = face;   // the self-test probe reads the head
  let headMode = ui.headMode || 'contact';
  const smooth = new Float32Array(8);
  $('headMode').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.v === headMode); b.addEventListener('click', () => { headMode = b.dataset.v; ui.headMode = headMode; $('headMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); face.mode = headMode === 'contact' ? 'contact' : 'value'; face.update(engine.quality); }); });
  face.mode = headMode === 'contact' ? 'contact' : 'value';
  // activity: log band power per channel, scaled between the quietest and the loudest channel right now, smoothed
  setInterval(() => {
    if (headMode === 'contact' || engine.state !== 'streaming' || root.classList.contains('hidden')) return;
    const f = engine.features, raw = new Float32Array(8);
    for (let ch = 0; ch < 8; ch++) { const b = f.bands[ch]; raw[ch] = Math.log10((headMode === 'total' ? b.total : b[headMode]) + 1e-6); }
    const lo = Math.min(...raw), hi = Math.max(...raw), span = Math.max(0.3, hi - lo);
    for (let ch = 0; ch < 8; ch++) { const t = (raw[ch] - lo) / span; smooth[ch] += (t - smooth[ch]) * 0.25; face.values[ch] = smooth[ch]; }
    face.update(engine.quality);
  }, 150);
  $('homeResetView').addEventListener('click', () => face.resetView());

  const CHECKS = [
    { id: 'found', label: 'Sensor connected', test: () => engine.state === 'streaming' },
    { id: 'rate', label: 'Streaming at 250 /s', test: () => engine.state === 'streaming' && engine.features.rate > 230 },
    { id: 'ref', label: 'Reference quiet', test: () => engine.quality && engine.quality.ref && engine.quality.ref.status === 'good', pending: () => !engine.quality || !engine.quality.ref || engine.quality.ref.status === 'wait', extra: () => engine.quality && engine.quality.ref && engine.quality.ref.status !== 'good' ? `${REF_LABEL[engine.quality.ref.status]} · ${engine.quality.ref.common.toFixed(0)} µV` : '' },
    { id: 'contact', label: 'All electrodes on the skin', test: () => engine.quality && engine.quality.every((q) => q.status === STATUS.GOOD || q.status === STATUS.FAIR || q.status === STATUS.OFF), pending: () => !engine.quality },
    { id: 'blink', label: 'Blink test (blink 3 times)', test: () => engine.blink.count >= 3, extra: () => engine.blink.warmed ? `${engine.blink.count} seen` : '' },
  ];
  const checksEl = $('checks');
  const checkRows = CHECKS.map((c) => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="dot"></div><div class="k">${c.label}</div><div class="v dim"></div>`;
    checksEl.appendChild(row); return row;
  });
  const refEl = $('homeRef');
  refEl.innerHTML = '<div class="row"><div class="dot"></div><div class="k"><b>Ref</b> · <span class="site"></span></div><div class="v"></div></div>';
  const refRow = refEl.firstChild;
  const contactEl = $('homeContact');
  const contactRows = XR_FACE.map((e) => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="dot"></div><div class="k"><b>${e.id}</b> · ${e.place}</div><div class="v"></div>`;
    contactEl.appendChild(row); return row;
  });

  function refresh() {
    const streaming = engine.state === 'streaming';
    $('homeText').textContent = engine.statusText;
    $('homeDot').className = 'dot ' + (streaming ? 'on' : engine.state === 'error' ? 'bad' : engine.state === 'connecting' ? 'warn' : '');
    $('homeConnect').disabled = streaming || engine.state === 'connecting';
    $('homeSim').disabled = streaming || engine.state === 'connecting';
    $('homeDisconnect').disabled = !engine.device;
    face.update(engine.quality, engine.quality ? engine.quality.ref : null);
    const nGood = engine.quality ? engine.quality.filter((q) => q.status === 'good').length : 0;
    const nOf = engine.features.contactOf;
    $('capHeadDot').className = 'dot ' + (streaming ? (nGood === nOf ? 'on' : 'warn') : '');
    $('capHead').textContent = streaming ? `${nGood}/${nOf} contact` : 'not connected';
    const f = engine.features, hconn = f.heart.connected || (engine.heart && engine.heart.connected);
    const hstate = hconn && f.heart.bpm > 0 ? 'beating' : hconn ? 'idle' : 'off';
    $('capHandDot').className = 'dot ' + (hstate === 'beating' ? 'on' : hstate === 'idle' ? 'warn' : '');
    $('capHand').textContent = hstate === 'beating' ? `${f.heart.bpm} bpm` : hstate === 'idle' ? 'no pulse' : 'no strap';
    CHECKS.forEach((c, i) => {
      const row = checkRows[i], pending = !streaming || (c.pending && c.pending());
      const ok = !pending && c.test();
      row.children[0].className = 'dot ' + (pending ? '' : ok ? 'on' : 'warn');
      row.children[2].textContent = pending ? '' : ok ? (c.extra ? c.extra() || 'ok' : 'ok') : (c.extra ? c.extra() || 'not yet' : 'not yet');
    });
    const q = engine.quality; let good = 0;
    XR_FACE.forEach((e, ch) => {
      const r = contactRows[ch], s = q ? q[ch].status : 'wait';
      r.children[0].className = 'dot ' + STATUS_DOT[s];
      r.children[1].innerHTML = `<b>${e.id}</b> · ${e.place}`;
      r.classList.toggle('dim', s === STATUS.OFF);
      r.children[2].textContent = s === 'wait' ? '' : s === STATUS.OFF ? STATUS_LABEL.off : `${q[ch].rms.toFixed(0)} µV · ${STATUS_LABEL[s]}`;
      if (s === STATUS.GOOD) good++;
    });
    // the reference: what every channel shares (it reads as all eight channels bad at once)
    const ref = q && q.ref ? q.ref : { status: 'wait', common: 0 };
    refRow.children[0].className = 'dot ' + (ref.status === 'good' ? 'on' : ref.status === 'wait' || ref.status === 'flat' ? '' : 'bad');
    refRow.querySelector('.site').textContent = refSite().label;
    refRow.children[2].textContent = ref.status === 'wait' || !streaming ? '' : `${ref.common.toFixed(0)} µV common · ${REF_LABEL[ref.status]}`;
    const refHint = ref.status === 'noisy' ? `Every channel carries the same ${ref.common.toFixed(0)} µV: the reference (${refSite().label}) or the bias (${biasSite().label}) is not touching well. Press them against the skin; a drop of saline helps. Live › Average reference hides it meanwhile.`
      : ref.status === 'lost' ? `Most channels are at the converter limit: the reference (${refSite().label}) is off the skin.` : '';
    $('homeContactSummary').textContent = !streaming ? '' : !q ? 'Reading…' : refHint || (good === engine.features.contactOf ? 'All good.' : `${good}/${engine.features.contactOf} good. Reseat the mask where it is grey or red.`);
    $('hDevice').textContent = engine.deviceName || '—';
    $('hRate').textContent = streaming ? `${engine.features.rate.toFixed(0)} /s` : '—';
    $('hPackets').textContent = streaming ? `${engine.stats.notifications} · ${engine.stats.lastLen} B` : '—';
    const loss = engine.features.loss;
    $('hLoss').textContent = !streaming || engine.sourceKind !== 'ble' ? '—' : loss < 0.01 ? 'none' : `${(loss * 100).toFixed(0)} %${loss > 0.05 ? ' · bring the box in line of sight' : ''}`;
    $('vState').textContent = visitor ? visitor.text : '';
    $('hUptime').textContent = streaming ? fmtDuration((Date.now() - engine.startedAt) / 1000) : '—';
    const he = engine.features.heartEEG;
    $('hEEG').textContent = !streaming ? '—' : he.locked ? `${Math.round(he.bpm)} bpm · confidence ${he.confidence.toFixed(2)}` : `searching · ${he.confidence.toFixed(2)}`;
    const hb = engine.heart; $('hHeartBtn').textContent = hb && hb.connected ? `${hb.bpm || '—'} bpm · ${hb.name} · disconnect` : 'Connect';
    renderStraps();
  }
  $('homeConnect').addEventListener('click', () => engine.connect('ble'));
  $('homeSim').addEventListener('click', () => engine.connect('sim'));
  $('homeDisconnect').addEventListener('click', () => engine.disconnect());
  $('hFolder').addEventListener('click', () => window.alma.openSessionsFolder());
  if (visitor) {
    const seg = (id, val, fn) => { const g = $(id); g.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.v === String(val)); b.addEventListener('click', () => { fn(b.dataset.v); g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); saveConfig && saveConfig(); }); }); };
    seg('vOn', visitor.cfg.enabled ? 1 : 0, (v) => visitor.configure({ enabled: v === '1' }));
    seg('vBase', visitor.cfg.baseline, (v) => visitor.configure({ baseline: +v }));
    seg('vIdle', visitor.cfg.idle, (v) => visitor.configure({ idle: v }));
    seg('vRec', visitor.cfg.record ? 1 : 0, (v) => visitor.configure({ record: v === '1' }));
    engine.addEventListener('visitor', () => { $('vState').textContent = visitor.text; });
  }
  engine.heartSource = ui.heartSource || 'auto';
  const paintSource = () => $('hSource').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === engine.heartSource));
  $('hSource').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { engine.heartSource = b.dataset.v; ui.heartSource = b.dataset.v; saveConfig && saveConfig(); paintSource(); refresh(); }));
  paintSource();
  $('hHeartBtn').addEventListener('click', () => (engine.heart && engine.heart.connected ? engine.disconnectHeart() : engine.connectHeart('ble')));
  $('antBtn').addEventListener('click', () => (engine.ant.state === 'open' || engine.ant.state === 'opening' ? engine.antStop() : engine.antStart()));
  function renderStraps() {
    const el = $('straps'); const st = engine.ant.state;
    $('antBtn').textContent = st === 'open' || st === 'opening' ? 'Stop ANT+ stick' : 'Start ANT+ stick';
    const straps = [...engine.straps.values()].sort((a, b) => a.firstSeen - b.firstSeen);
    $('antHint').textContent = st === 'open' ? (straps.length ? 'Give each strap a slot. Slot 1 is the main heart.' : 'Listening. Put a strap on; it shows up here within seconds.') : st === 'idle' ? 'Garmin ANT+ USB stick with chest or wrist straps.' : engine.ant.message || '';
    const key = straps.map((s) => s.id).join(',') + '|' + JSON.stringify(engine.strapSlots);
    if (el.dataset.key !== key) {
      el.dataset.key = key; el.innerHTML = '';
      for (const s of straps) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<div class="dot"></div><div class="k"><b>${s.id}</b></div><div class="v bpm"></div><select class="slot" style="width:92px"><option value="">no slot</option>${[1,2,3,4,5,6,7,8].map((n) => `<option value="${n}">slot ${n}</option>`).join('')}</select>`;
        const sel = row.querySelector('select'); sel.value = engine.slotOf(s.id) || '';
        sel.addEventListener('change', () => engine.assignStrap(+sel.value || 0, sel.value ? s.id : null));
        el.appendChild(row);
      }
    }
    const now = Date.now();
    straps.forEach((s, i) => { const row = el.children[i]; if (!row) return; const alive = now - s.lastSeen < 8000; row.children[0].className = 'dot ' + (alive ? 'on' : ''); row.querySelector('.bpm').textContent = alive ? `${s.bpm} bpm` : 'lost'; });
  }
  // electrode map: name, reference and bias sites, and the editor
  const editor = mountMontageEditor(document.body);
  $('homeMapEdit').addEventListener('click', () => editor.open());
  function renderMap() {
    $('homeMapName').textContent = montage.name;
    $('homeMap').innerHTML = `<div class="row"><div class="k"><b>Ref</b> · reference</div><div class="v">${refSite().label}</div></div><div class="row"><div class="k"><b>Bias</b> · ground</div><div class="v">${biasSite().label}</div></div>`;
    refresh();
  }
  onMontage(renderMap); renderMap();
  engine.addEventListener('ant', refresh); engine.addEventListener('strap', renderStraps);
  for (const ev of ['state', 'quality', 'blink', 'disconnected', 'heart']) engine.addEventListener(ev, refresh);
  const timer = setInterval(refresh, 1000);
  refresh();
  return { refresh, destroy: () => clearInterval(timer) };
}

export function fmtDuration(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m} min ${r} s` : `${r} s`; }
