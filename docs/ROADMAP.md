# Pieeg App · roadmap

2026-11-14. What comes next, in order. Most items port an open-source (MIT) piece of PiEEG's own software
(`PiEEG-server/dashboard/src`) into our engine, so the data is computed once and can be shown, recorded and
sent by OSC like everything else. Each item is done when it works with the real PiEEG XR, not only the simulator.

## Now: prove it with the hardware

- [ ] **First real session with PiEEG XR.** Contact checklist, bands, a 5-minute session with the files saved.
- [x] ANT+ heart-rate strap through the USB dongle (strap 25631 heard at 100–103 bpm, 2026-11-14).
- [ ] Heart strap inside the app: Start ANT+ stick → slot 1 → `heart.bpm` in Bands and by OSC.

## Next: what PiEEG has and we don't yet

| # | Item | What it gives | Source in PiEEG (MIT) | Output |
|---|---|---|---|---|
| 1 | ✅ sim · **Per-person calibration** | 20 s REST + 20 s ACTIVE, ranks every channel × band by Cohen's d, picks the electrodes that separate best; indices then read against this person, not a rolling window | `experiences/avatar-foundation/neuro/engine.ts`, `README.md` §2 | Calibrate button with progress in the session bar; `calibrated` flag in the summary |
| 2 | ✅ sim · **Facial gestures** | Smile, brow up, frown, jaw, hard blink, winks, pucker. Common-average reference, 5 features per channel, one logistic detector per gesture (L2 + group-lasso), 6 reps of 2 s, leave-one-rep-out score, shows which electrodes matter | `experiences/face-trainer/*` | `face.smile` … events and 0–1 probabilities |
| 3 | ✅ sim · **Gaze from EOG** | Horizontal = right − left, vertical = common mode; ridge regression with a 5-point calibration that keeps learning. Left / centre / right is reliable; Quest 3 has no eye tracking | `experiences/eye-track/EyeTrack.tsx` | `gaze.x`, `gaze.y`, `gaze.side` |
| 4 | ✅ sim · **Muscle envelopes** | Per channel: detrend → rectify → 80 ms moving average; calibrated threshold with hysteresis. A continuous "tension" signal (jaw, brow) | `avatar-foundation/neuro/useArtifactEnvelopes.ts`, `engine-artifact.ts` | `tension.jaw`, `tension.brow`, per channel |
| 5 | ✅ sim · **New indices and result methods** | Frontal alpha asymmetry (ln α right − ln α left); beta spike and recovery to baseline (how fast someone comes back to calm) | `glitching-reality/useFAA.ts`, `premeditatio-malorum/useStoicBands.ts` | `idx.faa`; result method *Recovery* |
| 6 | ✅ WebSocket · **More outputs** | WebSocket JSON and Lab Streaming Layer next to OSC | `pieeg_server/server.py`, `lsl.py` | Routing: destination type OSC / WebSocket / LSL |
| 7 | **16 channels** | PiEEG XR-16 and Octopus-16 over Bluetooth (dual ADS1299) | `pieeg.js` device table, `lib/ironbciBle.ts` | Device picker on Home |

**1 is built (0.7)** and tested with the simulator (eyes closed → alpha ranks first, `cal.score` 0 at rest and 1 with the
eyes closed). Still to prove with the real mask: which electrodes and bands separate for eyes closed, count backwards and
jaw tense, and whether 20 s is enough. Differences from PiEEG: no gain (1.0, so the score reads 0–1 between rest and
active), channels with bad contact are left out, and the indices are normalised against the calibration.

**2–6 are built (0.8)** and tested with the simulator only; its muscle and eye patterns are made up, so every number
below is still to be measured on a real face:

- *Gestures* (Face › Gestures): which of the nine the mask actually hears. Expect clench, jaw, brows up and blink hard to
  train; smile, frown and the winks depend on the placement; pucker is the long shot. Our features read a 1 Hz–Nyquist copy
  of the signal (smiles and clenches live above 40 Hz), and the readiness leaves one *cycle* out instead of one recording.
  With common-average reference, a strong gesture on the temples also changes the forehead channels, so the electrode cells
  of a gesture are rarely clean; that is the model being honest, not a fault.
