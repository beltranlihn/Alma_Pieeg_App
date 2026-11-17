# Unity

No packages needed. Two scripts.

## Receive values (WebSocket)

1. Copy `AlmaWebSocketReceiver.cs` into your `Assets` folder.
2. Add it to a GameObject.
3. Set **Url** to `ws://127.0.0.1:8765` (the app's WebSocket port).
4. Read values anywhere:

```csharp
public AlmaWebSocketReceiver alma;

void Update()
{
    float calm = alma.Get("/alma/calm");
    transform.localScale = Vector3.one * (1f + calm);
}
```

`Get` returns 0 until the first value arrives.

- It reconnects by itself if the app restarts.
- **On Rule** gets the rule name when a rule fires. **On Cue** gets the cue label. Hook them up in the Inspector. They run on the main thread, so you can touch the scene.
- On a headset (Quest), use the PC's IP in the Url, for example `ws://192.168.1.20:8765`, and allow the port in the PC firewall.

## Send a marker (UDP)

1. Copy `AlmaMarker.cs` into your `Assets` folder and add it to a GameObject.
2. Host `127.0.0.1`, port `9001`.
3. Call it:

```csharp
GetComponent<AlmaMarker>().Mark("scene 2");
// or, without a component:
AlmaMarker.Send("127.0.0.1", 9001, "scene 2");
```

It sends the OSC message `/alma/mark "scene 2"` with a tiny built-in encoder.

## PiEEG's own Unity plugin

If you want raw EEG samples, PiEEG's plugin `com.pieeg.unity` works with the app's PiEEG-compatible WebSocket on port 1616. Turn that server on in the app, then point the plugin at `ws://<computer>:1616`.

Install in Unity with Package Manager, **Add package from git URL**:

```
https://github.com/pieeg-club/PiEEG-unity.git?path=/Packages/com.pieeg.unity
```

## Notes

- If Unity says `System.Net.WebSockets` is missing, set **Api Compatibility Level** to `.NET Standard 2.1` (or `.NET Framework`) in Player Settings.
- WebGL builds cannot use `ClientWebSocket` or UDP. Use a standalone or Android build.
