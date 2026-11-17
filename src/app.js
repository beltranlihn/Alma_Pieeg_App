// EEG Alma Center — renderer entry: the engine, the router, the config and the five pages.
import { Engine } from './engine.js';
import { Router } from './router.js';
import { mountHome } from './pages/home.js';
import { mountLive } from './pages/live.js';
import { mountRouting } from './pages/routing.js';
import { mountFace } from './pages/face.js';
import { mountSessions } from './pages/sessions.js';
import { GESTURES } from './face.js';
import { mountCalibration } from './calview.js';

const $ = (id) => document.getElementById(id);
const engine = new Engine();
const router = new Router(engine);
const ui = { page: 'home', liveView: 'bands', display: null };

// ── Config (userData/config.json) ──
let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer); router.syncOutputs();
  saveTimer = setTimeout(() => window.alma.saveConfig(JSON.stringify({ version: 1, ui, filters: engine.filters, router: router.toJSON(), straps: engine.strapSlots, face: savedFace() }, null, 2)), 300);
}
// The simulator never writes the face model: with --sim the one in the file stays as it is; with the Home
// Simulator button the engine keeps the person's model aside (savedFaceModel) and gives it back on reconnect.
function savedFace() {
  if ((window.alma.flags || {}).sim) return (cfg && cfg.face) || null;
  return engine.savedFaceModel ?? (cfg && cfg.face) ?? null;
}
const cfg = await window.alma.loadConfig();
if (cfg) { Object.assign(ui, cfg.ui || {}); if (cfg.filters) Object.assign(engine.filters, cfg.filters); router.fromJSON(cfg.router); if (cfg.straps) engine.strapSlots = { ...cfg.straps }; if (cfg.face && !(window.alma.flags || {}).sim) engine.loadFaceModel(cfg.face); }
engine.addEventListener('ant', saveConfig);
engine.addEventListener('face-model', () => { if (!(window.alma.flags || {}).sim && engine.sourceKind !== 'sim') saveConfig(); });   // a simulator model never replaces a real one

// ── Pages ──
{ const v = (window.alma.flags || {}).view; if (v) { if (['gestures', 'gaze', 'tension'].includes(v)) ui.faceView = v; else ui.liveView = v; } }
const pages = {
  home: mountHome($('pageHome'), { engine, ui }),
  live: mountLive($('pageLive'), { engine, ui, saveConfig }),
  face: mountFace($('pageFace'), { engine, ui, saveConfig }),
  sessions: mountSessions($('pageSessions'), { ui, saveConfig }),
  routing: mountRouting($('pageRouting'), { engine, router, saveConfig }),
};
mountCalibration({ engine, ui, saveConfig, panel: $('calPanel') });
function show(page) {
  ui.page = page; saveConfig();
  for (const p of ['home', 'live', 'face', 'sessions', 'routing']) $('page' + p[0].toUpperCase() + p.slice(1)).classList.toggle('hidden', p !== page);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  pages[page].onShow?.();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));

// ── Header status ──
function refreshHeader() {
  const streaming = engine.state === 'streaming';
  $('hdrDot').className = 'dot ' + (streaming ? 'on' : engine.state === 'error' ? 'bad' : engine.state === 'connecting' ? 'warn' : '');
  $('hdrText').textContent = streaming && !engine._stalled ? `${engine.deviceName} · ${engine.features.rate.toFixed(0)} /s · ${engine.features.contactGood}/8 contact${engine.recorder.active ? ' · recording' : ''}` : engine.statusText;
  const bar = $('btnSession'); if (bar) bar.disabled = engine.state !== 'streaming';
  $('hdrConnect').textContent = engine.device ? 'Disconnect' : 'Connect PiEEG';
  $('hdrConnect').disabled = engine.state === 'connecting';
}
$('hdrConnect').addEventListener('click', () => (engine.device ? engine.disconnect() : engine.connect('ble')));
for (const ev of ['state', 'quality', 'recording', 'disconnected']) engine.addEventListener(ev, refreshHeader);
refreshHeader();

