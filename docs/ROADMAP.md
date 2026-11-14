# EEG Alma Center · roadmap

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
| 1 | **Per-person calibration** | 20 s REST + 20 s ACTIVE, ranks every channel × band by Cohen's d, picks the electrodes that separate best; indices then read against this person, not a rolling window | `experiences/avatar-foundation/neuro/engine.ts`, `README.md` §2 | Calibrate button with progress in the session bar; `calibrated` flag in the summary |
| 2 | **Facial gestures** | Smile, brow up, frown, jaw, hard blink, winks, pucker. Common-average reference, 5 features per channel, one logistic detector per gesture (L2 + group-lasso), 6 reps of 2 s, leave-one-rep-out score, shows which electrodes matter | `experiences/face-trainer/*` | `face.smile` … events and 0–1 probabilities |
| 3 | **Gaze from EOG** | Horizontal = right − left, vertical = common mode; ridge regression with a 5-point calibration that keeps learning. Left / centre / right is reliable; Quest 3 has no eye tracking | `experiences/eye-track/EyeTrack.tsx` | `gaze.x`, `gaze.y`, `gaze.side` |
| 4 | **Muscle envelopes** | Per channel: detrend → rectify → 80 ms moving average; calibrated threshold with hysteresis. A continuous "tension" signal (jaw, brow) | `avatar-foundation/neuro/useArtifactEnvelopes.ts`, `engine-artifact.ts` | `tension.jaw`, `tension.brow`, per channel |
| 5 | **New indices and result methods** | Frontal alpha asymmetry (ln α right − ln α left); beta spike and recovery to baseline (how fast someone comes back to calm) | `glitching-reality/useFAA.ts`, `premeditatio-malorum/useStoicBands.ts` | `idx.faa`; result method *Recovery* |
| 6 | **More outputs** | WebSocket JSON and Lab Streaming Layer next to OSC | `pieeg_server/server.py`, `lsl.py` | Routing: destination type OSC / WebSocket / LSL |
| 7 | **16 channels** | PiEEG XR-16 and Octopus-16 over Bluetooth (dual ADS1299) | `pieeg.js` device table, `lib/ironbciBle.ts` | Device picker on Home |

Left out on purpose: P300 and SSVEP (need repeated stimuli), webhooks, the LLM agent (later, once there is data).

## Later: the app itself

From `docs/UX.md` §4: big status line on Home, electrode ↔ row hover, replay of saved sessions, a Sessions page,
marks list, keyboard shortcuts, app icon and installer, import/export of the routing table.

## Giving it back to PiEEG

PiEEG has no installable desktop app that centralises acquisition, visualisation, sessions and configurable
OSC; their tools are eight separate pieces. Once this has run real sessions for a week:

- publish under MIT (same as PiEEG-server), with credits both ways;
- propose it to Ildar and Youssef as a Windows companion app for PiEEG XR (docs link, Kickstarter use case);
- offer the pieces they lack as pull requests if they prefer: generic OSC router, sessions and results,
  ANT+ / Bluetooth heart rate.
