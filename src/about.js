// About: who made the app, how to reach them, what it is not (a medical device), where the data goes, and the
// licences of everything inside it. Opened from About in the header or by clicking the app name.

// Contact shown in the dialog. Empty = the line is left out.
export const CONTACT = { web: 'https://almadigitalstudio.com', email: '' };

const MIT_TEXT = `MIT License

Copyright (c) 2026 Alma Digital Studio

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

// what ships inside the app, with its licence
const THIRD_PARTY = [
  ['PiEEG-server and pieeg.js', 'MIT · © 2025 PiEEG Community', 'Pieces of the analyses are ported from it: Avatar Foundation, Face Trainer, Eye Track, artifact envelopes, alpha asymmetry, beta recovery, filters and indices.', 'https://github.com/pieeg-club'],
  ['Electron', 'MIT · © Electron contributors', 'The app shell. It includes Chromium (BSD-3-Clause and others) and Node.js (MIT).', 'https://www.electronjs.org'],
  ['three.js', 'MIT · © 2010–2024 three.js authors', 'The 3D head view.', 'https://threejs.org'],
  ['Lee Perry-Smith head scan', 'CC BY 3.0 · Lee Perry-Smith, Infinite-Realities', 'The 3D head, from the three.js examples.', 'https://threejs.org'],
  ['Geist', 'SIL Open Font License 1.1 · Vercel', 'The typeface.', 'https://vercel.com/font'],
  ['facecap.glb (Face Cap)', 'licence not stated · Bannaflak', 'The Mirror face (Face › Mirror), from the three.js examples, as PiEEG\u2019s Face Trainer uses it. Internal use until its licence is confirmed.', 'https://www.bannaflak.com/face-cap/'],
];

export function mountAbout({ version }) {
  const btn = document.createElement('button'); btn.id = 'hdrAbout'; btn.className = 'tour-start'; btn.textContent = 'About';
  const tour = document.getElementById('hdrTour'), status = document.querySelector('header .status');
  (tour ? tour.after.bind(tour) : status.before.bind(status))(btn);
  const brand = document.querySelector('header .brand'); brand.title = 'About EEG Alma Center'; brand.style.cursor = 'pointer';

  const el = document.createElement('div'); el.className = 'mmap-overlay about-overlay hidden';
  const link = (url, text) => `<a href="${url}" data-ext="${url}">${text || url.replace(/^https:\/\/|^mailto:/, '')}</a>`;
  el.innerHTML = `
    <div class="mmap-panel about-panel" role="dialog" aria-label="About EEG Alma Center">
      <h2><span>About<span class="count">EEG Alma Center ${version}</span></span><button class="seg" id="aboutClose">Close <kbd>Esc</kbd></button></h2>
      <div class="about-body">
        <div class="about-hero">
          <div class="about-name"><img class="about-mark" src="assets/icon.svg" alt="">EEG Alma Center</div>
          <div class="about-by">by <b>Alma Digital Studio</b> · version ${version}</div>
          <p>A companion app for the PiEEG XR mask: it receives the signal over Bluetooth, checks the contact, calibrates
          to each person, shows it, records sessions and sends any signal out over OSC and WebSocket to TouchDesigner,
          Unreal, Unity, Max or a browser. Made for immersive and interactive art.</p>
          <div class="rows">
            ${CONTACT.web ? `<div class="row"><div class="k">Web</div><div class="v">${link(CONTACT.web)}</div></div>` : ''}
            ${CONTACT.email ? `<div class="row"><div class="k">Contact</div><div class="v">${link('mailto:' + CONTACT.email, CONTACT.email)}</div></div>` : ''}
            <div class="row"><div class="k">PiEEG XR</div><div class="v">${link('https://docs.pieeg.com/hardware/devices/PiEEG_XR/', 'docs.pieeg.com')}</div></div>
          </div>
        </div>

        <h3>Not a medical device</h3>
        <p>This app and the PiEEG XR are for research, art and play. They do not diagnose, treat or monitor any condition,
        and their numbers (indices, heart rate, tension) are not health measures. Following PiEEG's safety notes: power the
        box only from a battery (a power bank, the headset's battery or a laptop running on battery), never from a wall
        charger or a computer plugged into the mains, and not from a headset while it charges. Do not use it on someone
        with a pacemaker or other implant without their physician's approval. Stop if the skin gets irritated.</p>

        <h3>Your data</h3>
        <p>Everything stays on this computer. Recordings go to Documents › EEG Alma Center › sessions; the settings to the
        app's folder. Nothing is sent online. Signals leave the app only to the destinations you set in Routing. A recording
        holds the participant's name and notes as typed: ask people before recording them, and delete their files when
        asked.</p>

        <h3>Licence</h3>
        <p>EEG Alma Center is free software under the MIT licence, © 2026 Alma Digital Studio.
        <button class="seg" id="aboutShowLicence">Show the licence</button></p>
        <pre class="about-licence hidden" id="aboutLicence">${MIT_TEXT}</pre>

        <h3>Inside it</h3>
        <div class="rows about-third">
          ${THIRD_PARTY.map(([name, lic, what, url]) => `<div class="row"><div class="k"><b>${name}</b><span class="dim">${what}</span></div><div class="v">${lic}<br>${link(url)}</div></div>`).join('')}
        </div>
        <p class="dim">PiEEG and PiEEG XR are made by PiEEG. ANT+ is a trademark of Garmin Canada Inc. Other names belong to
        their owners. Their mention does not mean they endorse this app.</p>
      </div>
    </div>`;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  const open = () => el.classList.remove('hidden');
  const close = () => el.classList.add('hidden');
  btn.addEventListener('click', open); brand.addEventListener('click', open);
  $('aboutClose').addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) return close();
    const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); window.alma.openExternal?.(a.dataset.ext); }
  });
  $('aboutShowLicence').addEventListener('click', () => { const pre = $('aboutLicence'); pre.classList.toggle('hidden'); $('aboutShowLicence').textContent = pre.classList.contains('hidden') ? 'Show the licence' : 'Hide the licence'; });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });
  return { open, close };
}
