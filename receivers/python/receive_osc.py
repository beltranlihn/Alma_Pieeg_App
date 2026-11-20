"""Pieeg App - print incoming OSC messages. Standard library only.

Usage:  python receive_osc.py [port]      (default port 7000)
"""
import socket
import struct
import sys


def read_string(data, pos):
    end = data.index(b"\x00", pos)
    text = data[pos:end].decode("utf-8", errors="replace")
    pos = (end + 4) & ~3  # string + zero byte, padded to 4 bytes
    return text, pos


def decode_message(data):
    """Return (address, [args]) for f, i, s, d, h, T, F, N arguments."""
    address, pos = read_string(data, 0)
    args = []
    if pos >= len(data) or data[pos:pos + 1] != b",":
        return address, args
    tags, pos = read_string(data, pos)
    for tag in tags[1:]:
        if tag == "f":
            args.append(struct.unpack(">f", data[pos:pos + 4])[0])
            pos += 4
        elif tag == "i":
            args.append(struct.unpack(">i", data[pos:pos + 4])[0])
            pos += 4
        elif tag == "d":
            args.append(struct.unpack(">d", data[pos:pos + 8])[0])
            pos += 8
        elif tag == "h":
            args.append(struct.unpack(">q", data[pos:pos + 8])[0])
            pos += 8
        elif tag == "s":
            text, pos = read_string(data, pos)
            args.append(text)
        elif tag == "T":
            args.append(True)
        elif tag == "F":
            args.append(False)
        elif tag == "N":
            args.append(None)
    return address, args


def decode_packet(data):
    """Yield (address, args), unpacking bundles."""
    if data.startswith(b"#bundle"):
        pos = 16  # "#bundle\0" + 8 byte time tag
        while pos + 4 <= len(data):
            size = struct.unpack(">i", data[pos:pos + 4])[0]
            pos += 4
            for item in decode_packet(data[pos:pos + size]):
                yield item
            pos += size
    else:
        yield decode_message(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", port))
    print("Listening for OSC on UDP port %d. Ctrl+C to stop." % port)
    try:
        while True:
            data, _ = sock.recvfrom(65535)
            try:
                for address, args in decode_packet(data):
                    value = args[0] if len(args) == 1 else args
                    print(address, value)
            except Exception as exc:  # bad packet, keep going
                print("could not decode packet:", exc)
    except KeyboardInterrupt:
        print("bye")


if __name__ == "__main__":
    main()
