"""Create the controlled GTFS ZIP from the committed CSV observations."""
import json
import sys
import zipfile

with open(sys.argv[1], encoding='utf-8') as source:
    fixture = json.load(source)
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in fixture['csv'].items():
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 4, 21, 53, 4))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, content)
