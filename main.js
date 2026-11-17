// EEG Alma Center — main process.
// Owns the window, the Bluetooth device chooser (Web Bluetooth needs a host handler in Electron),
// the config file, the session files, the OSC/UDP sockets and the WebSocket listeners. BLE, DSP and drawing live in the renderer.
'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { encode } = require('./osc-encode.js');
const ant = require('./ant.js');
const { Hub } = require('./ws-server.js');
const wsHub = new Hub();

let win = null;
let pendingBleCallback = null;   // Chromium re-emits select-bluetooth-device as devices appear
let bleKind = 'pieeg';           // what the renderer is about to request: 'pieeg' | 'heart'
let udp = null;
const oscStats = { sent: 0, errors: 0 };

function sessionsDir() {
  const dir = path.join(app.getPath('documents'), 'EEG Alma Center', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function safeName(name) { return String(name || 'session').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80); }

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 680,
    backgroundColor: '#111111', title: 'EEG Alma Center', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: process.argv.filter((a) => a.startsWith('--')),   // flags reach the preload
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      backgroundThrottling: false,   // the scope and the BLE loop must not slow down when hidden
    },
  });

  // Web Bluetooth: the renderer calls navigator.bluetooth.requestDevice(); Chromium hands us the
  // list of advertising devices and we pick the PiEEG. Without this handler nothing connects.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    const pick = bleKind === 'heart' ? devices[0] : devices.find((d) => /pieeg|ironbci|eareeg/i.test(d.deviceName || ''));
    if (pick) { pendingBleCallback = null; callback(pick.deviceId); }
    else pendingBleCallback = callback;   // keep scanning; the event fires again with more devices
  });

  const sizeArg = process.argv.find((a) => a.startsWith('--size='));
  if (sizeArg) { const [w, h] = sizeArg.split('=')[1].split('x').map(Number); win.setContentSize(w, h); }
  win.loadFile('index.html');

  // --connect: press Connect PiEEG once the page is up. Web Bluetooth only starts from a user gesture, so the
  // click is sent as one (executeJavaScript with userGesture = true).
  if (process.argv.includes('--connect')) {
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      win.webContents.executeJavaScript("document.getElementById('hdrConnect').click()", true).catch(() => {});
    }, 1500));
  }

  // Self-test harness: `electron . --sim --shot=C:\path\out.png --quit-after=6000` captures the window.
  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  const quitArg = process.argv.find((a) => a.startsWith('--quit-after='));
  if (shotArg || quitArg) {
    win.webContents.on('console-message', (e) => { const lvl = e.level ?? e.params?.level; if (lvl === 'error' || lvl === 'warning' || lvl >= 2) console.log('CONSOLE', lvl, e.message ?? e.params?.message, (e.sourceId || '').split('/').pop(), e.lineNumber || ''); });
    win.webContents.once('did-finish-load', () => {
      const wait = quitArg ? +quitArg.split('=')[1] : 6000;
      setTimeout(async () => {
        const probeArg = process.argv.find((a) => a.startsWith('--probe='));
        if (probeArg) { try { console.log('PROBE', JSON.stringify(await win.webContents.executeJavaScript(decodeURIComponent(probeArg.slice(8))))); } catch (e) { console.log('PROBE-ERR', e.message); } }
        if (shotArg) { const img = await win.webContents.capturePage(); fs.writeFileSync(shotArg.split('=')[1], img.toPNG()); }
        app.quit();
      }, wait);
    });
  }
}

