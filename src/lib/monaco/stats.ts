import type { editor } from 'monaco-editor';

export function diffStats(changes: readonly editor.ILineChange[], originalEmpty = false, modifiedEmpty = false) {
  const stats = { added: 0, modified: 0, deleted: 0 };
  for (const change of changes) {
    const removed = originalEmpty || change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1;
    const inserted = modifiedEmpty || change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
    const paired = Math.min(removed, inserted);
    stats.modified += paired;
    stats.added += inserted - paired;
    stats.deleted += removed - paired;
  }
  return stats;
}
