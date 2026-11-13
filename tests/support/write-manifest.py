"""Adapt Node observations to the shared capture contract; do not invent coverage."""
import json
import pathlib
import sys
sys.dont_write_bytecode = True
from capture_manifest import Manifest

base = pathlib.Path(sys.argv[1])
data = json.loads((base / 'observations.json').read_text(encoding='utf-8'))
manifest = Manifest(data.get('tool', 'transit-live-smoke'), 'driven', 'network', target={'scope': data.get('scope', 'named public production GET endpoints only')}, tool_version='1')
manifest.open_session('live', started=data['started'], attached_before_navigate=True)
for observation in data['observations']:
    manifest.record(session='live', **observation)
manifest.close_session('live', ended=data['ended'], reason='closed')
manifest.write(base / 'capture-manifest.json')
