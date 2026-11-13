// Optional production check. Anonymous headless context; no personal browser state.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwned, disposeOwned } from './support/safety.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const base = createOwned(root);
Object.assign(process.env, { TMPDIR: base, TEMP: base, TMP: base });
const artifacts = join(base, 'artifacts');
mkdirSync(artifacts);
const started = new Date().toISOString();
const observations = [], errors = [], pending = new Set();
let browser, context, failure, sequence = 0;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const cdp = await browser.newBrowserCDPSession();
  const { userAgent } = await cdp.send('Browser.getVersion');
  await cdp.detach();
  const ua = execFileSync(process.env.PYTHON ?? 'python', [join(root, 'support/browser-user-agent.py'), userAgent], { encoding: 'utf8' }).trim();
  context = await browser.newContext({ userAgent: ua, viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Toronto', locale: 'en-CA' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const capture = async response => {
    const index = sequence++;
    const row = { ts: new Date().toISOString(), url: response.url(), status: response.status() };
    if (new URL(response.url()).origin !== 'https://guelph-transit-map.ca') {
      observations.push({ ...row, disposition: 'skipped_out_of_scope', reason: 'External map/CDN bodies remain in Playwright trace; structured corpus retains app-origin responses only' });
      return;
    }
    try {
      const bytes = await response.body();
      const file = `app-response-${index}.bin`;
      writeFileSync(join(artifacts, file), bytes);
      observations.push({ ...row, disposition: 'captured', file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      observations.push({ ...row, disposition: 'observed_no_body', loss: 'unreadable_response', error: String(error) });
    }
  };
  context.on('response', response => {
    const task = capture(response);
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  context.on('requestfailed', request => observations.push({ ts: new Date().toISOString(), disposition: 'failed', url: request.url(), error: request.failure()?.errorText }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('https://guelph-transit-map.ca/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('#countdownHeading')).toContainText('Next update', { timeout: 45000 });
  await expect(page.locator('#routeToggleButtonsDiv button')).not.toHaveCount(0);
  await page.locator('#aboutButton').click();
  await expect(page.locator('#aboutDialog')).toBeVisible();
  await page.locator('#aboutDialogClose').click();
  await expect(page.locator('#aboutDialog')).toBeHidden();
  await page.screenshot({ path: join(artifacts, 'production.png') });
} catch (error) { failure = String(error); }
finally {
  try {
    if (context) {
      await context.tracing.stop({ path: join(artifacts, 'trace.zip') });
      context.removeAllListeners('response');
      context.removeAllListeners('requestfailed');
      await context.close();
      // Closing bounds body reads for any request that never completed.
      // Aborted unreadable bodies are recorded as loss, never silently omitted.
      await Promise.allSettled([...pending]);
    }
    await browser?.close();
    writeFileSync(join(artifacts, 'observations.json'), JSON.stringify({ tool: 'transit-production-browser', scope: 'One driven page load and About round trip; app-origin response bodies retained, external responses enumerated; no exhaustive coverage claim', started, ended: new Date().toISOString(), observations }, null, 2));
    writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ functionalFailure: failure ?? null, consoleErrors: errors, observations: observations.length }, null, 2));
    execFileSync(process.env.PYTHON ?? 'python', [join(root, 'support/write-manifest.py'), artifacts]);
    const evidence = join(dirname(root), 'review/evidence', `production-browser-${started.replace(/[:.]/g, '-')}`);
    cpSync(artifacts, evidence, { recursive: true });
    console.log(`Evidence: ${evidence}`);
    console.log(JSON.stringify({ functionalFailure: failure ?? null, consoleErrors: errors }, null, 2));
  } finally { await browser?.close(); disposeOwned(base); }
}
process.exitCode = failure || errors.length ? 1 : 0;
