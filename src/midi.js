// MIDI out through the system's ports (Web MIDI). A mapping's address says what to send: "cc 1" (a controller,
// 0–127 from the mapping's output) or "note 60" (on while the value is in the upper half, off below). On Windows a
// virtual port (loopMIDI) carries it to Ableton, Max, a synth or a lighting desk on the same computer.
let access = null, outputs = [];
const listeners = new Set();

export async function midiInit() {
  if (access || typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return outputs;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); access.onstatechange = refresh; refresh(); } catch (_) { access = null; }
  return outputs;
}
function refresh() { outputs = access ? [...access.outputs.values()] : []; for (const fn of listeners) fn(midiOutputs()); }
export const onMidiPorts = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const midiOutputs = () => outputs.map((o) => o.name);

/** "cc 7" → { kind: 'cc', n: 7 } · "note 60" → { kind: 'note', n: 60 } · anything else → null. */
export function parseMidiAddress(a) {
  const m = /^\s*(cc|note)\s*(\d{1,3})\s*$/i.exec(String(a || '')); if (!m) return null;
  return { kind: m[1].toLowerCase(), n: Math.min(127, +m[2]) };
}
/** A mapping's output value as a 7-bit MIDI value: outputs up to 1 are scaled to 0–127, larger ones taken as is. */
export const to7bit = (v, outMax) => Math.max(0, Math.min(127, Math.round(outMax <= 1 ? v * 127 : v)));

export function midiSend(portName, bytes) {
  const o = outputs.find((x) => x.name === portName); if (!o) return false;
  try { o.send(bytes); return true; } catch (_) { return false; }
}
/** The bytes for one value (null when nothing has to go out). state remembers the last value per mapping. */
export function midiMessage(address, value7, channel, last) {
  const a = parseMidiAddress(address); if (!a) return null;
  const ch = Math.max(0, Math.min(15, (channel | 0) - 1));
  if (a.kind === 'cc') return last === value7 ? null : [0xb0 | ch, a.n, value7];
  const on = value7 >= 64, was = last >= 64;
  if (last !== undefined && on === was) return null;
  return on ? [0x90 | ch, a.n, 100] : [0x80 | ch, a.n, 0];
}
/** A short trigger (rules, cues): a note for 120 ms, or a controller at 127 then 0. */
export function midiPulse(portName, address, channel) {
  const a = parseMidiAddress(address); if (!a) return false;
  const ch = Math.max(0, Math.min(15, (channel | 0) - 1));
  const on = a.kind === 'note' ? [0x90 | ch, a.n, 100] : [0xb0 | ch, a.n, 127], off = a.kind === 'note' ? [0x80 | ch, a.n, 0] : [0xb0 | ch, a.n, 0];
  if (!midiSend(portName, on)) return false;
  setTimeout(() => midiSend(portName, off), 120); return true;
}
