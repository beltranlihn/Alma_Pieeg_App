// A minimal WebSocket server (RFC 6455), no dependencies: the app listens, any number of clients connect
// (TouchDesigner, Unity, Unreal, a browser) and receive JSON text frames. Server → client only; what clients
// send is read just enough to answer ping and close.
//   message: {"t": <ms since epoch>, "values": {"/alma/calm": 0.42, "/alma/blink": 1}}
'use strict';
const http = require('http');
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const acceptKey = (key) => crypto.createHash('sha1').update(String(key).trim() + GUID).digest('base64');

/** One unmasked server frame. opcode 1 = text, 8 = close, 10 = pong. */
function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const n = data.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, data]);
}

/** Parse client frames from a buffer (masked, as clients must send). Returns { frames, rest }. */
function decodeFrames(buf) {
  const frames = []; let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1], opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    const mask = masked ? buf.subarray(p, p + 4) : null; p += maskLen;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode, payload }); off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

/** Native clients (TouchDesigner, Unity, Unreal, Python) send no Origin. A browser page does: only pages from
 *  this computer (file://, localhost) may connect, so a website open in a browser cannot read someone's signals. */
function originAllowed(origin) {
  if (!origin || origin === 'null') return true;
  try { const u = new URL(origin); return u.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch (_) { return false; }
}

class Hub {
  constructor() { this.servers = new Map(); }   // "host:port" → { server, clients:Set, error, host, port }
  key(host, port) { return `${host || '0.0.0.0'}:${port}`; }

  /** Keep exactly these listeners open: [{ host, port }]. */
  sync(list) {
    const want = new Set(list.map((d) => this.key(d.host, d.port)));
    for (const [k, s] of this.servers) if (!want.has(k)) this._close(k, s);
    for (const d of list) {
      const k = this.key(d.host, d.port), s = this.servers.get(k);
      if (s && s.error) this._close(k, s);                      // a port that was taken: try again
      if (!this.servers.has(k)) this._open(k, d.host || '0.0.0.0', d.port);
    }
  }

  _open(k, host, port) {
    const entry = { host, port, clients: new Set(), error: '', server: null };
    const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`EEG Alma Center · WebSocket on ws://${req.headers.host || `${host}:${port}`}\n`); });
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
      if (!originAllowed(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n'));
      socket.setNoDelay(true);
      entry.clients.add(socket);
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk])); pending = rest;
        for (const f of frames) {
          if (f.opcode === 8) { try { socket.end(encodeFrame(f.payload.subarray(0, 2), 8)); } catch (_) { /* gone */ } entry.clients.delete(socket); }
          else if (f.opcode === 9) socket.write(encodeFrame(f.payload, 10));
        }
      });
      const drop = () => entry.clients.delete(socket);
      socket.on('close', drop); socket.on('error', drop);
    });
    server.on('error', (e) => { entry.error = e.code === 'EADDRINUSE' ? `port ${port} is taken` : e.message; });
    server.listen(port, host);
    entry.server = server; this.servers.set(k, entry);
  }

  _close(k, s) { for (const c of s.clients) { try { c.end(encodeFrame(Buffer.from([0x03, 0xe8]), 8)); } catch (_) { /* gone */ } } try { s.server.close(); } catch (_) { /* closed */ } this.servers.delete(k); }

  /** messages: [{ host, port, text }] */
  send(messages) {
    let sent = 0;
    for (const m of messages) {
      const s = this.servers.get(this.key(m.host, m.port)); if (!s || !s.clients.size) continue;
      const frame = encodeFrame(m.text);
      for (const c of s.clients) { if (c.writable && c.writableLength < 1 << 20) { c.write(frame); sent++; } }   // a stuck client is skipped, not buffered forever
    }
    return sent;
  }

  stats() { return [...this.servers.values()].map((s) => ({ host: s.host, port: s.port, clients: s.clients.size, error: s.error })); }
  closeAll() { for (const [k, s] of this.servers) this._close(k, s); }
}

module.exports = { Hub, encodeFrame, decodeFrames, acceptKey, originAllowed };
