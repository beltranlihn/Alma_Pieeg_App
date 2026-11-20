# Pieeg App - WebSocket DAT callbacks for TouchDesigner.
#
# Paste into a Text DAT and set it as the Callbacks DAT of a
# WebSocket DAT connected to ws://127.0.0.1:8765.
#
# Writes every address/value into the Table DAT "alma_values".
# Appends rule events and cues to the Table DAT "alma_events".

import json
import time

VALUES_TABLE = 'alma_values'
EVENTS_TABLE = 'alma_events'
MAX_EVENT_ROWS = 200

# "op" exists inside TouchDesigner. This guard lets the file load anywhere else.
try:
    op
except NameError:
    def op(path):
        return None


def _ensure_header(table, header):
    if table.numRows == 0:
        table.appendRow(header)


def _set_value(table, address, value):
    # look for the address in column 0, ignoring the header row
    row = None
    for r in range(1, table.numRows):
        if table[r, 0].val == address:
            row = r
            break
    if row is None:
        table.appendRow([address, value])
    else:
        table[row, 1] = value


def _add_event(table, kind, name, value='', threshold=''):
    table.appendRow([time.strftime('%H:%M:%S'), kind, name, value, threshold])
    # keep the table small: header + MAX_EVENT_ROWS
    while table.numRows > MAX_EVENT_ROWS + 1:
        table.deleteRow(1)


def onConnect(dat):
    print('Alma: connected')
    return


def onDisconnect(dat):
    print('Alma: disconnected')
    return


def onReceiveText(dat, rowIndex, message):
    try:
        frame = json.loads(message)
    except ValueError:
        return
    if not isinstance(frame, dict):
        return

    values_table = op(VALUES_TABLE)
    events_table = op(EVENTS_TABLE)

    values = frame.get('values')
    if values_table is not None and isinstance(values, dict):
        _ensure_header(values_table, ['address', 'value'])
        for address, value in values.items():
            _set_value(values_table, address, value)

    if events_table is not None:
        _ensure_header(events_table, ['time', 'kind', 'name', 'value', 'threshold'])
        if 'event' in frame:
            name = frame.get('rule_name') or frame.get('event')
            _add_event(events_table, 'rule', name,
                       frame.get('value', ''), frame.get('threshold', ''))
        if 'cue' in frame:
            _add_event(events_table, 'cue', frame.get('cue'))
    return


def onReceiveBinary(dat, contents):
    return


def onReceivePing(dat, contents):
    dat.sendPong(contents)
    return


def onReceivePong(dat, contents):
    return


def onMonitorMessage(dat, message):
    return
