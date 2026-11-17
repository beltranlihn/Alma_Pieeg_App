// The montage: where each input of the board sits on the face. PiEEG's documentation draws one layout
// (Ch1–Ch4 on the left, Ref and Bias in the centre, Ch5–Ch8 on the right), but a hand-built prototype can be
// wired differently: ours had the reference on the right forehead and the bias on the lower right temple.
// So the map is data, edited in the app (Home › Electrodes) and saved with the config.
//
// A site is a place on the mask; the montage says which input (E1…E8, Ref, Bias) is on each site.
// Everything that depends on position asks the montage at use time: the labels, the 3D head, the blink
// detector (forehead − temples), gaze (right temples − left temples), alpha asymmetry (right − left
// forehead), the tension groups (temples = jaw, forehead = brow) and the gesture cells.
import { CHANNELS } from './ble.js';

// side: L / R as the wearer sees it · region: temple | forehead | centre · dir: where on the 3D head
// (azimuth °, negative = screen left in the mirror view; elevation ° above the eye line)
export const SITES = [
  { id: 'lt_low', label: 'left temple · lower', short: 'L temple low', side: 'L', region: 'temple', dir: { az: -46, el: 16 }, doc: { x: 255, y: 414 } },
  { id: 'lt_up', label: 'left temple · upper', short: 'L temple up', side: 'L', region: 'temple', dir: { az: -45, el: 29 }, doc: { x: 240, y: 296 } },
  { id: 'lf_out', label: 'left forehead · outer', short: 'L forehead out', side: 'L', region: 'forehead', dir: { az: -27, el: 34 }, doc: { x: 320, y: 190 } },
  { id: 'lf_in', label: 'left forehead · inner', short: 'L forehead in', side: 'L', region: 'forehead', dir: { az: -11, el: 37 }, doc: { x: 447, y: 188 } },
  { id: 'c_left', label: 'centre · left', short: 'centre L', side: 'L', region: 'centre', dir: { az: -4, el: 30 }, doc: { x: 627, y: 240 } },
  { id: 'c_right', label: 'centre · right', short: 'centre R', side: 'R', region: 'centre', dir: { az: 4, el: 30 }, doc: { x: 835, y: 240 } },
  { id: 'rf_in', label: 'right forehead · inner', short: 'R forehead in', side: 'R', region: 'forehead', dir: { az: 11, el: 37 }, doc: { x: 1017, y: 188 } },
  { id: 'rf_out', label: 'right forehead · outer', short: 'R forehead out', side: 'R', region: 'forehead', dir: { az: 27, el: 34 }, doc: { x: 1145, y: 190 } },
  { id: 'rt_up', label: 'right temple · upper', short: 'R temple up', side: 'R', region: 'temple', dir: { az: 45, el: 29 }, doc: { x: 1223, y: 296 } },
  { id: 'rt_low', label: 'right temple · lower', short: 'R temple low', side: 'R', region: 'temple', dir: { az: 46, el: 16 }, doc: { x: 1208, y: 414 } },
];
export const SITE_BY_ID = Object.fromEntries(SITES.map((s) => [s.id, s]));
export const INPUTS = [...Array.from({ length: CHANNELS }, (_, k) => `E${k + 1}`), 'Ref', 'Bias'];

export const PRESETS = [
  { id: 'pieeg-docs', name: 'PiEEG XR documentation', channels: ['lt_low', 'lt_up', 'lf_out', 'lf_in', 'rf_in', 'rf_out', 'rt_up', 'rt_low'], ref: 'c_left', bias: 'c_right' },
];
export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Channel labels, kept as live objects so every view that holds XR_FACE sees a changed map. */
export const XR_FACE = Array.from({ length: CHANNELS }, (_, ch) => ({ id: `Ch${ch + 1}`, place: '' }));

