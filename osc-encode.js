// Minimal OSC 1.0 encoder (main process, CommonJS). Floats, ints, strings; bundles not needed.
'use strict';

function pad4(buf) { const n = (4 - (buf.length % 4)) % 4; return n ? Buffer.concat([buf, Buffer.alloc(n)]) : buf; }
function oscString(s) { return pad4(Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.alloc(1)])); }

/** encode('/muse/calm', [{ type: 'f', value: 0.42 }]) → Buffer */
function encode(address, args = []) {
  const tags = ',' + args.map((a) => a.type).join('');
  const parts = [oscString(address), oscString(tags)];
  for (const a of args) {
    if (a.type === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(Number(a.value) || 0, 0); parts.push(b); }
    else if (a.type === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(Number(a.value) || 0), 0); parts.push(b); }
    else if (a.type === 's') parts.push(oscString(a.value));
    else if (a.type === 'T' || a.type === 'F') { /* no payload */ }
  }
  return Buffer.concat(parts);
}

/** decode(Buffer) → [{ address, args: [values] }] (a bundle gives all its messages). Types f i s d h T F N. */
function decode(buf) {
  const out = [];
  const str = (o) => { let e = o; while (e < buf.length && buf[e] !== 0) e++; return { s: buf.toString('utf8', o, e), next: (e + 4) & ~3 }; };
  function msg(o, end) {
    const a = str(o); if (!a.s.startsWith('/')) return;
    const t = a.next < end ? str(a.next) : { s: ',', next: end }; let p = t.next; const args = [];
    for (const c of t.s.slice(1)) {
      if (c === 'f') { args.push(buf.readFloatBE(p)); p += 4; }
      else if (c === 'i') { args.push(buf.readInt32BE(p)); p += 4; }
      else if (c === 'd') { args.push(buf.readDoubleBE(p)); p += 8; }
      else if (c === 'h') { args.push(Number(buf.readBigInt64BE(p))); p += 8; }
      else if (c === 's' || c === 'S') { const v = str(p); args.push(v.s); p = v.next; }
      else if (c === 'T') args.push(true); else if (c === 'F') args.push(false); else if (c === 'N') args.push(null);
      else break;                                       // a type we do not read: stop, keep what we have
    }
    out.push({ address: a.s, args });
  }
  function walk(o, end) {
    if (buf.toString('utf8', o, o + 7) === '#bundle') {
      let p = o + 16;
      while (p + 4 <= end) { const n = buf.readInt32BE(p); p += 4; if (n <= 0 || p + n > end) break; walk(p, p + n); p += n; }
    } else msg(o, end);
  }
  try { walk(0, buf.length); } catch (_) { /* a broken datagram gives what was read */ }
  return out;
}

module.exports = { encode, decode };
