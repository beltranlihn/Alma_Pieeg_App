# Pieeg App - send a marker from TouchDesigner.
#
# Needs an OSC Out DAT (default name "oscout1") set to
# Network Address 127.0.0.1, Network Port 9001.
#
# Paste into a Text DAT named "alma_send_marker", then call:
#   mod.alma_send_marker.send_marker('scene 2')

# "op" exists inside TouchDesigner. This guard lets the file load anywhere else.
try:
    op
except NameError:
    def op(path):
        return None


def send_marker(text, oscout='oscout1'):
    """Stamp a marker in the Alma recording."""
    out = op(oscout)
    if out is None:
        print('Alma: OSC Out DAT "%s" not found' % oscout)
        return False
    out.sendOSC('/alma/mark', [str(text)])
    return True
