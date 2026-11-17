# TouchDesigner

Two ways to get data in. Use one or both.

## A. OSC In CHOP (simplest)

1. In the app, set the OSC destination to `127.0.0.1` port `7000`.
2. In TouchDesigner add an **OSC In CHOP**.
3. Set **Network Port** to `7000` and **Active** to On.
4. Optional: set the **Address Scope** (address filter) to `/alma/*` to keep only these signals.
5. Each address becomes a channel, for example `alma/calm`. Wire it to anything.

If two programs fight for port 7000, close one of them.

## B. WebSocket DAT (values, rule events and cues)

1. Add a **WebSocket DAT**. Point it at `ws://127.0.0.1:8765` (the Network Address / Port parameters depend on your build). Set **Active** to On.
2. Add two **Table DATs** named `alma_values` and `alma_events`.
3. Add a **Text DAT**, paste in `alma_websocket_callbacks.py`, and set the WebSocket DAT's **Callbacks DAT** to it.
4. `alma_values` gets one row per address (`address`, `value`). It updates every tick.
5. `alma_events` gets one row each time a rule fires or a cue is sent (`time`, `kind`, `name`, `value`, `threshold`).

Keep the three DATs in the same network so `op('alma_values')` finds them. If you move them, edit the two names at the top of the file.

Tip: use a **DAT to CHOP** on `alma_values` to turn it into channels.

## Send a marker

1. Add an **OSC Out DAT** named `oscout1`.
2. Set **Network Address** `127.0.0.1` and **Network Port** `9001`.
3. Run this from a Text DAT or a button callback:

```python
op('oscout1').sendOSC('/alma/mark', ['scene 2'])
```

`alma_send_marker.py` wraps it in one function. Paste it in a Text DAT named `alma_send_marker`, then:

```python
mod.alma_send_marker.send_marker('scene 2')
```

## Files

- `alma_websocket_callbacks.py` - callbacks for the WebSocket DAT.
- `alma_send_marker.py` - small marker helper.
