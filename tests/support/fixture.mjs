import { test as base, expect } from '@playwright/test';
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedPath } from './safety.mjs';

export const testsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runBase = process.env.TRANSIT_TEST_BASE;
if (!runBase) throw Error('Use node tests/run.mjs check main (or pr18)');
const fixture = JSON.parse(readFileSync(join(testsRoot, 'fixtures/transit.json'), 'utf8'));
const assetMap = new Map([
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet/dist/leaflet.js'],
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'leaflet/dist/leaflet.css'],
  ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', 'maplibre-gl/dist/maplibre-gl.js'],
  ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css', 'maplibre-gl/dist/maplibre-gl.css'],
  ['https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js', '@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js'],
  ['https://unpkg.com/leaflet-polylinedecorator@1.6.0/dist/leaflet.polylineDecorator.js', 'leaflet-polylinedecorator/dist/leaflet.polylineDecorator.js'],
  ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css', 'bootstrap/dist/css/bootstrap.min.css'],
]);
const localStyle = {
  version: 8,
  sources: { empty: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5eadf' } },
    ...['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit', 'highway-name-major', 'highway-name-minor', 'highway-name-path']
      .map(id => ({ id, type: 'symbol', source: 'empty', filter: ['all'] }))],
};
export const test = base.extend({
  browserErrors: async ({}, use) => { await use([]); },
  predictionStatus: [200, { option: true }],
  app: async ({ predictionStatus }, use, testInfo) => {
    const dir = join(runBase, `server-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${testInfo.testId.replace(/[^a-z0-9]/gi, '')}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ ...fixture, predictionStatus }));
    execFileSync(process.env.PYTHON ?? 'python', [join(testsRoot, 'support/build-zip.py'), join(dir, 'fixture.json'), join(dir, 'static.bin')]);
    const child = fork(join(testsRoot, 'support/server.mjs'), [], {
      cwd: join(runBase, 'app'), env: { ...process.env, TRANSIT_TEST_BASE: dir }, silent: true,
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Server did not listen: ${log}`)), 15000);
        child.once('message', data => { clearTimeout(timer); resolve(data.port); });
        child.once('exit', code => { clearTimeout(timer); reject(Error(`Server exited ${code}: ${log}`)); });
      });
      const url = `http://127.0.0.1:${port}`;
      await expect.poll(async () => {
        const routes = await (await fetch(url + '/route-data')).json();
        return routes.some(route => route.routeStops.length > 0);
      }, { timeout: 15000 }).toBe(true);
      await use({ url });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise(resolve => child.once('exit', resolve));
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.kill();
        await ended;
        clearTimeout(killTimer);
      }
      await testInfo.attach('server.log', { body: log, contentType: 'text/plain' });
      for (const name of ['resource-samples.jsonl', 'upstream-requests.jsonl']) {
        if (existsSync(join(dir, name))) await testInfo.attach(name, { path: join(dir, name), contentType: 'application/x-ndjson' });
      }
    }
  },
  context: async ({ browser, app }, use, testInfo) => {
    const cdp = await browser.newBrowserCDPSession();
    const { userAgent } = await cdp.send('Browser.getVersion');
    const { arguments: browserArguments } = await cdp.send('Browser.getBrowserCommandLine');
    const profile = browserArguments.find(argument => argument.startsWith('--user-data-dir='));
    expect(profile, 'Browser must have an isolated test profile').toBeDefined();
    ownedPath(runBase, profile.slice('--user-data-dir='.length));
    await testInfo.attach('browser-command-line.json', { body: JSON.stringify(browserArguments), contentType: 'application/json' });
    await cdp.detach();
    const ua = execFileSync(process.env.PYTHON ?? 'python', [join(testsRoot, 'support/browser-user-agent.py'), userAgent], { encoding: 'utf8' }).trim();
    const context = await browser.newContext({ userAgent: ua, viewport: testInfo.project.use.viewport,
      isMobile: testInfo.project.use.isMobile ?? false, hasTouch: testInfo.project.use.hasTouch ?? false,
      timezoneId: 'America/Toronto', locale: 'en-CA' });
    const unexpected = [];
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(app.url + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
      if (assetMap.has(url)) {
        const path = join(testsRoot, 'node_modules', assetMap.get(url));
        return route.fulfill({ path, headers: { 'access-control-allow-origin': '*' }, contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript' });
      }
      if (url === 'https://tiles.openfreemap.org/styles/bright') return route.fulfill({ json: localStyle, headers: { 'access-control-allow-origin': '*' } });
      if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '@font-face{font-family:Roboto;font-style:normal;font-weight:100 900;src:url(https://fixture.invalid/roboto.woff2)}' });
      if (url === 'https://fixture.invalid/roboto.woff2') return route.fulfill({ path: join(testsRoot, 'node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2'), contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
      if (url.startsWith('https://maps.gstatic.com/tactile/mylocation/')) return route.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png' });
      unexpected.push(url);
      await route.abort('blockedbyclient');
    });
    try { await use(context); }
    finally {
      await context.close();
      expect(unexpected, 'Unmapped external browser requests').toEqual([]);
    }
  },
  page: async ({ context, app, browserErrors }, use, testInfo) => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(fixture.fixedTime));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.goto(app.url);
    await expect(page.locator('#countdownHeading')).toContainText('Next update');
    try { await use(page); }
    finally {
      await testInfo.attach('browser-errors.json', { body: JSON.stringify({ exceptions: errors, console: browserErrors }, null, 2), contentType: 'application/json' });
      expect(errors, 'Uncaught browser exceptions').toEqual([]);
    }
  },
});
export { expect };
