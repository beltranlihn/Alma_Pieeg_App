// ARKit blendshapes from what the mask reads (src/arkit.js): only trained gestures drive shapes, tension stands in
// where nothing is trained, the gaze turns the right eyes, names convert for facecap and for a mirror.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARKIT, arkitWeights, facecapName, mirrorName } from '../src/arkit.js';

const base = () => ({ face: {}, blinkPulse: 0, gaze: { x: 0, y: 0, ready: 0 }, tension: { jaw: 0, brow: 0 } });

test('names: facecap suffixes and mirror sides', () => {
  assert.equal(facecapName('eyeBlinkLeft'), 'eyeBlink_L'); assert.equal(facecapName('mouthSmileRight'), 'mouthSmile_R'); assert.equal(facecapName('jawOpen'), 'jawOpen');
  assert.equal(mirrorName('eyeLookOutLeft'), 'eyeLookOutRight'); assert.equal(mirrorName('browInnerUp'), 'browInnerUp');
  assert.ok(ARKIT.every((n) => mirrorName(mirrorName(n)) === n));
});

test('an untrained gesture moves nothing, a trained one does', () => {
  const f = base(); f.face.smile = 0.9;
  assert.equal(arkitWeights(f, {}).mouthSmileLeft, 0);
  const w = arkitWeights(f, { smile: {} }); assert.equal(w.mouthSmileLeft, 0.9); assert.equal(w.mouthSmileRight, 0.9); assert.ok(w.cheekSquintLeft > 0.3);
  f.face.wink_left = 1; const v = arkitWeights(f, { wink_left: {} }); assert.equal(v.eyeBlinkLeft, 1); assert.equal(v.eyeBlinkRight, 0);
});

test('a blink pulse closes both eyes; tension stands in only where nothing is trained', () => {
  const f = base(); f.blinkPulse = 1; f.tension = { jaw: 1, brow: 1 };
  const w = arkitWeights(f, {}); assert.equal(w.eyeBlinkLeft, 1); assert.equal(w.eyeBlinkRight, 1);
  assert.ok(Math.abs(w.mouthPressLeft - 0.56) < 1e-9); assert.ok(Math.abs(w.browInnerUp - 0.6) < 1e-9);
  const t = arkitWeights(f, { clench: {}, brows_up: {} }); assert.equal(t.mouthPressLeft, 0); assert.equal(t.browInnerUp, 0);
});

test('gaze: the person looking right turns the right eye out and the left eye in; up and down', () => {
  const f = base(); f.gaze = { x: 0.8, y: -0.5, ready: 1 };
  const w = arkitWeights(f, {}); assert.equal(w.eyeLookOutRight, 0.8); assert.equal(w.eyeLookInLeft, 0.8); assert.equal(w.eyeLookOutLeft, 0);
  assert.equal(w.eyeLookUpLeft, 0.5); assert.equal(w.eyeLookDownLeft, 0);
  f.gaze.ready = 0; assert.equal(arkitWeights(f, {}).eyeLookOutRight, 0, 'no gaze before it is calibrated');
});
