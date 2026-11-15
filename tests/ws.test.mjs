import test from 'node:test';
import assert from 'node:assert/strict';
import ws from '../ws-server.js';

const { Hub, encodeFrame, decodeFrames, acceptKey } = ws;

test('handshake key: the example from RFC 6455', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('frames of every length encoding come back intact', () => {
  for (const n of [0, 5, 125, 126, 65535, 70000]) {
    const text = 'x'.repeat(n), { frames, rest } = decodeFrames(encodeFrame(text));
    assert.equal(frames.length, 1); assert.equal(frames[0].opcode, 1); assert.equal(frames[0].payload.toString(), text); assert.equal(rest.length, 0);
  }
  // a masked client frame split in two chunks
  const payload = Buffer.from('{"ping":1}'), mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))]);
  const a = decodeFrames(masked.subarray(0, 5)); assert.equal(a.frames.length, 0);
  const b = decodeFrames(Buffer.concat([a.rest, masked.subarray(5)])); assert.equal(b.frames[0].payload.toString(), '{"ping":1}');
});

test('a client connects, receives the JSON values, and the hub closes cleanly', async () => {
  const hub = new Hub(), port = 18000 + Math.floor(Math.random() * 2000);
  hub.sync([{ host: '127.0.0.1', port }]);
  await new Promise((r) => setTimeout(r, 100));
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => { client.onopen = resolve; client.onerror = reject; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(hub.stats()[0].clients, 1);
  const got = new Promise((resolve) => { client.onmessage = (e) => resolve(JSON.parse(e.data)); });
  assert.equal(hub.send([{ host: '127.0.0.1', port, text: JSON.stringify({ t: 1, values: { '/alma/calm': 0.42 } }) }]), 1);
  assert.deepEqual(await got, { t: 1, values: { '/alma/calm': 0.42 } });
  const closed = new Promise((resolve) => { client.onclose = resolve; });
  hub.sync([]);
  await closed;
  assert.equal(hub.stats().length, 0);
});
