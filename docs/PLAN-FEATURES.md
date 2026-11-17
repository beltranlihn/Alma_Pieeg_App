# EEG Alma Center · feature plan (2026-11-17)

From three sources: what other EEG software gives artists (OpenBCI GUI, Mind Monitor, Emotiv, Neurosity, PiEEG's own
dashboard), PiEEG's documentation (docs.pieeg.com, read on 2026-11-17) and what the first real tests with the mask
taught us. Effort: **S** = hours, **M** = one or two days, **L** = a week or more. Each phase stands on its own: the
app is usable after any of them.

Already done and matching PiEEG: raw CSV `timestamp, ch1…ch8` in Unix seconds (we add `mark`), the Hampel spike
filter (Live › Filters › Spike rejection), Good / Fair / Poor / Railed / No-contact statuses, a per-person montage,
µV conversion (4.5 / 2²⁴ · 10⁶, theirs divides by 2²⁴ − 1: a 6·10⁻⁸ difference).

Not possible with this board: impedance or lead-off measurement (PiEEG: "doesn't measure electrode impedance
directly"; no BLE command for it), battery level, changing gain or rate (no BLE commands documented).

## Phase 0 · plug into PiEEG's ecosystem (2–3 days)

Small, and each one opens a door that already exists.

| # | What | Why | Effort |
|---|---|---|---|
| 0.1 | **PiEEG-compatible WebSocket** on port 1616: raw frames `{"t": <unix s>, "n": <counter>, "channels": [µV × 8]}` at 250 Hz, their welcome message, and the commands `set_filter`, `start_record`, `stop_record` | Their Unity plugin (`com.pieeg.unity`) and their dashboard tools connect to this app without changes: point them to `ws://<pc>:1616` | M |
| 0.2 | **VRChat preset** in Routing: `/avatar/parameters/EEG_Delta … EEG_Gamma`, 127.0.0.1:9000, every 0.25 s, 0–1 with a rolling maximum (the same as theirs) | Avatars made for PiEEG move with this app; one click | S |
| 0.3 | **Unity names** for the same five bands and `EEG_Focus_Ratio` = β / (α + θ) | Their Unity sample scenes expect them | S |
| 0.4 | **Packet gaps** in Home › Stream: lost packets per minute (expected 50 notifications/s) | PiEEG asks to check the counter for gaps before recording; it tells "Bluetooth weak" from "bad contact" | S |
| 0.5 | **Firmware hint**: when the box connects but stays silent, the status also says "if it keeps happening, update the firmware (docs: Service)" | It is PiEEG's own fix for "visible but no data" | S |
| 0.6 | **Blink check against theirs**: run their adaptive threshold (max(25 µV, median + max(5σ, 8 µV)), 300 ms refractory) on our recordings and keep the better one | Two detectors, one truth | S |

## Phase 1 · installations and performances (1–2 weeks)

What a piece needs to run in a room, unattended, talking to the rest of the show.

| # | What | Why | Effort |
|---|---|---|---|
| 1.1 | **Markers in**: a key, or OSC / UDP / WebSocket from TouchDesigner or Unreal, stamped in the files and echoed out | The scene and the signal share one timeline: "the door opened here" | M |
| 1.2 | **Region outputs**: left / right forehead and left / right temples as ready 0–1 signals (and PiEEG-style groups for LSL / OSC) | Artists route regions, not channels; follows the electrode map | S |
| 1.3 | **Rules → events**: band power, amplitude or band ratio above / below a value for N s, with a cooldown, sent as OSC / WebSocket / HTTP (PiEEG's webhook triggers, plus hold time) | Lights, cues and scene changes without coding | M |
| 1.4 | **Visitor mode**: a 30–60 s baseline per visitor, an *idle* state while nobody wears the mask (outputs ease to safe values and an `/alma/present` flag says so), reconnects by itself | A piece that runs all day at a fair | M |
| 1.5 | **Receivers**: a TouchDesigner `.tox`, an Unreal Blueprint (OSC), a Max for Live device, a Unity scene (their plugin via 0.1) | Ten minutes from install to a moving image | M each |
| 1.6 | **Heart from the electrodes, validated**: a session with a strap and the mask together; compare `heart_bpm` and `heart_eeg_bpm` | Decide whether the estimate earns a place in pieces, or stays experimental | S |

## Phase 2 · studio work (2–3 weeks)

| # | What | Why | Effort |
|---|---|---|---|
| 2.1 | **LSL out**: `PiEEG` type `EEG`, 8 × float32 at 250 Hz (their naming), plus a markers stream and a features stream | OpenViBE, NeuroPype, MNE-LSL, Python notebooks, other labs | M (native liblsl) |
| 2.2 | **Replay a session as a live source** at 0.5–2× with its marks | Rehearse a patch without the mask, show a piece without a visitor | M |
| 2.3 | **MIDI out** to a port (loopMIDI on Windows): notes from events, CC from 0–1 signals | Ableton, synths, lighting desks | M |
| 2.4 | **EDF export** of a recording | PiEEG Studio (MNE), EEGLAB and clinical viewers open it | S–M |
| 2.5 | **Remote viewer**: a page on a phone or tablet on the same network, read-only | The artist walks the room while someone wears the mask | M |

## Phase 3 · experimental

| # | What | Note | Effort |
|---|---|---|---|
| 3.1 | **Face joystick**: x / y from gaze, jaw and brows, with a dead zone | Navigation in VR without hands | M |
| 3.2 | **Cue sheets**: a timeline of cues that fire OSC, synced to markers | Performances with a score | M |
| 3.3 | **P300 selection** (PiEEG has a P300 experience) | On a forehead-only mask the evoked response is weak; test before promising | L |
| 3.4 | **Trained mental commands** | Frontal dry electrodes: mostly muscle and eyes; honest framing as "face + mind" | L |
| 3.5 | **HRV from the strap** (RMSSD is there; add a breathing guide and coherence) | Only if 1.6 shows the electrodes are not enough | M |

## Order and dependencies

1. Phase 0 first: cheap, and it makes the app useful to everyone who already uses PiEEG's tools.
2. 1.2 and 1.3 need the real electrode map of our prototype (the multimeter pass) to name the regions right.
3. 1.4 waits for the PiEEG board made for the Quest 3 (Youssef: better signal), but can be built on the simulator.
4. 2.1 (LSL) is the only one with a native dependency; it goes after the others so it does not hold them up.
5. Safety stays in every phase: battery or headset power only (PiEEG: never a wall charger or a computer on the mains),
   not a medical device.