export const montage = { preset: 'pieeg-docs', name: PRESETS[0].name, channels: [...PRESETS[0].channels], ref: PRESETS[0].ref, bias: PRESETS[0].bias };
export const groups = { forehead: [], temples: [], leftForehead: [], rightForehead: [], leftTemples: [], rightTemples: [], left: [], right: [] };
const listeners = new Set();
export const onMontage = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Problems with a montage, as short sentences (empty = fine): every input on a site, no site twice. */
export function validateMontage(m) {
  const errs = [], chans = Array.isArray(m && m.channels) ? m.channels : [];
  if (chans.length !== CHANNELS) errs.push(`It needs a site for each of the ${CHANNELS} channels.`);
  const all = [...chans.map((s, k) => [`E${k + 1}`, s]), ['Ref', m && m.ref], ['Bias', m && m.bias]];
  all.forEach(([name, s]) => { if (!SITE_BY_ID[s]) errs.push(`${name} has no site.`); });
  const seen = {}; all.forEach(([name, s]) => { if (s && seen[s] !== undefined) errs.push(`${seen[s]} and ${name} are both on ${SITE_BY_ID[s]?.label || s}.`); else seen[s] = name; });
  return errs;
}

/** What a valid map leaves out, as sentences (it can still be applied). */
export function montageWarnings(m) {
  if (validateMontage(m).length) return [];
  const g = computeGroups(m), out = [];
  if (!g.temples.length) out.push('No channel on a temple: gaze and jaw tension need them.');
  else if (!g.leftTemples.length || !g.rightTemples.length) out.push('Temples on one side only: gaze left / right needs both.');
  if (!g.forehead.length) out.push('No channel on the forehead: blinks, the bands and brow tension need it.');
  else if (!g.leftForehead.length || !g.rightForehead.length) out.push('Forehead on one side only: alpha asymmetry needs both.');
  return out;
}

function computeGroups(m) {
  const at = (pred) => m.channels.map((s, ch) => (pred(SITE_BY_ID[s]) ? ch : -1)).filter((ch) => ch >= 0);
  const front = (s) => s.region === 'forehead' || s.region === 'centre';
  return {
    forehead: at(front), temples: at((s) => s.region === 'temple'),
    leftForehead: at((s) => front(s) && s.side === 'L'), rightForehead: at((s) => front(s) && s.side === 'R'),
    leftTemples: at((s) => s.region === 'temple' && s.side === 'L'), rightTemples: at((s) => s.region === 'temple' && s.side === 'R'),
    left: at((s) => s.side === 'L'), right: at((s) => s.side === 'R'),
  };
}

/** Apply a montage (validated). Returns the problems if it is not valid, and then changes nothing. */
export function setMontage(m) {
  if (!m || typeof m !== 'object') return ['No map.'];
  const next = { preset: m.preset || 'custom', name: m.name || (PRESET_BY_ID[m.preset]?.name ?? 'Custom'), channels: Array.isArray(m.channels) ? [...m.channels] : [], ref: m.ref, bias: m.bias };
  const errs = validateMontage(next); if (errs.length) return errs;
  const same = next.ref === montage.ref && next.bias === montage.bias && next.channels.every((s, k) => s === montage.channels[k]);
  if (same && groups.forehead.length + groups.temples.length) { montage.preset = next.preset; montage.name = next.name; return []; }   // nothing moved: nothing to redo
  Object.assign(montage, next);
  Object.assign(groups, computeGroups(montage));
  montage.channels.forEach((s, ch) => { XR_FACE[ch].place = SITE_BY_ID[s].label; });
  for (const fn of listeners) { try { fn(montage); } catch (e) { console.error(e); } }
  return [];
}
export const usePreset = (id) => setMontage({ ...PRESET_BY_ID[id], preset: id });
export const montageJSON = () => ({ preset: montage.preset, name: montage.name, channels: [...montage.channels], ref: montage.ref, bias: montage.bias });
export const siteOfChannel = (ch) => SITE_BY_ID[montage.channels[ch]];
export const refSite = () => SITE_BY_ID[montage.ref];
export const biasSite = () => SITE_BY_ID[montage.bias];
/** The input on a site ('E3', 'Ref', 'Bias' or ''), for the map drawing. */
export function inputAt(siteId, m = montage) {
  const ch = m.channels.indexOf(siteId); if (ch >= 0) return `E${ch + 1}`;
  return m.ref === siteId ? 'Ref' : m.bias === siteId ? 'Bias' : '';
}

usePreset('pieeg-docs');
