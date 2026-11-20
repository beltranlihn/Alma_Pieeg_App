# Pieeg App

Repository: [github.com/beltranlihn/Alma_Pieeg_App](https://github.com/beltranlihn/Alma_Pieeg_App). Called *EEG Alma Center* until
0.14: on its first start the new version moves the old settings and the `Documents\EEG Alma Center` recordings to the new name.

Desktop app (Windows first) that **receives, cleans, calibrates, visualizes and routes** biosignals. Built around the PiEEG XR
face mask for Meta Quest; other sources (Muse, Polar heart-rate bands) come later. Made by Alma Digital Studio for the
*Soul Charger* VR experience, but meant to send anything to anything: OSC, WebSocket, files.

Status: **0.13**: **Face › Mirror**, a face (Face Cap's facecap.glb, the one PiEEG's Face Trainer uses; licence not
stated, internal use) that blinks, winks, raises the brows, opens the jaw, smiles and looks where the mask says, live;
the same values go out as **ARKit blendshapes** (`arkit.*`) to drive any avatar rig.
**0.12.1**: the ten sites placed as on the real PiEEG XR pad (five per side, none on the nose; the "centre" sites are the inner brow discs) and the **Alma prototype** electrode map, measured with a multimeter (Ref on the right outer brow disc, Bias on the lower right temple).
**0.12**: everything for shows and installations: **markers and commands in** (OSC / UDP / WebSocket),
**rules → events** (OSC, WebSocket, MIDI or webhook, with hold and cooldown), a **cue sheet**, **visitor mode**
(presence, per-visitor baseline, safe outputs, a session per visitor, endless reconnect), **region outputs**, a
**face joystick**, **MIDI out**, a **remote viewer** served by every WebSocket destination, **replay a session as
the live source**, **BDF export**, **PiEEG compatibility** (their WebSocket on 1616 for their Unity plugin; VRChat
parameters; PiEEG-style values) and lost-sample reporting. Face gestures checked line by line against PiEEG's Face
Trainer v2; "ready" now needs two recordings and the other gestures count as negatives. Receivers in `receivers/`.
**0.11**: a **guided tour** (Tour in the top bar: 21 steps over every page, the panel outlined and explained;
offered once on the first run), an **About** box (Alma Digital Studio, contact, not a medical device, where the data
goes, MIT licence and third-party licences; also `LICENSE` and `THIRD-PARTY-NOTICES.md`), inputs **not connected**
in the electrode map (a mask with fewer discs: out of the head, the averages and the counts), the 3D head pads placed
from the face's real midline, and **heart rate from the electrodes** (experimental; Home › Heart from: Auto / Strap /
Electrodes; logged next to the strap's to validate it). Feature plan, with what PiEEG's docs add: `docs/PLAN-FEATURES.md`.
**0.10** (after the first tests with the real PiEEG XR): an **editable electrode map** (Home › Electrodes; a mask can be wired differently from PiEEG's drawing, ours is), **contact per electrode** plus a **reference check** (a noisy reference no longer reads as eight bad electrodes), *railed* only at the converter limit, blinks from forehead − temples, an **average reference** option, and Bluetooth retries / reconnect / no-data warning. English quick start for other users: `docs/QUICKSTART.md`. **0.9**: a **Sessions** page (every saved session as lines over time with its marks, results and per-signal numbers, and a second session laid over it to compare); the routing table can be exported, imported and its mappings copied; fixes from a review (a measured tension range survives reconnecting, the simulator never overwrites a real face model, WebSocket refuses web pages from other sites and retries a taken port, steady send rate from the first tick). **0.8**: a **Face** page with what the mask reads from the face: **gestures** (record each one 2–3 times; a detector per gesture with the electrodes it uses, ported from PiEEG's Face Trainer), **gaze** left / centre / right from the EOG (9-dot calibration that reads each target against the centre around it, so electrode drift does not pass for a glance), **tension** of jaw and brow (muscle above 20 Hz, 0–1 against the person). New indices: **alpha asymmetry** and **beta surge**, and the result method **Recovery**. Routing sends by **WebSocket** too (JSON). All of it tested with the simulator only. **0.7**: per-person calibration (REST then a task, Cohen's d over every channel × band, ported from PiEEG's Avatar Foundation): `cal.score` reads 0 at the person's rest and 1 at their task, and the indices read against the calibration instead of the last minute. **0.4**: sessions with participant and notes, three files per session (raw, features at 10 Hz, summary), live results (signal × method: change vs start, mean, now, peak, time above) shown large and sent as `result1–3`. Previously **0.3**: Home (3D head cut at the neck, electrode pads coloured by contact), Live (waves, bands, spectrum, indices), Routing (generic OSC: any host, port, address, type), heart rate from ANT+ straps through the USB stick (Latido Común hardware) and from Bluetooth straps, sessions. UX notes in `docs/UX.md`. Roadmap in
`VR Unreal/docs/EEG-ALMA-CENTER-INVESTIGACION-Y-PLAN.md` (§8).

## Run

```bash
npm install
npm start              # the app
npm start -- --sim     # starts the built-in simulator at once
npm test               # DSP, recorder, calibration, face, gaze, tension and WebSocket tests (node --test)
npm run dist           # Windows installer + portable exe in dist/
```

## Use

1. Power the PiEEG box **from a battery or from the headset** (never from a mains-powered PC while someone wears it).
2. Put the mask on, press **Connect PiEEG**. The host picks the first `PiEEG_XR` / IronBCI it sees.
3. Watch **Contact**: every channel should be green within a second. Grey = no contact, red = hum or railed (reference lost).
4. On **Live**, type the participant's name, **Start session** (or `R`), drop marks with `M`, **End session**. Three files land in
   `Documents/Pieeg App/sessions/` as `name_YYYYMMDD_HHMMSS.raw.csv` (`timestamp, ch1..ch8` raw µV, `mark`; PiEEG's
   layout, so PiEEG Studio opens it), `.features.csv` (one row per 100 ms: bands, indices, blinks, heart, contact) and
   `.summary.json` (participant, notes, duration, per-signal mean / start / end / min / max, the results).
5. **Calibrate** (`C`, in the session bar) once the contact is green: 5 s to get ready, REST (eyes open, face relaxed), 5 s,
   then the **active task** chosen in Live › Calibration (eyes closed, count backwards, jaw tense or your own cue), each phase
   10 / 20 / 30 / 60 s. A tone marks every change, so it works with the eyes closed. The panel ranks the electrodes by how well
   they tell the two apart (Cohen's d: strong ≥ 1.2, usable ≥ 0.8, marginal ≥ 0.4); the ticked ones drive `cal.score`
   (0 = this person's rest, 1 = their task). Channels with bad contact during the recording are left out. While calibrated,
   `idx.*` read 0–1 between the 5th and 95th percentile of the calibration instead of the last minute; *Reset* goes back.
   The calibration is saved in the session summary (`calibrated`, `calibration`) and `cal_score` in the features CSV.
6. **Results**: pick up to three (signal × method). *Change* compares the last 30 s with the first 30 s (±%), *Average*, *Now*,
   *Best 10 s* and *Time above 60* read 0–100; *Recovery* is the median time (s) the signal takes to come back down after each
   rise (use it with Beta surge). They show large above the Live views and go out as `result1`–`result3`.
7. **Face** (the page between Live and Routing):
   - *Gestures*: press **Record** on a gesture and follow the strip on top: rest, then the gesture, 3 times the first recording,
     2 the second, 1 after that (PiEEG's 3-2-1). Readiness is the balanced accuracy on a cycle the detector had not seen
     (ready from 0.85). The 8 cells show the electrodes the detector uses (group-lasso). Live: `face.<gesture>` 0–1 and
     `face.<gesture>.on` with hysteresis (on 0.7, off 0.4). The detectors are saved in the config, not the recordings.
   - *Gaze*: **G** runs 9 dots (23 s, head still). Then `gaze.x`, `gaze.y` (−1…1) and `gaze.side` (−1 / 0 / 1). The centre
     follows slow drift while the eyes are near the middle; **0** recentres at once. Left / right is the dependable part.
   - *Tension*: `tension.jaw` (temples) and `tension.brow` (forehead), 0–1 between the relaxed floor (10th percentile of the
     last minute) and the highest level seen; *Relax, clench, brows · 15 s* measures the range instead. On above 0.6, off below 0.4.
   Gesture recordings and the gaze dots are marked in the raw file when a session runs; the summary keeps what was trained.

8. **Sessions**: the saved sessions, newest first. Open one to see it whole: the signals as lines (pick them under the chart),
   the marks in amber, the three results on top and start / end / change / mean / min / max per signal from the summary.
   *Lay over* draws another session dashed from its own start, with its mean in the last column. Nothing on this page writes.

**Routing** destinations are *OSC · UDP* (send to host:port) or *WebSocket*: the app listens on host:port (`127.0.0.1` = this
computer, `0.0.0.0` = the network) and every client gets `{"t": ms, "values": {"/address": value, …}}` at the destination's rate.
Native clients (TouchDesigner, Unity, Unreal, Python) connect freely; a browser page only from this computer (file://, localhost),
so a website cannot read the stream. *Export* / *Import* save and load the table as a file (import adds, never replaces);
*Copy* duplicates a mapping.

**Heart rate:** plug the Garmin ANT+ USB stick (WinUSB driver, as for Latido Común), press *Start ANT+ stick* on Home, put a strap on: it appears with its id; give it a slot. Slot 1 is the main heart (`heart.*` signals); every slot has `strapN.bpm` / `strapN.beat`.

**Simulator** keys: `B` blink · `J` jaw clench · `←` `→` eye movement · `E` eyes closed (alpha up, a calibration target) · `1`–`8` toggle a bad contact on that channel.
In the simulator the face protocols act themselves: it makes the gesture while the strip asks for it, follows the gaze dots
and clenches or raises the brows for the tension range. Its muscle patterns are plausible, not measured.
Self-tests (`--shot=out.png --quit-after=ms --probe=<urlencoded js>`): `--calib=10` (calibration), `--face=clench,brows_up`
(records each twice), `--gaze` (the 9 dots), `--tension` (the range), `--wstest=8799` (a temporary WebSocket destination
that is never saved), `--view=gaze` (opens that view). In simulator runs the face model is neither loaded nor saved.

## How it is built

Plain Electron (no bundler), ES modules in the renderer, `contextIsolation` + sandbox, one preload bridge (`window.alma`).
Design follows the VEATION design system (`assets/tokens.css`, Geist): grey surfaces, 1 px lines, amber only as a point.

| File | Role |
|---|---|
| `main.js` | window, Web Bluetooth device chooser, session files, screenshot self-test (`--shot=path --quit-after=ms`) |
| `src/ble.js` | PiEEG/IronBCI BLE protocol: notify `fe42`, 24 bytes per sample, 24-bit two's complement → µV |
| `src/sim.js` | 8-channel simulator with blinks, jaw, eye movements, bad contacts |
| `src/dsp.js` | Hampel (5, 3σ), Butterworth 1–40 Hz (4th order), notch 50/60 Hz, Goertzel; side chains for the face: wide band (1 Hz–Nyquist), muscle envelope (> 20 Hz), slow EOG (< 8 Hz) |
| `src/ring.js` | ring buffers (raw + filtered) and the sample clock |
| `src/quality.js` | contact status per channel from rms, mains hum and railing |
| `src/scope.js` | the oscilloscope (Canvas 2D, 60 fps) with the XR Face electrode names |
| `src/record.js` | CSV + JSON session recorder with marks |
| `src/engine.js` | the pipeline: source → DSP → rings → features (bands, indices, blink, heart) |
| `src/head.js` | 3D head (three.js) with the electrodes and the contact heat map |
| `src/indices.js`, `src/fft.js`, `src/detect.js` | PiEEG-style indices, FFT and band powers, blink detector |
| `src/signals.js`, `src/router.js`, `osc-encode.js` | the signal catalogue, the OSC router and the encoder |
| `src/heart.js` | heart rate over the standard Bluetooth Heart Rate service |
| `ant.js` | ANT+ heart-rate straps through a Garmin USB stick (main process, `ant-plus-next`); straps get slots 1–8 |
| `src/session.js` | session log at 10 Hz, result methods, features CSV and summary JSON |
| `src/calibrate.js`, `src/calview.js` | per-person calibration (PiEEG Avatar Foundation: Welford, Cohen's d, ranking) and its UI |
| `src/face.js` | gestures (PiEEG Face Trainer): CAR, 5 features × 8 channels, L2 + group-lasso logistic per gesture, 3-2-1 protocol, leave-one-cycle-out |
| `src/gaze.js` | gaze from EOG (PiEEG Eye Track): h = temples right − left, v = forehead − temples, 9 dots, 2×2 ridge, drift-following centre |
| `src/tension.js` | jaw and brow tension from the muscle envelope (PiEEG artifact envelopes), self-setting or measured range |
| `ws-server.js` | WebSocket server without dependencies (RFC 6455, text frames out, ping/close in) |
| `src/tones.js` | the cue tones shared by every protocol |
| `src/pages/*.js` | Home, Live, Face, Sessions, Routing |
| `src/app.js` | wiring, config persistence (userData/config.json) |

Electrode map (PiEEG XR): Ch1–2 left temple (lower, upper) · Ch3–4 left forehead · Ch5–6 right forehead ·
Ch7–8 right temple (upper, lower) · reference and bias at the centre of the forehead.

## Credits

3D head: Lee Perry-Smith head scan by Infinite-Realities (CC-BY), as shipped with the three.js examples. three.js (MIT) is vendored in `assets/vendor`.

Protocol and the shape of the detectors follow PiEEG's open-source work (MIT): https://github.com/pieeg-club/PiEEG-server.
Not a medical device. Research and art use only.
