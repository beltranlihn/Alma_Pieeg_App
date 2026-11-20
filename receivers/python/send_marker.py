"""Pieeg App - send a marker. Standard library only.

Usage:  python send_marker.py scene 2
        python send_marker.py "breathing starts"

Sends the OSC message  /alma/mark "<text>"  to 127.0.0.1:9001.
Set ALMA_HOST / ALMA_PORT in the environment to change the target.
"""
import os
import socket
import sys


def pad(text):
    data = text.encode("utf-8") + b"\x00"
    while len(data) % 4:
        data += b"\x00"
    return data


def osc_string_message(address, text):
    return pad(address) + pad(",s") + pad(text)


def main():
    text = " ".join(sys.argv[1:]) or "python"
    host = os.environ.get("ALMA_HOST", "127.0.0.1")
    port = int(os.environ.get("ALMA_PORT", "9001"))
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(osc_string_message("/alma/mark", text), (host, port))
    print("sent marker %r to %s:%d" % (text, host, port))


if __name__ == "__main__":
    main()
