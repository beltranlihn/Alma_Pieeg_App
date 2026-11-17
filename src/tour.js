// The guided tour: walks through every page and panel, darkens the rest of the window and outlines the one it
// talks about, with a card that says what it is for. Started from Tour in the header; offered once on the first
// run. While it is open it holds the keyboard (→ / Enter next, ← back, Esc close), so C, M and R do not start a
// calibration or a recording behind it. At the end it puts back the page and the views it found.
//
// A step: { page, view (Live or Face sub-tab), target, title, text }. target is { sel } (one element, or several
// separated by commas: the box around all of them) or { heading } (an h2 of that page and everything under it
// until the next h2). No target: the card sits in the middle.

const STEPS = [
  { page: 'home', target: { sel: 'nav' }, title: 'Five pages',
    text: 'Home to put the mask on and check it. Live to watch the signal. Face for gestures, gaze and tension. Sessions for what you recorded. Routing to send it all to TouchDesigner, Unreal, Max, Unity or a browser.' },
  { page: 'home', target: { sel: '#hdrDot, #hdrText, #hdrConnect' }, title: 'Connect',
    text: 'Connects to the PiEEG box over Bluetooth. Once it streams, this says the rate (250 /s) and how many electrodes have good contact. Power the box from a battery or the headset only, never from the mains.' },
  { page: 'home', target: { sel: '.session-bar' }, title: 'The session bar',
    text: 'Participant and notes go into every file. Calibrate (C) measures this person at rest and in a task. Mark (M) drops a marker into the recording. Start session (R) records the raw signal and all the features to Documents › EEG Alma Center › sessions.' },
  { page: 'home', target: { sel: '.home-visual, .head-tools' }, title: 'The head',
    text: 'Each disc is an electrode, where the electrode map puts it. In Contact: green good, yellow fair, red poor, grey flat; the bigger metal disc is the reference. The band buttons paint the head with each band instead. Drag to turn it.' },
  { page: 'home', target: { heading: 'Ready to start' }, title: 'Ready to start',
    text: 'Five checks before recording: sensor, stream, a quiet reference, every electrode on the skin, and three blinks seen. When they are all green, the signal is worth recording.' },
  { page: 'home', target: { heading: 'Contact' }, title: 'Contact',
    text: 'Ref first: what every channel shares. If it says noisy, press the reference and bias discs: a bad reference looks like eight bad electrodes. Then each channel’s own noise in µV. "No disc" is an input with no electrode on this mask.' },
  { page: 'home', target: { heading: 'Electrodes' }, title: 'The electrode map',
    text: 'Which input of the board sits where on the mask. Prototypes are wired differently: find the wiring with a multimeter and set it in Edit map. Blinks, gaze, asymmetry, tension and the head all follow it.' },
  { page: 'home', target: { heading: 'Heart rate' }, title: 'Heart rate',
    text: 'A Garmin ANT+ stick or a Bluetooth strap. "Heart from" picks the source: Auto uses a strap when there is one; Electrodes estimates the pulse from the temples, experimental and for art, never for health. It only says a number when the rhythm is clear.' },
  { page: 'home', target: { heading: 'Stream' }, title: 'Stream',
    text: 'Packets, rate and time connected. If data stops, the status says so and what to do. The body blocks Bluetooth: keep the box on the side of the head that faces the computer.' },
  { page: 'live', view: 'bands', target: { sel: '#views' }, title: 'Live: four views',
    text: 'Bands: power per band and channel. Waves: the signal itself. Spectrum: what frequencies it carries. Indices: calm, focus, relaxation and more, each 0–1, ready to send out.' },
  { page: 'live', view: 'waves', target: { sel: '#viewWaves' }, title: 'Waves',
    text: 'The eight channels, filtered. Channels without contact are dimmed. Blinks are big slow bumps on the forehead; jaw and movement are fast fuzz on the temples.' },
  { page: 'live', view: 'waves', target: { heading: 'Filters' }, title: 'Filters',
    text: 'Mains notch, band-pass, and Reference: Average subtracts what all channels share, which hides a noisy reference while you fix it. Only the view and the analysis change: recordings keep the raw signal.' },
  { page: 'live', view: 'indices', target: { sel: '#calPanel' }, title: 'Calibration',
    text: 'Measures this person at rest and in a task (eyes closed, counting…) and finds the channel and band that change the most. The indices are then scaled to that person instead of to the last minute.' },
  { page: 'live', view: 'indices', target: { heading: 'Results' }, title: 'Results',
    text: 'After a session: how the signals you choose moved, beginning against end, by method.' },
  { page: 'face', view: 'gestures', target: { sel: '#fvGestures' }, title: 'Gestures',
    text: 'Teach it a few face gestures (blink, clench, smile, raise the brows): twice each, then it recognises them live. Each one can be sent out as a trigger.' },
  { page: 'face', view: 'gaze', target: { sel: '#fvGaze' }, title: 'Gaze',
    text: 'Nine dots to calibrate where the eyes look, from the eye muscles near the temples and the forehead: left, right, up and down, as numbers you can send.' },
  { page: 'face', view: 'tension', target: { sel: '#fvTension' }, title: 'Tension',
    text: 'Jaw and brow tension 0–1, from muscle activity. Range asks the person to clench and relax, so 1 means their own strongest.' },
  { page: 'sessions', target: { sel: '#pageSessions .live-side' }, title: 'Sessions',
    text: 'Every recording with its participant, notes and markers. Pick one to see its signals over time; Compare overlays two. Folder opens the files.' },
  { page: 'routing', target: { heading: 'Destinations' }, title: 'Destinations',
    text: 'Where the signals go: OSC over UDP (TouchDesigner, Max, Unreal, Resolume) or WebSocket (browsers, Unity, Unreal). Several at once, each with its own rate.' },
  { page: 'routing', target: { heading: 'Mappings' }, title: 'Mappings',
    text: 'One line per signal: what it is, its address, its range and where it goes. Export and Import carry a whole setup to another computer.' },
  { page: null, target: null, title: 'That is all',
    text: 'Start the tour again any time from Tour in the header. The quick start guide (QUICKSTART.md) has the same in writing, with the mask and the safety notes.' },
];