const flags = window.alma.flags || {};
if (flags.probe) window.almaEngine = engine;                    // the self-test probe reads the engine
show(flags.page || ui.page || 'home');
if (flags.sim && flags.session) setTimeout(() => { engine.startSession('test-person', 'self-test'); setTimeout(() => engine.endSession(), +flags.session * 1000); }, 2500);
if (flags.sim) {
  window.almaEngine = engine;                                   // for --probe in the self-test
  setTimeout(() => engine.connect('sim'), 300);
  if (flags.calib) {                                            // --calib=<s>: rest, then eyes closed in the simulator
    engine.addEventListener('calib', (e) => { const p = e.detail.phase; if (p === 'active') engine.device?.setEyes?.(true); if (p === 'done' || p === 'cancelled') engine.device?.setEyes?.(false); });
    setTimeout(() => engine.startCalibration({ seconds: +flags.calib, task: 'eyes' }), 2500);
  }
  // The simulator acts out the face protocols by itself: it makes the gesture while the cue says so, follows
  // the gaze dots and clenches or raises the brows when the tension range asks. So the Face page can be shown
  // and checked without the mask.
  engine.addEventListener('gesture', (e) => { const d = e.detail || {}; if (d.type === 'phase' || d.type === 'start') engine.device?.setGesture?.(d.phase === 'up' || d.phase === 'hold' || d.phase === 'down' ? d.id : null); if (d.type === 'trained' || d.type === 'cancelled') engine.device?.setGesture?.(null); });
  engine.addEventListener('gaze', (e) => { const d = e.detail || {}; if (d.type === 'phase') engine.device?.setGaze?.(d.target.x, d.target.y); if (d.type === 'done' || d.type === 'cancelled') engine.device?.setGaze?.(0, 0); });
  engine.addEventListener('tension', (e) => { const d = e.detail || {}; if (d.type === 'step') engine.device?.setGesture?.(d.kind === 'jaw' ? 'clench' : d.kind === 'brow' ? 'brows_up' : null); if (d.type === 'range' || d.type === 'cancelled') engine.device?.setGesture?.(null); });
  if (flags.face) {                                             // --face=<id>[,<id>]: record each gesture twice, then try them
    const ids = flags.face.split(',').filter((id) => GESTURES.some((g) => g.id === id)); let k = 0;
    const next = () => { if (k < ids.length * 2) { engine.startGesture(ids[Math.floor(k / 2)]); k++; } };
    engine.addEventListener('gesture', (e) => { if (e.detail.type === 'trained') setTimeout(next, 300); });
    setTimeout(next, 2500);
  }
  if (flags.wstest) {                                           // --wstest=<port>: a temporary WebSocket destination
    const d = router.addDestination({ name: 'Self-test', kind: 'ws', host: '127.0.0.1', port: +flags.wstest, rate: 20, temp: true });
    for (const [signal, address] of [['idx.calm', '/alma/calm'], ['face.clench', '/alma/clench'], ['gaze.side', '/alma/side'], ['tension.jaw', '/alma/jaw']]) router.addMapping({ signal, address, destination: d.id, ...(signal === 'gaze.side' ? { type: 'i', outMin: -1, outMax: 1 } : {}) });
  }
  if (flags.gaze) setTimeout(() => engine.startGaze(), 2500);   // --gaze: the 9 dots
  if (flags.tension) setTimeout(() => engine.startTensionRange(), 2500);
  if (flags.events) setTimeout(() => { engine.device?.trigger?.('blink'); setTimeout(() => engine.device?.trigger?.('blink'), 900); setTimeout(() => engine.device?.trigger?.('blink'), 1800); setTimeout(() => engine.device?.trigger?.('jaw'), 3000); setTimeout(() => engine.device?.trigger?.('left'), 4500); }, 2500);
}
