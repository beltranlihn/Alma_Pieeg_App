# EEG Alma Center · UX / UI: where it stands and what makes it excellent

2026-11-14. An honest review of the 0.2 screens against the VEATION design system and against the tools
Beltrán's team already uses all day (Ableton, TouchDesigner, Unreal, Muse Integration). Each point says what is
wrong, why it matters for an operator with people waiting, and what to do. Items marked **done** are already in
0.3; the rest is the queue.

## 1. Who uses it and when

Three moments, three mental states:

| Moment | Who | What they need in 2 seconds |
|---|---|---|
| **Setting up** a person (Home) | The operator, with a visitor in front of them | Is it on? Is it touching? Can I start? One glance, no reading. |
| **Watching** a session (Live) | The artist or researcher | What is moving, how clean is it, mark this moment. |
| **Wiring** the piece (Routing) | The developer, once | Which number goes where, is it arriving. Then never again. |

The app must switch between the dense, pro mode (Live, Routing) and the calm, glanceable mode (Home) without
changing its look. VEATION does this with one trick: **the same grey language, less of it**.

## 2. What was wrong in 0.2 (and what changed)

| Problem | Why it hurts | Fix |
|---|---|---|
| Section titles were tiny uppercase labels | Nothing separated the blocks; the panel read as one long list | **done** · section bars (`s2` stripe, 12 px 600) like VEATION's row headers |
| Too many sentences in the panels | The operator stops reading after the first session | **done** · one line per hint, most hints removed; copy is a label, not a paragraph |
| The 3D head showed shoulders, was lit flat, had number sprites | It looked like a demo asset, not a product; the numbers fought the typography | **done** · cut at the neck with a capped plane, three-point studio light, flat metal pads with a thin status ring, no numbers (the list on the right has them) |
| Head heat spread over the whole face | It read as "the head is green", not "this electrode is good" | **done** · narrower glow (σ 0.10), lower blend, status only on the ring |
| Routing had named presets (TouchDesigner, BioHub, VRChat) | OSC is generic; the names implied the app knows those tools | **done** · generic destinations (name, host, port, rate) and mappings; no presets |
| Heart rate lived in Python windows next to the app | Three tools open to run one piece | **done** · ANT+ straps through the USB stick inside the app (slots 1–8) and Bluetooth straps |

## 3. The rules we follow (from VEATION, applied to a live-data tool)

1. **Three surfaces, not six.** `s0` wells (canvas, inputs), `s1` panels, `s2` elevated (headers, buttons). Nothing else.
2. **Text is the UI.** Geist 12 px for everything, 600 only for names and values that matter. Numbers tabular. No icons.
3. **Lines, not boxes.** 1 px `line-soft` between rows; no cards, no rounded containers, no shadows.
4. **Amber is a point, never a surface.** It marks the mark (recording events) and the "fair" state. Green = good, red = bad, grey = absent.
5. **Status in words a visitor could read**: "Reference in contact", "All good", "Reseat the mask where it is grey".
6. **One idea per block.** Home: ready / contact / heart / stream. Live: channels / view settings / filters / appearance / recording. Routing: destinations / mappings.
7. **Everything the operator changes persists** (`config.json`), so the app opens as it was left.

## 4. The queue (next passes)

**Home**
- Big state line above the head: *"Ready"* / *"Reseat Ch2 and Ch4"* / *"Not connected"*, 20 px, the only large text on the page.
- Hover an electrode on the head → the row in Contact highlights, and vice versa.
- A "Calibrate 30 s" button next to Connect, with the progress drawn inside the button (Muse Integration pattern). The calibration is the F2 work (rest/active, per person).
- Battery and signal strength of each ANT+ strap when the stick reports them.

**Live**
- Marks list with timestamps under Recording, click to jump in replay.
- Replay of a saved session (scrub bar) in the same views, so sessions can be reviewed without PiEEG Studio.
- Bands view: choose which lanes to show and their order; drag to reorder.
- Spectrum: hover gives the frequency and power at the cursor.
- A compact "meters" strip at the bottom of every view: the seven indices and the heart as thin bars, always visible.

**Routing**
- A "learn" column: the receiver's last value echo is not possible over UDP, so instead show *sent N messages to host:port in the last 10 s* per destination, and a red dot when the OS reports the host unreachable.
- Duplicate a mapping; drag to reorder; filter by destination.
- Import/export of the routing table as JSON (to share a piece's wiring).

**App**
- Keyboard: `1 2 3` switch pages, `space` pause the scope, `R` record, `M` mark.
- A status bar at the bottom (VEATION's `statusbar`): last event, OSC sent, session file saved.
- A 'Sessions' page: list, size, duration, open folder, delete.
- Proper app icon and installer branding (VEATION icon grey `#262626` as reference).

## 5. Things we deliberately do not do

- No gradients, glows, neon, or "brain" imagery. The head is grey; the data is the colour.
- No AI copy, no onboarding tours, no empty-state illustrations. Empty states are one sentence.
- No per-tool presets. The piece's addresses live with the piece (Soul Charger: `/muse/*` on UDP 10000), not in the tool.
