import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedPath, disposeOwned, createOwned, replayFetch } from '../support/safety.mjs';

test('cleanup refuses an unrelated directory and missing ownership marker', () => {
  const base=mkdtempSync(join(tmpdir(),'transit-guard-unit-'));
  try {assert.throws(()=>disposeOwned(base),/ownership/);assert.ok(existsSync(base));}
  finally {rmSync(base,{recursive:true,force:true});}
});
test('owned paths reject traversal and cleanup removes only the owned temporary base', () => {
  const base=createOwned();
  try {assert.throws(()=>ownedPath(base,'../escape'),/outside/);writeFileSync(ownedPath(base,'log.txt'),'test');}
  finally {disposeOwned(base);}
  assert.equal(existsSync(base),false);
});
test('replay fails closed and validates response byte integrity', async () => {
  const base=createOwned();
  try {
    writeFileSync(ownedPath(base,'feed.bin'),'abc');
    const replay=replayFetch({requests:{'https://fixture.invalid/feed':{file:'feed.bin',sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}}},base);
    assert.equal(await(await replay('https://fixture.invalid/feed')).text(),'abc');
    await assert.rejects(()=>replay('https://unexpected.invalid/'),/Unmapped/);
    await assert.rejects(()=>replay('https://fixture.invalid/feed',{method:'POST'}),/Unmapped/);
    const abort = new AbortController();abort.abort();
    await assert.rejects(()=>replay('https://fixture.invalid/feed',{signal:abort.signal}), {name:'AbortError'});
    writeFileSync(ownedPath(base,'feed.bin'),'changed');await assert.rejects(()=>replay('https://fixture.invalid/feed'),/SHA/);
  } finally {disposeOwned(base);}
});
