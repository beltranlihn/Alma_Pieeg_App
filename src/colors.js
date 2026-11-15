// One colour per band and per index, used everywhere the same signal appears (lanes, bars, meters,
// results, routing). Taken from the VEATION interface palette (parameter colours), so the app stays
// grey and only the data carries colour.
export const BAND_COLOR = {
  delta: '#7fb2e8',   // blue   (p-op)
  theta: '#c58bd0',   // purple (p-rot)
  alpha: '#4a8d6f',   // green  (toggle-on)
  beta: '#e0954b',    // orange (p-az)
  gamma: '#e0645c',   // red    (p-size)
};
export const INDEX_COLOR = {
  calm: '#4a8d6f',
  focus: '#e0954b',
  relax: '#7fb2e8',
  engagement: '#e8c84b',
  workload: '#c58bd0',
  fatigue: '#d06fb0',
  meditation: '#4fc3e8',
};
export const HEART_COLOR = '#e06c6c';
export const FACE_COLOR = '#e8c84b';     // gestures (p-exp)
export const GAZE_COLOR = '#4fc3e8';     // gaze (auto-live)
export const TENSION_COLOR = { jaw: '#e0645c', brow: '#e0954b' };
export const FAA_COLOR = '#c58bd0';
export const NEUTRAL = '#e0e0e0';

/** Colour for a signal id of the catalogue (rel.alpha, idx.focus, heart.bpm, …); neutral otherwise. */
export function signalColor(id) {
  if (!id) return NEUTRAL;
  const [group, name] = id.split('.');
  if ((group === 'rel' || group === 'abs') && BAND_COLOR[name]) return BAND_COLOR[name];
  if ((group === 'idx' || group === 'raw') && INDEX_COLOR[name]) return INDEX_COLOR[name];
  if (id === 'calm') return INDEX_COLOR.calm;
  if (id === 'idx.faa' || id === 'faa') return FAA_COLOR;
  if (id === 'beta.surge') return BAND_COLOR.beta;
  if (group === 'face') return FACE_COLOR;
  if (group === 'gaze') return GAZE_COLOR;
  if (group === 'tension') return TENSION_COLOR[name] || TENSION_COLOR.jaw;
  if (group === 'heart' || group.startsWith('strap')) return HEART_COLOR;
  const m = id.match(/^ch\d\.(\w+)$/); if (m && BAND_COLOR[m[1]]) return BAND_COLOR[m[1]];
  return NEUTRAL;
}
