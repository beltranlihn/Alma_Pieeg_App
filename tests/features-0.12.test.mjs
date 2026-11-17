// 0.12: markers and commands in, rules, cue sheet, visitor mode, replay, BDF export, MIDI, PiEEG compatibility,
// idle outputs, OSC decoding, the WebSocket's welcome / incoming text / viewer page, gestures against each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import net from 'node:net';
import crypto from 'node:crypto';

globalThis.window = globalThis.window || { alma: {} };
const sent = { osc: [], ws: [], http: [] };
Object.assign(window.alma, { oscSend: (m) => sent.osc.push(...m), wsSend: (m) => sent.ws.push(...m), wsSync: () => {}, httpPost: async (u, b) => { sent.http.push({ u, b }); return { ok: true, status: 200 }; } });
globalThis.document = globalThis.document || { getElementById: () => null };

const { parseRaw, ReplayDevice } = await import('../src/replay.js');
const { buildBDF } = await import('../src/bdf.js');
const { parseMidiAddress, midiMessage, to7bit } = await import('../src/midi.js');
const { Rules } = await import('../src/rules.js');
const { Cues } = await import('../src/cues.js');
const { Visitor } = await import('../src/visitor.js');
const { Router } = await import('../src/router.js');
const { RollingMax, pieegFrame } = await import('../src/compat.js');
const { GestureTrainer, readiness, FEATURE_DIM } = await import('../src/face.js');
const require = createRequire(import.meta.url);
const { encode, decode } = require('../osc-encode.js');
const { Hub, encodeFrame } = require('../ws-server.js');

/** A small stand-in for the engine: features, state, a recorder, events. */
function fakeEngine() {
  const e = new EventTarget();
  Object.assign(e, {
    state: 'streaming', fs: 250, quality: null, device: null, marks: [],
    recorder: { active: false }, features: { rate: 250, marker: { pulse: 0, count: 0 }, rule: { pulse: 0, count: 0 }, cue: { index: 0 }, visitor: { present: 0, state: 0, count: 0, elapsed: 0 }, idxNorm: { calm: 0 } },
    mark(t) { this.marks.push(t); }, _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); },
    resetForVisitor() { this.resets = (this.resets || 0) + 1; }, startSession() { this.recorder.active = true; }, endSession() { this.recorder.active = false; },
  });
  return e;
}

test('OSC decode reads what encode writes, and bundles', () => {
  const m = decode(encode('/alma/mark', [{ type: 's', value: 'door opened' }, { type: 'f', value: 0.5 }, { type: 'i', value: 7 }]));
  assert.equal(m[0].address, '/alma/mark'); assert.equal(m[0].args[0], 'door opened'); assert.ok(Math.abs(m[0].args[1] - 0.5) < 1e-6); assert.equal(m[0].args[2], 7);
  const a = encode('/a', [{ type: 'i', value: 1 }]), b = encode('/b', []);
  const size = (x) => { const s = Buffer.alloc(4); s.writeInt32BE(x.length); return s; };
  const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), size(a), a, size(b), b]);
  assert.deepEqual(decode(bundle).map((x) => x.address), ['/a', '/b']);
  assert.deepEqual(decode(Buffer.from('not osc')), []);
});

const CSV = ['timestamp,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8,mark',
  ...Array.from({ length: 600 }, (_, i) => `${(1700000000 + i / 250).toFixed(6)},${[1, 2, 3, 4, 5, 6, 7, 8].map((k) => (k * 100 + i).toFixed(3)).join(',')},${i === 300 ? '"door, opened"' : ''}`)].join('\n');

test('replay: parses a raw CSV with its marks and plays it at speed', async () => {
  const d = parseRaw(CSV);
  assert.equal(d.n, 600); assert.equal(d.ch[8 * 10 + 2], 310); assert.equal(d.marks.get(300), 'door, opened');
  const dev = new ReplayDevice({ base: 'x', text: CSV, speed: 2 }); const got = []; const marks = [];
  dev.onMark = (t) => marks.push(t);
  await dev.start((s) => got.push(...s)); await new Promise((r) => setTimeout(r, 400)); await dev.stop();
  assert.ok(got.length > 120 && got.length < 260, `samples ${got.length}`);    // ~0.4 s × 500 /s
  await assert.rejects(new ReplayDevice({ base: 'y', text: 'nothing' }).start(() => {}));
});

