import test from 'node:test';
import assert from 'node:assert/strict';
import * as targets from '../support/targets.mjs';
const { targetSettings } = targets;

test('current target exercises the checked-out application with all features', () => {
  assert.deepEqual(targetSettings('current'), { ref: 'HEAD', schedules: true });
});

test('CI rejects testing a different current commit while allowing explicit comparisons', () => {
  const trigger = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  assert.throws(() => targets.verifyTargetCommit('current', other, trigger), /does not match the triggering commit/);
  assert.doesNotThrow(() => targets.verifyTargetCommit('current', trigger, trigger));
  assert.doesNotThrow(() => targets.verifyTargetCommit('current', other, undefined));
  assert.doesNotThrow(() => targets.verifyTargetCommit('baseline', other, trigger));
});

test('baseline remains pinned to the pre-PR18 commit', () => {
  assert.equal(targetSettings('baseline').ref, 'e0183aac2428c7d92f9dcb35a09f46c304e86fda');
  assert.equal(targetSettings('baseline').schedules, false);
});
test('current main and PR18 both exercise schedule/search regressions', () => {
  assert.equal(targetSettings('main').schedules, true);
  assert.equal(targetSettings('pr18').schedules, true);
  assert.throws(() => targetSettings('unknown'), /Unknown target/);
});
