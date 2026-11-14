// 3D head with the PiEEG XR electrodes and a heat map painted on the skin (vertex colours):
// contact quality by default, any per-channel value (band power, rms) in general.
// Model: Lee Perry-Smith head scan (Infinite-Realities, CC-BY), shipped with the three.js examples.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XR_FACE } from './scope.js';

// Where each electrode sits, as a direction from the head centre: azimuth (°, negative = screen
// left = the wearer's left, mirror view) and elevation (° above the eye line).
const DIRS = [
  { az: -52, el: 16 },  // Ch1 left temple lower
  { az: -50, el: 29 },  // Ch2 left temple upper
  { az: -27, el: 34 },  // Ch3 left forehead outer
  { az: -11, el: 37 },  // Ch4 left forehead inner
  { az: 11, el: 37 },   // Ch5 right forehead inner
  { az: 27, el: 34 },   // Ch6 right forehead outer
  { az: 50, el: 29 },   // Ch7 right temple upper
  { az: 52, el: 16 },   // Ch8 right temple lower
];
const AUX = [{ az: -4, el: 46, label: 'ref' }, { az: 4, el: 46, label: 'bias' }];
const STATUS_SCORE = { good: 1, fair: 0.6, poor: 0.2, railed: 0, none: 0, wait: -1 };
const SKIN = new THREE.Color('#3a3a3a');
const C_GOOD = new THREE.Color('#4a8d6f'), C_FAIR = new THREE.Color('#e5b567'), C_BAD = new THREE.Color('#e06c6c'), C_NONE = new THREE.Color('#6d6d6d');
const C_LO = new THREE.Color('#262626'), C_MID = new THREE.Color('#e5b567'), C_HI = new THREE.Color('#ffffff');

function dirVec({ az, el }) { const a = az * Math.PI / 180, e = el * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); }

