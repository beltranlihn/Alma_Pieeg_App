// Regression tests for the issues the 0.8 review found.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import ws from '../ws-server.js';
import { TensionGroup, TENSION_GROUPS } from '../src/tension.js';
import { GestureTrainer, validModel, FEATURE_DIM } from '../src/face.js';
import { Gaze, fitGaze, GAZE_TARGETS } from '../src/gaze.js';
import { Router } from '../src/router.js';

test('a new stream keeps the measured tension range', () => {
  const g = new TensionGroup(TENSION_GROUPS[0]);
  g.setRange([3, 3, 3], [30, 30, 30]); g.reset();
  assert.ok(g.fixed && g.fixed.ceil === 30);
});

test('a broken saved gesture model is dropped, a good one kept', () => {
  const good = { w: new Array(FEATURE_DIM).fill(0.1), b: 0, mean: new Array(FEATURE_DIM).fill(0), std: new Array(FEATURE_DIM).fill(1), cv: 0.9, importance: new Array(8).fill(0.5) };
  assert.ok(validModel(good));
  assert.equal(validModel({ ...good, mean: undefined }), null);
  assert.equal(validModel({ ...good, std: new Array(FEATURE_DIM).fill(NaN) }), null);
  const tr = new GestureTrainer(); tr.fromJSON({ models: { clench: good, smile: { w: good.w } } });
  assert.ok(tr.trained('clench')); assert.ok(!tr.trained('smile'));
  assert.doesNotThrow(() => { tr.predict(new Float32Array(FEATURE_DIM)); tr.summary(); tr.toJSON(); });
});

test('a gesture turns off when the features stop', () => {
  const tr = new GestureTrainer();
  tr.fromJSON({ models: { clench: { w: new Array(FEATURE_DIM).fill(1), b: 0, mean: new Array(FEATURE_DIM).fill(0), std: new Array(FEATURE_DIM).fill(1), cv: 1 } } });
  for (let k = 0; k < 20; k++) tr.predict(new Float32Array(FEATURE_DIM).fill(1));
  assert.equal(tr.on.clench, 1);
  for (let k = 0; k < 20; k++) tr.predict(null);
  assert.equal(tr.on.clench, 0);
});

test('gaze: an empty last centre hold falls back to the one before; an electrode dropping out does not move the gaze', () => {
  const holds = GAZE_TARGETS.map((target) => ({ target, h: Array.from({ length: 20 }, () => 60 * target.x + 5), v: Array.from({ length: 20 }, () => -40 * target.y + 7) }));
  holds[holds.length - 1].h = []; holds[holds.length - 1].v = [];
  const m = fitGaze(holds);
  assert.ok(m); assert.equal(m.centre.h, 5); assert.equal(m.centre.v, 7);
  const g = new Gaze(); g.model = { ax: [1 / 60, 0], ay: [0, -1 / 40] };
  const eog = Float64Array.from([-30, -30, 0, 0, 0, 0, 30, 34]);     // looking right; Ch8 sits 4 µV higher than Ch7
  for (let k = 0; k < 15; k++) g.update(k * 50, eog, { bad: new Array(8).fill(false) });
  const before = g.x;
  for (let k = 0; k < 15; k++) g.update(k * 50, eog, { bad: [false, false, false, false, false, false, false, true] });
  assert.ok(Math.abs(g.x - before) < 0.02, `x moved from ${before} to ${g.x}`);
});

test('websocket: browser pages from other sites are refused; a taken port is retried', async () => {
  const { Hub, originAllowed } = ws;
  assert.ok(originAllowed(undefined)); assert.ok(originAllowed('null')); assert.ok(originAllowed('http://localhost:5173')); assert.ok(originAllowed('file://'));
  assert.ok(!originAllowed('https://example.com')); assert.ok(!originAllowed('http://192.168.0.5'));
  const port = 20000 + Math.floor(Math.random() * 2000);
  const blocker = net.createServer().listen(port, '127.0.0.1'); await new Promise((r) => blocker.once('listening', r));
  const hub = new Hub({ retryMs: 0 }); hub.sync([{ host: '127.0.0.1', port }]); await new Promise((r) => setTimeout(r, 100));
  assert.match(hub.stats()[0].error, /taken/);
  await new Promise((r) => blocker.close(r));
  hub.sync([{ host: '127.0.0.1', port }]); await new Promise((r) => setTimeout(r, 100));
  assert.equal(hub.stats()[0].error, '');
  const c = new WebSocket(`ws://127.0.0.1:${port}`); await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
  c.close(); hub.closeAll();
});

test('router: the configured rate from the first tick, with a jittering 50 ms tick and after a pause', () => {
  const sent = [];
  globalThis.window = { alma: { oscSend: (b) => sent.push(...b.map((m) => ({ ...m, at: clock }))), wsSync() {} } };
  let clock = 1000;
  const engine = { addEventListener() {}, features: { calm: 0.5 }, state: 'streaming' };
  const r = new Router(engine);
  for (const rate of [20, 10, 1]) { const d = r.addDestination({ name: `r${rate}`, port: 9000 + rate, rate }); r.addMapping({ signal: 'calm', address: `/r${rate}`, destination: d.id }); }
  const run = (ms) => { const end = clock + ms; let k = 0; while (clock < end) { clock += k++ % 2 ? 61 : 39; r._tick(clock); } };
  const count = (port, from, to) => sent.filter((m) => m.port === port && m.at > from && m.at <= to).length;
  run(2000);
  assert.ok(Math.abs(count(9020, 1000, 3000) - 40) <= 1, `20 Hz → ${count(9020, 1000, 3000)}`);
  assert.ok(Math.abs(count(9010, 1000, 3000) - 20) <= 1, `10 Hz → ${count(9010, 1000, 3000)}`);
  assert.ok(count(9001, 1000, 3000) <= 3, `1 Hz → ${count(9001, 1000, 3000)}`);
  assert.ok(count(9010, 1000, 1200) <= 2, 'no burst at the start');
  const t0 = clock; clock += 5000;                                   // a pause (Sending off, or the window busy)
  run(1000);
  assert.ok(count(9010, t0 + 5000, t0 + 5300) <= 3, `burst after a pause: ${count(9010, t0 + 5000, t0 + 5300)}`);
  delete globalThis.window;
});
