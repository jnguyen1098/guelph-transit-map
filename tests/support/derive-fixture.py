"""Reproduce the bounded derivative; original observations stay in review/evidence."""
import csv
import hashlib
import io
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(root / 'raw/static.bin') as archive:
    tables = {name: list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))
              for name in ['routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt', 'stop_times.txt']}
vehicles, predictions, alerts = [json.loads((root / (name + '-decoded.json')).read_text())
                                for name in ['vehicles', 'predictions', 'alerts']]
ids = {vehicles['entity'][0]['vehicle']['trip']['tripId']}
for headsign in ['99 Mainline Northbound', '99 Mainline Southbound']:
    candidates = sorted(row['trip_id'] for row in tables['trips.txt'] if row['trip_headsign'] == headsign)
    ids.add(next((entity['vehicle']['trip']['tripId'] for entity in vehicles['entity']
                 if entity['vehicle']['trip']['tripId'] in candidates), candidates[0]))
ids.add(next(row['trip_id'] for row in tables['stop_times.txt'] if row['stop_id'] == '103'))
tables['trips.txt'] = [row for row in tables['trips.txt'] if row['trip_id'] in ids]
shapes = {row['shape_id'] for row in tables['trips.txt']}
tables['shapes.txt'] = [row for row in tables['shapes.txt'] if row['shape_id'] in shapes]
tables['stop_times.txt'] = [row for row in tables['stop_times.txt'] if row['trip_id'] in ids]
vehicles['entity'] = [entity for entity in vehicles['entity'] if entity['vehicle']['trip']['tripId'] in ids]
predictions['entity'] = [entity for entity in predictions['entity'] if entity['tripUpdate']['trip'].get('tripId') in ids]
alerts['entity'] = alerts['entity'][:1]
contents = {}
for name, rows in tables.items():
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=list(rows[0]), lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    contents[name] = output.getvalue()
fixture = {
    'fixedTime': '2026-11-04T21:53:04.000Z',
    'provenance': {
        'type': 'derived bounded fixture, not a live feed', 'source': root.as_posix(),
        'sourceSha256': {name: hashlib.sha256((root / 'raw' / name).read_bytes()).hexdigest()
                         for name in ['static.bin', 'vehicles.bin', 'predictions.bin', 'alerts.bin']},
        'selection': 'All route/stop metadata; four trips (first vehicle, 99 north/south, stop 103), matching shapes, stop times, vehicles and updates; first alert. CSV normalized, protobuf decoded without defaults. Originals retained in review/evidence.',
    },
    'csv': contents, 'feeds': {'vehicles': vehicles, 'predictions': predictions, 'alerts': alerts},
}
output_path = pathlib.Path(sys.argv[2])
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(fixture, separators=(',', ':')), encoding='utf-8')
print({'trips': sorted(ids), 'vehicles': len(vehicles['entity']), 'updates': len(predictions['entity'])})
