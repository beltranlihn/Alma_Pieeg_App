// The electrode map editor (Home › Electrodes › Edit map): a drawing of the mask with its ten sites and, for each
// input of the board (E1…E8, Ref, Bias), the site it is wired to. Start from PiEEG's documentation or from what
// is saved, change a site, see it on the drawing, Apply. Problems (two inputs on one site) are said in words and
// block Apply. The way to find the real wiring: a multimeter on continuity, board pin ↔ disc.
import { SITES, INPUTS, PRESETS, PRESET_BY_ID, montageJSON, setMontage, validateMontage, montageWarnings, inputAt } from './montage.js';

const INPUT_COLOR = { Ref: '#e5b567', Bias: '#7fb2e8' };

export function mountMontageEditor(host) {
  const el = document.createElement('div');
  el.className = 'mmap-overlay hidden';
  el.innerHTML = `
    <div class="mmap-panel" role="dialog" aria-label="Electrode map">
      <h2><span>Electrode map<span class="count" id="mmapName"></span></span><button class="seg" id="mmapClose">Close <kbd>Esc</kbd></button></h2>
      <div class="mmap-body">
        <div class="mmap-draw">
          <svg id="mmapSvg" viewBox="170 120 1130 380" preserveAspectRatio="xMidYMid meet">
            <path class="mmap-outline" d="M 210 300 Q 205 150 450 148 Q 640 146 733 212 Q 826 146 1016 148 Q 1262 150 1257 300 Q 1252 455 1120 472 L 860 472 Q 733 515 606 472 L 345 472 Q 213 455 210 300 Z"/>
            <line class="mmap-mid" x1="733" y1="130" x2="733" y2="495"/>
            <g id="mmapSites"></g>
          </svg>
          <div class="hint">Seen as in PiEEG's drawing (looking at the electrodes). Click a site to pick it for the selected input.</div>
        </div>
        <div class="mmap-side">
          <div class="rows">
            <div class="row"><div class="k">Start from</div><select id="mmapPreset" style="width:210px"><option value="saved">What is applied now</option>${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
          </div>
          <div class="rows contact" id="mmapRows"></div>
          <div class="hint" id="mmapMsg"></div>
          <div class="mmap-actions"><button class="primary action" id="mmapApply">Apply</button></div>
          <div class="hint">To find the wiring: multimeter on continuity, one probe on the gold pad under each connector (left to right: E1 … E8, Bias, Ref), the other on each disc until it beeps.</div>
        </div>
      </div>
    </div>`;
  host.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  let draft = montageJSON(), selected = 0;

  const rowsEl = $('mmapRows');
  const siteOptions = SITES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  const inputRows = INPUTS.map((name, k) => {
    const row = document.createElement('div'); row.className = 'row clickable';
    row.innerHTML = `<i class="swatch" style="background:${INPUT_COLOR[name] || 'var(--ink-2)'}"></i><div class="k"><b>${name}</b>${name === 'Ref' ? ' · reference' : name === 'Bias' ? ' · ground' : ''}</div><select style="width:190px">${siteOptions}</select>`;
    const sel = row.querySelector('select');
    sel.addEventListener('change', () => { setInput(k, sel.value); });
    row.addEventListener('click', (e) => { if (e.target !== sel) { selected = k; render(); } });
    rowsEl.appendChild(row); return row;
  });

  function getInput(k) { return k < 8 ? draft.channels[k] : k === 8 ? draft.ref : draft.bias; }
  function setInput(k, site) {
    // keep the map whole: if another input sat on that site, it takes this input's old site (a swap)
    const old = getInput(k), other = INPUTS.findIndex((_, j) => j !== k && getInput(j) === site);
    const put = (j, s) => { if (j < 8) draft.channels[j] = s; else if (j === 8) draft.ref = s; else draft.bias = s; };
    put(k, site); if (other >= 0) put(other, old);
    draft.preset = 'custom'; draft.name = 'Custom'; selected = k; render();
  }

  function render() {
    $('mmapName').textContent = draft.name;
    inputRows.forEach((row, k) => { row.querySelector('select').value = getInput(k); row.classList.toggle('sel', k === selected); });
    const g = $('mmapSites'); g.innerHTML = '';
    for (const s of SITES) {
      const name = inputAt(s.id, draft), k = INPUTS.indexOf(name), sel = k === selected;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'g'); c.setAttribute('class', 'mmap-site' + (sel ? ' sel' : ''));
      c.innerHTML = `<circle cx="${s.doc.x}" cy="${s.doc.y}" r="34" style="${INPUT_COLOR[name] ? `stroke:${INPUT_COLOR[name]}` : ''}"/><text x="${s.doc.x}" y="${s.doc.y + 7}" style="${INPUT_COLOR[name] ? `fill:${INPUT_COLOR[name]}` : ''}">${name || '·'}</text>`;
      c.addEventListener('click', () => setInput(selected, s.id));
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = s.label; c.appendChild(t);
      g.appendChild(c);
    }
    const errs = validateMontage(draft), same = JSON.stringify(draft) === JSON.stringify(montageJSON());
    const warn = montageWarnings(draft).join(' ');
    $('mmapMsg').textContent = errs.length ? errs.join(' ') : `${same ? 'This is the map in use.' : 'Not applied yet. Applying it clears the gaze, the tension range and the calibration measured on the old map.'}${warn ? ' ' + warn : ''}`;
    $('mmapApply').disabled = !!errs.length || same;
  }

  $('mmapPreset').addEventListener('change', (e) => {
    const v = e.target.value;
    draft = v === 'saved' ? montageJSON() : { ...PRESET_BY_ID[v], preset: v, channels: [...PRESET_BY_ID[v].channels] };
    render();
  });
  $('mmapApply').addEventListener('click', () => { const errs = setMontage(draft); if (errs.length) { $('mmapMsg').textContent = errs.join(' '); return; } render(); });
  const close = () => el.classList.add('hidden');
  $('mmapClose').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.classList.contains('hidden')) close(); });

  return { open: () => { draft = montageJSON(); selected = 0; $('mmapPreset').value = 'saved'; render(); el.classList.remove('hidden'); }, close };
}

