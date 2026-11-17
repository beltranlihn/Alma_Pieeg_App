# Python

Standard library only. Python 3.7 or newer.

| Script | What it does |
|---|---|
| `receive_osc.py [port]` | Listens for OSC on UDP 7000 and prints address and value. |
| `send_marker.py <text>` | Sends `/alma/mark "<text>"` to 127.0.0.1:9001. |
| `receive_pieeg_ws.py [host] [port]` | Connects to the PiEEG-compatible WebSocket (port 1616), prints the welcome and 5 samples, sends a marker. |

```
python receive_osc.py
python send_marker.py scene 2
python receive_pieeg_ws.py
```

`send_marker.py` reads `ALMA_HOST` and `ALMA_PORT` from the environment if you need another target.

For `receive_pieeg_ws.py`, turn on the PiEEG-compatible WebSocket in the app first.
