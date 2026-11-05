import test from 'node:test';
import assert from 'node:assert/strict';
import { diffStats } from '../src/lib/monaco/stats.ts';

const change = (originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber) => ({
  originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber,
});

test('line statistics pair modified lines and count remaining additions and deletions', () => {
  assert.deepEqual(diffStats([change(2, 3, 2, 4), change(7, 8, 8, 0), change(10, 0, 10, 10)]), { added: 2, modified: 2, deleted: 2 });
  assert.deepEqual(diffStats([]), { added: 0, modified: 0, deleted: 0 });
});

test('empty models count as zero lines', () => {
  assert.deepEqual(diffStats([change(1, 1, 1, 3)], true, false), { added: 3, modified: 0, deleted: 0 });
  assert.deepEqual(diffStats([change(1, 2, 1, 1)], false, true), { added: 0, modified: 0, deleted: 2 });
});
