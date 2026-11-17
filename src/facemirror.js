// Face › Mirror: a face that does what the mask reads, live. The model is facecap.glb (Face Cap by Bannaflak, from
// the three.js examples, the one PiEEG's Face Trainer v2 uses), decoded once into assets/models/facecap.glb with its
// texture removed: it is painted with the app's own grey skin. Its 52 ARKit targets take arkit.js's weights,
// smoothed so it moves like a face and not like a meter; the eyeballs turn with the gaze.
// Licence of the model: not stated by its author. Internal use (PiEEG and Alma) until confirmed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARKIT, facecapName, mirrorName } from './arkit.js';

const SKIN = new THREE.Color('#5a5a5a');

export class FaceMirror {
  constructor(container) {
    this.container = container; this.ready = false; this.error = '';
    this.mirror = true;                    // like a mirror: the person's left on the screen's left
    this.target = Object.fromEntries(ARKIT.map((n) => [n, 0])); this.now = { ...this.target };
    this.gaze = { x: 0, y: 0, on: false }; this._gz = { x: 0, y: 0 };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x111111, 1); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100);
    this.scene.add(new THREE.HemisphereLight(0xdedede, 0x1a1a1a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(-2.5, 3.5, 3.5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfc8d6, 0.55); fill.position.set(3, 0.5, 2.5); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(1.5, 2.5, -4); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.9; this.controls.maxPolarAngle = 2.0;
    this._resize = this._resize.bind(this); new ResizeObserver(this._resize).observe(container);
    this._load().catch((e) => { this.error = `Could not load the face: ${e.message || e}`; });
    this._frame = this._frame.bind(this); requestAnimationFrame(this._frame);
  }

  async _load() {
    const gltf = await new GLTFLoader().loadAsync('assets/models/facecap.glb');
    const root = gltf.scene;
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0.04 });
    const eye = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.22, metalness: 0.05 });   // sclera; an iris disc is added on each eye
    const teeth = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.5 });
    root.traverse((o) => {
      if (!o.isMesh) return;
      const path = []; for (let p = o; p; p = p.parent) path.push((p.name || '').toLowerCase());
      o.material = path.some((n) => n.startsWith('eye') || n.includes('grp_eye')) ? eye : path.some((n) => n.includes('teeth')) ? teeth : skin;
      if (o.morphTargetDictionary && o.morphTargetInfluences && (!this.head || Object.keys(o.morphTargetDictionary).length > Object.keys(this.head.morphTargetDictionary).length)) this.head = o;
    });
    if (!this.head) throw new Error('no blendshapes in the model');
    this.eyes = { L: root.getObjectByName('eyeLeft'), R: root.getObjectByName('eyeRight') };
    this.eyeBase = { L: this.eyes.L ? this.eyes.L.rotation.clone() : null, R: this.eyes.R ? this.eyes.R.rotation.clone() : null };
    this.scene.add(root);
    root.updateMatrixWorld(true);
    // irises: a dark cap (and a darker pupil) laid on each eyeball's sphere, carried by the eye so the gaze shows and
    // the lids cover them as they close
    const iris = new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.3, metalness: 0.1 });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const s of ['L', 'R']) {
      const e = this.eyes[s]; if (!e) continue;
      // the eyeball measured in the eye's own space (a world box grows with the eye's tilt): a sphere whose front is
      // flattened where the model's own iris sits, so the radius is the largest half-extent and the centre sits one
      // radius in from the full side of each axis
      const ball = e.children.find((o) => o.isMesh && o.geometry.attributes.position.count > 100); if (!ball) continue;
      ball.updateMatrix(); const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate(), v = new THREE.Vector3(), pa = ball.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(ball.matrix); lo.min(v); hi.max(v); }
      const half = hi.clone().sub(lo).multiplyScalar(0.5), R = Math.max(half.x, half.y, half.z), centre = new THREE.Vector3();
      for (const k of ['x', 'y', 'z']) centre[k] = half[k] > R * 0.99 ? (lo[k] + hi[k]) / 2 : (Math.abs(hi[k]) < Math.abs(lo[k]) ? lo[k] + R : hi[k] - R);
      const cw = e.localToWorld(centre.clone()), fwd = e.worldToLocal(cw.clone().add(new THREE.Vector3(0, 0, 1))).sub(centre).normalize();
      const orient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd);
      const cap = (radius, angle, mat) => { const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 8, 0, Math.PI * 2, 0, angle), mat); m.position.copy(centre); m.quaternion.copy(orient); e.add(m); };
      cap(R * 1.004, Math.asin(0.46), iris); cap(R * 1.008, Math.asin(0.19), pupil);
    }
    const box = new THREE.Box3().setFromObject(this.head), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    this.focus = c; this.dist = Math.max(size.x, size.y) * 2.6;
    this.index = {}; for (const n of ARKIT) { const k = this.head.morphTargetDictionary[facecapName(n)]; if (k !== undefined) this.index[n] = k; }
    this.resetView(); this.ready = true; this._resize();
  }

  resetView() {
    if (!this.focus) return;
    this.camera.position.set(this.focus.x, this.focus.y + this.dist * 0.05, this.focus.z + this.dist);
    this.controls.target.copy(this.focus); this.controls.minDistance = this.dist * 0.5; this.controls.maxDistance = this.dist * 2.2; this.controls.update();
  }

  /** A ten-second loop of expressions and glances, for the guided tour (the simulator has no trained gestures). */
  _demo(t) {
    const w = {}, s = t % 10, g = { x: 0, y: 0, on: true }, part = (a, b) => (s >= a && s < b ? Math.sin(Math.PI * (s - a) / (b - a)) : 0);
    w.mouthSmileLeft = w.mouthSmileRight = 0.85 * part(0, 1.6); w.cheekSquintLeft = w.cheekSquintRight = 0.3 * part(0, 1.6);
    w.browInnerUp = w.browOuterUpLeft = w.browOuterUpRight = part(1.6, 3.2);
    w.eyeBlinkLeft = part(3.2, 4.2); w.jawOpen = 0.55 * part(4.2, 5.8);
    g.x = -0.85 * part(5.8, 7.4) + 0.85 * part(7.4, 9);
    w.browDownLeft = w.browDownRight = 0.8 * part(9, 10); w.mouthPressLeft = w.mouthPressRight = 0.6 * part(9, 10);
    const blink = (t % 3.3) < 0.15 ? 1 : 0; w.eyeBlinkLeft = Math.max(w.eyeBlinkLeft, blink); w.eyeBlinkRight = blink;
    this.set(w, g);
  }

  /** New target weights (ARKit names, the person's own sides) and gaze ({ x, y, on }). */
  set(weights, gaze) { for (const n of ARKIT) this.target[n] = weights[n] || 0; if (gaze) this.gaze = gaze; }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _frame() {
    requestAnimationFrame(this._frame);
    if (!this.ready || !this.container.offsetParent) return;          // hidden page: nothing to draw
    if (this.demo) this._demo(performance.now() / 1000);
    const inf = this.head.morphTargetInfluences;
    for (const n of ARKIT) {
      const t = this.target[n], cur = this.now[n];
      const k = n.startsWith('eyeBlink') ? 0.55 : 0.22;                // blinks are fast, the rest eases
      this.now[n] = cur + (t - cur) * k;
      const shape = this.mirror ? mirrorName(n) : n, idx = this.index[shape];
      if (idx !== undefined) inf[idx] = this.now[n];
    }
    // eyeballs: the person's gaze; in a mirror, looking to their right turns the eyes to the screen's right.
    // The model sits under a +90° turn about X (its eyes look along local +Y), so a turn about the world's vertical
    // is a turn about the eye's local −Z, and looking down is +X.
    const gx = this.gaze.on ? this.gaze.x : 0, gy = this.gaze.on ? this.gaze.y : 0;
    this._gz.x += (gx - this._gz.x) * 0.2; this._gz.y += (gy - this._gz.y) * 0.2;
    const yaw = (this.mirror ? 1 : -1) * this._gz.x * 0.38, pitch = this._gz.y * 0.25;
    for (const s of ['L', 'R']) { const e = this.eyes[s], b = this.eyeBase[s]; if (e && b) e.rotation.set(b.x + pitch, b.y, b.z - yaw); }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
