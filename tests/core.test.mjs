import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineStats, findChunkIndex, hasCollapsibleRegions, nextUnchangedCollapseState } from '../src/lib/diff-stats.ts';
import {
  nextSpaceLimited,
  parsePreferences,
  resolveEffectiveLayout,
  SIDEBAR_DRAWER_BREAKPOINT,
  SPLIT_MIN_WIDTH_ENTER,
  SPLIT_MIN_WIDTH_EXIT,
} from '../src/lib/preferences.ts';
import { normalizeColor } from '../src/lib/monaco-theme.ts';

const change = (a, endA, b, endB) => ({ originalStartLineNumber: a, originalEndLineNumber: endA, modifiedStartLineNumber: b, modifiedEndLineNumber: endB });

test('line statistics count insertions, deletions, replacements and mixed chunks', () => {
  assert.deepEqual(lineStats([]), { added: 0, deleted: 0 });
  assert.deepEqual(lineStats([change(0, 0, 1, 2)]), { added: 2, deleted: 0 });
  assert.deepEqual(lineStats([change(1, 3, 0, 0)]), { added: 0, deleted: 3 });
  assert.deepEqual(lineStats([change(2, 2, 2, 2)]), { added: 1, deleted: 1 });
  assert.deepEqual(lineStats([change(2, 3, 2, 4), change(7, 0, 8, 9), change(10, 11, 10, 0)]), { added: 5, deleted: 4 });
});

test('cursor lookup covers both sides, outside ranges and empty-range anchors', () => {
  const changes = [change(2, 4, 2, 3), change(8, 10, 7, 0), change(12, 0, 9, 11)];
  assert.equal(findChunkIndex(changes, 'a', 3), 0);
  assert.equal(findChunkIndex(changes, 'b', 3), 0);
  assert.equal(findChunkIndex(changes, 'a', 5), -1);
  assert.equal(findChunkIndex(changes, 'b', 7), 1);
  assert.equal(findChunkIndex(changes, 'b', 8), -1);
  assert.equal(findChunkIndex(changes, 'a', 12), 2);
  assert.equal(findChunkIndex([change(1, 2, 0, 0)], 'b', 1), 0);
  assert.equal(findChunkIndex([], 'a', 1), -1);
});

test('preferences follow system defaults until explicitly selected', () => {
  const defaults = parsePreferences(null, 'zh-CN', true);
  assert.equal(defaults.locale, 'zh');
  assert.equal(defaults.theme, 'dark');
  assert.equal(defaults.explicitLocale, false);
  assert.equal(defaults.explicitTheme, false);
  assert.equal(defaults.wrap, true);
  assert.equal(defaults.collapse, true);
  assert.equal(parsePreferences(null, 'fr', false).locale, 'en');
  for (const raw of ['null', '[]', '{broken']) assert.equal(parsePreferences(raw, 'en', false).theme, 'light');
});

test('legacy comparison methods are ignored and other preferences survive', () => {
  const p = parsePreferences(JSON.stringify({ comparisonMethod: 'word', locale: 'en', theme: 'light', layout: 'unified', wrap: false, collapse: false, displayGroupOpen: true }), 'zh', true);
  assert.equal('comparisonMethod' in p, false);
  assert.equal(p.layout, 'inline');
  assert.equal(p.locale, 'en');
  assert.equal(p.theme, 'light');
  assert.equal(p.explicitTheme, true);
  assert.equal(p.explicitLocale, true);
  assert.equal(p.wrap, false);
  assert.equal(p.collapse, false);
});

test('theme colors expand short hex values, keep alpha hex values, and fall back for invalid values', () => {
  assert.equal(normalizeColor('#fff'), '#ffffff');
  assert.equal(normalizeColor(' #aBc '), '#aabbcc');
  assert.equal(normalizeColor('#2a4f'), '#22aa44ff');
  assert.equal(normalizeColor('#A1B2C3'), '#a1b2c3');
  assert.equal(normalizeColor('#2DA44E29'), '#2da44e29');
  assert.equal(normalizeColor('no-color', '#123456'), '#123456');
  assert.equal(normalizeColor(''), '#000000');
});