// ── IPC: Bluetooth, sessions, config ──────────────────────────────────────────
ipcMain.on('ble-kind', (_e, kind) => { bleKind = kind === 'heart' ? 'heart' : 'pieeg'; });
ipcMain.on('ble-cancel', () => { if (pendingBleCallback) { pendingBleCallback(''); pendingBleCallback = null; } });
ipcMain.handle('sessions-dir', () => sessionsDir());
ipcMain.handle('save-session', async (_e, name, csvText, metaJson) => {
  const dir = sessionsDir(), base = safeName(name), csvPath = path.join(dir, base + '.csv');
  await fs.promises.writeFile(csvPath, csvText, 'utf8');
  if (metaJson) await fs.promises.writeFile(path.join(dir, base + '.json'), metaJson, 'utf8');
  return csvPath;
});
ipcMain.handle('save-files', async (_e, name, files) => {
  const dir = sessionsDir(), base = safeName(name), out = [];
  for (const [ext, text] of Object.entries(files)) { const p = path.join(dir, base + ext); await fs.promises.writeFile(p, text, 'utf8'); out.push(p); }
  return out;
});
ipcMain.handle('list-sessions', async () => {
  const dir = sessionsDir();
  const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.csv'));
  const out = [];
  for (const n of names) { const st = await fs.promises.stat(path.join(dir, n)); out.push({ name: n, size: st.size, mtime: st.mtimeMs }); }
  return out.sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('open-sessions-folder', () => shell.openPath(sessionsDir()));
// Sessions page: every saved session that has a summary (0.4 and later), newest first
ipcMain.handle('sessions-index', async () => {
  const dir = sessionsDir(), out = [];
  for (const n of (await fs.promises.readdir(dir)).filter((x) => x.endsWith('.summary.json'))) {
    try {
      const s = JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8')), base = n.slice(0, -'.summary.json'.length);
      out.push({ base, participant: s.participant || '', notes: s.notes || '', started_at: s.started_at, duration_sec: s.duration_sec, results: s.results || [], calibrated: !!s.calibrated, face: s.face || null, marks: s.marks || [], signals: s.signals || {}, hasFeatures: fs.existsSync(path.join(dir, base + '.features.csv')) });
    } catch (_) { /* a broken summary is skipped */ }
  }
  return out.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
});
ipcMain.handle('session-features', async (_e, base) => {
  const p = path.join(sessionsDir(), safeName(base) + '.features.csv');
  try { return await fs.promises.readFile(p, 'utf8'); } catch (_) { return null; }
});
ipcMain.handle('session-reveal', (_e, base) => { shell.showItemInFolder(path.join(sessionsDir(), safeName(base) + '.summary.json')); });
ipcMain.handle('config-load', async () => {
  try { return JSON.parse(await fs.promises.readFile(configPath(), 'utf8')); } catch (_) { return null; }
});
ipcMain.handle('config-save', async (_e, json) => { await fs.promises.writeFile(configPath(), json, 'utf8'); return configPath(); });
// Routing table as a file, to share a piece's wiring
ipcMain.handle('routing-export', async (_e, json) => {
  const dir = path.join(app.getPath('documents'), 'EEG Alma Center'); fs.mkdirSync(dir, { recursive: true });
  const r = await dialog.showSaveDialog(win, { title: 'Export routing', defaultPath: path.join(dir, 'routing.json'), filters: [{ name: 'Routing', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, json, 'utf8'); return r.filePath;
});
ipcMain.handle('routing-import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import routing', properties: ['openFile'], defaultPath: path.join(app.getPath('documents'), 'EEG Alma Center'), filters: [{ name: 'Routing', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], text: await fs.promises.readFile(r.filePaths[0], 'utf8') };
});

// ── IPC: OSC over UDP ─────────────────────────────────────────────────────────
function socket() {
  if (!udp) { udp = dgram.createSocket('udp4'); udp.on('error', () => { oscStats.errors++; }); }
  return udp;
}
/** messages: [{ host, port, address, args: [{type, value}] }] — one UDP datagram each. */
ipcMain.on('osc-send', (_e, messages) => {
  const s = socket();
  for (const m of messages) {
    try { s.send(encode(m.address, m.args), m.port, m.host, (err) => { if (err) oscStats.errors++; else oscStats.sent++; }); }
    catch (_) { oscStats.errors++; }
  }
});
ipcMain.handle('osc-stats', () => ({ ...oscStats }));

// ── IPC: WebSocket (JSON to any client that connects) ────────────────────────
ipcMain.on('ws-sync', (_e, list) => { try { wsHub.sync(Array.isArray(list) ? list : []); } catch (_) { /* reported in stats */ } });
ipcMain.on('ws-send', (_e, messages) => { try { wsHub.send(messages); } catch (_) { /* a client went away */ } });
ipcMain.handle('ws-stats', () => wsHub.stats());

// ── IPC: ANT+ straps ──────────────────────────────────────────────────────────
ipcMain.handle('ant-start', async () => ant.start());
ipcMain.handle('ant-stop', () => ant.stop());
ipcMain.handle('ant-status', () => ant.getStatus());
ant.onEvent((type, payload) => { if (win && !win.isDestroyed()) win.webContents.send('ant-event', { type, payload }); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { wsHub.closeAll(); app.quit(); });
