import test from 'node:test';
import assert from 'node:assert/strict';
import { targetSettings } from '../support/targets.mjs';

test('baseline remains pinned to the pre-PR18 commit', () => {
  assert.equal(targetSettings('baseline').ref, 'e0183aac2428c7d92f9dcb35a09f46c304e86fda');
  assert.equal(targetSettings('baseline').schedules, false);
});
test('current main and PR18 both exercise schedule/search regressions', () => {
  assert.equal(targetSettings('main').schedules, true);
  assert.equal(targetSettings('pr18').schedules, true);
  assert.throws(() => targetSettings('unknown'), /Unknown target/);
});
