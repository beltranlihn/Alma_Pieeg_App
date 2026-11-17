# EEG Alma Center · quick start (PiEEG XR)

A Windows desktop app that receives the PiEEG XR over Bluetooth, checks the contact, cleans and analyses the
signal, calibrates per person, records sessions and sends any value to other software (Unreal, TouchDesigner,
Unity, Max, a browser) by OSC or WebSocket. Built by Alma Digital Studio on top of PiEEG's open-source work (MIT).

Version 0.10 · beta. What has been tried with a real PiEEG XR and what only with the built-in simulator is listed
at the end.

## 1. Install

- **EEG-Alma-Center-Setup-0.10.0.exe** installs it; **EEG-Alma-Center-0.10.0-portable.exe** runs without installing.
- Windows 10 or 11 with Bluetooth Low Energy. No drivers. Nothing else to install.
- Sessions are saved in `Documents\EEG Alma Center\sessions`.

## 2. Power and safety

- Power the box from a battery or from the headset. **Never wear it while it is powered from a computer or a charger
  on mains.** Not a medical device.

## 3. Connect

1. Power the box. Within a few metres of the PC.
2. **Home › Connect PiEEG**. The app picks the first `PiEEG_XR` / IronBCI it sees. *Stream* should read 250 /s.
3. If it says *Connected, but no data*: unplug the box for 5 s, plug it back, Connect again.
4. Bluetooth goes through air, not well through a head: if samples per second drop when the mask is on, put the
   box (or a USB Bluetooth adapter on an extension) in line of sight of the receiver.
5. **Simulator** (Home) runs everything without a device.

## 4. Electrode map

**Home › Electrodes › Edit map** says which board input (E1–E8, Ref, Bias) sits on which of the ten sites of the
mask. The default is the layout in PiEEG's documentation (Ref centre-left, Bias centre-right). A hand-built mask
may be wired differently, and everything that depends on position (labels, the 3D head, blinks, gaze, alpha
asymmetry, jaw and brow tension) follows this map.

To check a mask:
- **Multimeter** on continuity: one probe on the gold pad under each connector on the board (left to right
  E1 … E8, Bias, Ref), the other on each disc until it beeps.
- **Without tools**: bridge the reference disc and one other disc with a strip of paper soaked in salt water,
  mask off the face. The channel of that other disc drops to about 1 µV and turns green in the app.

## 5. Contact

Every channel is "its electrode minus the reference", so the app splits each one in two:

- **Own** (what that electrode adds): each channel minus the median of all channels. Good ≤ 25 µV, fair ≤ 60 µV.
- **Reference** (what every channel shares): its own row on Home. If it says *noisy*, the reference or the bias
  is not touching well. Every channel will look alike until it does. Press those two discs against the skin; a
  drop of saline helps.
- *At the converter limit* means a channel really saturates (±2.25 V in the app's units), not just an offset.
- **Live › Filters › Reference › Average** subtracts the mean of the channels with contact, for the analysis and the
  Waves view, while you fix the reference.

## 6. Use

- **Live**: bands over time, waves, spectrum, indices (PiEEG's formulas, read 0–1 against the person). Results on
  top: pick a signal and a method (change vs start, average, now, best 10 s, time above 60, recovery).
- **Calibrate** (`C`): rest, then a task (eyes closed, count backwards, jaw tense or your own cue). The electrodes ×
  bands that tell the two apart best drive `cal.score` (0 = this person's rest, 1 = the task). After PiEEG's
  Avatar Foundation.
- **Face**: facial gestures trained per person (after PiEEG Face Trainer), gaze left / centre / right from the EOG
  with nine dots (after PiEEG Eye Track), jaw and brow tension from the muscle envelope.
- **Sessions**: *Start session* (`R`), *Mark* (`M`), *End session*. Each session saves the raw samples (PiEEG's CSV
  layout), a features CSV at 10 Hz and a summary. The Sessions page shows a saved session whole and lays another
  over it.

## 7. Send to other software (Routing)

- Add a destination: **OSC · UDP** (host and port of the receiver) or **WebSocket** (the app listens; `127.0.0.1` =
  this computer, `0.0.0.0` = the network).
- Add mappings: signal → address, input range → output range, smoothing, int or float, rate.
- WebSocket clients get one JSON message per tick: `{"t": 1763390000000, "values": {"/alma/calm": 0.42, ...}}`.
- Browser pages can connect only from this computer (file://, localhost); native clients connect freely.
- **Export / Import** saves the routing table to a file to share a piece's wiring.
- TouchDesigner: an *OSC In* CHOP on the port of the destination. Unreal: an OSC server on that port.

Some signals: `idx.calm`, `idx.focus`, `rel.alpha`, `blink.pulse`, `cal.score`, `face.<gesture>`, `gaze.side`,
`tension.jaw`, `heart.bpm`, `contact.ok`, `contact.ref`, `result1`–`result3`. The full list is in the Routing page.

## 8. What has been tried with the real device

| Part | Real PiEEG XR | Simulator only |
|---|---|---|
| Bluetooth connection, 250 SPS, reconnects, no-data warning | ✓ | |
| Contact per electrode, reference check, railed | ✓ (checked against six recordings and PiEEG's dataset) | |
| Blinks (forehead − temples) | ✓ | |
| Electrode map editor | ✓ (our prototype is wired differently from the drawing) | |
| Sessions, files, Sessions page, routing OSC / WebSocket | ✓ | |
| Calibration, gestures, gaze, tension, indices on a real face | | ✓ to be measured |

## 9. Credits and license

MIT. The analyses port pieces of PiEEG's open-source dashboard (PiEEG-server, MIT): Avatar Foundation, Face Trainer,
Eye Track, artifact envelopes, Glitching Reality (alpha asymmetry), Premeditatio Malorum (beta recovery), pieeg.js
filters and indices. 3D head: Lee Perry-Smith scan (Infinite-Realities, CC-BY) from the three.js examples.
