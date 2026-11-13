import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import http from 'node:http';
import { replayFetch } from './safety.mjs';
import { appendFileSync } from 'node:fs';

const base = process.env.TRANSIT_TEST_BASE;
if (!base || !process.send) throw Error('Test child requires owned base and IPC');
const fixture = JSON.parse(readFileSync(join(base, 'fixture.json'), 'utf8'));
const require = createRequire(join(process.cwd(), 'app.js'));
const protobuf = require('protobufjs');
const feedType = protobuf.loadSync('gtfs-realtime.proto').lookupType('transit_realtime.FeedMessage');
const prefix = 'https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/';
const requests = {};
for (const [name, url] of Object.entries({
  static: 'https://drive.google.com/uc?export=download&id=1SsCgQ0agO_EONavJoOuBPMlbcu2VcUs4',
  vehicles: prefix + 'vehicle/vehiclepositions.pb', alerts: prefix + 'alert/alerts.pb', predictions: prefix + 'tripupdate/tripupdates.pb',
})) {
  const file = `${name}.bin`;
  if (name !== 'static') writeFileSync(join(base, file), feedType.encode(feedType.fromObject(fixture.feeds[name])).finish());
  const bytes = readFileSync(join(base, file));
  requests[url] = { file, sha256: createHash('sha256').update(bytes).digest('hex'), status: name === 'predictions' ? fixture.predictionStatus ?? 200 : 200 };
}
const replay = replayFetch({ requests }, base);
globalThis.fetch = async (...args) => {
  const started = performance.now();
  try { return await replay(...args); }
  finally { appendFileSync(join(base, 'upstream-requests.jsonl'), JSON.stringify({ url: String(args[0]), elapsedMs: performance.now() - started }) + '\n'); }
};
setInterval(() => {
  appendFileSync(join(base, 'resource-samples.jsonl'), JSON.stringify({
    elapsedSeconds: process.uptime(), memory: process.memoryUsage(), cpu: process.cpuUsage(), resources: process.getActiveResourcesInfo(),
  }) + '\n');
}, 500).unref();
const OriginalDate = Date;
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixture.fixedTime])); }
  static now() { return new OriginalDate(fixture.fixedTime).getTime(); }
};
// Test seam only: production still listens on 8081; never claim an existing port.
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const callback = args.find(value => typeof value === 'function');
  this.once('listening', () => process.send({ port: this.address().port }));
  return originalListen.call(this, 0, '127.0.0.1', callback);
};
require(join(process.cwd(), 'app.js'));
