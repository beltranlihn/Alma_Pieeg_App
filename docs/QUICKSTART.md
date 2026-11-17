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
3. If it says *Connected, but no data*: unplug the box for 5 s, plug it back, Connect again. If it keeps
   happening, update the box's firmware (PiEEG docs › PiEEG XR › Service).
4. New to the app? **Tour** (top bar) walks through every panel; **About** has the licences and the safety notes.
5. Bluetooth goes through air, not well through a head: if samples per second drop when the mask is on, put the
   box (or a USB Bluetooth adapter on an extension) in line of sight of the receiver.
6. **Simulator** (Home) runs everything without a device.

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

The PiEEG XR pad has ten discs, five per side, none on the nose: three along each brow (inner, middle, outer) and
two down each temple. PiEEG's "centre" Ref and Bias are the two inner brow discs. Our prototype, checked with a
multimeter, is wired differently: preset **Alma prototype** (wearer's left → right: temple low E1, temple up E7,
brow outer E3, middle E4, inner E2 · brow inner E6, middle E5, outer **Ref**, temple up E8, temple low **Bias**).

If a mask has fewer discs than the board has inputs, set the inputs that beep on no disc to **not connected**: they
disappear from the 3D head, read *no disc* in Contact, and stay out of every average, of the reference check and of
the counts (6/6 instead of 8/8).

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
- **Heart rate** (Home): an ANT+ USB stick or a Bluetooth strap. *Heart from* picks the source: *Auto* (the strap
  when there is one), *Strap*, or *Electrodes*, an experimental estimate from the pulse at the temples. It says a
  number only when several channels agree on a steady rhythm; in the first real recordings it mostly did not. For
  art, never for health. To check it, record a session with a strap on too: the features file logs both.
- **Sessions**: *Start session* (`R`), *Mark* (`M`), *End session*. Each session saves the raw samples (PiEEG's CSV
  layout), a features CSV at 10 Hz and a summary. The Sessions page shows a saved session whole and lays another
  over it.

## 7. Send to other software (Routing)

- Add a destination: **OSC · UDP** (host and port of the receiver), **WebSocket** (the app listens; `127.0.0.1` =
  this computer, `0.0.0.0` = the network) or **MIDI** (a port of this computer; on Windows install loopMIDI for a
  virtual one; the address is `cc 7` or `note 60`).
- A WebSocket destination has a **viewer**: open `http://<this computer>:<port>/` in any browser (a phone on the same
  network too, with `0.0.0.0`) to watch the values live. The link is next to the destination.
- Add mappings: signal → address, input range → output range, smoothing, int or float, rate.
- WebSocket clients get one JSON message per tick: `{"t": 1763390000000, "values": {"/alma/calm": 0.42, ...}}`.
- Browser pages can connect only from this computer (file://, localhost); native clients connect freely.
- **Export / Import** saves the routing table to a file to share a piece's wiring.
- TouchDesigner: an *OSC In* CHOP on the port of the destination. Unreal: an OSC server on that port.

Some signals: `idx.calm`, `idx.focus`, `rel.alpha`, `blink.pulse`, `cal.score`, `face.<gesture>`, `gaze.side`,
`tension.jaw`, `heart.bpm`, `contact.ok`, `contact.ref`, `result1`–`result3`; regions (`region.lf.alpha`,
`region.rt.emg`…, they follow the electrode map); the face joystick (`joy.x` from the gaze, `joy.y` brows up / jaw
down, `joy.press` a hard blink); `stream.loss`; `marker.pulse`; `visitor.present`; PiEEG-style values
(`pieeg.alpha`, `pieeg.focus`). The full list is in the Routing page. Ready-made receivers for TouchDesigner, Max,
Unity, Unreal and Python are in the `receivers` folder.

## 7b. Shows and installations

- **Markers in** (Routing): other software sends OSC to this computer, port 9001: `/alma/mark "scene 2"` drops a
  marker in the recording (and sends `marker.pulse` out); `/alma/session/start "name"`, `/alma/session/stop`,
  `/alma/calibrate`, `/alma/cues/start`, `/alma/cues/stop` drive the app. Plain text over UDP is a marker too, and so
  is `{"mark": "…"}` over any of the app's WebSocket ports. Choose *The network* to accept them from a Quest.
- **Rules** (Routing): "calm above 0.7 for 5 s → send /lights/fade", with a cooldown. To an OSC address, a WebSocket
  event, a MIDI note, or an HTTP POST to a webhook (the JSON has the same fields as PiEEG's webhook events).
- **Cue sheet** (Routing): timed messages from the start of each session (or Run), each fired once and marked.
- **Visitor mode** (Home): for a piece that runs all day. The app sees the mask go on (contact for 3 s) and off (5 s
  without); each visitor starts fresh and settles for 30–60 s; meanwhile, and between visitors, every continuous output
  eases to zero, the middle of its range or its last value. Optionally a session per visitor. Bluetooth keeps
  reconnecting while the mode is on.
- **Play a session as if live** (Sessions › Play and export): the open session runs through the whole app at 0.5–2×,
  looping, with its marks coming back as markers. Rehearse a patch or show a piece without the mask.
- **BDF export** (Sessions): the 24-bit member of the EDF family, for MNE (`mne.io.read_raw_bdf`), EEGLAB, EDFbrowser
  and PiEEG Studio; the marks are annotations.
- **PiEEG compatibility** (Routing): their WebSocket on port 1616 (one frame per sample, their welcome, their
  `start_record` / `stop_record` / `set_filter`), so their Unity plugin connects to this app unchanged; and the VRChat
  avatar parameters `EEG_Delta … EEG_Gamma` to 127.0.0.1:9000.

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
