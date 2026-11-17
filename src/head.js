// 3D head with the PiEEG XR electrodes and a heat map painted on the skin (vertex colours).
// Model: Lee Perry-Smith head scan (Infinite-Realities, CC-BY), shipped with the three.js examples.
// The mesh is cut by a plane at the neck (every triangle clipped, the opening capped) so the bust
// ends with a clean flat base, and each electrode is a small pad lying on the skin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Where each electrode sits comes from the montage (montage.js): each site has a direction from the head centre
// (azimuth °, negative = screen left in the mirror view; elevation ° above the eye line). The pads move when
// the map is edited, so the head always shows the mask as it is wired.
import { montage, SITE_BY_ID, onMontage } from './montage.js';
const channelDirs = () => montage.channels.map((s) => SITE_BY_ID[s].dir);
const auxDirs = () => [SITE_BY_ID[montage.ref].dir, SITE_BY_ID[montage.bias].dir];   // reference, bias
const CUT_Y = -0.40;                                           // neck plane (head height = 2)
const EYE_LINE = 0.18;
const STATUS_COLOR = { good: '#4a8d6f', fair: '#e5b567', poor: '#e06c6c', railed: '#e06c6c', none: '#6d6d6d', wait: null, noisy: '#e06c6c', lost: '#e06c6c' };
const SKIN = new THREE.Color('#4b4b4b');
// heat LUT for activity (0 → 1): skin grey → blue → cyan → green → yellow → red → white, like a topomap
const LUT_STOPS = ['#3a3f47', '#2f5f9e', '#4fc3e8', '#4a8d6f', '#e8c84b', '#e0645c', '#ffffff'].map((c) => new THREE.Color(c));
function lut(t) { t = Math.max(0, Math.min(0.9999, t)) * (LUT_STOPS.length - 1); const i = Math.floor(t); return LUT_STOPS[i].clone().lerp(LUT_STOPS[i + 1], t - i); }
const MASK_RADIUS = 0.55;    // how far from an electrode the activity map reaches before fading to skin

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
  const cap = [];
  if (edge.length) {      // cap: fan from the centroid of the cut loop, facing down; its own geometry so the edge stays hard
    const centre = new THREE.Vector3(); edge.forEach(([a, b]) => { centre.add(a); centre.add(b); }); centre.divideScalar(edge.length * 2); centre.y = cutY;
    for (const [a, b] of edge) cap.push(centre.clone(), b.clone(), a.clone());
  }
  const toGeo = (list) => { const arr = new Float32Array(list.length * 3); list.forEach((v, i) => v.toArray(arr, i * 3)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return g; };
  return { body: toGeo(out), cap: toGeo(cap) };
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
    const cut = clipAtPlane(geo, CUT_Y);
    geo = mergeVertices(cut.body, 1e-4); geo.computeVertexNormals();                  // smooth skin
    const capGeo = cut.cap; capGeo.computeVertexNormals();                             // flat base, hard edge
    this.scene.add(new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: SKIN.clone().multiplyScalar(0.85), roughness: 0.9, metalness: 0 })));
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
    // a turned pad: flat base on the skin, bevelled rim, shallow dome with a centre dimple (profile in x = radius, y = height)
    const profile = [[0, 0], [0.026, 0], [0.028, 0.0035], [0.026, 0.009], [0.019, 0.011], [0.009, 0.0118], [0.004, 0.0095], [0, 0.009]].map(([r, h]) => new THREE.Vector2(r, h));
    const padGeo = new THREE.LatheGeometry(profile, 56); padGeo.rotateX(Math.PI / 2);   // axis along +Z so lookAt lays it on the skin
    const ringGeo = new THREE.TorusGeometry(0.0295, 0.0022, 10, 56);
    this._place = place; this._padGeo = padGeo; this._ringGeo = ringGeo;
    const auxProfile = [[0, 0], [0.016, 0], [0.018, 0.0025], [0.015, 0.0065], [0.006, 0.0078], [0, 0.0072]].map(([r, h]) => new THREE.Vector2(r, h));
    this._auxGeo = new THREE.LatheGeometry(auxProfile, 40); this._auxGeo.rotateX(Math.PI / 2);
    this._buildPads();
    onMontage(() => { if (this.ready) { this._buildPads(); this._lowY = undefined; this.update(this.quality, this.ref); } });
    this.resetView();
    this.ready = true; this._resize(); this.update(this.quality);
  }

  /** Pads for the 8 channels and the reference/bias, at the montage's sites (rebuilt when the map changes). */
  _buildPads() {
    for (const o of [...this.pads, ...this.rings, ...(this.aux || [])]) { this.scene.remove(o); o.material.dispose(); }
    this.pads = []; this.rings = []; this.aux = []; this.points = [];
    const place = this._place, padGeo = this._padGeo, ringGeo = this._ringGeo;
    channelDirs().map(place).forEach(({ p, n: nrm }) => {
      this.points.push(p);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0x6d6d6d, emissive: 0x000000, roughness: 0.4, metalness: 0.15 }));
      pad.position.copy(p).add(nrm.clone().multiplyScalar(0.006)); pad.lookAt(pad.position.clone().add(nrm)); this.scene.add(pad); this.pads.push(pad);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }));
      ring.position.copy(pad.position).add(nrm.clone().multiplyScalar(0.004)); ring.lookAt(ring.position.clone().add(nrm)); this.scene.add(ring); this.rings.push(ring);
    });
    auxDirs().map(place).forEach(({ p, n: nrm }) => {
      const pad = new THREE.Mesh(this._auxGeo, new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.4, metalness: 0.6 }));
      pad.position.copy(p).add(nrm.clone().multiplyScalar(0.005)); pad.lookAt(pad.position.clone().add(nrm)); this.scene.add(pad); this.aux.push(pad);
    });
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Repaint from contact quality (mode 'contact') or from this.values (mode 'value': 0–1 per channel, interpolated). */
  update(quality, ref) {
    this.quality = quality; if (ref !== undefined) this.ref = ref; if (!this.ready) return;
    if (this.aux && this.aux[0]) {           // the reference pad: grey, or the colour of the reference check
      const rc = this.mode === 'contact' && this.ref ? STATUS_COLOR[this.ref.status] : null;
      this.aux[0].material.color.set(rc || 0x8c8c8c); this.aux[0].material.emissive.set(rc ? new THREE.Color(rc).multiplyScalar(0.25) : 0x000000);
    }
    if (this.mode === 'value') return this._paintActivity();
    const cols = [];
    for (let i = 0; i < 8; i++) {
      let c = null;
      if (this.mode === 'contact') { const st = quality ? quality[i].status : 'wait'; c = STATUS_COLOR[st] ? new THREE.Color(STATUS_COLOR[st]) : null; }
      else c = this._ramp(Math.max(0, Math.min(1, this.values[i])));
      cols.push(c);
      const pc = c || new THREE.Color(0x6d6d6d); this.pads[i].material.color.set(pc); this.pads[i].material.emissive.set(c ? c.clone().multiplyScalar(0.25) : 0x000000);
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
  _paintActivity() {
    const vals = this.values, pos = this.positions, n = pos.length / 3, tmp = new THREE.Color();
    if (this._lowY === undefined) this._lowY = Math.min(...this.points.map((p) => p.y));
    for (let i = 0; i < 8; i++) { const c = lut(vals[i]); this.pads[i].material.color.set(c); this.pads[i].material.emissive.set(c.clone().multiplyScalar(0.3)); }
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let wsum = 0, acc = 0, near = Infinity;
      for (let i = 0; i < 8; i++) {
        const p = this.points[i], dx = x - p.x, dy = y - p.y, dz = z - p.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < near) near = d2;
        const w = 1 / (d2 + 0.0015);                       // inverse distance squared, softened at the electrode
        wsum += w; acc += w * vals[i];
      }
      const d = Math.sqrt(near), fade = Math.max(0, Math.min(1, (y - (this._lowY - 0.10)) / 0.14));   // scalp, forehead and temples only: fades out just below the lowest electrode
      const a = fade * (d < MASK_RADIUS * 0.6 ? 1 : Math.max(0, 1 - (d - MASK_RADIUS * 0.6) / (MASK_RADIUS * 0.4)));
      if (a <= 0) { this.colors[v * 3] = SKIN.r; this.colors[v * 3 + 1] = SKIN.g; this.colors[v * 3 + 2] = SKIN.b; continue; }
      tmp.copy(lut(acc / wsum));
      this.colors[v * 3] = SKIN.r + (tmp.r - SKIN.r) * a; this.colors[v * 3 + 1] = SKIN.g + (tmp.g - SKIN.g) * a; this.colors[v * 3 + 2] = SKIN.b + (tmp.b - SKIN.b) * a;
    }
    this.head.geometry.attributes.color.needsUpdate = true;
  }
  resetView() { this.camera.position.set(0.3, 0.55, 3.4); this.controls.target.set(0, 0.4, 0); this.controls.update(); }
  _frame() { if (this.ready && this.container.isConnected && this.container.offsetParent !== null) { this.controls.update(); this.renderer.render(this.scene, this.camera); } requestAnimationFrame(this._frame); }
}
