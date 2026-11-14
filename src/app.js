// EEG Alma Center — renderer entry. Wires source → DSP → rings → scope/quality/recorder → UI.
import { PiEEGDevice, CHANNELS, SAMPLE_RATE } from './ble.js';
import { SimDevice } from './sim.js';
import { ChannelChain } from './dsp.js';
import { Rings, SampleClock } from './ring.js';
import { assessAll, STATUS } from './quality.js';
import { Scope, XR_FACE } from './scope.js';
import { Recorder } from './record.js';

const $ = (id) => document.getElementById(id);
const fs = SAMPLE_RATE;
const rings = new Rings(fs, 60);
const clock = new SampleClock(fs);
const chains = Array.from({ length: CHANNELS }, () => new ChannelChain(fs));
const scope = new Scope($('scope'), rings);
const recorder = new Recorder();
let device = null;
let quality = null;
let rate = { samples: 0, t0: performance.now(), value: 0 };
const filtTmp = new Float32Array(CHANNELS);

const log = (text) => { $('log').textContent = text; };
const setStatus = (text, dotClass) => { $('statusText').textContent = text; $('statusDot').className = 'dot' + (dotClass ? ' ' + dotClass : ''); };

// ── Source → pipeline ────────────────────────────────────────────────────────
function onSamples(samples, arrivalMs) {
  const stamps = clock.stamp(arrivalMs, samples.length);
  for (let s = 0; s < samples.length; s++) {
    const raw = samples[s];
    for (let ch = 0; ch < CHANNELS; ch++) filtTmp[ch] = chains[ch].process(raw[ch]);
    rings.push(raw, filtTmp);
    recorder.push(stamps[s], raw);
  }
  rate.samples += samples.length;
}

async function startSource(src) {
  if (device) await stopSource();
  device = src;
  device.onStatus = (t) => { log(t); };
  device.onDisconnected = () => { setStatus(`${device.name} · disconnected`, 'bad'); $('btnConnect').disabled = false; $('btnSim').disabled = false; };
  rings.reset(); clock.reset(); applySettings();   // fresh filter state per connection
  try {
    await device.start(onSamples);
  } catch (e) {
    device = null;
    setStatus(e && e.name === 'NotFoundError' ? 'No PiEEG found (is it powered? within 5 m? not taken by another app?)' : `Could not connect: ${e.message || e}`, 'bad');
    log(String(e));
    return;
  }
  setStatus(`${device.name} · streaming`, 'on');
  $('empty').style.display = 'none';
  $('btnConnect').disabled = true; $('btnSim').disabled = true; $('btnDisconnect').disabled = false;
  $('btnRecord').disabled = false;
  rate = { samples: 0, t0: performance.now(), value: 0 };
}

async function stopSource() {
  if (!device) return;
  if (recorder.active) await stopRecording();
  await device.stop();
  device = null;
  setStatus('No device');
  $('btnConnect').disabled = false; $('btnSim').disabled = false; $('btnDisconnect').disabled = true; $('btnRecord').disabled = true; $('btnMark').disabled = true;
}

// ── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  recorder.start(); scope.marks = [];
  $('btnRecord').textContent = 'Stop & save'; $('btnRecord').className = 'rec'; $('btnMark').disabled = false;
  log('Recording…');
}
async function stopRecording() {
  recorder.stop();
  $('btnRecord').textContent = 'Record'; $('btnRecord').className = ''; $('btnMark').disabled = true;
  if (recorder.rows.length === 0) return;
  const stamp = new Date(recorder.startedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const auto = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  const typed = $('sessionName').value.trim();
  const name = typed ? `${typed}_${auto}` : `session_${auto}`;
  const meta = recorder.toMeta({ device: device ? device.name : 'unknown', sample_rate: fs, filters: currentFilters(), contact_at_end: quality });
  try {
    const path = await window.alma.saveSession(name, recorder.toCSV(), meta);
    $('recSaved').textContent = name + '.csv'; $('recSaved').title = path;
    log(`Saved ${path}`);
  } catch (e) { log(`Save failed: ${e.message || e}`); }
}
function addMark(text) {
  const m = recorder.mark(text);
  if (!m) return;
  scope.marks.push({ t: performance.now(), text: m.text });
  log(`Mark "${m.text}" at ${recorder.seconds.toFixed(1)} s`);
}

// ── Settings ─────────────────────────────────────────────────────────────────
const settings = { seconds: 8, scale: 100, source: 'filt', bandpass: 1, notch: 50, hampel: 1 };
function currentFilters() { return { hampel: !!settings.hampel, bandpass: !!settings.bandpass, low: 1, high: 40, notch: settings.notch }; }
function applySettings() {
  scope.seconds = settings.seconds; scope.scaleUv = settings.scale; scope.source = settings.source;
  for (const c of chains) c.configure(currentFilters());
}
document.querySelectorAll('.seg-group').forEach((group) => {
  const key = group.dataset.set;
  group.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    const v = btn.dataset.v; settings[key] = isNaN(+v) ? v : +v; applySettings();
  }));
});

