import { writeFileSync, mkdirSync, cpSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwned, disposeOwned } from './support/safety.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const base = createOwned(root);
Object.assign(process.env, { TMPDIR: base, TEMP: base, TMP: base });
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `TRANSIT_TEST_BASE=${base}\n`);
const artifacts = join(base, 'artifacts');
mkdirSync(artifacts);
const observations = [];
const failures = [];
const started = new Date().toISOString();
async function get(path, validate) {
  const url = new URL(path, 'https://guelph-transit-map.ca/').href;
  const ts = new Date().toISOString();
  let response, bytes;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    bytes = Buffer.from(await response.arrayBuffer());
    const file = `response-${observations.length}.bin`;
    writeFileSync(join(artifacts, file), bytes);
    observations.push({ ts, disposition: 'captured', url, finalUrl: response.url, status: response.status, bytes: bytes.length, file,
      sha256: createHash('sha256').update(bytes).digest('hex') });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    await validate(bytes);
  } catch (error) {
    if (!bytes) observations.push({ ts, disposition: 'failed', url, error: String(error), ...(response ? { loss: 'unreadable_response' } : {}) });
    failures.push(`${url}: ${error.message}`);
  }
}
try {
  await get('/', bytes => { if (!bytes.toString().includes('Guelph Transit Map')) throw Error('Wrong HTML document'); });
  await get('/index.js', bytes => { if (!bytes.toString().includes('UpdateMarkers')) throw Error('Missing application code'); });
  await get('/style.css', bytes => { if (!bytes.toString().includes('#map')) throw Error('Missing map styles'); });
  for (const path of ['/route-data', '/bus-positions', '/alerts']) {
    await get(path, bytes => {
      const value = JSON.parse(bytes);
      if (!Array.isArray(value)) throw Error('Expected JSON array');
      if (path === '/route-data' && !value.some(route => Array.isArray(route.routeStops) && route.routeStops.length)) throw Error('No initialized route/stop data');
      if (path === '/bus-positions' && value.some(bus => !Number.isFinite(bus.position?.latitude) || !Number.isFinite(bus.position?.longitude))) throw Error('Invalid vehicle coordinates');
      // Zero vehicles or alerts is legitimate, especially overnight.
    });
  }
} finally {
  try {
    writeFileSync(join(artifacts, 'observations.json'), JSON.stringify({ started, ended: new Date().toISOString(), observations }, null, 2));
    writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ failures, observations: observations.length }, null, 2));
    execFileSync(process.env.PYTHON ?? 'python', [join(root, 'support/write-manifest.py'), artifacts]);
    if (process.env.GITHUB_ENV) {
      // CI uploads evidence before the separate always-cleanup step.
      console.log(`CI evidence: ${artifacts}`);
    } else {
      const evidence = join(dirname(root), 'review/evidence', `live-smoke-${started.replace(/[:.]/g, '-')}`);
      cpSync(artifacts, evidence, { recursive: true });
      console.log(`Evidence: ${evidence}`);
    }
  } finally { if (!process.env.GITHUB_ENV) disposeOwned(base); }
}
console.log(JSON.stringify({ observations: observations.length, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
