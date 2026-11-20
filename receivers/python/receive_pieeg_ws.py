"""Pieeg App - PiEEG-compatible WebSocket client. Standard library only.

Connects to ws://127.0.0.1:1616, prints the welcome message and the first
5 sample frames, then sends {"mark": "python"} and closes.

Usage:  python receive_pieeg_ws.py [host] [port]
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def connect(host, port):
    sock = socket.create_connection((host, port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        "GET / HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n" % (host, port, key)
    )
    sock.sendall(request.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("connection closed during handshake")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    if b" 101 " not in head.split(b"\r\n")[0]:
        raise RuntimeError("handshake failed: " + head.decode(errors="replace"))
    expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    if expected.lower() not in head.decode(errors="replace").lower():
        print("warning: Sec-WebSocket-Accept did not match")
    return sock, rest  # rest = bytes already read after the headers


def read_exact(sock, buf, n):
    """Return n bytes, taking from buf first. Returns (data, remaining buf)."""
    while len(buf) < n:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("connection closed")
        buf += chunk
    return buf[:n], buf[n:]


def read_frame(sock, buf):
    """Read one frame. Returns (opcode, payload, remaining buf). No fragmentation."""
    head, buf = read_exact(sock, buf, 2)
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        ext, buf = read_exact(sock, buf, 2)
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext, buf = read_exact(sock, buf, 8)
        length = struct.unpack(">Q", ext)[0]
    mask = b""
    if masked:  # servers normally do not mask, but handle it
        mask, buf = read_exact(sock, buf, 4)
    payload, buf = read_exact(sock, buf, length)
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload, buf


def send_frame(sock, opcode, payload):
    """Client frames MUST be masked."""
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(header + mask + masked)


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 1616
    sock, buf = connect(host, port)
    print("connected to ws://%s:%d" % (host, port))

    samples = 0
    while samples < 5:
        opcode, payload, buf = read_frame(sock, buf)
        if opcode == 0x1:  # text
            text = payload.decode("utf-8", errors="replace")
            try:
                msg = json.loads(text)
            except ValueError:
                print("text:", text)
                continue
            if isinstance(msg, dict) and isinstance(msg.get("channels"), list):   # samples carry a list; the welcome says how many
                samples += 1
                print("sample", msg.get("n"), msg["channels"])
            else:
                print("welcome:", text)
        elif opcode == 0x9:  # ping
            send_frame(sock, 0xA, payload)
        elif opcode == 0x8:  # close
            print("server closed the connection")
            return

    send_frame(sock, 0x1, json.dumps({"mark": "python"}).encode())
    print("sent mark")
    send_frame(sock, 0x8, struct.pack(">H", 1000))
    sock.close()


if __name__ == "__main__":
    main()
