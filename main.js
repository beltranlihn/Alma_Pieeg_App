// EEG Alma Center — main process.
// Owns the window, the Bluetooth device chooser (Web Bluetooth needs a host handler in Electron)
// and the session files on disk. Everything else (BLE, DSP, drawing) lives in the renderer.
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let pendingBleCallback = null;   // Chromium re-emits select-bluetooth-device as devices appear

function sessionsDir() {
  const dir = path.join(app.getPath('documents'), 'EEG Alma Center', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name) {
  return String(name || 'session').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#111111',
    title: 'EEG Alma Center',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: process.argv.filter((a) => a.startsWith('--')),   // flags reach the preload
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,   // the scope and the BLE loop must not slow down when hidden
    },
  });

  // Web Bluetooth: the renderer calls navigator.bluetooth.requestDevice(); Chromium hands us the
  // list of advertising devices and we pick the PiEEG. Without this handler nothing connects.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    const pick = devices.find((d) => /pieeg|ironbci|eareeg/i.test(d.deviceName || ''));
    if (pick) {
      pendingBleCallback = null;
      callback(pick.deviceId);
    } else {
      pendingBleCallback = callback;   // keep scanning; the event fires again with more devices
    }
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

ipcMain.on('ble-cancel', () => {
  if (pendingBleCallback) { pendingBleCallback(''); pendingBleCallback = null; }
});

ipcMain.handle('sessions-dir', () => sessionsDir());

ipcMain.handle('save-session', async (_e, name, csvText, metaJson) => {
  const dir = sessionsDir();
  const base = safeName(name);
  const csvPath = path.join(dir, base + '.csv');
  await fs.promises.writeFile(csvPath, csvText, 'utf8');
  if (metaJson) await fs.promises.writeFile(path.join(dir, base + '.json'), metaJson, 'utf8');
  return csvPath;
});

ipcMain.handle('open-sessions-folder', () => shell.openPath(sessionsDir()));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
