# Unreal Engine

Uses Unreal's built-in **OSC** plugin. No code, only Blueprints.

## 1. Enable the plugin

1. **Edit > Plugins**, search `OSC`, tick **OSC**, restart the editor.

## 2. Receive values

In the app, set the OSC destination to `127.0.0.1` port `7000` (use the PC's IP if Unreal runs on another machine).

In a Blueprint (for example your Level Blueprint or a GameMode):

1. **Event BeginPlay** > **Create OSC Server**
   - **Receive IP Address**: `0.0.0.0`
   - **Port**: `7000`
   - **Start Listening**: on
2. Right-click the output and **Promote to Variable**, name it `AlmaServer`.
   **Keep this reference.** If it is only a local pin, Unreal may garbage-collect the server and messages stop.
3. Drag from `AlmaServer` and add **Bind Event to On OSC Message Received**. Connect it after the Set node.
   The event gives you a `Message` and the sender's IP and port.
4. Inside the event:
   - **Get OSC Message Address** (Message) > **Convert OSC Address to String** gives `/alma/calm`.
   - **Switch on String** with cases `/alma/calm`, `/alma/blink`, `/alma/clench`.
   - In each case: **Get OSC Message Floats** (Message) > **Get** index 0. Use the float for what you need (a material parameter, a light, a variable).
   - For `/alma/blink` the value is an int. If the Floats array is empty, use **Get OSC Message Ints** instead.
5. On **End Play**, call **Stop** on `AlmaServer` (optional but tidy).

Events run on the game thread, so you can touch actors and materials directly.

## 3. Send a marker

In the app the input port is `9001`.

1. **Event BeginPlay** > **Create OSC Client**
   - **Send IP Address**: `127.0.0.1`
   - **Port**: `9001`
   - **Client Name**: `AlmaClient`
2. Promote the client to a variable `AlmaClient` (keep the reference).
3. When you want a marker (for example on a key press or on level change):
   - Make an empty OSC message and set its address to `/alma/mark` (**Set OSC Message Address**; node names vary slightly between engine versions).
   - **Add String to OSC Message**: `scene 2`. Use the message it returns.
   - **Send OSC Message** (target `AlmaClient`, Message).

## On a Quest or other headset

- The headset is a different computer. In the app set the OSC destination to the **PC's IP** (not 127.0.0.1) when Unreal runs on the PC, or to the **headset's IP** when the packaged app runs on the headset.
- Create the OSC Server with `0.0.0.0` so it listens on the network.
- The PC firewall must allow UDP on the ports you use (7000 to receive on the PC, 9001 for the app's input). The headset and the PC must be on the same Wi-Fi network.
- To send a marker from a headset to the PC, put the **PC's IP** in Create OSC Client instead of `127.0.0.1`. The app listens on this computer only by default: in the app, **Routing › Markers and commands in › From**, choose **The network** first.
- Packaged Android builds need the Internet permission (it is on by default).
