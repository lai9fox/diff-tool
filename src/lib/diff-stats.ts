import type { editor } from 'monaco-editor/editor/editor.api.js';

export type Side = 'a' | 'b';
export type LineChange = editor.ILineChange;

export function lineStats(changes: LineChange[]) {
  let added = 0;
  let deleted = 0;
  for (const c of changes) {
    if (c.originalEndLineNumber > 0) deleted += c.originalEndLineNumber - c.originalStartLineNumber + 1;
    if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
  }
  return { added, deleted };
}

export function findChunkIndex(changes: LineChange[], side: Side, lineNumber: number) {
  return changes.findIndex(c => {
    const start = side === 'a' ? c.originalStartLineNumber : c.modifiedStartLineNumber;
    const end = side === 'a' ? c.originalEndLineNumber : c.modifiedEndLineNumber;
    // An empty range is anchored after this line (0 means before the first line).
    return end === 0 ? lineNumber === Math.max(1, start) : lineNumber >= start && lineNumber <= end;
  });
}

export function hasCollapsibleRegions(
  changes: LineChange[],
  originalLineCount: number,
  modifiedLineCount: number,
  contextLineCount: number,
  minimumLineCount: number,
) {
  if (!changes.length) return false;
  let prevOrigEnd = 0;
  let prevModEnd = 0;
  const edgeThreshold = contextLineCount + minimumLineCount;
  const middleThreshold = contextLineCount * 2 + minimumLineCount;
  for (const c of changes) {
    const origStart = prevOrigEnd + 1;
    const modStart = prevModEnd + 1;
    const origGapEnd = c.originalEndLineNumber === 0 ? c.originalStartLineNumber : c.originalStartLineNumber - 1;
    const modGapEnd = c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber : c.modifiedStartLineNumber - 1;
    const length = Math.min(origGapEnd - origStart + 1, modGapEnd - modStart + 1);
    const atStart = origStart === 1 && modStart === 1;
    if (length >= (atStart ? edgeThreshold : middleThreshold)) return true;
    prevOrigEnd = c.originalEndLineNumber === 0 ? c.originalStartLineNumber : c.originalEndLineNumber;
    prevModEnd = c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber : c.modifiedEndLineNumber;
  }
  const origStart = prevOrigEnd + 1;
  const modStart = prevModEnd + 1;
  const tailLength = Math.min(originalLineCount - prevOrigEnd, modifiedLineCount - prevModEnd);
  return origStart + tailLength === originalLineCount + 1
    && modStart + tailLength === modifiedLineCount + 1
    && tailLength >= edgeThreshold;
}

export function nextUnchangedCollapseState(options: {
  collapse: boolean;
  changes: LineChange[];
  originalLineCount: number;
  modifiedLineCount: number;
  contextLineCount: number;
  minimumLineCount: number;
  shouldCollapseNextDiff: boolean;
  hadCollapsibleRegions: boolean;
}) {
  const hasCollapsible = hasCollapsibleRegions(
    options.changes,
    options.originalLineCount,
    options.modifiedLineCount,
    options.contextLineCount,
    options.minimumLineCount,
  );
  const shouldCollapse = options.collapse && hasCollapsible && (options.shouldCollapseNextDiff || !options.hadCollapsibleRegions);
  const preservesUnchangedState = options.hadCollapsibleRegions
    && !options.changes.length
    && options.originalLineCount === options.modifiedLineCount
    && options.originalLineCount >= options.contextLineCount + options.minimumLineCount;
  return {
    shouldCollapse,
    hadCollapsibleRegions: options.collapse && (hasCollapsible || preservesUnchangedState),
  };
}
