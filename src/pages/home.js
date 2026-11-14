// Home: is the sensor on, connected, streaming, touching the skin, and does it see blinks?
import { HeadView } from '../head.js';
import { CHANNELS } from '../ble.js';
import { STATUS } from '../quality.js';
import { XR_FACE } from '../scope.js';

const STATUS_LABEL = { good: 'good', fair: 'fair', poor: 'poor', railed: 'railed · reference lost', none: 'no contact', wait: '…' };
const STATUS_DOT = { good: 'on', fair: 'warn', poor: 'bad', railed: 'bad', none: '', wait: '' };

export function mountHome(root, { engine, ui }) {
  root.innerHTML = `
    <section class="home">
      <div class="home-face">
        <div class="head-wrap" id="homeFace"></div><div class="head-tools"><span class="hint">Drag to turn the head</span><button class="seg" id="homeResetView">Reset view</button></div>
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
        <div class="rows contact" id="homeContact"></div>
        <div class="hint" id="homeContactSummary"></div>
        <h2>Stream</h2>
        <div class="rows">
          <div class="row"><div class="k">Device</div><div class="v" id="hDevice">—</div></div>
          <div class="row"><div class="k">Samples per second</div><div class="v" id="hRate">—</div></div>
          <div class="row"><div class="k">Packets</div><div class="v" id="hPackets">—</div></div>
          <div class="row"><div class="k">Streaming for</div><div class="v" id="hUptime">—</div></div>
          <div class="row"><div class="k">Heart rate</div><div class="v" id="hHeart">—</div></div>
          <div class="row"><div class="k"></div><div class="v"><button class="seg" id="hHeartBtn">Connect heart-rate strap</button></div></div>
          <div class="row"><div class="k">Sessions folder</div><div class="v"><button class="seg" id="hFolder">Open</button></div></div>
        </div>
      </div>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const face = new HeadView($('homeFace'));
  $('homeResetView').addEventListener('click', () => face.resetView());

  const CHECKS = [
    { id: 'found', label: 'Sensor connected', test: () => engine.state === 'streaming' },
    { id: 'rate', label: 'Streaming at 250 /s', test: () => engine.state === 'streaming' && engine.features.rate > 230 },
    { id: 'ref', label: 'Reference in contact', test: () => engine.quality && !engine.quality.some((q) => q.status === STATUS.RAILED), pending: () => !engine.quality },
    { id: 'contact', label: 'All electrodes on the skin', test: () => engine.quality && engine.quality.every((q) => q.status === STATUS.GOOD || q.status === STATUS.FAIR), pending: () => !engine.quality },
    { id: 'blink', label: 'Blink test (blink 3 times)', test: () => engine.blink.count >= 3, extra: () => engine.blink.warmed ? `${engine.blink.count} seen` : '' },
  ];
  const checksEl = $('checks');
  const checkRows = CHECKS.map((c) => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="dot"></div><div class="k">${c.label}</div><div class="v dim"></div>`;
    checksEl.appendChild(row); return row;
  });
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
    face.update(engine.quality);
    CHECKS.forEach((c, i) => {
      const row = checkRows[i], pending = !streaming || (c.pending && c.pending());
      const ok = !pending && c.test();
      row.children[0].className = 'dot ' + (pending ? '' : ok ? 'on' : 'warn');
      row.children[2].textContent = pending ? '' : ok ? (c.extra ? c.extra() || 'ok' : 'ok') : (c.extra ? c.extra() || 'not yet' : 'not yet');
    });
    const q = engine.quality; let good = 0;
    XR_FACE.forEach((_, ch) => {
      const r = contactRows[ch], s = q ? q[ch].status : 'wait';
      r.children[0].className = 'dot ' + STATUS_DOT[s];
      r.children[2].textContent = s === 'wait' ? '' : `${q[ch].rms.toFixed(0)} µV · ${STATUS_LABEL[s]}`;
      if (s === STATUS.GOOD) good++;
    });
    $('homeContactSummary').textContent = !streaming ? '' : !q ? 'Reading…' : good === CHANNELS ? 'All good.' : `${good}/${CHANNELS} good. Reseat the mask where it is grey or red.`;
    $('hDevice').textContent = engine.deviceName || '—';
    $('hRate').textContent = streaming ? `${engine.features.rate.toFixed(0)} /s` : '—';
    $('hPackets').textContent = streaming ? `${engine.stats.notifications} · ${engine.stats.lastLen} B` : '—';
    $('hUptime').textContent = streaming ? fmtDuration((Date.now() - engine.startedAt) / 1000) : '—';
    const hb = engine.heart; $('hHeart').textContent = hb && hb.connected ? `${hb.bpm || '—'} bpm · ${hb.name}` : 'not connected';
    $('hHeartBtn').textContent = hb && hb.connected ? 'Disconnect heart' : 'Connect heart-rate strap';
  }
  $('homeConnect').addEventListener('click', () => engine.connect('ble'));
  $('homeSim').addEventListener('click', () => engine.connect('sim'));
  $('homeDisconnect').addEventListener('click', () => engine.disconnect());
  $('hFolder').addEventListener('click', () => window.alma.openSessionsFolder());
  $('hHeartBtn').addEventListener('click', () => (engine.heart && engine.heart.connected ? engine.disconnectHeart() : engine.connectHeart('ble')));
  for (const ev of ['state', 'quality', 'blink', 'disconnected', 'heart']) engine.addEventListener(ev, refresh);
  const timer = setInterval(refresh, 1000);
  refresh();
  return { refresh, destroy: () => clearInterval(timer) };
}

export function fmtDuration(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m} min ${r} s` : `${r} s`; }
