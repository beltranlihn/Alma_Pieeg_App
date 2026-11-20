// Pieeg App - send a marker from Unity.
//
// Sends the OSC message  /alma/mark "text"  over UDP to the app's input port
// (127.0.0.1:9001 by default). The marker is stamped in the recording.
//
//   GetComponent<AlmaMarker>().Mark("scene 2");
// or from anywhere:
//   AlmaMarker.Send("127.0.0.1", 9001, "scene 2");

using System.Net.Sockets;
using System.Text;
using UnityEngine;

public class AlmaMarker : MonoBehaviour
{
    public string host = "127.0.0.1";
    public int port = 9001;

    [Tooltip("Optional: press this key to send a test marker.")]
    public KeyCode testKey = KeyCode.None;

    public void Mark(string text)
    {
        Send(host, port, text);
    }

    void Update()
    {
        if (testKey != KeyCode.None && Input.GetKeyDown(testKey))
            Mark("unity test");
    }

    public static void Send(string host, int port, string text)
    {
        byte[] packet = EncodeOsc("/alma/mark", text);
        using (var udp = new UdpClient())
        {
            udp.Send(packet, packet.Length, host, port);
        }
    }

    // Minimal OSC message: address, type tags ",s", one string argument.
    // Every string ends with a zero byte and is padded to a multiple of 4.
    public static byte[] EncodeOsc(string address, string arg)
    {
        var bytes = new System.Collections.Generic.List<byte>();
        AddPadded(bytes, address);
        AddPadded(bytes, ",s");
        AddPadded(bytes, arg ?? "");
        return bytes.ToArray();
    }

    static void AddPadded(System.Collections.Generic.List<byte> list, string s)
    {
        byte[] b = Encoding.UTF8.GetBytes(s);
        list.AddRange(b);
        int pad = 4 - (b.Length % 4); // always 1 to 4 zero bytes
        for (int i = 0; i < pad; i++) list.Add(0);
    }
}