test('BDF+: header, 24-bit samples that come back to µV, marks as annotations', () => {
  const d = parseRaw(CSV), out = buildBDF(d, { participant: 'Test Person' });
  const txt = (o, n) => Buffer.from(out.subarray(o, o + n)).toString('latin1').trim();
  assert.equal(out[0], 0xff); assert.equal(txt(1, 7), 'BIOSEMI'); assert.equal(txt(192, 5), 'BDF+C');
  assert.equal(+txt(236, 8), 3); assert.equal(+txt(252, 4), 9);                 // 600 samples → 3 one-second records · 8 + annotations
  const headBytes = 256 * 10; assert.equal(+txt(184, 8), headBytes);
  const s0 = out[headBytes] | (out[headBytes + 1] << 8) | (out[headBytes + 2] << 16), uv = (s0 >= 0x800000 ? s0 - 0x1000000 : s0) * (4.5 / 16777215 * 1e6);
  assert.ok(Math.abs(uv - 100) < 0.3, `ch1 first sample ${uv}`);
  const recBytes = (8 * 250 + 64) * 3, ann = Buffer.from(out.subarray(headBytes + recBytes + 8 * 250 * 3, headBytes + 2 * recBytes)).toString('latin1');
  assert.ok(ann.startsWith('+1\x14\x14\x00'), JSON.stringify(ann.slice(0, 12))); assert.ok(ann.includes('door, opened'));
  assert.equal(out.length, headBytes + 3 * recBytes);
});

test('MIDI: addresses, controllers only on change, notes on and off', () => {
  assert.deepEqual(parseMidiAddress('CC 7'), { kind: 'cc', n: 7 }); assert.deepEqual(parseMidiAddress('note 60'), { kind: 'note', n: 60 }); assert.equal(parseMidiAddress('/alma/x'), null);
  assert.equal(to7bit(0.5, 1), 64); assert.equal(to7bit(200, 127), 127);
  assert.deepEqual(midiMessage('cc 7', 64, 2, undefined), [0xb1, 7, 64]); assert.equal(midiMessage('cc 7', 64, 2, 64), null);
  assert.deepEqual(midiMessage('note 60', 127, 1, 0), [0x90, 60, 100]); assert.deepEqual(midiMessage('note 60', 0, 1, 127), [0x80, 60, 0]); assert.equal(midiMessage('note 60', 120, 1, 127), null);
});

test('rules: hold time, once per crossing, cooldown, webhook payload', async () => {
  const e = fakeEngine(), router = new Router(e), rules = new Rules(e, router);
  const r = rules.add({ signal: 'idx.calm', op: 'above', value: 0.7, hold: 1, cooldown: 5, target: 'http', url: 'http://127.0.0.1:1/hook' });
  e.features.idxNorm.calm = 0.9;
  rules.tick(0); rules.tick(500); assert.equal(rules.stateOf(r.id).count, 0, 'not held long enough');
  rules.tick(1100); assert.equal(rules.stateOf(r.id).count, 1);
  rules.tick(2000); assert.equal(rules.stateOf(r.id).count, 1, 'once per crossing');
  e.features.idxNorm.calm = 0.2; rules.tick(2100); e.features.idxNorm.calm = 0.9; rules.tick(2200); rules.tick(3500);
  assert.equal(rules.stateOf(r.id).count, 1, 'cooldown');
  e.features.idxNorm.calm = 0.2; rules.tick(6000); e.features.idxNorm.calm = 0.9; rules.tick(6100); rules.tick(7200);
  assert.equal(rules.stateOf(r.id).count, 2);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(sent.http.length, 2); assert.equal(sent.http[0].b.rule_name, r.name); assert.equal(sent.http[0].b.threshold, 0.7);
});

test('cue sheet: fires each cue once at its time, marks it, stops after the last', async () => {
  const e = fakeEngine(), router = new Router(e), cues = new Cues(e, router);
  const d = router.addDestination({ kind: 'osc', host: '127.0.0.1', port: 9999 });
  cues.add({ at: 0.05, label: 'one', target: d.id, address: '/cue/1' }); cues.add({ at: 0.15, label: 'two', target: d.id, address: '/cue/2' });
  e.recorder.active = true; cues.start(); const before = sent.osc.length;
  await new Promise((r) => setTimeout(r, 80)); cues.tick(); assert.equal(cues.fired.size, 1);
  await new Promise((r) => setTimeout(r, 100)); cues.tick(); cues.tick();
  assert.equal(cues.fired.size, 2); assert.equal(cues.running, false);
  assert.deepEqual(sent.osc.slice(before).map((m) => m.address), ['/cue/1', '/cue/2']); assert.deepEqual(e.marks, ['cue one', 'cue two']);
});

