// Calibration UI: the Calibrate button in the session bar (progress drawn inside it), the cue line that
// replaces the participant fields while it runs, a tone at every phase change (for eyes closed), and the
// Calibration panel in Live (task, length, the ranked electrodes, reset).
import { CAL_TASKS, CAL_LENGTHS, TASK_BY_ID, REST_CUE, PHASE_LABEL } from './calibrate.js';
import { BANDS } from './fft.js';
import { INDICES } from './indices.js';
import { XR_FACE } from './scope.js';
import { BAND_COLOR } from './colors.js';
import { tone } from './tones.js';

const BAND_SYMBOL = Object.fromEntries(BANDS.map((b) => [b.id, b.label.split(' ')[0]]));
const INDEX_LABEL = Object.fromEntries(INDICES.map((i) => [i.id, i.label]));
const signed = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
export const featureName = (f) => `${XR_FACE[f.channel].id} ${BAND_SYMBOL[f.band]}`;

export function mountCalibration({ engine, ui, saveConfig, panel }) {
  const $ = (id) => document.getElementById(id);
  const cal = engine.calib;
  Object.assign(cal.settings, ui.calib || {});

  // ── panel ──
  panel.innerHTML = `
    <h2><span>Calibration<span class="count" id="calState"></span></span><button class="seg danger" id="calReset">Reset</button></h2>
    <div class="rows">
      <div class="row"><div class="k">Active task</div><select id="calTask" style="width:150px">${CAL_TASKS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</select></div>
      <div class="row"><div class="k">Each phase</div><div class="seg-group" id="calLen">${CAL_LENGTHS.map((s) => `<button class="seg" data-v="${s}">${s}${s === CAL_LENGTHS[CAL_LENGTHS.length - 1] ? ' s' : ''}</button>`).join('')}</div></div>
    </div>
    <div class="rows contact" id="calRank"></div>
    <div class="hint" id="calHint"></div>`;
  const task = $('calTask'), len = $('calLen');
  task.value = cal.settings.task;
  task.addEventListener('change', () => { cal.settings.task = task.value; persist(); });
  function paintLen() { len.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === cal.settings.seconds)); }
  len.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { cal.settings.seconds = +b.dataset.v; paintLen(); persist(); }));
  paintLen();
  $('calReset').addEventListener('click', () => engine.resetCalibration());
  function persist() { ui.calib = { seconds: cal.settings.seconds, task: cal.settings.task }; saveConfig(); }

  function ago(ms) { const s = (Date.now() - ms) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; }
  function renderPanel() {
    const r = cal.result;
    paintLen(); task.value = cal.settings.task;
    $('calReset').style.visibility = r ? '' : 'hidden';
    $('calState').textContent = cal.running ? 'running' : r ? `${TASK_BY_ID[r.task].label} · ${r.seconds} s · ${ago(r.at)}${r.participant ? ` · ${r.participant}` : ''}` : 'not calibrated';
    const rank = $('calRank');
    if (!r) { rank.innerHTML = ''; $('calHint').textContent = 'Rest, then the task. The electrodes that tell them apart best drive Calibrated (cal.score), and the indices read against this person.'; return; }
    rank.innerHTML = '';
    r.ranking.slice(0, 5).forEach((f, k) => {
      const row = document.createElement('div'); row.className = 'row' + (f.trained ? ' clickable' : '');
      row.innerHTML = `<input type="checkbox" ${cal.selected.includes(k) ? 'checked' : ''} ${f.trained ? '' : 'disabled'}><i class="swatch" style="background:${BAND_COLOR[f.band]}"></i><div class="k"><b>${featureName(f)}</b> · ${XR_FACE[f.channel].place}</div><div class="v${f.trained ? '' : ' dim'}">${signed(f.d)} · ${f.quality}</div>`;
      const box = row.querySelector('input');
      const toggle = () => { const sel = new Set(cal.selected); sel.has(k) ? sel.delete(k) : sel.add(k); engine.selectCalibration([...sel].sort((a, b) => a - b)); };
      if (f.trained) { row.addEventListener('click', (e) => { if (e.target !== box) toggle(); }); box.addEventListener('change', toggle); }
      rank.appendChild(row);
    });
    if (!r.ranking.length) rank.innerHTML = '<div class="row"><div class="k">No usable channel: check the contact and calibrate again.</div></div>';
    const moved = Object.entries(r.indices).filter(([, c]) => Math.abs(c.d) >= 0.8).sort((a, b) => Math.abs(b[1].d) - Math.abs(a[1].d));
    const parts = [moved.length ? `Moved with the task: ${moved.slice(0, 3).map(([id, c]) => `${INDEX_LABEL[id]} ${signed(c.d)}`).join(' · ')}.` : 'No index moved clearly with the task.'];
    if (r.excluded.length) parts.push(`Left out for contact: ${r.excluded.map((ch) => XR_FACE[ch].id).join(', ')}.`);
    if (!cal.selected.length) parts.push('Nothing drives cal.score: tick an electrode.');
    $('calHint').textContent = parts.join(' ');
  }

  // ── session bar: button + cue line ──
  const btn = $('btnCal'), cue = $('calCue');
  let doneTimer = null;
  function setCue(phaseText, text, clock) { cue.querySelector('b').textContent = phaseText; cue.querySelector('span').textContent = text; cue.querySelector('.sb-clock').textContent = clock; }
  function refreshButton() {
    const streaming = engine.state === 'streaming';
    btn.disabled = !streaming && !cal.running;
    btn.classList.toggle('running', cal.running);
    btn.innerHTML = cal.running ? 'Cancel <kbd>C</kbd>' : `${cal.result ? 'Recalibrate' : 'Calibrate'} <kbd>C</kbd>`;
    btn.title = cal.running ? 'Stop the calibration' : `Rest ${cal.settings.seconds} s, then ${TASK_BY_ID[cal.settings.task].label.toLowerCase()} ${cal.settings.seconds} s`;
  }
  function toggle() {
    if (cal.running) { engine.cancelCalibration(); return; }
    if (engine.state !== 'streaming') return;
    clearTimeout(doneTimer);
    if (engine.startCalibration({ seconds: cal.settings.seconds, task: cal.settings.task })) tone(440, 90);
  }
  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) toggle();
  });

  function frame() {
    if (cal.running) {
      const now = performance.now(), ph = cal.phase;
      const text = ph === 'rest' ? REST_CUE : ph === 'active' ? TASK_BY_ID[cal._run.task].cue : ph === 'prep1' ? `Rest comes first. ${REST_CUE}` : `Next: ${TASK_BY_ID[cal._run.task].label.toLowerCase()}.`;
      setCue(PHASE_LABEL[ph], text, `${cal.remaining(now)} s`);
      btn.style.setProperty('--p', `${(cal.totalProgress(now) * 100).toFixed(1)}%`);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  engine.addEventListener('calib', (e) => {
    const ph = e.detail && e.detail.phase;
    if (ph === 'rest') tone(523);
    else if (ph === 'active') { tone(659); tone(659, 140, 0.22); }
    else if (ph === 'done') { tone(784, 180); tone(1047, 260, 0.2); }
    document.body.classList.toggle('calibrating', cal.running || ph === 'done');
    if (ph === 'done') {
      const r = cal.result, best = r.ranking[cal.selected[0]];
      setCue('Calibrated', best ? `${featureName(best)} · ${XR_FACE[best.channel].place} · ${best.quality}` : 'no clear contrast · try a stronger task or check the contact', '');
      clearTimeout(doneTimer); doneTimer = setTimeout(() => document.body.classList.remove('calibrating'), 4000);
    }
    refreshButton(); renderPanel();
  });
  for (const ev of ['state', 'disconnected']) engine.addEventListener(ev, refreshButton);
  setInterval(() => { if (cal.result && !cal.running) $('calState').textContent = `${TASK_BY_ID[cal.result.task].label} · ${cal.result.seconds} s · ${ago(cal.result.at)}${cal.result.participant ? ` · ${cal.result.participant}` : ''}`; }, 30000);
  refreshButton(); renderPanel();
  return { toggle };
}
