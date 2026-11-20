# Changelog

What each version added (newest first). The app was called EEG Alma Center until 0.14.

## 0.14

The app is now **Pieeg App** and the repository is `Alma_Pieeg_App`. On the first start the settings and the
`Documents\EEG Alma Center` recordings move to the new name. A README that explains everything.

## 0.13

**Face › Mirror**, a face (Face Cap's facecap.glb, the one PiEEG's Face Trainer uses; licence not stated, internal use) that blinks, winks, raises the brows, opens the jaw, smiles and looks where the mask says, live; the same values go out as **ARKit blendshapes** (`arkit.*`) to drive any avatar rig.

## 0.12.1

the ten sites placed as on the real PiEEG XR pad (five per side, none on the nose; the "centre" sites are the inner brow discs) and the **Alma prototype** electrode map, measured with a multimeter (Ref on the right outer brow disc, Bias on the lower right temple).

## 0.12

everything for shows and installations: **markers and commands in** (OSC / UDP / WebSocket), **rules → events** (OSC, WebSocket, MIDI or webhook, with hold and cooldown), a **cue sheet**, **visitor mode** (presence, per-visitor baseline, safe outputs, a session per visitor, endless reconnect), **region outputs**, a **face joystick**, **MIDI out**, a **remote viewer** served by every WebSocket destination, **replay a session as the live source**, **BDF export**, **PiEEG compatibility** (their WebSocket on 1616 for their Unity plugin; VRChat parameters; PiEEG-style values) and lost-sample reporting. Face gestures checked line by line against PiEEG's Face Trainer v2; "ready" now needs two recordings and the other gestures count as negatives. Receivers in `receivers/`.

## 0.11

a **guided tour** (Tour in the top bar: 21 steps over every page, the panel outlined and explained; offered once on the first run), an **About** box (Alma Digital Studio, contact, not a medical device, where the data goes, MIT licence and third-party licences; also `LICENSE` and `THIRD-PARTY-NOTICES.md`), inputs **not connected** in the electrode map (a mask with fewer discs: out of the head, the averages and the counts), the 3D head pads placed from the face's real midline, and **heart rate from the electrodes** (experimental; Home › Heart from: Auto / Strap / Electrodes; logged next to the strap's to validate it). Feature plan, with what PiEEG's docs add: `docs/PLAN-FEATURES.md`.

## 0.10

an **editable electrode map** (Home › Electrodes; a mask can be wired differently from PiEEG's drawing, ours is), **contact per electrode** plus a **reference check** (a noisy reference no longer reads as eight bad electrodes), *railed* only at the converter limit, blinks from forehead − temples, an **average reference** option, and Bluetooth retries / reconnect / no-data warning. English quick start for other users: `docs/QUICKSTART.md`.

## 0.9

a **Sessions** page (every saved session as lines over time with its marks, results and per-signal numbers, and a second session laid over it to compare); the routing table can be exported, imported and its mappings copied; fixes from a review (a measured tension range survives reconnecting, the simulator never overwrites a real face model, WebSocket refuses web pages from other sites and retries a taken port, steady send rate from the first tick).

## 0.8

a **Face** page with what the mask reads from the face: **gestures** (record each one 2–3 times; a detector per gesture with the electrodes it uses, ported from PiEEG's Face Trainer), **gaze** left / centre / right from the EOG (9-dot calibration that reads each target against the centre around it, so electrode drift does not pass for a glance), **tension** of jaw and brow (muscle above 20 Hz, 0–1 against the person). New indices: **alpha asymmetry** and **beta surge**, and the result method **Recovery**. Routing sends by **WebSocket** too (JSON). All of it tested with the simulator only.

## 0.7

per-person calibration (REST then a task, Cohen's d over every channel × band, ported from PiEEG's Avatar Foundation): `cal.score` reads 0 at the person's rest and 1 at their task, and the indices read against the calibration instead of the last minute.

## 0.4

sessions with participant and notes, three files per session (raw, features at 10 Hz, summary), live results (signal × method: change vs start, mean, now, peak, time above) shown large and sent as `result1–3`. Previously

## 0.3

Home (3D head cut at the neck, electrode pads coloured by contact), Live (waves, bands, spectrum, indices), Routing (generic OSC: any host, port, address, type), heart rate from ANT+ straps through the USB stick (Latido Común hardware) and from Bluetooth straps, sessions. UX notes in `docs/UX.md`. Roadmap in `VR Unreal/docs/EEG-ALMA-CENTER-INVESTIGACION-Y-PLAN.md` (§8).
