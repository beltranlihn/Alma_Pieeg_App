// The catalogue of signals a mapping can send. Each has an id, a label, a group, a natural range and
// a getter over the engine's features. Keep ids stable: they are saved in config.json.
import { CHANNELS } from './ble.js';
import { XR_FACE } from './scope.js';
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';

export const SIGNALS = [];
const add = (id, label, group, unit, range, get, kind = 'continuous') => SIGNALS.push({ id, label, group, unit, range, get, kind });

for (const i of INDICES) add(`idx.${i.id}`, `${i.label} · normalised to the last minute`, 'Indices (0–1, PiEEG formulas)', '0–1', [0, 1], (f) => f.idxNorm[i.id]);
for (const i of INDICES) add(`raw.${i.id}`, `${i.label} · raw ratio ${i.formula}`, 'Indices (raw ratios)', 'ratio', [0, 2], (f) => f.idx[i.id]);
add('calm', 'Calm · α / (α + β), forehead (raw)', 'Indices (raw ratios)', '0–1', [0, 1], (f) => f.calm);
for (const b of BANDS) add(`rel.${b.id}`, `${b.label} · relative power`, 'Bands (forehead average)', '0–1', [0, 1], (f) => f.rel[b.id]);
for (const b of BANDS) add(`abs.${b.id}`, `${b.label} · absolute power`, 'Bands (forehead average)', 'µV²', [0, 200], (f) => f.avg[b.id]);
add('dominant', 'Dominant frequency', 'Bands (forehead average)', 'Hz', [0, 40], (f) => f.avg.dominant);
add('blink.pulse', 'Blink · pulse (1 for 150 ms)', 'Events', '0/1', [0, 1], (f) => f.blinkPulse, 'event');
add('blink.count', 'Blink · count this session', 'Events', 'n', [0, 1000], (f) => f.blinkCount, 'event');
add('blink.amplitude', 'Blink · frontal peak-to-peak', 'Events', 'µV', [0, 400], (f) => f.blinkAmp);
add('heart.bpm', 'Heart · beats per minute', 'Heart', 'bpm', [40, 140], (f) => f.heart.bpm);
add('heart.beat', 'Heart · beat pulse (1 for 150 ms)', 'Heart', '0/1', [0, 1], (f) => f.heart.beat, 'event');
add('heart.rmssd', 'Heart · HRV (RMSSD, last minute)', 'Heart', 'ms', [0, 150], (f) => f.heart.rmssd);
add('heart.connected', 'Heart · device connected (1/0)', 'Heart', '0/1', [0, 1], (f) => f.heart.connected, 'event');
add('contact.ok', 'Contact · all channels good (1/0)', 'Contact', '0/1', [0, 1], (f) => f.contactOk, 'event');
add('contact.good', 'Contact · channels good', 'Contact', 'n', [0, CHANNELS], (f) => f.contactGood);
add('stream.rate', 'Stream · samples per second', 'Contact', '/s', [0, 300], (f) => f.rate);
for (let ch = 0; ch < CHANNELS; ch++) {
  const e = XR_FACE[ch];
  add(`ch${ch + 1}.rms`, `${e.id} · rms (1 s) · ${e.place}`, 'Per channel · amplitude', 'µV', [0, 100], (f) => f.rms[ch]);
  add(`ch${ch + 1}.env`, `${e.id} · envelope (80 ms) · ${e.place}`, 'Per channel · amplitude', 'µV', [0, 100], (f) => f.env[ch]);
}
for (let ch = 0; ch < CHANNELS; ch++) for (const b of BANDS) add(`ch${ch + 1}.${b.id}`, `${XR_FACE[ch].id} · ${b.label}`, 'Per channel · bands (absolute)', 'µV²', [0, 200], (f) => f.bands[ch][b.id]);

export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
export const SIGNAL_GROUPS = [...new Set(SIGNALS.map((s) => s.group))];

// ── Presets ────────────────────────────────────────────────────────────────
export const PRESETS = [
  {
    id: 'biohub', name: 'Soul Charger · BP_BioHub (Quest)',
    destination: { name: 'Quest · BioHub', host: '192.168.0.100', port: 10000, rate: 20 },
    mappings: [
      { signal: 'idx.calm', address: '/muse/calm', type: 'f', outMin: 0, outMax: 1, smooth: 0.6 },
      { signal: 'rel.alpha', address: '/muse/alpha', type: 'f', outMin: 0, outMax: 1, smooth: 0.5 },
      { signal: 'contact.ok', address: '/muse/sensor_active', type: 'i', outMin: 0, outMax: 1, smooth: 0 },
      { signal: 'heart.bpm', address: '/muse/heart_rate', type: 'f', outMin: 40, outMax: 140, smooth: 0 },
      { signal: 'blink.pulse', address: '/muse/blink', type: 'i', outMin: 0, outMax: 1, smooth: 0 },
    ],
  },
  {
    id: 'touchdesigner', name: 'TouchDesigner · /pieeg/*',
    destination: { name: 'TouchDesigner', host: '127.0.0.1', port: 7000, rate: 15 },
    mappings: [
      ...BANDS.map((b) => ({ signal: `rel.${b.id}`, address: `/pieeg/${b.id}`, type: 'f', outMin: 0, outMax: 1, smooth: 0.3 })),
      { signal: 'idx.relax', address: '/pieeg/relax', type: 'f', outMin: 0, outMax: 1, smooth: 0.5 },
      { signal: 'blink.pulse', address: '/pieeg/blink', type: 'i', outMin: 0, outMax: 1, smooth: 0 },
      { signal: 'dominant', address: '/pieeg/dominant', type: 'f', outMin: 0, outMax: 40, smooth: 0.3 },
    ],
  },
  {
    id: 'vrchat', name: 'VRChat · avatar parameters',
    destination: { name: 'VRChat', host: '127.0.0.1', port: 9000, rate: 10 },
    mappings: BANDS.map((b) => ({ signal: `rel.${b.id}`, address: `/avatar/parameters/EEG_${b.id[0].toUpperCase()}${b.id.slice(1)}`, type: 'f', outMin: 0, outMax: 1, smooth: 0.4 })),
  },
];