- *Gaze* (Face › Gaze): the channel roles (h = Ch7–8 − Ch1–2, v = Ch3–6 − temples) assume the XR Face layout; check the
  sign and size of h with a first look left / right. The 9 dots return to the centre between targets so electrode drift
  cancels; PiEEG's degree-2 fit on 5 points was replaced by a 2×2 ridge. Quest 3 has no eye tracking: this is all it has.
- *Tension* (Face › Tension): the floor/ceiling rule (ceiling ≥ 3 × floor) is a guess; the measured range overrides it.
- *Alpha asymmetry* uses Ch5–6 vs Ch3–4; *Beta surge* is β against its last ~20 s; *Recovery* (result method) is the median
  time back to within 20 % of the baseline after each rise.
- *WebSocket*: tested end to end (a client receives JSON at the destination's rate). **LSL is not done**: it needs the native
  liblsl library (and a Node binding such as koffi); left for when someone asks for it.

Left out on purpose: P300 and SSVEP (need repeated stimuli), webhooks, the LLM agent (later, once there is data).

## First real tests (2026-11-17)

Bluetooth to Windows works at 250 SPS; the head between the box and the PC drops packets (5–25 %) and turning
away cuts the link; after a cut the board can stay connected and silent until power-cycled (also with bleak).
Contact: with the reference disc badly seated every channel carried the same ~50 µV (r 0.99); seated, r ≈ 0.82 and
the per-electrode noise 6–9 µV, close to PiEEG's own dataset. Our prototype mask (Quest 3S, used on a Quest 3) is
wired differently from the drawing: Ref on the right forehead, Bias on the lower right temple. 0.10 answers all of
this in the app (map editor, reference check, honest railed, blinks, average reference, reconnects).
PiEEG (meeting 11-17): the Bluetooth losses are the PC/adapter side; the signal improves a lot with a board made for
the Quest 3; Ref/Bias position matters little and can be reordered to the docs; they support GITEX.

## Next for interactive work (research 2026-11-17)

The plan, in phases with effort and order, and what PiEEG's documentation adds (their WebSocket on 1616 for their
Unity plugin, the VRChat parameters, LSL naming): **`docs/PLAN-FEATURES.md`**.

From PiEEG's dashboard and other EEG software (OpenBCI GUI, Mind Monitor, Emotiv, Neurosity), what an artist or an
installation would use first: **markers in** (keys and OSC/UDP from Unreal or TouchDesigner, stamped in the files);
**region bundles** (frontal, left/right, temples as ready-made 0–1 outputs); **rules → events** (above X for N s,
cooldown, OSC/HTTP for lights and cues); **ready-made receivers** (TouchDesigner .tox, Max for Live device, Unreal
Blueprint); **per-visitor quick baseline**, **idle state between visitors** and **safe values when the signal drops**
for unattended installations; **LSL out**; **MIDI out** (virtual port); **replay a saved session as a live source** to
rehearse a patch without the mask; then a gesture "joystick" (x/y from jaw, brow, gaze), a remote viewer, cue
sheets, P300 selection and trained mental commands (experimental on frontal dry electrodes).

## Later: the app itself

From `docs/UX.md` §4: big status line on Home, electrode ↔ row hover, scrubbing a saved raw file through the views,
marks list, keyboard shortcuts, app icon and installer. Done in 0.9: a Sessions page (whole-session lines, marks, results,
comparison) and import/export of the routing table. The packaged build now includes `osc-encode.js`, `ant.js` and
`ws-server.js` (0.7 and earlier would not have started once installed).

## Giving it back to PiEEG

PiEEG has no installable desktop app that centralises acquisition, visualisation, sessions and configurable
OSC; their tools are eight separate pieces. Once this has run real sessions for a week:

- publish under MIT (same as PiEEG-server), with credits both ways;
- propose it to Ildar and Youssef as a Windows companion app for PiEEG XR (docs link, Kickstarter use case);
- offer the pieces they lack as pull requests if they prefer: generic OSC router, sessions and results,
  ANT+ / Bluetooth heart rate.
- ask Youssef about the `invert` flag in Avatar Foundation: `linkFromRanked` sets `invert = d < 0`, but `evaluateLink`
  already maps rest → 0 and active → 1 for either sign (it divides by `active − rest`), so inverting again seems to
  flip negative-d links (active → 0). We do not invert.
