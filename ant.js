// ANT+ heart-rate straps through a USB stick (main process). Same hardware as Latido Común:
// a Garmin/Dynastream dongle (vendor 0x0FCF) with the WinUSB driver (Zadig) and ANT+ chest or
// wrist straps. We run one scanner that hears every strap in range and forwards each reading.
'use strict';

let stick = null, scanner = null, lib = null;
let status = { state: 'idle', message: 'ANT+ stick not started' };
const listeners = new Set();

function emit(type, payload) { for (const fn of listeners) { try { fn(type, payload); } catch (_) {} } }
function setStatus(state, message) { status = { state, message }; emit('status', status); }

async function start() {
  if (stick) return status;
  try { lib = require('ant-plus-next'); } catch (e) { setStatus('error', `ANT+ library unavailable: ${e.message}`); return status; }
  const candidates = [lib.GarminStick3, lib.GarminStick2];
  let opened = false;
  for (const Stick of candidates) {
    const s = new Stick();
    try { if (!(await s.isPresent())) continue; } catch (_) { continue; }
    const sc = new lib.HeartRateScanner(s);
    sc.on('heartRateData', (d) => {
      // d: { DeviceId, ComputedHeartRate, BeatCount, BeatTime, RRInterval?, Rssi?, ... }
      emit('data', { id: d.DeviceId, bpm: d.ComputedHeartRate || 0, beatCount: d.BeatCount || 0, beatTime: d.BeatTime || 0, rr: d.RRInterval || null, rssi: d.Rssi ?? null, t: Date.now() });
    });
    s.on('startup', () => { sc.scan(); setStatus('open', 'ANT+ stick open, listening for straps'); });
    s.on('shutdown', () => { setStatus('idle', 'ANT+ stick closed'); });
    s.on('error', (e) => { setStatus('error', `ANT+: ${e && e.message ? e.message : e}`); });
    let ok = false;
    setStatus('opening', 'Opening ANT+ stick…');
    try { ok = await s.open(); } catch (e) { ok = false; setStatus('error', `ANT+ stick: ${e && e.message ? e.message : e} (on Windows the dongle needs the WinUSB driver, installed with Zadig)`); }
    if (ok) { stick = s; scanner = sc; opened = true; break; }
  }
  if (!opened && status.state !== 'error') setStatus('no-stick', 'No ANT+ USB stick found. Plug the Garmin dongle in.');
  return status;
}

async function stop() {
  if (!stick) return status;
  try { await stick.close(); } catch (_) {}
  stick = null; scanner = null; setStatus('idle', 'ANT+ stick closed');
  return status;
}

module.exports = { start, stop, getStatus: () => status, onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
