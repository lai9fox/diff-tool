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
