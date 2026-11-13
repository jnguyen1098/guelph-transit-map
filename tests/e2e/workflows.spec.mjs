import { test, expect } from '../support/fixture.mjs';

test('page starts without browser console errors', async ({ page, browserErrors }) => {
  await expect(page.locator('.busMarker')).not.toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('routes, stops, alerts and About work through visible controls', async ({ page }) => {
  const route = page.locator('#routeToggleButtonsDiv button').filter({ hasText: /^99 - North$/ });
  await expect(page.locator('.busMarker')).not.toHaveCount(0);
  await route.click();
  await expect(route).toHaveClass(/selected/);
  await expect(page.locator('.leaflet-overlay-pane path')).not.toHaveCount(0);
  await page.locator('#toggleStopsButton').click();
  await expect(page.locator('img.leaflet-marker-icon')).not.toHaveCount(0);
  await page.locator('#toggleAlertsButton').click();
  await expect(page.locator('#alertsDiv')).toBeVisible();
  await expect(page.locator('#alertsDiv')).toContainText('Stop');
  await page.locator('#alertsCloseButton').click();
  await expect(page.locator('#alertsDiv')).toBeHidden();
  await page.locator('#aboutButton').click();
  await expect(page.locator('#aboutDialog')).toBeVisible();
  await page.locator('#aboutDialogClose').click();
  await expect(page.locator('#aboutDialog')).toBeHidden();
});

test('repeated route/stop toggles keep map layers bounded after initialization', async ({ page }, testInfo) => {
  const layers = () => page.evaluate(() => Object.keys(map._layers).length);
  const counts = [];
  const route = page.locator('#routeToggleButtonsDiv button').filter({ hasText: /^99 - North$/ });
  for (let index = 0; index < 12; index++) {
    await route.click();
    await expect(route).toHaveClass(/selected/);
    await page.locator('#toggleStopsButton').click();
    await expect(page.locator('img.leaflet-marker-icon')).not.toHaveCount(0);
    await page.locator('#toggleStopsButton').click();
    await route.click();
    await expect(route).not.toHaveClass(/selected/);
    // Leaflet creates and retains its shared SVG renderer on the first route.
    // Compare identical warm states; a one-time renderer is not a growing leak.
    await expect(page.locator('.busMarker')).toHaveCount(3);
    counts.push(await layers());
  }
  await testInfo.attach('layer-counts.json', { body: JSON.stringify(counts), contentType: 'application/json' });
  expect(new Set(counts).size, 'Layer count after each identical completed cycle').toBe(1);
});

test.describe('PR18', () => {
test.skip(process.env.TRANSIT_HAS_SCHEDULES !== 'true', 'These features are absent from the fixed pre-PR18 baseline');
test('exact stop search opens and closes an arrival card', async ({ page }) => {
  await page.locator('#stopSearchInput').fill('103');
  const first = page.locator('.stopSearchResult').first();
  await expect(first).toContainText('Gordon at Kortright');
  await first.click();
  await expect(page.locator('#infoCardTitle')).toContainText('Gordon at Kortright');
  await expect(page.locator('#infoCardBody')).not.toHaveText('Loading...');
  await expect(page.locator('img.selectedStop')).toHaveCount(1);
  await page.locator('#infoCardCloseButton').click();
  await expect(page.locator('#infoCard')).toBeHidden();
  await expect(page.locator('img.selectedStop')).toHaveCount(0);
});

test('visible bus marker opens real trip predictions', async ({ page }) => {
  // Select a marker a person can hit, rather than firing Leaflet events internally.
  const markers = page.locator('.busMarker');
  let hit = false;
  for (let index = 0; index < await markers.count(); index++) {
    const marker = markers.nth(index);
    if (await marker.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })) { await marker.click(); hit = true; break; }
  }
  expect(hit, 'At least one bus must be reachable on the map').toBe(true);
  await expect(page.locator('#infoCardBody')).not.toHaveText('Loading...');
  await expect(page.locator('#infoCardBody')).toContainText('Next');
});

test('displays a prediction service error and allows closing the card', async ({ page }) => {
  await page.route('**/stop-arrivals?*', route => route.fulfill({ status: 502, json: [] }));
  await page.locator('#stopSearchInput').fill('103');
  await page.locator('.stopSearchResult').first().click();
  await expect(page.locator('#infoCardBody')).toContainText('Arrival times are unavailable right now');
  await page.locator('#infoCardCloseButton').click();
  await expect(page.locator('#infoCard')).toBeHidden();
});

test('closing a card while its request is pending does not reopen it', async ({ page }) => {
  let release, sawRequest;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { sawRequest = resolve; });
  await page.route('**/stop-arrivals?*', async route => {
    sawRequest();
    await gate;
    await route.continue();
  });
  try {
    await page.locator('#stopSearchInput').fill('103');
    await page.locator('.stopSearchResult').first().click();
    await requested;
    await expect(page.locator('#infoCardBody')).toHaveText('Loading...');
    await page.locator('#infoCardCloseButton').click();
    const completed = page.waitForResponse(response => response.url().includes('/stop-arrivals?'));
    release();
    await completed;
    await expect(page.locator('#infoCard')).toBeHidden();
    await expect(page.locator('img.selectedStop')).toHaveCount(0);
  } finally { release(); }
});

test('repeated searched-stop cards remove their standalone map markers', async ({ page }, testInfo) => {
  const counts = [];
  for (let cycle = 0; cycle < 12; cycle++) {
    await page.locator('#stopSearchInput').fill('103');
    await page.locator('.stopSearchResult').first().click();
    await expect(page.locator('#infoCardBody')).not.toHaveText('Loading...');
    await expect(page.locator('img.selectedStop')).toHaveCount(1);
    await page.locator('#infoCardCloseButton').click();
    await expect(page.locator('img.selectedStop')).toHaveCount(0);
    counts.push(await page.evaluate(() => Object.keys(map._layers).length));
  }
  await testInfo.attach('card-layer-counts.json', { body: JSON.stringify(counts), contentType: 'application/json' });
  expect(new Set(counts).size).toBe(1);
});

test.describe('upstream prediction failure', () => {
  test.use({ predictionStatus: 503 });
  test('real Express endpoint maps a feed outage to HTTP 502', async ({ request, app }) => {
    const response = await request.get(app.url + '/stop-arrivals?stopId=103');
    expect(response.status()).toBe(502);
    expect(await response.json()).toEqual([]);
  });
});
});
