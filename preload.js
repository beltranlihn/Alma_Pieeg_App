// EEG Alma Center — preload. The only bridge between the page and the host.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const argv = process.argv;
const pageArg = argv.find((a) => a.startsWith('--page='));
const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const flags = { sim: argv.includes('--sim'), events: argv.includes('--events'), page: pageArg ? pageArg.split('=')[1] : null, preset: arg('preset'), view: arg('view'), session: arg('session') };

contextBridge.exposeInMainWorld('alma', {
  version: '0.4.0',
  flags,
  saveSession: (name, csvText, metaJson) => ipcRenderer.invoke('save-session', name, csvText, metaJson),
  saveFiles: (name, files) => ipcRenderer.invoke('save-files', name, files),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  sessionsDir: () => ipcRenderer.invoke('sessions-dir'),
  openSessionsFolder: () => ipcRenderer.invoke('open-sessions-folder'),
  cancelBle: () => ipcRenderer.send('ble-cancel'),
  bleKind: (kind) => ipcRenderer.send('ble-kind', kind),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (json) => ipcRenderer.invoke('config-save', json),
  oscSend: (messages) => ipcRenderer.send('osc-send', messages),
  oscStats: () => ipcRenderer.invoke('osc-stats'),
  antStart: () => ipcRenderer.invoke('ant-start'),
  antStop: () => ipcRenderer.invoke('ant-stop'),
  antStatus: () => ipcRenderer.invoke('ant-status'),
  onAnt: (fn) => { ipcRenderer.on('ant-event', (_e, ev) => fn(ev)); },
});