export function mountTour({ ui, saveConfig, flags = {} }) {
  const $ = (id) => document.getElementById(id);
  const btn = document.createElement('button'); btn.id = 'hdrTour'; btn.className = 'tour-start'; btn.textContent = 'Tour';
  btn.title = 'A walk through every panel';
  document.querySelector('header .status').before(btn);

  const block = document.createElement('div'); block.className = 'tour-block hidden';
  const hole = document.createElement('div'); hole.className = 'tour-hole hidden';
  const card = document.createElement('div'); card.className = 'tour-card hidden'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  card.innerHTML = `<div class="tour-step"></div><h3></h3><p></p><div class="tour-actions"><button class="seg skip">Skip</button><button class="seg back">Back</button><button class="primary next">Next</button></div>`;
  document.body.append(block, hole, card);

  let k = -1, before = null;
  const currentPage = () => document.querySelector('nav button.on')?.dataset.page || 'home';
  const currentView = (id) => document.querySelector(`#${id} [data-view].on`)?.dataset.view || null;
  const goPage = (p) => { if (p && currentPage() !== p) document.querySelector(`nav button[data-page="${p}"]`)?.click(); };
  const goView = (page, v) => { if (!v) return; const tabs = page === 'face' ? 'faceViews' : 'views'; const b = document.querySelector(`#${tabs} [data-view="${v}"]`); if (b && !b.classList.contains('on')) b.click(); };

  function elementsOf(step) {
    const t = step.target; if (!t) return [];
    const root = step.page ? $('page' + step.page[0].toUpperCase() + step.page.slice(1)) : document;
    if (t.sel) return [...document.querySelectorAll(t.sel)].filter((el) => !root || root.contains(el) || !el.closest('main'));
    const h = [...root.querySelectorAll('h2')].find((el) => el.textContent.trim().startsWith(t.heading) && el.offsetParent);
    if (!h) return [];
    const out = [h]; for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) out.push(n);
    return out;
  }
  function boxOf(els) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const el of els) { const q = el.getBoundingClientRect(); if (!q.width || !q.height) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
    if (l === Infinity) return null;
    // keep it inside the window (a long panel scrolls; the outline shows the part on screen)
    l = Math.max(4, l); t = Math.max(4, t); r = Math.min(innerWidth - 4, r); b = Math.min(innerHeight - 4, b);
    return { left: l, top: t, width: r - l, height: b - t };
  }

  function place() {
    const step = STEPS[k], els = elementsOf(step), box = boxOf(els), pad = 6;
    if (box) {
      Object.assign(hole.style, { left: `${box.left - pad}px`, top: `${box.top - pad}px`, width: `${box.width + 2 * pad}px`, height: `${box.height + 2 * pad}px` });
      hole.classList.remove('hidden'); block.classList.add('clear');
    } else { hole.classList.add('hidden'); block.classList.remove('clear'); }
    // the card: beside the box where there is room (right, left, below, above), else in the middle
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16, W = innerWidth, H = innerHeight;
    let x = (W - cw) / 2, y = (H - ch) / 2;
    if (box) {
      const midY = Math.min(H - ch - 12, Math.max(12, box.top + box.height / 2 - ch / 2)), midX = Math.min(W - cw - 12, Math.max(12, box.left + box.width / 2 - cw / 2));
      if (box.left + box.width + pad + gap + cw <= W - 12) { x = box.left + box.width + pad + gap; y = midY; }
      else if (box.left - pad - gap - cw >= 12) { x = box.left - pad - gap - cw; y = midY; }
      else if (box.top + box.height + pad + gap + ch <= H - 12) { x = midX; y = box.top + box.height + pad + gap; }
      else if (box.top - pad - gap - ch >= 12) { x = midX; y = box.top - pad - gap - ch; }
      else { x = W - cw - 24; y = H - ch - 24; }                       // the box fills the window: bottom right, over it
    }
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
  }

  function go(n) {
    if (n < 0 || n >= STEPS.length) return close();
    k = n; const step = STEPS[k];
    goPage(step.page); goView(step.page, step.view);
    card.querySelector('.tour-step').textContent = `${k + 1} / ${STEPS.length}`;
    card.querySelector('h3').textContent = step.title;
    card.querySelector('p').textContent = step.text;
    card.querySelector('.back').disabled = k === 0;
    card.querySelector('.next').textContent = k === STEPS.length - 1 ? 'Done' : 'Next';
    // bring the panel into view first (side panels scroll), then measure on the next frame
    const els = elementsOf(step); if (els[0]) els[0].scrollIntoView({ block: step.target.heading ? 'start' : 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => requestAnimationFrame(place));
  }

  function open(at = 0) {
    if (!block.classList.contains('hidden')) return go(at);
    before = { page: currentPage(), live: currentView('views'), face: currentView('faceViews') };
    for (const el of [block, hole, card]) el.classList.remove('hidden');
    window.addEventListener('keydown', onKey, true); window.addEventListener('resize', place);
    go(at);
  }
  function close() {
    for (const el of [block, hole, card]) el.classList.add('hidden');
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', place);
    if (before) { goPage('live'); goView('live', before.live); goPage('face'); goView('face', before.face); goPage(before.page); before = null; }
    k = -1; if (!ui.tourSeen) { ui.tourSeen = true; saveConfig(); }
  }
  function onKey(e) {
    e.stopPropagation();                                   // the app's shortcuts wait until the tour is closed
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(k + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (k > 0) go(k - 1); }
    else if (!e.ctrlKey && !e.metaKey) e.preventDefault();
  }
  card.querySelector('.next').addEventListener('click', () => go(k + 1));
  card.querySelector('.back').addEventListener('click', () => go(k - 1));
  card.querySelector('.skip').addEventListener('click', close);
  btn.addEventListener('click', () => open(0));

  // first run: offer it once, quietly (never in a self-test run)
  if (flags.tour) setTimeout(() => open(Math.max(0, Math.min(STEPS.length - 1, (+flags.tour || 1) - 1))), 1200);
  else if (!ui.tourSeen && !flags.sim && !flags.probe && !flags.shot) {
    const offer = document.createElement('div'); offer.className = 'tour-offer';
    offer.innerHTML = '<span>First time here? A two-minute tour shows what each panel does.</span><button class="seg later">Not now</button><button class="primary go">Take the tour</button>';
    document.body.append(offer);
    const done = () => { offer.remove(); ui.tourSeen = true; saveConfig(); };
    offer.querySelector('.later').addEventListener('click', done);
    offer.querySelector('.go').addEventListener('click', () => { offer.remove(); open(0); });
  }
  return { open, close, steps: STEPS.length };
}
