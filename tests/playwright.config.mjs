import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
if (!process.env.TRANSIT_TEST_BASE) throw Error('Run with node tests/run.mjs check main (or pr18)');
export default defineConfig({
  testDir: './e2e', timeout: 45000, expect: { timeout: 10000 }, workers: 1,
  fullyParallel: false, retries: 0, forbidOnly: true,
  outputDir: join(process.env.TRANSIT_TEST_BASE, 'artifacts/results'),
  reporter: [['list'], ['json', { outputFile: join(process.env.TRANSIT_TEST_BASE, 'artifacts/results.json') }],
    ['html', { outputFolder: join(process.env.TRANSIT_TEST_BASE, 'artifacts/html'), open: 'never' }]],
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--enable-automation'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'short-desktop', use: { viewport: { width: 1000, height: 500 } }, testMatch: '**/layout.spec.mjs' },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, testMatch: '**/layout.spec.mjs' },
  ],
});
