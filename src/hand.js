// A hand with a band on the wrist: shows whether the heart-rate strap is there and beating.
// Model: generic XR hand from @webxr-input-profiles/assets (MIT, Amazon 2019), in its bind pose.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SKIN = 0x4b4b4b;
const STATE_COLOR = { beating: '#e06c6c', idle: '#e5b567', off: '#4a4a4a' };

export class HandView {
  constructor(container) {
    this.container = container; this.ready = false; this.state = 'off'; this.pulse = 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x111111, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdedede, 0x1a1a1a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-1, 2, 2); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(1, 1, -2); this.scene.add(rim);
    new ResizeObserver(() => this._resize()).observe(container);
    this._load();
    this._frame = this._frame.bind(this); requestAnimationFrame(this._frame);
  }

  async _load() {
    const gltf = await new GLTFLoader().loadAsync('assets/models/hand-left.glb');
    const root = gltf.scene;
    root.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.72, metalness: 0.05 }); o.frustumCulled = false; } });
    // palm towards the viewer, fingers up
    root.rotation.set(0, -1.15, Math.PI);       // the model's fingers point down: flip them up, then turn the palm three-quarters to the viewer
    this.group = new THREE.Group(); this.group.add(root); this.scene.add(this.group);
    this.group.updateMatrixWorld(true);
    const wrist = root.getObjectByName('wrist'), mid = root.getObjectByName('middle-finger-metacarpal');
    const w = new THREE.Vector3(), m = new THREE.Vector3();
    wrist.getWorldPosition(w); (mid || wrist).getWorldPosition(m);
    const axis = m.clone().sub(w).normalize();
    // the band: a flat ring around the wrist, a little towards the arm
    const bandGeo = new THREE.TorusGeometry(0.025, 0.0048, 16, 64); bandGeo.scale(1, 1, 1.8);
    this.band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: 0x4a4a4a, emissive: 0x000000, roughness: 0.45, metalness: 0.2 }));
    this.band.position.copy(w).add(axis.clone().multiplyScalar(-0.006));
    this.band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    this.scene.add(this.band);
    // frame the hand
    const box = new THREE.Box3().setFromObject(this.group).expandByObject(this.band);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    this.camera.position.copy(c).add(new THREE.Vector3(0.05, 0.02, size * 1.9)); this.camera.lookAt(c);
    this.ready = true; this._resize(); this.setState(this.state);
  }

  _resize() { const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** 'beating' (strap on and a pulse), 'idle' (strap connected, no pulse), 'off' (no strap). */
  setState(state) {
    this.state = state; if (!this.ready) return;
    const c = new THREE.Color(STATE_COLOR[state] || STATE_COLOR.off);
    this.band.material.color.copy(c);
  }
  beat() { this.pulse = 1; }

  _frame() {
    if (this.ready && this.container.isConnected && this.container.offsetParent !== null) {
      this.pulse *= 0.9;
      const s = 1 + 0.12 * this.pulse; this.band.scale.set(s, s, 1);
      this.band.material.emissive.copy(this.band.material.color).multiplyScalar(this.state === 'beating' ? 0.15 + 0.6 * this.pulse : 0.05);
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(this._frame);
  }
}
