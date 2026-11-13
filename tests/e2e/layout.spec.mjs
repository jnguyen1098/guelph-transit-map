import { test, expect } from '../support/fixture.mjs';

test('primary controls are clickable at the actual viewport size', async ({ page }, testInfo) => {
  await testInfo.attach('layout.json', { body: JSON.stringify(await page.evaluate(() => ({
    innerWidth, innerHeight, devicePixelRatio, clientWidth: document.documentElement.clientWidth,
    viewport: document.querySelector('meta[name=viewport]')?.content ?? null,
  }))), contentType: 'application/json' });
  for (const id of ['toggleStopsButton', 'toggleAlertsButton', 'aboutButton']) {
    // trial still performs hit testing and scrolling; no force-click hides overlap.
    await page.locator('#' + id).click({ trial: true, timeout: 3000 });
  }
  if (testInfo.project.name === 'mobile') {
    expect(await page.evaluate(() => innerWidth), 'Mobile CSS layout should match the configured 390px viewport').toBeLessThanOrEqual(400);
  }
});
