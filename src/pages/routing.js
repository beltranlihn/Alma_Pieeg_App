// Routing: where each signal goes. Destinations (host, port, rate) and mappings (signal → address),
// edited in place, saved automatically, with the live value of every mapping next to it.
import { SIGNALS, SIGNAL_BY_ID, SIGNAL_GROUPS } from '../signals.js';

export function mountRouting(root, { engine, router, saveConfig }) {
  root.innerHTML = `
    <section class="routing">
      <div class="routing-head">
        <div class="routing-title">
          <h1>Routing</h1>
          <div class="hint">OSC over UDP, or a WebSocket that receivers connect to (one JSON message per tick). Add a destination, then map signals to addresses.</div>
        </div>
        <div class="routing-tools">
          <div class="row"><div class="k">Sending</div><div class="seg-group" id="routerEnabled"><button class="seg on" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
          <div class="row"><div class="k">Messages sent</div><div class="v" id="oscSent">0</div></div>
          <div class="row"><div class="k">Routing file</div><div class="v"><button class="seg" id="rtExport">Export</button> <button class="seg" id="rtImport">Import</button></div></div>
          <div class="hint" id="rtNote"></div>
        </div>
      </div>

      <h2>Destinations <button class="seg" id="addDest">+ Add</button></h2>
      <div class="table" id="dests">
        <div class="trow thead"><div>On</div><div>Name</div><div>Type</div><div>Host (IP)</div><div>Port</div><div>Rate (Hz)</div><div>Mappings</div><div></div></div>
      </div>

      <h2>Mappings <button class="seg" id="addMap">+ Add</button></h2>
      <div class="table maps" id="maps">
        <div class="trow thead"><div>On</div><div>Signal</div><div>Address</div><div>Destination</div><div>Type</div><div>In min</div><div>In max</div><div>Out min</div><div>Out max</div><div>Smooth</div><div>Live</div><div></div></div>
      </div>
      <div class="hint">In → Out: the signal range that maps to the output range. Smooth 0 = instant, 0.9 = slow. Int sends whole numbers.</div>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const signalOptionsNow = () => SIGNAL_GROUPS.map((g) => `<optgroup label="${g}">${SIGNALS.filter((s) => s.group === g).map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</optgroup>`).join('');
  const destOptions = () => router.destinations.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  const liveEls = new Map();

  function num(v, fallback) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }

  function renderDests() {
    const el = $('dests'); el.querySelectorAll('.trow:not(.thead)').forEach((r) => r.remove());
    if (!router.destinations.length) { const r = document.createElement('div'); r.className = 'trow empty-row'; r.innerHTML = '<div>No destinations yet. Add one, or load a preset.</div>'; el.appendChild(r); }
    for (const d of router.destinations) {
      const r = document.createElement('div'); r.className = 'trow';
      r.innerHTML = `<div><input type="checkbox" ${d.enabled ? 'checked' : ''}></div>
        <div><input type="text" value="${esc(d.name)}"></div>
        <div><select class="kind"><option value="osc">OSC · UDP</option><option value="ws">WebSocket</option></select></div>
        <div><input type="text" value="${esc(d.host)}" spellcheck="false" title="${d.kind === 'ws' ? 'Listen on: 127.0.0.1 = this computer only · 0.0.0.0 = the network' : 'Where to send'}"></div>
        <div><input type="text" value="${d.port}"></div>
        <div><input type="text" value="${d.rate}"></div>
        <div class="dim" data-dest="${d.id}">${router.mappings.filter((m) => m.destination === d.id).length}</div>
        <div class="actions"><button class="seg" title="Send /alma/test 1.0">Test</button><button class="seg danger">Remove</button></div>`;
      const [on, name, host, port, rate] = r.querySelectorAll('input');
      const kind = r.querySelector('.kind'); kind.value = d.kind || 'osc';
      kind.addEventListener('change', () => { d.kind = kind.value; if (d.kind === 'ws' && d.port === 9000) d.port = 8765; router.syncOutputs(); saveConfig(); renderDests(); });
      on.addEventListener('change', () => { d.enabled = on.checked; router.syncOutputs(); saveConfig(); });
      name.addEventListener('change', () => { d.name = name.value.trim() || 'Destination'; saveConfig(); renderMaps(); });
      host.addEventListener('change', () => { d.host = host.value.trim(); router.syncOutputs(); saveConfig(); });
      port.addEventListener('change', () => { d.port = Math.max(1, Math.min(65535, num(port.value, d.port) | 0)); port.value = d.port; router.syncOutputs(); saveConfig(); });
      rate.addEventListener('change', () => { d.rate = Math.max(1, Math.min(250, num(rate.value, d.rate))); rate.value = d.rate; saveConfig(); });
      const [test, remove] = r.querySelectorAll('button');
      test.addEventListener('click', () => { router.test(d); test.textContent = 'Sent'; setTimeout(() => (test.textContent = 'Test'), 900); });
      remove.addEventListener('click', () => { router.removeDestination(d.id); saveConfig(); renderDests(); renderMaps(); });
      el.appendChild(r);
    }
  }

  function renderMaps() {
    const el = $('maps'); el.querySelectorAll('.trow:not(.thead)').forEach((r) => r.remove()); liveEls.clear();
    if (!router.mappings.length) { const r = document.createElement('div'); r.className = 'trow empty-row'; r.innerHTML = '<div>No mappings yet.</div>'; el.appendChild(r); }
    for (const m of router.mappings) {
      const r = document.createElement('div'); r.className = 'trow';
      r.innerHTML = `<div><input type="checkbox" ${m.enabled ? 'checked' : ''}></div>
        <div><select class="sig">${signalOptionsNow()}</select></div>
        <div><input type="text" class="addr" value="${esc(m.address)}" spellcheck="false"></div>
        <div><select class="dest">${destOptions()}</select></div>
        <div><select class="type"><option value="f">float</option><option value="i">int</option></select></div>
        <div><input type="text" value="${m.inMin}"></div><div><input type="text" value="${m.inMax}"></div>
        <div><input type="text" value="${m.outMin}"></div><div><input type="text" value="${m.outMax}"></div>
        <div><input type="text" value="${m.smooth}"></div>
        <div class="live"><div class="meter"><div class="meter-fill"></div></div><span class="v"></span></div>
        <div class="actions"><button class="seg copy" title="Duplicate this mapping">Copy</button><button class="seg danger">Remove</button></div>`;
      const on = r.querySelector('input[type=checkbox]'), sig = r.querySelector('.sig'), addr = r.querySelector('.addr'), dest = r.querySelector('.dest'), type = r.querySelector('.type');
      const [inMin, inMax, outMin, outMax, smooth] = Array.from(r.querySelectorAll('input[type=text]')).slice(1);
      sig.value = m.signal; dest.value = m.destination || ''; type.value = m.type;
      on.addEventListener('change', () => { m.enabled = on.checked; saveConfig(); });
      sig.addEventListener('change', () => { m.signal = sig.value; const s = SIGNAL_BY_ID[m.signal]; m.inMin = s.range[0]; m.inMax = s.range[1]; inMin.value = m.inMin; inMax.value = m.inMax; if (s.kind === 'event') { m.type = 'i'; type.value = 'i'; } saveConfig(); });
      addr.addEventListener('change', () => { let a = addr.value.trim(); if (!a.startsWith('/')) a = '/' + a; m.address = a.replace(/\s+/g, '_'); addr.value = m.address; saveConfig(); });
      dest.addEventListener('change', () => { m.destination = dest.value; saveConfig(); renderDests(); });
      type.addEventListener('change', () => { m.type = type.value; saveConfig(); });
      inMin.addEventListener('change', () => { m.inMin = num(inMin.value, m.inMin); saveConfig(); });
      inMax.addEventListener('change', () => { m.inMax = num(inMax.value, m.inMax); saveConfig(); });
      outMin.addEventListener('change', () => { m.outMin = num(outMin.value, m.outMin); saveConfig(); });
      outMax.addEventListener('change', () => { m.outMax = num(outMax.value, m.outMax); saveConfig(); });
      smooth.addEventListener('change', () => { m.smooth = Math.max(0, Math.min(0.95, num(smooth.value, m.smooth))); smooth.value = m.smooth; saveConfig(); });
      r.querySelector('button.danger').addEventListener('click', () => { router.removeMapping(m.id); saveConfig(); renderMaps(); renderDests(); });
      r.querySelector('button.copy').addEventListener('click', () => { router.duplicateMapping(m.id); saveConfig(); renderMaps(); renderDests(); });
      liveEls.set(m.id, { fill: r.querySelector('.meter-fill'), v: r.querySelector('.live .v'), m });
      el.appendChild(r);
    }
  }

  function refreshLive() {
    for (const { fill, v, m } of liveEls.values()) {
      const val = router.live.get(m.id);
      if (val === undefined) { v.textContent = '—'; fill.style.width = '0%'; continue; }
      const span = (m.outMax - m.outMin) || 1, pct = Math.max(0, Math.min(1, (val - m.outMin) / span));
      fill.style.width = `${(pct * 100).toFixed(1)}%`; v.textContent = m.type === 'i' ? String(Math.round(val)) : val.toFixed(3);
    }
    $('oscSent').textContent = String(router.sent);
  }

  const note = (t) => { $('rtNote').textContent = t; clearTimeout(note.t); note.t = setTimeout(() => { $('rtNote').textContent = ''; }, 6000); };
  $('rtExport').addEventListener('click', async () => { const p = await window.alma.exportRouting(router.exportJSON()); if (p) note(`Saved ${p.split(/[\x5c/]/).pop()}.`); });
  $('rtImport').addEventListener('click', async () => {
    const f = await window.alma.importRouting(); if (!f) return;
    try { const r = router.importJSON(f.text); saveConfig(); renderDests(); renderMaps(); note(`Added ${r.destinations} destination${r.destinations === 1 ? '' : 's'} and ${r.mappings} mapping${r.mappings === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped (unknown signal)` : ''}.`); }
    catch (e) { note(`Could not read ${f.path.split(/[\x5c/]/).pop()}: ${e.message}`); }
  });
  $('addDest').addEventListener('click', () => { router.addDestination(); saveConfig(); renderDests(); renderMaps(); });
  $('addMap').addEventListener('click', () => { if (!router.destinations.length) router.addDestination(); router.addMapping(); saveConfig(); renderDests(); renderMaps(); });
  $('routerEnabled').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', (b.dataset.v === '1') === router.enabled); b.addEventListener('click', () => { router.enabled = b.dataset.v === '1'; $('routerEnabled').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); saveConfig(); }); });
  setInterval(() => { if (!root.classList.contains('hidden')) refreshLive(); }, 100);
  // WebSocket destinations: how many clients are connected, or why the port could not open
  setInterval(async () => {
    if (root.classList.contains('hidden') || !window.alma.wsStats) return;
    const stats = await window.alma.wsStats();
    for (const d of router.destinations) {
      const cell = root.querySelector(`[data-dest="${d.id}"]`); if (!cell) continue;
      const n = router.mappings.filter((m) => m.destination === d.id).length;
      if (d.kind !== 'ws') { cell.textContent = String(n); continue; }
      const s = stats.find((x) => x.port === d.port && x.host === (d.host || '0.0.0.0'));
      cell.textContent = !d.enabled ? `${n}` : !s ? `${n} · opening` : s.error ? `${n} · ${s.error}` : `${n} · ${s.clients} ${s.clients === 1 ? 'client' : 'clients'}`;
    }
  }, 1000);
  renderDests(); renderMaps();
  return { onShow: () => { renderDests(); renderMaps(); } };
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