// ── Contact panel ────────────────────────────────────────────────────────────
const contactEl = $('contact');
const contactRows = XR_FACE.map((e, ch) => {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<div class="dot"></div><div class="k"><b>${e.id}</b> · ${e.place}</div><div class="line"></div><div class="v"></div>`;
  contactEl.appendChild(row);
  return { dot: row.children[0], line: row.children[2], v: row.children[3] };
});
const STATUS_LABEL = { good: 'good', fair: 'fair', poor: 'poor', railed: 'railed', none: 'no contact', wait: '…' };
const STATUS_DOT = { good: 'on', fair: 'warn', poor: 'bad', railed: 'bad', none: '', wait: '' };
function refreshContact() {
  if (!device) return;
  quality = assessAll(rings, fs); scope.quality = quality;
  let good = 0;
  quality.forEach((q, ch) => {
    const r = contactRows[ch];
    r.dot.className = 'dot ' + STATUS_DOT[q.status];
    r.line.textContent = q.status === STATUS.WAIT ? '' : `hum ${q.line.toFixed(0)}`;
    r.v.textContent = q.status === STATUS.WAIT ? '…' : `${q.rms.toFixed(0)} µV · ${STATUS_LABEL[q.status]}`;
    if (q.status === STATUS.GOOD) good++;
  });
  const waiting = quality[0].status === STATUS.WAIT;
  $('contactSummary').textContent = waiting ? 'Streams a second of signal before judging.' : `${good}/${CHANNELS} good · rms of the filtered trace, hum = 50/60 Hz amplitude on the raw trace`;
}

// ── Loops ────────────────────────────────────────────────────────────────────
function frame() {
  scope.draw(performance.now());
  if (recorder.active) { $('recTime').textContent = `${recorder.seconds.toFixed(1)} s`; $('recSamples').textContent = String(recorder.rows.length); $('recMarks').textContent = String(recorder.marks.length); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(refreshContact, 300);
setInterval(() => {
  const now = performance.now(), dt = (now - rate.t0) / 1000;
  if (dt >= 1) { rate.value = rate.samples / dt; rate.samples = 0; rate.t0 = now; }
  $('statRate').textContent = device ? `${rate.value.toFixed(0)} /s` : '—';
  if (device) { $('statNotif').textContent = String(device.stats.notifications); $('statLen').textContent = `${device.stats.lastLen} B${device.stats.oddBytes ? ' (!' + device.stats.oddBytes + ' odd)' : ''}`; }
  $('statSpikes').textContent = String(chains.reduce((a, c) => a + c.hampel.replaced, 0));
}, 1000);

// ── Buttons and keys ─────────────────────────────────────────────────────────
$('btnConnect').addEventListener('click', () => {
  if (!PiEEGDevice.supported()) { setStatus('Web Bluetooth is not available in this window', 'bad'); return; }
  startSource(new PiEEGDevice());
});
$('btnSim').addEventListener('click', () => startSource(new SimDevice()));
$('btnDisconnect').addEventListener('click', stopSource);
$('btnRecord').addEventListener('click', () => (recorder.active ? stopRecording() : startRecording()));
$('btnMark').addEventListener('click', () => addMark('mark'));
$('btnFolder').addEventListener('click', () => window.alma.openSessionsFolder());
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key.toLowerCase() === 'm') addMark('mark');
  if (e.key.toLowerCase() === 'r' && device) (recorder.active ? stopRecording() : startRecording());
});
window.alma.sessionsDir().then((d) => { $('btnFolder').title = d; });
applySettings();

// Dev harness: `npm start -- --sim` starts the simulator at once (used by the screenshot self-test).
if (window.alma.flags && window.alma.flags.sim) {
  setTimeout(() => startSource(new SimDevice()), 300);
  if (window.alma.flags.events) setTimeout(() => { device?.trigger?.('blink'); setTimeout(() => device?.trigger?.('jaw'), 1500); setTimeout(() => device?.trigger?.('left'), 3200); }, 2500);
}
