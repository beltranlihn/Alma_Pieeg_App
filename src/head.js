// 3D head with the PiEEG XR electrodes and a heat map painted on the skin (vertex colours).
// Model: Lee Perry-Smith head scan (Infinite-Realities, CC-BY), shipped with the three.js examples.
// The mesh is cut by a plane at the neck (every triangle clipped, the opening capped) so the bust
// ends with a clean flat base, and each electrode is a small pad lying on the skin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Where each electrode sits, as a direction from the head centre: azimuth (°, negative = screen left,
// mirror view: the wearer's left appears on the left) and elevation (° above the eye line).
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
const AUX = [{ az: -4, el: 46 }, { az: 4, el: 46 }];           // reference, bias
const CUT_Y = -0.40;                                           // neck plane (head height = 2)
const EYE_LINE = 0.18;
const STATUS_COLOR = { good: '#4a8d6f', fair: '#e5b567', poor: '#e06c6c', railed: '#e06c6c', none: '#6d6d6d', wait: null };
const SKIN = new THREE.Color('#4b4b4b');
const C_LO = new THREE.Color('#2a2a2a'), C_MID = new THREE.Color('#e5b567'), C_HI = new THREE.Color('#ffffff');

const dirVec = ({ az, el }) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); };

/** Clip a triangle list against the plane y = cutY (keep y > cutY) and cap the opening with a flat disc. */
function clipAtPlane(geo, cutY) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const p = src.attributes.position.array, out = [], edge = [];
  const V = (i) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const lerp = (a, b) => { const t = (cutY - a.y) / (b.y - a.y); return a.clone().lerp(b, t); };
  for (let t = 0; t < p.length / 9; t++) {
    const tri = [V(t * 3), V(t * 3 + 1), V(t * 3 + 2)], inside = tri.map((v) => v.y > cutY), n = inside.filter(Boolean).length;
    if (n === 3) out.push(...tri);
    else if (n === 0) continue;
    else if (n === 1) {
      const i = inside.indexOf(true), a = tri[i], b = tri[(i + 1) % 3], c = tri[(i + 2) % 3], ab = lerp(a, b), ac = lerp(a, c);
      out.push(a, ab, ac); edge.push([ab, ac]);
    } else {
      const i = inside.indexOf(false), c = tri[i], a = tri[(i + 1) % 3], b = tri[(i + 2) % 3], ac = lerp(a, c), bc = lerp(b, c);
      out.push(a, b, bc, a, bc, ac); edge.push([bc, ac]);
    }
  }
  if (edge.length) {      // cap: fan from the centroid of the cut loop, facing down
    const centre = new THREE.Vector3(); edge.forEach(([a, b]) => { centre.add(a); centre.add(b); }); centre.divideScalar(edge.length * 2); centre.y = cutY;
    for (const [a, b] of edge) out.push(centre.clone(), b.clone(), a.clone());
  }
  const arr = new Float32Array(out.length * 3); out.forEach((v, i) => v.toArray(arr, i * 3));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

