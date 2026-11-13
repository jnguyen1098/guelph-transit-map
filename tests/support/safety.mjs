// Replay strategy adapted from review/server-probe.cjs; fail closed on new URLs.
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const marker = '.transit-test-owner';
export function createOwned(parent = tmpdir()) {
  const base = mkdtempSync(join(parent, 'transit-e2e-'));
  writeFileSync(join(base, marker), JSON.stringify({ base: realpathSync(base), token: randomUUID() }));
  return base;
}
export function ownedPath(base, name) {
  const path = resolve(base, name);
  const rel = relative(resolve(base), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Path outside owned base');
  return path;
}
export function disposeOwned(base) {
  let owner;
  try { owner = JSON.parse(readFileSync(join(base, marker), 'utf8')); }
  catch { throw Error('Missing test ownership marker'); }
  if (lstatSync(base).isSymbolicLink() || realpathSync(base) !== owner.base || !/^[a-f0-9-]{36}$/.test(owner.token)) {
    throw Error('Invalid test ownership marker');
  }
  rmSync(base, { recursive: true });
}
export function replayFetch(manifest, base) {
  return async function replay(input, options = {}) {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = options.method ?? input.method ?? 'GET';
    const signal = options.signal ?? input.signal;
    if (method !== 'GET' || !Object.hasOwn(manifest.requests, url)) throw Error(`Unmapped replay request: ${method} ${url}`);
    signal?.throwIfAborted();
    const entry = manifest.requests[url];
    const bytes = readFileSync(ownedPath(base, entry.file));
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`SHA mismatch: ${entry.file}`);
    return new Response(bytes, { status: entry.status ?? 200, headers: { 'content-type': entry.contentType ?? 'application/octet-stream' } });
  };
}
