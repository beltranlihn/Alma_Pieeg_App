// Routing, second half: rules that fire events, the cue sheet, markers coming in, and compatibility with PiEEG's
// own tools. Mounted under the mappings by routing.js.
import { SIGNAL_BY_ID } from '../signals.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const parseTime = (t, d) => { const m = /^\s*(\d+):(\d{1,2}(?:\.\d+)?)\s*$/.exec(String(t)); return m ? +m[1] * 60 + +m[2] : num(t, d); };

export function mountRoutingMore(host, { engine, router, rules, cues, inputs, compat, saveConfig, signalOptions }) {
  host.innerHTML = `
    <h2>Rules <button class="seg" id="addRule">+ Add</button></h2>
    <div class="table rules" id="rules"><div class="trow thead"><div>On</div><div>Name</div><div>Signal</div><div>When</div><div>Value</div><div>For (s)</div><div>Cooldown (s)</div><div>Send to</div><div>Address or URL</div><div>Now</div><div></div></div></div>
    <div class="hint">A rule fires once when its signal stays above (or below) the value for that long, then waits for the cooldown and for the signal to come back. It sends 1 to the address (OSC), a JSON event (WebSocket: <code>{"event", "rule_name", "value", …}</code>), a MIDI note, or POSTs the same JSON to a webhook. Marked in the recording.</div>

    <h2><span>Cue sheet<span class="count" id="cueState"></span></span><span><button class="seg" id="cueRun">Run</button> <button class="seg" id="cueStop">Stop</button> <button class="seg" id="addCue">+ Add</button></span></h2>
    <div class="rows cue-opts"><div class="row"><div class="k">Start with each session</div><div class="seg-group" id="cueWith"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div></div>
    <div class="table cues" id="cues"><div class="trow thead"><div>On</div><div>At (m:ss)</div><div>Label</div><div>Send to</div><div>Address</div><div>Value</div><div>State</div><div></div></div></div>
    <div class="hint">Timed messages for a piece with a score. They run from the start of a session (or Run, or OSC <code>/alma/cues/start</code>), each fires once, and each is marked in the recording.</div>

    <h2>Markers and commands in</h2>
    <div class="rows io-rows">
      <div class="row"><div class="k">Listen (UDP, OSC or text)</div><div class="seg-group" id="inOn"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
      <div class="row"><div class="k">From</div><div class="seg-group" id="inHost"><button class="seg" data-v="127.0.0.1">This computer</button><button class="seg" data-v="0.0.0.0">The network</button></div></div>
      <div class="row"><div class="k">Port</div><div class="v"><input type="text" id="inPort" style="width:80px"></div></div>
      <div class="row"><div class="k">State</div><div class="v" id="inState">—</div></div>
      <div class="row"><div class="k">Last</div><div class="v" id="inLast">—</div></div>
    </div>
    <div class="hint">OSC <code>/alma/mark "text"</code> drops a marker (any plain-text datagram does too); <code>/alma/session/start "name"</code>, <code>/alma/session/stop</code>, <code>/alma/calibrate</code>, <code>/alma/cues/start</code>, <code>/alma/cues/stop</code>. Over any WebSocket port of the app: <code>{"mark": "text"}</code>. Markers go out as <i>marker.pulse</i> and are stamped in the recording.</div>

    <h2>PiEEG compatibility</h2>
    <div class="rows io-rows">
      <div class="row"><div class="k"><b>PiEEG WebSocket</b> · their Unity plugin and tools</div><div class="seg-group" id="pwOn"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
      <div class="row"><div class="k">From</div><div class="seg-group" id="pwHost"><button class="seg" data-v="127.0.0.1">This computer</button><button class="seg" data-v="0.0.0.0">The network</button></div></div>
      <div class="row"><div class="k">Port</div><div class="v"><input type="text" id="pwPort" style="width:80px"></div></div>
      <div class="row"><div class="k">State</div><div class="v" id="pwState">—</div></div>
      <div class="row"><div class="k"><b>VRChat avatar parameters</b> · EEG_Delta … EEG_Gamma</div><div class="seg-group" id="vrOn"><button class="seg" data-v="1">On</button><button class="seg" data-v="0">Off</button></div></div>
      <div class="row"><div class="k">To</div><div class="v"><input type="text" id="vrHost" style="width:130px" spellcheck="false"> : <input type="text" id="vrPort" style="width:70px"></div></div>
    </div>
    <div class="hint">The PiEEG WebSocket sends every sample as PiEEG's server does (<code>{"t", "n", "channels": [8 µV]}</code> at 250 /s) and takes their commands (<code>start_record</code>, <code>stop_record</code>, <code>set_filter</code>). VRChat gets the five bands 0–1 every 0.25 s on OSC (each over its own 10 s maximum, as PiEEG's bridge). The same values are signals for any mapping: <i>PiEEG style</i>.</div>`;
  const $ = (id) => host.querySelector('#' + id);
  const destOptions = (withHttp) => router.destinations.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('') + (withHttp ? '<option value="http">HTTP webhook</option>' : '') + '<option value="">Nowhere (mark only)</option>';
  const segs = (id, value, on) => { const g = $(id); g.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.v === String(value)); b.onclick = () => { on(b.dataset.v); g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }; }); };

  // ── rules ──
  const ruleEls = new Map();
  function renderRules() {
    const el = $('rules'); el.querySelectorAll('.trow:not(.thead)').forEach((r) => r.remove()); ruleEls.clear();
    if (!rules.list.length) { const r = document.createElement('div'); r.className = 'trow empty-row'; r.innerHTML = '<div>No rules yet. Example: calm above 0.7 for 5 s → fade the lights.</div>'; el.appendChild(r); }
    for (const rule of rules.list) {
      const r = document.createElement('div'); r.className = 'trow';
      r.innerHTML = `<div><input type="checkbox" ${rule.enabled ? 'checked' : ''}></div><div><input type="text" class="name" value="${esc(rule.name)}"></div>
        <div><select class="sig">${signalOptions()}</select></div><div><select class="op"><option value="above">above</option><option value="below">below</option></select></div>
        <div><input type="text" class="val" value="${rule.value}"></div><div><input type="text" class="hold" value="${rule.hold}"></div><div><input type="text" class="cool" value="${rule.cooldown}"></div>
        <div><select class="dest">${destOptions(true)}</select></div><div><input type="text" class="addr" spellcheck="false" value="${esc(rule.target === 'http' ? rule.url : rule.address)}"></div>
        <div class="dim now">—</div><div class="actions"><button class="seg test" title="Fire it now">Fire</button><button class="seg danger">Remove</button></div>`;
      const q = (c) => r.querySelector(c);
      q('.sig').value = rule.signal; q('.op').value = rule.op; q('.dest').value = rule.target;
      q('input[type=checkbox]').onchange = (e) => { rule.enabled = e.target.checked; saveConfig(); };
      q('.name').onchange = (e) => { rule.name = e.target.value.trim() || 'Rule'; saveConfig(); };
      q('.sig').onchange = (e) => { rule.signal = e.target.value; saveConfig(); };
      q('.op').onchange = (e) => { rule.op = e.target.value; saveConfig(); };
      q('.val').onchange = (e) => { rule.value = num(e.target.value, rule.value); e.target.value = rule.value; saveConfig(); };
      q('.hold').onchange = (e) => { rule.hold = Math.max(0, num(e.target.value, rule.hold)); e.target.value = rule.hold; saveConfig(); };
      q('.cool').onchange = (e) => { rule.cooldown = Math.max(0, num(e.target.value, rule.cooldown)); e.target.value = rule.cooldown; saveConfig(); };
      q('.dest').onchange = (e) => { rule.target = e.target.value; q('.addr').value = rule.target === 'http' ? rule.url : rule.address; saveConfig(); };
      q('.addr').onchange = (e) => { const v = e.target.value.trim(); if (rule.target === 'http') rule.url = v; else rule.address = v; saveConfig(); };
      q('.test').onclick = () => rules.fire(rule, SIGNAL_BY_ID[rule.signal] ? SIGNAL_BY_ID[rule.signal].get(engine.features) : 0);
      q('.danger').onclick = () => { rules.remove(rule.id); saveConfig(); renderRules(); };
      ruleEls.set(rule.id, q('.now')); el.appendChild(r);
    }
  }
  $('addRule').onclick = () => { rules.add(); saveConfig(); renderRules(); };

  // ── cues ──
  const cueEls = new Map();
  function renderCues() {
    const el = $('cues'); el.querySelectorAll('.trow:not(.thead)').forEach((r) => r.remove()); cueEls.clear();
    if (!cues.list.length) { const r = document.createElement('div'); r.className = 'trow empty-row'; r.innerHTML = '<div>No cues yet.</div>'; el.appendChild(r); }
    for (const c of cues.list) {
      const r = document.createElement('div'); r.className = 'trow';
      r.innerHTML = `<div><input type="checkbox" ${c.enabled ? 'checked' : ''}></div><div><input type="text" class="at" value="${mmss(c.at)}"></div><div><input type="text" class="label" value="${esc(c.label)}"></div>
        <div><select class="dest">${destOptions(false)}</select></div><div><input type="text" class="addr" spellcheck="false" value="${esc(c.address)}"></div><div><input type="text" class="val" value="${c.value}"></div>
        <div class="dim st">—</div><div class="actions"><button class="seg danger">Remove</button></div>`;
      const q = (s) => r.querySelector(s); q('.dest').value = c.target;
      q('input[type=checkbox]').onchange = (e) => { c.enabled = e.target.checked; saveConfig(); };
      q('.at').onchange = (e) => { c.at = Math.max(0, parseTime(e.target.value, c.at)); cues.sort(); saveConfig(); renderCues(); };
      q('.label').onchange = (e) => { c.label = e.target.value.trim() || 'Cue'; saveConfig(); };
      q('.dest').onchange = (e) => { c.target = e.target.value; saveConfig(); };
      q('.addr').onchange = (e) => { c.address = e.target.value.trim(); saveConfig(); };
      q('.val').onchange = (e) => { c.value = num(e.target.value, c.value); e.target.value = c.value; saveConfig(); };
      q('.danger').onclick = () => { cues.remove(c.id); saveConfig(); renderCues(); };
      cueEls.set(c.id, q('.st')); el.appendChild(r);
    }
  }
  $('addCue').onclick = () => { cues.add(); saveConfig(); renderCues(); };
  $('cueRun').onclick = () => cues.start(false);
  $('cueStop').onclick = () => cues.stop();
  segs('cueWith', cues.withSession ? 1 : 0, (v) => { cues.withSession = v === '1'; saveConfig(); });

  // ── inputs ──
  segs('inOn', inputs.cfg.enabled ? 1 : 0, (v) => { inputs.configure({ enabled: v === '1' }); saveConfig(); });
  segs('inHost', inputs.cfg.host, (v) => { inputs.configure({ host: v }); saveConfig(); });
  $('inPort').value = inputs.cfg.port; $('inPort').onchange = (e) => { inputs.configure({ port: num(e.target.value, inputs.cfg.port) }); e.target.value = inputs.cfg.port; saveConfig(); };

  // ── PiEEG compatibility ──
  segs('pwOn', compat.cfg.pieegWs ? 1 : 0, (v) => { compat.configure({ pieegWs: v === '1' }); saveConfig(); });
  segs('pwHost', compat.cfg.pieegHost, (v) => { compat.configure({ pieegHost: v }); saveConfig(); });
  $('pwPort').value = compat.cfg.pieegPort; $('pwPort').onchange = (e) => { compat.configure({ pieegPort: num(e.target.value, compat.cfg.pieegPort) }); e.target.value = compat.cfg.pieegPort; saveConfig(); };
  segs('vrOn', compat.cfg.vrchat ? 1 : 0, (v) => { compat.configure({ vrchat: v === '1' }); saveConfig(); });
  $('vrHost').value = compat.cfg.vrchatHost; $('vrHost').onchange = (e) => { compat.configure({ vrchatHost: e.target.value.trim() || '127.0.0.1' }); saveConfig(); };
  $('vrPort').value = compat.cfg.vrchatPort; $('vrPort').onchange = (e) => { compat.configure({ vrchatPort: num(e.target.value, compat.cfg.vrchatPort) }); e.target.value = compat.cfg.vrchatPort; saveConfig(); };

  // ── live state ──
  async function refresh() {
    if (host.closest('.hidden')) return;
    const f = engine.features;
    for (const rule of rules.list) {
      const el = ruleEls.get(rule.id); if (!el) continue;
      const st = rules.stateOf(rule.id), sig = SIGNAL_BY_ID[rule.signal];
      el.textContent = `${sig ? (+sig.get(f)).toFixed(2) : '—'} · fired ${st.count}${st.result ? ` · ${st.result}` : ''}`;
    }
    const next = cues.next;
    $('cueState').textContent = cues.running ? `running ${mmss(cues.elapsed)}${next ? ` · next ${next.label} at ${mmss(next.at)}` : ''}` : cues.fired.size ? `stopped · ${cues.fired.size} fired` : '';
    for (const c of cues.list) { const el = cueEls.get(c.id); if (el) el.textContent = cues.fired.has(c.id) ? 'fired' : cues.running && next && next.id === c.id ? 'next' : '—'; }
    const s = window.alma.inputStats ? await window.alma.inputStats() : null;
    $('inState').textContent = !inputs.cfg.enabled ? 'off' : !s ? '—' : s.error ? s.error : s.listening ? `listening on ${inputs.cfg.host}:${inputs.cfg.port} · ${s.received} received` : 'opening';
    const l = inputs.last; $('inLast').textContent = l ? `${l.command ? '' : 'marker '}${l.text}${l.from ? ` · ${l.from}` : ''} · ${new Date(l.at).toLocaleTimeString()}` : '—';
    if (compat.cfg.pieegWs && window.alma.wsStats) {
      const st = (await window.alma.wsStats()).find((x) => x.port === compat.cfg.pieegPort && x.host === compat.cfg.pieegHost);
      $('pwState').textContent = !st ? 'opening' : st.error ? st.error : `${st.clients} ${st.clients === 1 ? 'client' : 'clients'} · ${compat.sentFrames} frames sent · ws://${compat.cfg.pieegHost === '0.0.0.0' ? '<this computer>' : '127.0.0.1'}:${compat.cfg.pieegPort}`;
    } else $('pwState').textContent = 'off';
  }
  setInterval(refresh, 500);
  engine.addEventListener('rule', () => refresh());
  renderRules(); renderCues();
  return { render: () => { renderRules(); renderCues(); } };
}
