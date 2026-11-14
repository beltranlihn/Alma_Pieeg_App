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

module.exports = { encode };
