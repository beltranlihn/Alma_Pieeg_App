// EEG Alma Center — renderer entry: the engine, the router, the config and the three pages.
import { Engine } from './engine.js';
import { Router } from './router.js';
import { mountHome } from './pages/home.js';
import { mountLive } from './pages/live.js';
import { mountRouting } from './pages/routing.js';

const $ = (id) => document.getElementById(id);
const engine = new Engine();
const router = new Router(engine);
const ui = { page: 'home', liveView: 'waves', display: null };

// ── Config (userData/config.json) ──
let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.alma.saveConfig(JSON.stringify({ version: 1, ui, filters: engine.filters, router: router.toJSON(), straps: engine.strapSlots }, null, 2)), 300);
}
const cfg = await window.alma.loadConfig();
if (cfg) { Object.assign(ui, cfg.ui || {}); if (cfg.filters) Object.assign(engine.filters, cfg.filters); router.fromJSON(cfg.router); if (cfg.straps) engine.strapSlots = { ...cfg.straps }; }
engine.addEventListener('ant', saveConfig);

// ── Pages ──
if ((window.alma.flags || {}).view) ui.liveView = window.alma.flags.view;
const pages = {
  home: mountHome($('pageHome'), { engine, ui }),
  live: mountLive($('pageLive'), { engine, ui, saveConfig }),
  routing: mountRouting($('pageRouting'), { engine, router, saveConfig }),
};
function show(page) {
  ui.page = page; saveConfig();
  for (const p of ['home', 'live', 'routing']) $('page' + p[0].toUpperCase() + p.slice(1)).classList.toggle('hidden', p !== page);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  pages[page].onShow?.();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));

// ── Header status ──
function refreshHeader() {
  const streaming = engine.state === 'streaming';
  $('hdrDot').className = 'dot ' + (streaming ? 'on' : engine.state === 'error' ? 'bad' : engine.state === 'connecting' ? 'warn' : '');
  $('hdrText').textContent = streaming ? `${engine.deviceName} · ${engine.features.rate.toFixed(0)} /s · ${engine.features.contactGood}/8 contact${engine.recorder.active ? ' · recording' : ''}` : engine.statusText;
  const bar = $('btnSession'); if (bar) bar.disabled = engine.state !== 'streaming';
  $('hdrConnect').textContent = engine.device ? 'Disconnect' : 'Connect PiEEG';
  $('hdrConnect').disabled = engine.state === 'connecting';
}
$('hdrConnect').addEventListener('click', () => (engine.device ? engine.disconnect() : engine.connect('ble')));
for (const ev of ['state', 'quality', 'recording', 'disconnected']) engine.addEventListener(ev, refreshHeader);
refreshHeader();

const flags = window.alma.flags || {};
show(flags.page || ui.page || 'home');
if (flags.sim && flags.session) setTimeout(() => { engine.startSession('test-person', 'self-test'); setTimeout(() => engine.endSession(), +flags.session * 1000); }, 2500);
if (flags.sim) {
  setTimeout(() => engine.connect('sim'), 300);
  if (flags.events) setTimeout(() => { engine.device?.trigger?.('blink'); setTimeout(() => engine.device?.trigger?.('blink'), 900); setTimeout(() => engine.device?.trigger?.('blink'), 1800); setTimeout(() => engine.device?.trigger?.('jaw'), 3000); setTimeout(() => engine.device?.trigger?.('left'), 4500); }, 2500);
}