export class HeadView {
  constructor(container) {
    this.container = container;
    this.mode = 'contact';                        // 'contact' | 'value'
    this.values = new Float32Array(8);            // 0–1 per channel in 'value' mode
    this.quality = null;
    this.ready = false;
    this.radius = 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x111111, 1);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-2, 3, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(3, 1, -3); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.7; this.controls.maxPolarAngle = 2.0; this.controls.minDistance = 2.2; this.controls.maxDistance = 6;
    this.markers = []; this.labels = [];
    this._resize = this._resize.bind(this); window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(container);
    this._load();
    this._frame = this._frame.bind(this); requestAnimationFrame(this._frame);
  }

  async _load() {
    const gltf = await new GLTFLoader().loadAsync('assets/models/LeePerrySmith.glb');
    let mesh = null; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    gltf.scene.updateMatrixWorld(true);
    const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld); geo.computeVertexNormals();
    const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const s = 2 / size.y;                                       // head height = 2 units
    geo.translate(-center.x, -center.y, -center.z); geo.scale(s, s, s);
    // drop everything below the neck (no shoulders): keep triangles whose vertices are all above the cut
    const CUT = -0.42;
    const posAttr = geo.attributes.position, idx = geo.index ? Array.from(geo.index.array) : [...Array(posAttr.count).keys()];
    const kept = [];
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (posAttr.getY(a) > CUT && posAttr.getY(b) > CUT && posAttr.getY(c) > CUT) kept.push(a, b, c); }
    geo.setIndex(kept);
    this.radius = 1;
    const n = geo.attributes.position.count;
    this.colors = new Float32Array(n * 3); for (let i = 0; i < n; i++) SKIN.toArray(this.colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.head = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 }));
    this.scene.add(this.head);
    this.positions = geo.attributes.position.array;
    // electrode points: cast a ray from outside toward the centre along each direction
    const ray = new THREE.Raycaster();
    const eyeLine = 0.18;                                       // the eye line sits a bit above the centre of the bounding box
    const place = (d) => {
      const v = dirVec(d), origin = v.clone().multiplyScalar(4).add(new THREE.Vector3(0, eyeLine, 0));
      ray.set(origin, v.clone().negate());
      const hit = ray.intersectObject(this.head, false)[0];
      return hit ? { p: hit.point.clone(), n: hit.face.normal.clone().normalize() } : { p: origin.multiplyScalar(0.25), n: v.clone() };
    };
    const placed = DIRS.map(place), auxPlaced = AUX.map(place);
    this.points = placed.map((x) => x.p);
    this.auxPoints = auxPlaced.map((x) => x.p);
    const mk = new THREE.CircleGeometry(0.032, 32);
    placed.forEach(({ p, n: nrm }) => {
      const m = new THREE.Mesh(mk, new THREE.MeshBasicMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide }));
      m.position.copy(p).add(nrm.clone().multiplyScalar(0.012)); m.lookAt(m.position.clone().add(nrm)); this.scene.add(m); this.markers.push(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.04, 32), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
      ring.position.copy(m.position); ring.quaternion.copy(m.quaternion); this.scene.add(ring);
    });
    auxPlaced.forEach(({ p, n: nrm }) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.024, 24), new THREE.MeshBasicMaterial({ color: 0x8c8c8c, side: THREE.DoubleSide }));
      m.position.copy(p).add(nrm.clone().multiplyScalar(0.012)); m.lookAt(m.position.clone().add(nrm)); this.scene.add(m);
    });
    this.resetView();
    this.ready = true; this._resize(); this.update(this.quality);
  }

  _label(text, size = 12) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    g.font = `600 ${size * 3}px Geist, Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e0e0e0'; g.fillText(text, 32, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    sp.scale.set(0.14, 0.14, 1); sp.renderOrder = 10; return sp;
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Repaint from contact quality (mode 'contact') or from this.values (mode 'value'). */
  update(quality) {
    this.quality = quality; if (!this.ready) return;
    const scores = new Float32Array(8), cols = [];
    for (let i = 0; i < 8; i++) {
      if (this.mode === 'contact') {
        const st = quality ? quality[i].status : 'wait'; scores[i] = STATUS_SCORE[st];
        cols.push(st === 'good' ? C_GOOD : st === 'fair' ? C_FAIR : st === 'poor' || st === 'railed' ? C_BAD : st === 'none' ? C_NONE : null);
      } else { scores[i] = Math.max(0, Math.min(1, this.values[i])); cols.push(this._ramp(scores[i])); }
      const m = this.markers[i]; m.material.color.set(cols[i] || new THREE.Color(0x4a4a4a));
    }
    // vertex colours: gaussian splat of each electrode's colour on the skin
    const pos = this.positions, n = pos.length / 3, sigma = 0.11, tmp = new THREE.Color();
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let wsum = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < 8; i++) {
        const c = cols[i]; if (!c) continue;
        const p = this.points[i], dx = x - p.x, dy = y - p.y, dz = z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        const w = Math.exp(-d2 / (2 * sigma * sigma)); if (w < 0.002) continue;
        wsum += w; r += w * c.r; g += w * c.g; b += w * c.b;
      }
      if (wsum > 0) { const a = Math.min(1, wsum * 0.55); tmp.setRGB(r / wsum, g / wsum, b / wsum); this.colors[v * 3] = SKIN.r + (tmp.r - SKIN.r) * a; this.colors[v * 3 + 1] = SKIN.g + (tmp.g - SKIN.g) * a; this.colors[v * 3 + 2] = SKIN.b + (tmp.b - SKIN.b) * a; }
      else { this.colors[v * 3] = SKIN.r; this.colors[v * 3 + 1] = SKIN.g; this.colors[v * 3 + 2] = SKIN.b; }
    }
    this.head.geometry.attributes.color.needsUpdate = true;
  }
  _ramp(t) { return t < 0.5 ? C_LO.clone().lerp(C_MID, t * 2) : C_MID.clone().lerp(C_HI, (t - 0.5) * 2); }
  resetView() { this.camera.position.set(0, 0.55, 3.4); this.controls.target.set(0, 0.42, 0); this.controls.update(); }
  _frame() { if (this.ready && this.container.isConnected && this.container.offsetParent !== null) { this.controls.update(); this.renderer.render(this.scene, this.camera); } requestAnimationFrame(this._frame); }
}
