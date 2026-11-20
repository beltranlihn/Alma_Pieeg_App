// Pieeg App — preload. The only bridge between the page and the host.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const argv = process.argv;
const pageArg = argv.find((a) => a.startsWith('--page='));
const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const flags = { sim: argv.includes('--sim'), events: argv.includes('--events'), page: pageArg ? pageArg.split('=')[1] : null, preset: arg('preset'), view: arg('view'), session: arg('session'), calib: arg('calib'), face: arg('face'), wstest: arg('wstest'), probe: argv.some((a) => a.startsWith('--probe=')), gaze: argv.includes('--gaze'), tension: argv.includes('--tension'), tour: arg('tour'), shot: argv.some((a) => a.startsWith('--shot=')) };

contextBridge.exposeInMainWorld('alma', {
  version: arg('app-version') || '0.0.0',              // from package.json, passed by main.js
  flags,
  saveSession: (name, csvText, metaJson) => ipcRenderer.invoke('save-session', name, csvText, metaJson),
  saveFiles: (name, files) => ipcRenderer.invoke('save-files', name, files),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  sessionsDir: () => ipcRenderer.invoke('sessions-dir'),
  openSessionsFolder: () => ipcRenderer.invoke('open-sessions-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  netAddresses: () => ipcRenderer.invoke('net-addresses'),
  sessionRaw: (base) => ipcRenderer.invoke('session-raw', base),
  saveBinary: (base, ext, bytes) => ipcRenderer.invoke('save-binary', base, ext, bytes),
  httpPost: (url, body) => ipcRenderer.invoke('http-post', url, body),
  inputSync: (cfg) => ipcRenderer.send('input-sync', cfg),
  inputStats: () => ipcRenderer.invoke('input-stats'),
  onInput: (fn) => ipcRenderer.on('input-message', (_e, m) => fn(m)),
  onWsMessage: (fn) => ipcRenderer.on('ws-message', (_e, m) => fn(m)),
  sessionsIndex: () => ipcRenderer.invoke('sessions-index'),
  sessionFeatures: (base) => ipcRenderer.invoke('session-features', base),
  revealSession: (base) => ipcRenderer.invoke('session-reveal', base),
  cancelBle: () => ipcRenderer.send('ble-cancel'),
  bleKind: (kind) => ipcRenderer.send('ble-kind', kind),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (json) => ipcRenderer.invoke('config-save', json),
  exportRouting: (json) => ipcRenderer.invoke('routing-export', json),
  importRouting: () => ipcRenderer.invoke('routing-import'),
  oscSend: (messages) => ipcRenderer.send('osc-send', messages),
  oscStats: () => ipcRenderer.invoke('osc-stats'),
  wsSync: (list) => ipcRenderer.send('ws-sync', list),
  wsSend: (messages) => ipcRenderer.send('ws-send', messages),
  wsStats: () => ipcRenderer.invoke('ws-stats'),
  antStart: () => ipcRenderer.invoke('ant-start'),
  antStop: () => ipcRenderer.invoke('ant-stop'),
  antStatus: () => ipcRenderer.invoke('ant-status'),
  onAnt: (fn) => { ipcRenderer.on('ant-event', (_e, ev) => fn(ev)); },
});