test('collapsible region detection matches Monaco edge and middle thresholds', () => {
  assert.equal(hasCollapsibleRegions([], 50, 50, 3, 4), false);
  assert.equal(hasCollapsibleRegions([change(1, 1, 1, 1)], 7, 7, 3, 4), false);
  assert.equal(hasCollapsibleRegions([change(1, 1, 1, 1)], 8, 8, 3, 4), true);
  assert.equal(hasCollapsibleRegions([change(8, 8, 8, 8)], 8, 8, 3, 4), true);
  assert.equal(hasCollapsibleRegions([change(1, 1, 1, 1), change(11, 11, 11, 11)], 11, 11, 3, 4), false);
  assert.equal(hasCollapsibleRegions([change(1, 1, 1, 1), change(12, 12, 12, 12)], 12, 12, 3, 4), true);
  assert.equal(hasCollapsibleRegions([change(0, 0, 1, 2), change(9, 9, 11, 11)], 9, 11, 3, 4), false);
  assert.equal(hasCollapsibleRegions([change(1, 2, 0, 0)], 9, 7, 3, 4), true);
});

test('unchanged collapse state preserves manual expansions across diff updates while collapsing initial regions', () => {
  const base = {
    collapse: true,
    originalLineCount: 40,
    modifiedLineCount: 40,
    contextLineCount: 3,
    minimumLineCount: 4,
  };
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, changes: [change(1, 1, 1, 1)], shouldCollapseNextDiff: false, hadCollapsibleRegions: false }),
    { shouldCollapse: true, hadCollapsibleRegions: true },
  );
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, changes: [change(1, 1, 1, 1)], shouldCollapseNextDiff: false, hadCollapsibleRegions: true }),
    { shouldCollapse: false, hadCollapsibleRegions: true },
  );
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, changes: [], shouldCollapseNextDiff: false, hadCollapsibleRegions: true }),
    { shouldCollapse: false, hadCollapsibleRegions: true },
  );
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, changes: [], shouldCollapseNextDiff: false, hadCollapsibleRegions: false }),
    { shouldCollapse: false, hadCollapsibleRegions: false },
  );
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, changes: [change(1, 1, 1, 1)], shouldCollapseNextDiff: true, hadCollapsibleRegions: true }),
    { shouldCollapse: true, hadCollapsibleRegions: true },
  );
  assert.deepEqual(
    nextUnchangedCollapseState({ ...base, originalLineCount: 1, modifiedLineCount: 1, changes: [], shouldCollapseNextDiff: false, hadCollapsibleRegions: true }),
    { shouldCollapse: false, hadCollapsibleRegions: false },
  );
});

test('responsive layout enters and exits auto-inline with hysteresis while preserving preferred layout', () => {
  assert.equal(nextSpaceLimited(0, false), false);
  assert.equal(nextSpaceLimited(0, true), true);
  assert.equal(nextSpaceLimited(SPLIT_MIN_WIDTH_ENTER, false), false);
  assert.equal(nextSpaceLimited(SPLIT_MIN_WIDTH_ENTER - 1, false), true);
  assert.equal(nextSpaceLimited(SPLIT_MIN_WIDTH_EXIT - 1, true), true);
  assert.equal(nextSpaceLimited(SPLIT_MIN_WIDTH_EXIT, true), false);

  assert.equal(resolveEffectiveLayout('split', false), 'split');
  assert.equal(resolveEffectiveLayout('split', true), 'inline');
  assert.equal(resolveEffectiveLayout('inline', false), 'inline');
  assert.equal(resolveEffectiveLayout('inline', true), 'inline');

  // Desktop workspace right above the drawer breakpoint still fits side-by-side (220px sidebar + 48px shell chrome + 2px border).
  assert.equal(nextSpaceLimited(SIDEBAR_DRAWER_BREAKPOINT + 1 - 270, false), false);
});
