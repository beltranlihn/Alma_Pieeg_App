// EEG Alma Center — preload. The only bridge between the page and the host.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const argv = process.argv;
const flags = { sim: argv.includes('--sim'), events: argv.includes('--events') };

contextBridge.exposeInMainWorld('alma', {
  version: '0.1.0',
  flags,
  saveSession: (name, csvText, metaJson) => ipcRenderer.invoke('save-session', name, csvText, metaJson),
  sessionsDir: () => ipcRenderer.invoke('sessions-dir'),
  openSessionsFolder: () => ipcRenderer.invoke('open-sessions-folder'),
  cancelBle: () => ipcRenderer.send('ble-cancel'),
});
