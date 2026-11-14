import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwned, disposeOwned } from './support/safety.mjs';
import { createHash } from 'node:crypto';
import { targetSettings, verifyTargetCommit } from './support/targets.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = dirname(root);
const [command = 'check', target = 'current', frequency = 'once'] = process.argv.slice(2);
if (!['once', 'repeatedly'].includes(frequency)) throw Error('Frequency must be once or repeatedly');
function prepare() {
  const { ref, schedules } = targetSettings(target);
  const sha = execFileSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' }).trim();
  verifyTargetCommit(target, sha, process.env.GITHUB_SHA);
  // Windows Python must never read Codex intermediates from AppData/Temp.
  const base = createOwned(root);
  Object.assign(process.env, { TMPDIR: base, TEMP: base, TMP: base });
  try {
    mkdirSync(join(base, 'app'));
    mkdirSync(join(base, 'artifacts'));
    const archive = execFileSync('git', ['archive', sha, 'app.js', 'package.json', 'package-lock.json', 'gtfs-realtime.proto', 'public'], { cwd: repo });
    writeFileSync(join(base, 'source.tar'), archive);
    execFileSync('tar', ['-xf', join(base, 'source.tar'), '-C', join(base, 'app')]);
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: join(base, 'app'), env: { ...process.env, npm_config_cache: join(base, 'npm-cache') }, encoding: 'utf8', shell: process.platform === 'win32',
    });
    writeFileSync(join(base, 'artifacts/npm-install.log'), result.stdout + result.stderr);
    if (result.status !== 0) throw Error(`App dependency install failed: ${result.stderr}`);
    const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(join(base, 'artifacts/target.json'), JSON.stringify({ target, ref, sha, schedules, ciTriggerSha: process.env.GITHUB_SHA ?? null, node: process.version, platform: process.platform,
      fixture: '2026-11-04 bounded derivative', fixtureSha256: hash(join(root, 'fixtures/transit.json')), toolingLockSha256: hash(join(root, 'package-lock.json')) }, null, 2));
    process.env.TRANSIT_TEST_BASE = base;
    process.env.TRANSIT_TARGET = target;
    process.env.TRANSIT_HAS_SCHEDULES = String(schedules);
    console.log(`Prepared ${target} ${sha} at ${base}`);
    return base;
  } catch (error) { disposeOwned(base); throw error; }
}
function exercise() {
  if (!process.env.TRANSIT_TEST_BASE) throw Error('Missing prepared temporary base');
  const base = process.env.TRANSIT_TEST_BASE;
  Object.assign(process.env, { TMPDIR: base, TEMP: base, TMP: base });
  const result = spawnSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(root, 'playwright.config.mjs'),
    ...(frequency === 'repeatedly' ? ['--repeat-each', '3'] : [])], {
    cwd: repo, env: process.env, stdio: 'inherit',
  });
  return result.status ?? 1;
}
if (command === 'refresh') {
  execFileSync('git', ['fetch', '--no-tags', 'https://github.com/BenFort/guelph-transit-map.git', '+refs/heads/main:refs/remotes/origin/main', '+refs/pull/18/head:refs/remotes/origin/pr/18'], { cwd: repo, stdio: 'inherit' });
} else if (command === 'setup') {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw Error('Test tooling install failed');
  execFileSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'install', 'chromium'], { stdio: 'inherit' });
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'refresh'], { stdio: 'inherit' });
} else if (command === 'prepare') {
  if (!process.env.GITHUB_ENV) throw Error('prepare is for CI; locally use check');
  const base = prepare();
  appendFileSync(process.env.GITHUB_ENV, `TRANSIT_TEST_BASE=${base}\nTRANSIT_TARGET=${target}\nTRANSIT_HAS_SCHEDULES=${process.env.TRANSIT_HAS_SCHEDULES}\n`);
} else if (command === 'exercise') {
  process.exitCode = exercise();
} else if (command === 'cleanup') {
  if (process.env.TRANSIT_TEST_BASE) disposeOwned(process.env.TRANSIT_TEST_BASE);
} else if (command === 'check') {
  const base = prepare();
  try {
    process.exitCode = exercise();
    const evidence = resolve(repo, 'review/evidence', `e2e-${target}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    cpSync(join(base, 'artifacts'), evidence, { recursive: true });
    console.log(`Evidence: ${evidence}`);
  } finally { disposeOwned(base); }
} else throw Error('Use setup, refresh, check current, check baseline, check main, check pr18, prepare current, exercise, or cleanup');
