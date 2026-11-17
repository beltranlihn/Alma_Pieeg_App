// ARKit blendshapes from what the mask reads. ARKit's 52 face coefficients are the common language of face rigs
// (iPhone face tracking, Unreal Live Link / MetaHuman, Unity, VRChat, ready-made avatars): the Face › Mirror view
// moves a face with them, and they go out as signals (arkit.*) to drive an avatar anywhere.
// Only what the mask can hear is filled in, from the person's trained gestures, blinks, the gaze and the muscle
// tension; everything else stays 0. The person's own left / right (as ARKit names them, from the face's side).
export const ARKIT = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
  'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight',
  'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'browDownLeft', 'browDownRight',
  'jawOpen', 'mouthClose', 'mouthPressLeft', 'mouthPressRight', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthPucker', 'mouthFunnel', 'cheekSquintLeft', 'cheekSquintRight',
];
/** facecap.glb (Face Cap) names its targets browDown_L … mouthSmile_R. */
export const facecapName = (n) => n.replace(/Left$/, '_L').replace(/Right$/, '_R');
/** The same shape on the other side (for a mirror view). */
export const mirrorName = (n) => (n.endsWith('Left') ? n.slice(0, -4) + 'Right' : n.endsWith('Right') ? n.slice(0, -5) + 'Left' : n);

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

/** Fill `out` from the engine's features. trained: { gestureId: model } (only trained gestures drive shapes; when a
 *  part of the face has none trained, its muscle tension stands in, softer). */
export function arkitWeights(f, trained = {}, out = {}) {
  for (const n of ARKIT) out[n] = 0;
  const has = (id) => !!trained[id], p = (id) => (has(id) && f.face ? clamp(f.face[id], 0, 1) : 0);
  const set = (n, v) => { v = clamp(v, 0, 1); if (v > out[n]) out[n] = v; };
  // eyes: a natural blink (the detector's pulse), a hard blink, a wink
  const blink = f.blinkPulse ? 1 : 0, hard = p('blink_hard');
  set('eyeBlinkLeft', Math.max(blink, hard, p('wink_left'))); set('eyeBlinkRight', Math.max(blink, hard, p('wink_right')));
  set('eyeSquintLeft', 0.6 * hard); set('eyeSquintRight', 0.6 * hard); set('cheekSquintLeft', 0.35 * hard); set('cheekSquintRight', 0.35 * hard);
  // gaze (x: −1 left … 1 right, y: −1 up … 1 down, the person's own directions)
  if (f.gaze && f.gaze.ready) {
    const x = clamp(f.gaze.x), y = clamp(f.gaze.y);
    if (x > 0) { set('eyeLookOutRight', x); set('eyeLookInLeft', x); } else { set('eyeLookOutLeft', -x); set('eyeLookInRight', -x); }
    if (y < 0) { set('eyeLookUpLeft', -y); set('eyeLookUpRight', -y); } else { set('eyeLookDownLeft', y); set('eyeLookDownRight', y); }
  }
  // brows: raised or frowning; without either trained, the brow tension raises them a little
  const up = has('brows_up') || has('frown') ? p('brows_up') : 0.6 * clamp(f.tension && f.tension.brow, 0, 1);
  set('browInnerUp', up); set('browOuterUpLeft', up); set('browOuterUpRight', up);
  set('browDownLeft', p('frown')); set('browDownRight', p('frown'));
  // jaw and mouth
  set('jawOpen', p('jaw_open'));
  const clench = has('clench') ? p('clench') : 0.7 * clamp(f.tension && f.tension.jaw, 0, 1);
  set('mouthPressLeft', 0.8 * clench); set('mouthPressRight', 0.8 * clench); set('mouthClose', 0.3 * clench);
  const smile = p('smile'); set('mouthSmileLeft', smile); set('mouthSmileRight', smile); set('cheekSquintLeft', 0.4 * smile); set('cheekSquintRight', 0.4 * smile);
  set('mouthPucker', p('pucker')); set('mouthFunnel', 0.3 * p('pucker'));
  return out;
}
