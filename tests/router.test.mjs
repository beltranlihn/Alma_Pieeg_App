import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router.js';

const fakeEngine = { addEventListener() {}, features: {}, state: 'idle' };

test('routing file: export leaves self-test destinations out, import adds with fresh ids and skips unknown signals', () => {
  const a = new Router(fakeEngine);
  const d = a.addDestination({ name: 'TD', host: '127.0.0.1', port: 7000 });
  a.addDestination({ name: 'Self-test', kind: 'ws', port: 8799, temp: true });
  a.addMapping({ signal: 'idx.calm', address: '/calm', destination: d.id });
  a.addMapping({ signal: 'gaze.side', address: '/side', destination: d.id, type: 'i' });
  const file = JSON.parse(a.exportJSON());
  assert.equal(file.format, 'eeg-alma-center-routing:v1');
  assert.deepEqual(file.destinations.map((x) => x.name), ['TD']);
  file.mappings.push({ ...file.mappings[0], signal: 'no.such.signal' });

  const b = new Router(fakeEngine);
  const own = b.addDestination({ name: 'Mine' });
  const r = b.importJSON(JSON.stringify(file));
  assert.deepEqual(r, { destinations: 1, mappings: 2, skipped: 1 });
  assert.equal(b.destinations.length, 2);
  const imported = b.destinations.find((x) => x.name === 'TD');
  assert.notEqual(imported.id, d.id);
  assert.ok(b.mappings.every((m) => m.destination === imported.id));
  assert.equal(b.destinations[0], own, 'importing never replaces what is there');
  assert.throws(() => b.importJSON('{"hello":1}'));
});

test('duplicate puts a copy right below the original', () => {
  const a = new Router(fakeEngine), d = a.addDestination();
  const m1 = a.addMapping({ signal: 'idx.calm', address: '/a', destination: d.id });
  a.addMapping({ signal: 'idx.focus', address: '/b', destination: d.id });
  const c = a.duplicateMapping(m1.id);
  assert.deepEqual(a.mappings.map((m) => m.address), ['/a', '/a', '/b']);
  assert.notEqual(c.id, m1.id);
});
