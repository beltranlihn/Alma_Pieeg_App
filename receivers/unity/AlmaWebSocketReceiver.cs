// EEG Alma Center - Unity WebSocket receiver. No packages needed.
//
// Add this to any GameObject. It connects to the app's WebSocket server,
// reconnects on its own, and keeps the latest value of every address.
//
//   float calm = receiver.Get("/alma/calm");
//
// Rule events and cues arrive on the main thread through UnityEvents.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Events;

public class AlmaWebSocketReceiver : MonoBehaviour
{
    [Serializable] public class StringEvent : UnityEvent<string> { }

    [Header("Connection")]
    [Tooltip("The app is the server. Use the PC's IP when running on a headset.")]
    public string url = "ws://127.0.0.1:8765";
    public float reconnectSeconds = 2f;

    [Header("Events (called on the main thread)")]
    [Tooltip("Gets the rule name when a rule fires.")]
    public StringEvent OnRule = new StringEvent();
    [Tooltip("Gets the cue label when a cue is sent.")]
    public StringEvent OnCue = new StringEvent();

    public bool IsConnected { get; private set; }

    readonly ConcurrentDictionary<string, float> _values = new ConcurrentDictionary<string, float>();
    readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
    CancellationTokenSource _cts;

    /// <summary>Latest value for an address, or 0 if never received.</summary>
    public float Get(string address)
    {
        float v;
        return _values.TryGetValue(address, out v) ? v : 0f;
    }

    void OnEnable()
    {
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        Task.Run(() => RunLoop(token));
    }

    void OnDisable()
    {
        if (_cts != null) _cts.Cancel();
        IsConnected = false;
    }

    void Update()
    {
        Action a;
        while (_mainThread.TryDequeue(out a))
        {
            try { a(); }
            catch (Exception e) { Debug.LogException(e); }
        }
    }

    async Task RunLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            using (var ws = new ClientWebSocket())
            {
                try
                {
                    await ws.ConnectAsync(new Uri(url), token);
                    IsConnected = true;
                    await ReceiveLoop(ws, token);
                }
                catch (OperationCanceledException) { }
                catch (Exception e)
                {
                    Debug.Log("Alma: " + e.Message);
                }
                IsConnected = false;
            }

            try { await Task.Delay(TimeSpan.FromSeconds(reconnectSeconds), token); }
            catch (OperationCanceledException) { }
        }
    }

    async Task ReceiveLoop(ClientWebSocket ws, CancellationToken token)
    {
        var buffer = new byte[8192];
        while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
        {
            using (var ms = new MemoryStream())
            {
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Text)
                    HandleFrame(Encoding.UTF8.GetString(ms.ToArray()));
            }
        }
    }

    void HandleFrame(string json)
    {
        var root = TinyJson.Parse(json) as Dictionary<string, object>;
        if (root == null) return;

        object valuesObj;
        if (root.TryGetValue("values", out valuesObj))
        {
            var values = valuesObj as Dictionary<string, object>;
            if (values != null)
            {
                foreach (var kv in values)
                {
                    if (kv.Value is double) _values[kv.Key] = (float)(double)kv.Value;
                    else if (kv.Value is bool) _values[kv.Key] = (bool)kv.Value ? 1f : 0f;
                }
            }
        }

        object ev;
        if (root.TryGetValue("event", out ev) && ev is string)
        {
            object nameObj;
            string name = root.TryGetValue("rule_name", out nameObj) && nameObj is string
                ? (string)nameObj : (string)ev;
            _mainThread.Enqueue(() => OnRule.Invoke(name));
        }

        object cue;
        if (root.TryGetValue("cue", out cue) && cue is string)
        {
            string label = (string)cue;
            _mainThread.Enqueue(() => OnCue.Invoke(label));
        }
    }
}

// A tiny JSON reader: objects, arrays, strings, numbers, true/false/null.
// Objects become Dictionary<string, object>, numbers become double,
// arrays become List<object>. Enough for the Alma frames.
static class TinyJson
{
    public static object Parse(string s)
    {
        int i = 0;
        try { return ReadValue(s, ref i); }
        catch (Exception) { return null; }
    }

    static void Skip(string s, ref int i)
    {
        while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
    }

    static object ReadValue(string s, ref int i)
    {
        Skip(s, ref i);
        char c = s[i];
        if (c == '{') return ReadObject(s, ref i);
        if (c == '[') return ReadArray(s, ref i);
        if (c == '"') return ReadString(s, ref i);
        if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
        if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
        if (string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
        return ReadNumber(s, ref i);
    }

    static Dictionary<string, object> ReadObject(string s, ref int i)
    {
        var d = new Dictionary<string, object>();
        i++; // {
        Skip(s, ref i);
        if (s[i] == '}') { i++; return d; }
        while (true)
        {
            Skip(s, ref i);
            string key = ReadString(s, ref i);
            Skip(s, ref i);
            i++; // :
            d[key] = ReadValue(s, ref i);
            Skip(s, ref i);
            if (s[i] == ',') { i++; continue; }
            i++; // }
            return d;
        }
    }

    static List<object> ReadArray(string s, ref int i)
    {
        var l = new List<object>();
        i++; // [
        Skip(s, ref i);
        if (s[i] == ']') { i++; return l; }
        while (true)
        {
            l.Add(ReadValue(s, ref i));
            Skip(s, ref i);
            if (s[i] == ',') { i++; continue; }
            i++; // ]
            return l;
        }
    }

    static string ReadString(string s, ref int i)
    {
        var sb = new StringBuilder();
        i++; // opening quote
        while (s[i] != '"')
        {
            char c = s[i++];
            if (c == '\\')
            {
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 't': sb.Append('\t'); break;
                    case 'r': sb.Append('\r'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                        i += 4;
                        break;
                    default: sb.Append(e); break; // \" \\ \/
                }
            }
            else sb.Append(c);
        }
        i++; // closing quote
        return sb.ToString();
    }

    static object ReadNumber(string s, ref int i)
    {
        int start = i;
        while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
        return double.Parse(s.Substring(start, i - start), CultureInfo.InvariantCulture);
    }
}
