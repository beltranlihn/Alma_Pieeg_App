# Pieeg App - receiver examples

Ready-to-use examples for getting EEG and face signals from Pieeg App into your own software. Pick your tool, open its folder, follow the short README.

| Folder | For | What is inside |
|---|---|---|
| `touchdesigner/` | TouchDesigner | OSC In CHOP setup, WebSocket DAT callbacks, marker sender |
| `max/` | Max 8 and Max for Live | A small patch: receive values, send a marker |
| `unity/` | Unity | WebSocket receiver, OSC marker sender (no packages) |
| `unreal/` | Unreal Engine | Blueprint steps with the built-in OSC plugin |
| `python/` | Anything else | Plain Python scripts (standard library only) |

## The contract, short version

**OSC out (UDP)**
- One message per mapping address, for example `/alma/calm 0.42`.
- One argument per message: a float, or an int for events.
- Goes to the IP and port you set in the app, for example `127.0.0.1:7000`.
- A rule that fires sends a float `1.0` to its address, for example `/alma/rule`.
- A cue sends its value to its address, for example `/alma/cue`.

**WebSocket out**
- The app is the server: connect to `ws://<computer>:<port>`. Default port is 8765.
- Every tick you get one JSON text frame:
  `{"t": 1760000000000, "values": {"/alma/calm": 0.42, "/alma/blink": 1}}`
  (`t` is milliseconds since epoch.)
- A rule adds fields: `event` (rule name), `rule_name`, `rule_id`, `trigger_type`, `value`, `threshold`, `ts`.
- A cue adds `cue` (the label).
- Open `http://<computer>:<port>/` in a browser to see the built-in live viewer.

**MIDI out**
- Goes through a virtual port such as loopMIDI on Windows.
- A mapping address `cc 7` sends 0-127. `note 60` is on while the value is in the upper half.

**Inputs the app listens to**
- UDP on `127.0.0.1:9001` by default. OSC or plain text.
  - `/alma/mark "text"` - a marker. It is stamped in the recording and goes out as the `marker.pulse` signal. Any plain-text UDP datagram also counts as a marker.
  - `/alma/session/start "participant"`
  - `/alma/session/stop`
  - `/alma/calibrate`
  - `/alma/cues/start`
  - `/alma/cues/stop`
- On any WebSocket port, a client can send `{"mark": "text"}`.

**PiEEG-compatible WebSocket (optional, port 1616)**
- One frame per sample at 250 Hz: `{"t": <unix seconds>, "n": <counter>, "channels": [8 floats in uV]}`.
- Each new client gets a welcome JSON.
- Commands: `{"cmd":"start_record"}`, `{"cmd":"stop_record"}`, `{"cmd":"set_filter","enabled":true,"lowcut":1,"highcut":40}`.

**VRChat (optional)**
- `/avatar/parameters/EEG_Delta` ... `EEG_Gamma` (0-1) to `127.0.0.1:9000`.

## Example addresses

You choose your own addresses in the app. These are used in the examples.

| Address | Type | Range | Meaning |
|---|---|---|---|
| `/alma/calm` | float | 0-1 | calm level |
| `/alma/focus` | float | 0-1 | focus level |
| `/alma/blink` | int | 0 or 1 | blink pulse |
| `/alma/clench` | float | 0-1 | jaw clench gesture probability |
| `/alma/gaze_x` | float | -1 to 1 | gaze left/right |
| `/alma/jaw` | float | 0-1 | jaw opening |
| `/alma/heart_bpm` | float | bpm | heart rate |
| `/alma/rule` | float | 1.0 | a rule fired |
| `/alma/cue` | float | value | a cue was sent |

## Send a marker from each tool

Send to `127.0.0.1:9001` (change it if you set another port in the app).

| Tool | How |
|---|---|
| TouchDesigner | OSC Out DAT `oscout1`: `op('oscout1').sendOSC('/alma/mark', ['scene 2'])` |
| Max | message box `/alma/mark "from Max"` into `udpsend 127.0.0.1 9001` |
| Unity | `AlmaMarker.Mark("scene 2")` |
| Unreal | Create OSC Client, Add String to OSC Message, Send OSC Message |
| Python | `python python/send_marker.py scene 2` |
| Any WebSocket | send `{"mark": "scene 2"}` |
| Anything with UDP | send the plain text `scene 2` as a UDP datagram |

## Tips

- Receiving on the same computer: use `127.0.0.1`. From another computer or a headset: use the PC's IP and allow the ports through the firewall.
- Only one program can listen on a UDP port at a time. Use different ports, or the WebSocket (many clients can connect).
- OSC is best for low latency. WebSocket is best when you want rule events and cues in one place.