test('visitor mode: arrives after 3 s of contact, settles, goes live, leaves after 5 s without', () => {
  const e = fakeEngine(), v = new Visitor(e); v.configure({ enabled: true, baseline: 10 });
  const good = () => { e.quality = Object.assign(Array.from({ length: 8 }, () => ({ status: 'good' })), { ref: { status: 'good' } }); };
  const off = () => { e.quality = Object.assign(Array.from({ length: 8 }, () => ({ status: 'poor' })), { ref: { status: 'noisy' } }); };
  good(); v.check(0); v.check(2000); assert.equal(v.state, 'idle');
  v.check(3100); assert.equal(v.state, 'baseline'); assert.equal(e.resets, 1); assert.equal(v.idlePolicy(), 'zero');
  v.check(14000); assert.equal(v.state, 'active'); assert.equal(v.idlePolicy(), null);
  off(); v.check(15000); v.check(19000); assert.equal(v.state, 'active', 'a short loss is not leaving');
  v.check(20100); assert.equal(v.state, 'idle'); assert.equal(v.count, 1);
  v.configure({ enabled: false }); assert.equal(v.idlePolicy(), null);
});

test('idle outputs ease to the safe value; events go to their minimum', () => {
  const e = fakeEngine(); e.features.idxNorm.calm = 0.9; e.features.blinkPulse = 1;
  const router = new Router(e), d = router.addDestination({ kind: 'osc' });
  const m = router.addMapping({ signal: 'idx.calm', destination: d.id, smooth: 0 });
  assert.ok(Math.abs(router.evaluate(m, e.features) - 0.9) < 1e-9);
  let v = 0.9; for (let k = 0; k < 60; k++) v = router.evaluate(m, e.features, 'zero');
  assert.ok(v < 0.02, `eased to ${v}`);
  for (let k = 0; k < 80; k++) v = router.evaluate(m, e.features, 'middle');
  assert.ok(Math.abs(v - 0.5) < 0.01, `middle ${v}`);
});

test('PiEEG style: rolling maximum and the frame format', () => {
  const r = new RollingMax(3); assert.equal(r.push(2), 1); assert.equal(r.push(1), 0.5); r.push(1); r.push(1); assert.equal(r.push(1), 1, 'the old maximum left the window');
  const f = JSON.parse(pieegFrame(1700000000.123456, 42, Float32Array.from([1.23456, 2, 3, 4, 5, 6, 7, 8])));
  assert.equal(f.t, 1700000000.123456); assert.equal(f.n, 42); assert.equal(f.channels.length, 8); assert.equal(f.channels[0], 1.235);
});

test('WebSocket: welcome on connect, text from clients reaches the app, the viewer page is served', async () => {
  const msgs = [], port = 18000 + Math.floor(Math.random() * 1000);
  const hub = new Hub({ retryMs: 0, onMessage: (p, t) => msgs.push([p, t]), page: () => '<html>viewer</html>' });
  hub.sync([{ host: '127.0.0.1', port, welcome: '{"status":"connected"}' }]); await new Promise((r) => setTimeout(r, 100));
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text(); assert.match(html, /viewer/);
  const sock = net.connect(port, '127.0.0.1'); let data = Buffer.alloc(0);
  sock.on('data', (d) => { data = Buffer.concat([data, d]); });
  await new Promise((r) => sock.on('connect', r));
  sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise((r) => setTimeout(r, 100));
  assert.match(data.toString('latin1'), /101 Switching Protocols/); assert.match(data.toString('latin1'), /\{"status":"connected"\}/);
  const pl = Buffer.from('{"mark":"hi"}'), mask = crypto.randomBytes(4);
  sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | pl.length]), mask, Buffer.from(pl.map((b, i) => b ^ mask[i & 3]))]));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(msgs, [[port, '{"mark":"hi"}']]);
  sock.destroy(); hub.closeAll(); assert.ok(encodeFrame('x').length === 3);
});

test('gestures: "ready" needs two recordings; the other gestures are negatives', () => {
  assert.equal(readiness(0.95, 1), 'record again'); assert.equal(readiness(0.95, 2), 'ready'); assert.equal(readiness(0.75), 'improving');
  const tr = new GestureTrainer();
  const unit = (val, pos) => { const n = 20, X = new Float32Array(n * FEATURE_DIM), y = new Uint8Array(n); for (let i = 0; i < n; i++) { const p = pos && i >= 10; y[i] = p ? 1 : 0; for (let k = 0; k < FEATURE_DIM; k++) X[i * FEATURE_DIM + k] = (p ? val[k % val.length] : 0) + Math.sin(i * 7 + k) * 0.05; } return { X, y, n }; };
  tr.units.clench = [unit([1, 0], true), unit([1, 0], true), unit([1, 0], true)];
  tr.units.smile = [unit([0, 1], true), unit([0, 1], true)];
  const u = tr._unitsFor('clench'); assert.equal(u.length, 4); assert.ok(u[3].others); assert.equal(u[3].n, 20); assert.ok(u[3].y.every((v) => v === 0));
  tr.recordings.clench = 1; const m = tr.refit('clench'); assert.ok(m && m.againstOthers);
  assert.equal(readiness(m.cv, m.recordings), 'record again');
});