export class HeadView {
  constructor(container) {
    this.container = container;
    this.mode = 'contact';                        // 'contact' | 'value'
    this.values = new Float32Array(8);
    this.quality = null; this.ready = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x111111, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    // studio lighting: soft key from the upper left, cool fill from the right, rim from behind
    this.scene.add(new THREE.HemisphereLight(0xdedede, 0x1a1a1a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2.5, 3.5, 3.5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfc8d6, 0.5); fill.position.set(3, 0.5, 2.5); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(1.5, 2.5, -4); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false; this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.7; this.controls.maxPolarAngle = 2.0; this.controls.minDistance = 2.2; this.controls.maxDistance = 6;
    this.pads = []; this.rings = [];
    this._resize = this._resize.bind(this); window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(container);
    this._load();
    this._frame = this._frame.bind(this); requestAnimationFrame(this._frame);
  }

  async _load() {
    const gltf = await new GLTFLoader().loadAsync('assets/models/LeePerrySmith.glb');
    let mesh = null; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    gltf.scene.updateMatrixWorld(true);
    let geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld);
    const box = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), s = 2 / size.y;
    geo.translate(-center.x, -center.y, -center.z); geo.scale(s, s, s);
    geo = mergeVertices(clipAtPlane(geo, CUT_Y), 1e-4); geo.computeVertexNormals();   // merge → smooth shading again
    const n = geo.attributes.position.count;
    this.colors = new Float32Array(n * 3); for (let i = 0; i < n; i++) SKIN.toArray(this.colors, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.head = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 }));
    this.scene.add(this.head);
    this.positions = geo.attributes.position.array;

    // electrode pads: find the skin point along each direction, lay a pad on it
    const ray = new THREE.Raycaster();
    const place = (d) => {
      const v = dirVec(d), origin = v.clone().multiplyScalar(4).add(new THREE.Vector3(0, EYE_LINE, 0));
      ray.set(origin, v.clone().negate());
      const hit = ray.intersectObject(this.head, false)[0];
      return hit ? { p: hit.point.clone(), n: hit.face.normal.clone().normalize() } : { p: origin.multiplyScalar(0.25), n: v };
    };
    const padGeo = new THREE.CylinderGeometry(0.03, 0.033, 0.012, 40);
    padGeo.rotateX(Math.PI / 2);                 // axis along +Z so lookAt orients it on the skin
    const ringGeo = new THREE.TorusGeometry(0.036, 0.0045, 12, 48);
    this.points = [];
    DIRS.map(place).forEach(({ p, n: nrm }) => {
      this.points.push(p);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.45, metalness: 0.25 }));
      pad.position.copy(p).add(nrm.clone().multiplyScalar(0.006)); pad.lookAt(pad.position.clone().add(nrm)); this.scene.add(pad); this.pads.push(pad);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4a4a4a }));
      ring.position.copy(pad.position).add(nrm.clone().multiplyScalar(0.006)); ring.lookAt(ring.position.clone().add(nrm)); this.scene.add(ring); this.rings.push(ring);
    });
    const auxGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.01, 32); auxGeo.rotateX(Math.PI / 2);
    AUX.map(place).forEach(({ p, n: nrm }) => {
      const pad = new THREE.Mesh(auxGeo, new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.4, metalness: 0.6 }));
      pad.position.copy(p).add(nrm.clone().multiplyScalar(0.005)); pad.lookAt(pad.position.clone().add(nrm)); this.scene.add(pad);
    });
    this.resetView();
    this.ready = true; this._resize(); this.update(this.quality);
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Repaint from contact quality (mode 'contact') or from this.values (mode 'value'). */
  update(quality) {
    this.quality = quality; if (!this.ready) return;
    const cols = [];
    for (let i = 0; i < 8; i++) {
      let c = null;
      if (this.mode === 'contact') { const st = quality ? quality[i].status : 'wait'; c = STATUS_COLOR[st] ? new THREE.Color(STATUS_COLOR[st]) : null; }
      else c = this._ramp(Math.max(0, Math.min(1, this.values[i])));
      cols.push(c);
      this.rings[i].material.color.set(c || new THREE.Color(0x4a4a4a));
    }
    // skin: a soft glow of each electrode's colour around its pad
    const pos = this.positions, n = pos.length / 3, sigma = 0.10, tmp = new THREE.Color();
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let wsum = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < 8; i++) {
        const c = cols[i]; if (!c) continue;
        const p = this.points[i], dx = x - p.x, dy = y - p.y, dz = z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        const w = Math.exp(-d2 / (2 * sigma * sigma)); if (w < 0.003) continue;
        wsum += w; r += w * c.r; g += w * c.g; b += w * c.b;
      }
      if (wsum > 0) { const a = Math.min(1, wsum * 0.38); tmp.setRGB(r / wsum, g / wsum, b / wsum); this.colors[v * 3] = SKIN.r + (tmp.r - SKIN.r) * a; this.colors[v * 3 + 1] = SKIN.g + (tmp.g - SKIN.g) * a; this.colors[v * 3 + 2] = SKIN.b + (tmp.b - SKIN.b) * a; }
      else { this.colors[v * 3] = SKIN.r; this.colors[v * 3 + 1] = SKIN.g; this.colors[v * 3 + 2] = SKIN.b; }
    }
    this.head.geometry.attributes.color.needsUpdate = true;
  }
  _ramp(t) { return t < 0.5 ? C_LO.clone().lerp(C_MID, t * 2) : C_MID.clone().lerp(C_HI, (t - 0.5) * 2); }
  resetView() { this.camera.position.set(0.3, 0.55, 3.4); this.controls.target.set(0, 0.4, 0); this.controls.update(); }
  _frame() { if (this.ready && this.container.isConnected && this.container.offsetParent !== null) { this.controls.update(); this.renderer.render(this.scene, this.camera); } requestAnimationFrame(this._frame); }
}
