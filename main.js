// EEG Alma Center — main process.
// Owns the window, the Bluetooth device chooser (Web Bluetooth needs a host handler in Electron),
// the config file, the session files and the OSC/UDP sockets. BLE, DSP and drawing live in the renderer.
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const { encode } = require('./osc-encode.js');
const ant = require('./ant.js');

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

  win.loadFile('index.html');

  // Self-test harness: `electron . --sim --shot=C:\path\out.png --quit-after=6000` captures the window.
  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  const quitArg = process.argv.find((a) => a.startsWith('--quit-after='));
  if (shotArg || quitArg) {
    win.webContents.once('did-finish-load', () => {
      const wait = quitArg ? +quitArg.split('=')[1] : 6000;
      setTimeout(async () => {
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
ipcMain.handle('list-sessions', async () => {
  const dir = sessionsDir();
  const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.csv'));
  const out = [];
  for (const n of names) { const st = await fs.promises.stat(path.join(dir, n)); out.push({ name: n, size: st.size, mtime: st.mtimeMs }); }
  return out.sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('open-sessions-folder', () => shell.openPath(sessionsDir()));
ipcMain.handle('config-load', async () => {
  try { return JSON.parse(await fs.promises.readFile(configPath(), 'utf8')); } catch (_) { return null; }
});
ipcMain.handle('config-save', async (_e, json) => { await fs.promises.writeFile(configPath(), json, 'utf8'); return configPath(); });

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

// ── IPC: ANT+ straps ──────────────────────────────────────────────────────────
ipcMain.handle('ant-start', async () => ant.start());
ipcMain.handle('ant-stop', () => ant.stop());
ipcMain.handle('ant-status', () => ant.getStatus());
ant.onEvent((type, payload) => { if (win && !win.isDestroyed()) win.webContents.send('ant-event', { type, payload }); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
