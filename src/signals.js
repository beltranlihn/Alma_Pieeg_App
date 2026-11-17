// The catalogue of signals a mapping can send. Each has an id, a label, a group, a natural range and
// a getter over the engine's features. Keep ids stable: they are saved in config.json.
import { CHANNELS } from './ble.js';
import { XR_FACE, onMontage } from './montage.js';
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';
import { GESTURES } from './face.js';
import { TENSION_GROUPS } from './tension.js';

export const SIGNALS = [];
const add = (id, label, group, unit, range, get, kind = 'continuous') => SIGNALS.push({ id, label, group, unit, range, get, kind });

for (const i of INDICES) add(`idx.${i.id}`, `${i.label} · 0–1 for this person (calibration, or the last minute)`, 'Indices (0–1, PiEEG formulas)', '0–1', [0, 1], (f) => f.idxNorm[i.id]);
for (const i of INDICES) add(`raw.${i.id}`, `${i.label} · raw ratio ${i.formula}`, 'Indices (raw ratios)', 'ratio', [0, 2], (f) => f.idx[i.id]);
add('calm', 'Calm · α / (α + β), forehead (raw)', 'Indices (raw ratios)', '0–1', [0, 1], (f) => f.calm);
for (const b of BANDS) add(`rel.${b.id}`, `${b.label} · relative power`, 'Bands (forehead average)', '0–1', [0, 1], (f) => f.rel[b.id]);
for (const b of BANDS) add(`abs.${b.id}`, `${b.label} · absolute power`, 'Bands (forehead average)', 'µV²', [0, 200], (f) => f.avg[b.id]);
add('dominant', 'Dominant frequency', 'Bands (forehead average)', 'Hz', [0, 40], (f) => f.avg.dominant);
add('cal.score', 'Calibrated · 0 = your rest, 1 = your active', 'Calibration', '0–1', [0, 1], (f) => f.cal.score);
add('cal.ready', 'Calibrated · done (1/0)', 'Calibration', '0/1', [0, 1], (f) => f.cal.ready, 'event');
add('idx.faa', 'Alpha asymmetry · 0–1 for this person (last minute)', 'Indices (0–1, PiEEG formulas)', '0–1', [0, 1], (f) => f.faaNorm);
add('faa', 'Alpha asymmetry · ln α right − ln α left (forehead)', 'Indices (raw ratios)', 'ln', [-1, 1], (f) => f.faa);
add('beta.surge', 'Beta surge · β above its last ~20 s, 0–1', 'Indices (0–1, PiEEG formulas)', '0–1', [0, 1], (f) => f.betaSurge);
for (const g of GESTURES) {
  add(`face.${g.id}`, `${g.label} · probability (trained in Face)`, 'Face · gestures', '0–1', [0, 1], (f) => f.face[g.id]);
  add(`face.${g.id}.on`, `${g.label} · on (1/0)`, 'Face · gestures', '0/1', [0, 1], (f) => f.faceOn[g.id], 'event');
}
add('gaze.x', 'Gaze · horizontal, −1 left … 1 right (EOG)', 'Face · gaze', '−1…1', [-1, 1], (f) => f.gaze.x);
add('gaze.y', 'Gaze · vertical, −1 up … 1 down (EOG)', 'Face · gaze', '−1…1', [-1, 1], (f) => f.gaze.y);
add('gaze.side', 'Gaze · side, −1 left · 0 centre · 1 right', 'Face · gaze', '−1/0/1', [-1, 1], (f) => f.gaze.side, 'event');
add('gaze.ready', 'Gaze · calibrated (1/0)', 'Face · gaze', '0/1', [0, 1], (f) => f.gaze.ready, 'event');
for (const t of TENSION_GROUPS) {
  add(`tension.${t.id}`, `${t.label} tension · 0–1 (${t.where}, muscle above 20 Hz)`, 'Face · tension', '0–1', [0, 1], (f) => f.tension[t.id]);
  add(`tension.${t.id}.on`, `${t.label} tension · on (1/0)`, 'Face · tension', '0/1', [0, 1], (f) => f.tension[`${t.id}On`], 'event');
}
add('blink.pulse', 'Blink · pulse (1 for 150 ms)', 'Events', '0/1', [0, 1], (f) => f.blinkPulse, 'event');
add('blink.count', 'Blink · count this session', 'Events', 'n', [0, 1000], (f) => f.blinkCount, 'event');
add('blink.amplitude', 'Blink · frontal peak-to-peak', 'Events', 'µV', [0, 400], (f) => f.blinkAmp);
add('heart.bpm', 'Heart · beats per minute', 'Heart', 'bpm', [40, 140], (f) => f.heart.bpm);
for (let s = 1; s <= 8; s++) { add(`strap${s}.bpm`, `Strap ${s} · bpm`, 'Heart straps (ANT+)', 'bpm', [40, 140], (f) => f.strap[s].bpm); add(`strap${s}.beat`, `Strap ${s} · beat pulse`, 'Heart straps (ANT+)', '0/1', [0, 1], (f) => f.strap[s].beat, 'event'); add(`strap${s}.on`, `Strap ${s} · present (1/0)`, 'Heart straps (ANT+)', '0/1', [0, 1], (f) => f.strap[s].on, 'event'); }
add('heart.beat', 'Heart · beat pulse (1 for 150 ms)', 'Heart', '0/1', [0, 1], (f) => f.heart.beat, 'event');
add('heart.rmssd', 'Heart · HRV (RMSSD, last minute)', 'Heart', 'ms', [0, 150], (f) => f.heart.rmssd);
add('heart.connected', 'Heart · device connected (1/0)', 'Heart', '0/1', [0, 1], (f) => f.heart.connected, 'event');
for (let k = 1; k <= 3; k++) add(`result${k}`, `Result ${k} · as configured in Live`, 'Session results', '', [-100, 100], (f) => f.result[k - 1]);
add('session.elapsed', 'Session · elapsed seconds', 'Session results', 's', [0, 1800], (f) => f.sessionElapsed);
add('session.active', 'Session · running (1/0)', 'Session results', '0/1', [0, 1], (f) => f.sessionActive, 'event');
add('contact.ok', 'Contact · all channels good (1/0)', 'Contact', '0/1', [0, 1], (f) => f.contactOk, 'event');
add('contact.good', 'Contact · channels good', 'Contact', 'n', [0, CHANNELS], (f) => f.contactGood);
add('contact.ref', 'Contact · reference quiet (1/0)', 'Contact', '0/1', [0, 1], (f) => f.refOk, 'event');
add('contact.common', 'Contact · signal common to all channels (reference noise)', 'Contact', 'µV', [0, 100], (f) => f.refCommon);
add('stream.rate', 'Stream · samples per second', 'Contact', '/s', [0, 300], (f) => f.rate);
for (let ch = 0; ch < CHANNELS; ch++) {
  const e = XR_FACE[ch];
  add(`ch${ch + 1}.rms`, `${e.id} · rms (1 s) · ${e.place}`, 'Per channel · amplitude', 'µV', [0, 100], (f) => f.rms[ch]);
  add(`ch${ch + 1}.env`, `${e.id} · envelope (80 ms) · ${e.place}`, 'Per channel · amplitude', 'µV', [0, 100], (f) => f.env[ch]);
  add(`ch${ch + 1}.emg`, `${e.id} · muscle (above 20 Hz, 100 ms) · ${e.place}`, 'Per channel · amplitude', 'µV', [0, 50], (f) => f.emg[ch]);
}
for (let ch = 0; ch < CHANNELS; ch++) for (const b of BANDS) add(`ch${ch + 1}.${b.id}`, `${XR_FACE[ch].id} · ${b.label}`, 'Per channel · bands (absolute)', 'µV²', [0, 200], (f) => f.bands[ch][b.id]);

export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
// When the electrode map changes, the per-channel labels say the new place.
onMontage(() => {
  for (let ch = 0; ch < CHANNELS; ch++) {
    const e = XR_FACE[ch];
    if (SIGNAL_BY_ID[`ch${ch + 1}.rms`]) SIGNAL_BY_ID[`ch${ch + 1}.rms`].label = `${e.id} · rms (1 s) · ${e.place}`;
    if (SIGNAL_BY_ID[`ch${ch + 1}.env`]) SIGNAL_BY_ID[`ch${ch + 1}.env`].label = `${e.id} · envelope (80 ms) · ${e.place}`;
    if (SIGNAL_BY_ID[`ch${ch + 1}.emg`]) SIGNAL_BY_ID[`ch${ch + 1}.emg`].label = `${e.id} · muscle (above 20 Hz, 100 ms) · ${e.place}`;
  }
});
export const SIGNAL_GROUPS = [...new Set(SIGNALS.map((s) => s.group))];

// Presets were removed: OSC is generic (name, host, port, type). Keep the Soul Charger addresses here as
// the reference contract the BioHub expects: /muse/calm, /muse/alpha, /muse/sensor_active, /muse/heart_rate on UDP 10000.
export const PRESETS = [];
