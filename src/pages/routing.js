// Routing: where each signal goes. Destinations (host, port, rate) and mappings (signal → address),
// edited in place, saved automatically, with the live value of every mapping next to it.
import { SIGNALS, SIGNAL_BY_ID, SIGNAL_GROUPS } from '../signals.js';
import { midiOutputs, onMidiPorts } from '../midi.js';
import { mountRoutingMore } from './routing-more.js';

export function mountRouting(root, { engine, router, saveConfig, rules, cues, inputs, compat }) {
  root.innerHTML = `
    <section class="routing">
      <div class="routing-head">
        <div class="routing-title">
          <h1>Routing</h1>
          <div class="hint">OSC over UDP, a WebSocket that receivers connect to (one JSON message per tick; open its address in a browser, on this computer or a phone, to watch the values), or a MIDI port. Add a destination, then map signals to addresses.</div>
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
        <div class="trow thead"><div>On</div><div>Name</div><div>Type</div><div>Host (IP) · MIDI port</div><div>Port · channel</div><div>Rate (Hz)</div><div>Mappings</div><div></div></div>
      </div>

      <h2>Mappings <button class="seg" id="addMap">+ Add</button></h2>
      <div class="table maps" id="maps">
        <div class="trow thead"><div>On</div><div>Signal</div><div>Address</div><div>Destination</div><div>Type</div><div>In min</div><div>In max</div><div>Out min</div><div>Out max</div><div>Smooth</div><div>Live</div><div></div></div>
      </div>
      <div class="hint">In → Out: the signal range that maps to the output range. Smooth 0 = instant, 0.9 = slow. Int sends whole numbers. For MIDI the address is <code>cc 7</code> (0–127 from the output) or <code>note 60</code> (on in the upper half).</div>
      <div id="routingMore"></div>
    </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const signalOptionsNow = () => SIGNAL_GROUPS.map((g) => `<optgroup label="${g}">${SIGNALS.filter((s) => s.group === g).map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</optgroup>`).join('');
  const destOptions = () => router.destinations.map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  const liveEls = new Map();

  function num(v, fallback) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }

  function renderDests() {
    const el = $('dests'); el.querySelectorAll('.trow:not(.thead)').forEach((r) => r.remove());
    if (!router.destinations.length) { const r = document.createElement('div'); r.className = 'trow empty-row'; r.innerHTML = '<div>No destinations yet. Add one.</div>'; el.appendChild(r); }
    for (const d of router.destinations) {
      const r = document.createElement('div'); r.className = 'trow';
      const midi = d.kind === 'midi', ports = midiOutputs();
      const hostCell = midi
        ? `<select class="host">${(ports.length ? ports : []).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}${ports.includes(d.host) || !d.host ? '' : `<option value="${esc(d.host)}">${esc(d.host)} (not found)</option>`}${ports.length ? '' : '<option value="">No MIDI ports · install loopMIDI</option>'}</select>`
        : `<input type="text" class="host" value="${esc(d.host)}" spellcheck="false" title="${d.kind === 'ws' ? 'Listen on: 127.0.0.1 = this computer only · 0.0.0.0 = the network' : 'Where to send'}">`;
      r.innerHTML = `<div><input type="checkbox" class="on" ${d.enabled ? 'checked' : ''}></div>
        <div><input type="text" class="name" value="${esc(d.name)}"></div>
        <div><select class="kind"><option value="osc">OSC · UDP</option><option value="ws">WebSocket</option><option value="midi">MIDI</option></select></div>
        <div>${hostCell}</div>
        <div><input type="text" class="port" value="${d.port}" title="${midi ? 'MIDI channel 1–16' : 'UDP / TCP port'}"></div>
        <div><input type="text" class="rate" value="${d.rate}"></div>
        <div class="dim" data-dest="${d.id}">${router.mappings.filter((m) => m.destination === d.id).length}</div>
        <div class="actions"><button class="seg test" title="${midi ? 'Send note 60' : 'Send /alma/test 1.0'}">Test</button><button class="seg danger">Remove</button></div>`;
      const q = (c) => r.querySelector(c);
      const kind = q('.kind'); kind.value = d.kind || 'osc';
      kind.addEventListener('change', () => {
        const was = d.kind; d.kind = kind.value;
        if (d.kind === 'midi') { d.host = midiOutputs()[0] || ''; d.port = 1; }
        else if (was === 'midi') { d.host = '127.0.0.1'; d.port = d.kind === 'ws' ? 8765 : 9000; }
        else if (d.kind === 'ws' && d.port === 9000) d.port = 8765;
        router.syncOutputs(); saveConfig(); renderDests(); renderMaps();
      });
      q('.on').addEventListener('change', (e) => { d.enabled = e.target.checked; router.syncOutputs(); saveConfig(); });
      q('.name').addEventListener('change', (e) => { d.name = e.target.value.trim() || 'Destination'; saveConfig(); renderMaps(); more.render(); });
      q('.host').addEventListener('change', (e) => { d.host = e.target.value.trim(); router.syncOutputs(); saveConfig(); });
      q('.port').addEventListener('change', (e) => { d.port = midi ? Math.max(1, Math.min(16, num(e.target.value, d.port) | 0)) : Math.max(1, Math.min(65535, num(e.target.value, d.port) | 0)); e.target.value = d.port; router.syncOutputs(); saveConfig(); });
      q('.rate').addEventListener('change', (e) => { d.rate = Math.max(1, Math.min(250, num(e.target.value, d.rate))); e.target.value = d.rate; saveConfig(); });
      const test = q('.test');
      test.addEventListener('click', () => { router.test(d); test.textContent = 'Sent'; setTimeout(() => (test.textContent = 'Test'), 900); });
      q('.danger').addEventListener('click', () => { router.removeDestination(d.id); saveConfig(); renderDests(); renderMaps(); more.render(); });
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
      addr.addEventListener('change', () => {
        const d = router.destinations.find((x) => x.id === m.destination);
        if (d && d.kind === 'midi') { m.address = addr.value.trim().toLowerCase().replace(/\s+/g, ' '); addr.value = m.address; saveConfig(); return; }   // "cc 7" or "note 60"
        let a = addr.value.trim(); if (!a.startsWith('/')) a = '/' + a; m.address = a.replace(/\s+/g, '_'); addr.value = m.address; saveConfig();
      });
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
  $('addDest').addEventListener('click', () => { router.addDestination(); saveConfig(); renderDests(); renderMaps(); more.render(); });
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
      const viewer = s && !s.error ? (d.host === '0.0.0.0' || d.host === '' ? (lan[0] ? `http://${lan[0]}:${d.port}/` : '') : `http://${d.host === 'localhost' ? '127.0.0.1' : d.host}:${d.port}/`) : '';
      cell.innerHTML = !d.enabled ? `${n}` : !s ? `${n} · opening` : s.error ? `${n} · ${esc(s.error)}` : `${n} · ${s.clients} ${s.clients === 1 ? 'client' : 'clients'}${viewer ? ` · <a href="#" data-ext="${viewer}" title="${viewer}">viewer</a>` : ''}`;
    }
  }, 1000);
  // the remote viewer link opens in the browser (this computer, or copy it to a phone on the same network)
  let lan = []; if (window.alma.netAddresses) window.alma.netAddresses().then((a) => { lan = a || []; });
  $('dests').addEventListener('click', (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); window.alma.openExternal?.(a.dataset.ext); } });
  onMidiPorts(() => { if (router.destinations.some((d) => d.kind === 'midi')) renderDests(); });
  const more = mountRoutingMore($('routingMore'), { engine, router, rules, cues, inputs, compat, saveConfig, signalOptions: signalOptionsNow });
  renderDests(); renderMaps();
  return { onShow: () => { renderDests(); renderMaps(); more.render(); } };
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
