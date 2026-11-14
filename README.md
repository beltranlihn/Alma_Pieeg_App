# EEG Alma Center

Desktop app (Windows first) that **receives, cleans, calibrates, visualizes and routes** biosignals. Built around the PiEEG XR
face mask for Meta Quest; other sources (Muse, Polar heart-rate bands) come later. Made by Alma Digital Studio for the
*Soul Charger* VR experience, but meant to send anything to anything: OSC, WebSocket, files.

Status: **0.3**: Home (3D head cut at the neck, electrode pads coloured by contact), Live (waves, bands, spectrum, indices), Routing (generic OSC: any host, port, address, type), heart rate from ANT+ straps through the USB stick (Latido Común hardware) and from Bluetooth straps, sessions. UX notes in `docs/UX.md`. Roadmap in
`VR Unreal/docs/EEG-ALMA-CENTER-INVESTIGACION-Y-PLAN.md` (§8).

## Run

```bash
npm install
npm start              # the app
npm start -- --sim     # starts the built-in simulator at once
npm test               # DSP, decoder and recorder tests (node --test)
npm run dist           # Windows installer + portable exe in dist/
```

## Use

1. Power the PiEEG box **from a battery or from the headset** (never from a mains-powered PC while someone wears it).
2. Put the mask on, press **Connect PiEEG**. The host picks the first `PiEEG_XR` / IronBCI it sees.
3. Watch **Contact**: every channel should be green within a second. Grey = no contact, red = hum or railed (reference lost).
4. **Record** (or `R`), drop marks with `M`, **Stop & save**. Sessions land in `Documents/EEG Alma Center/sessions/` as
   `name_YYYYMMDD_HHMMSS.csv` (`timestamp, ch1..ch8` raw µV, `mark`) plus a `.json` sidecar. The CSV layout matches
   PiEEG's recordings, so PiEEG Studio (MNE-Python) opens them.

**Heart rate:** plug the Garmin ANT+ USB stick (WinUSB driver, as for Latido Común), press *Start ANT+ stick* on Home, put a strap on: it appears with its id; give it a slot. Slot 1 is the main heart (`heart.*` signals); every slot has `strapN.bpm` / `strapN.beat`.

**Simulator** keys: `B` blink · `J` jaw clench · `←` `→` eye movement · `1`–`8` toggle a bad contact on that channel.

## How it is built

Plain Electron (no bundler), ES modules in the renderer, `contextIsolation` + sandbox, one preload bridge (`window.alma`).
Design follows the VEATION design system (`assets/tokens.css`, Geist): grey surfaces, 1 px lines, amber only as a point.

| File | Role |
|---|---|
| `main.js` | window, Web Bluetooth device chooser, session files, screenshot self-test (`--shot=path --quit-after=ms`) |
| `src/ble.js` | PiEEG/IronBCI BLE protocol: notify `fe42`, 24 bytes per sample, 24-bit two's complement → µV |
| `src/sim.js` | 8-channel simulator with blinks, jaw, eye movements, bad contacts |
| `src/dsp.js` | Hampel (5, 3σ), Butterworth 1–40 Hz (4th order), notch 50/60 Hz, Goertzel |
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
| `src/pages/*.js` | Home, Live, Routing |
| `src/app.js` | wiring, config persistence (userData/config.json) |

Electrode map (PiEEG XR): Ch1–2 left temple (lower, upper) · Ch3–4 left forehead · Ch5–6 right forehead ·
Ch7–8 right temple (upper, lower) · reference and bias at the centre of the forehead.

## Credits

3D head: Lee Perry-Smith head scan by Infinite-Realities (CC-BY), as shipped with the three.js examples. three.js (MIT) is vendored in `assets/vendor`.

Protocol and the shape of the detectors follow PiEEG's open-source work (MIT): https://github.com/pieeg-club/PiEEG-server.
Not a medical device. Research and art use only.
