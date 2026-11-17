# Max

`alma-receive.maxpat` is a small Max 8 patch.

## What it does

- `udpreceive 7000` listens for the app's OSC.
- `route /alma/calm /alma/blink /alma/clench` splits the signals.
- Number boxes show `calm` and `clench`. A `button` flashes on each blink (`sel 1` keeps only the 1s).
- The message box `/alma/mark "from Max"` goes to `udpsend 127.0.0.1 9001`. Click it to stamp a marker in the recording.

## Use it

1. In the app, set the OSC destination to `127.0.0.1` port `7000`.
2. Open `alma-receive.maxpat`. Switch the patch to run mode (lock it, Ctrl/Cmd+E).
3. Move your signals. The numbers should move.

To add a signal: add its address to the `route` object (for example `route /alma/calm /alma/blink /alma/clench /alma/jaw`) and connect the new outlet. The last outlet of `route` is everything that did not match.

## If nothing arrives

- Port 7000 must be free. Only one program can listen on it.
- If Max prints `FullPacket` instead of values, put a `OSC-route` object (from CNMAT) after `udpreceive` and use it instead of `route`.
- Windows firewall: allow Max to receive on UDP.

## Max for Live

You can use the same patch inside a Max for Live device.

1. In Ableton Live add a new **Max MIDI Effect** (or Max Instrument / Max Audio Effect) and click **Edit**.
2. Copy all the objects from `alma-receive.maxpat` and paste them into the device.
3. Keep `udpreceive 7000` as it is. Send a signal into Live like this:
   - For a parameter: use `live.dial` (set the range 0-1) after `route` and map it in Live.
   - For notes: connect a value to `makenote` and `noteout`, or use `live.numbox`.
4. Freeze and save the device.

One device per port. If two devices both open `udpreceive 7000`, the second one will fail. Use one device that receives the signals and sends the values to others with `send` / `receive`, or set a different port in the app for each.
