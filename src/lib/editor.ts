import { type Chunk } from '@codemirror/merge';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

export { diffConfig } from './diff.ts';

const activeDiffLine = Decoration.line({ class: 'cm-active-diff-chunk' });
export const setActiveChunkEffect = StateEffect.define<DecorationSet>();

export const activeChunkField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setActiveChunkEffect)) {
        return effect.value;
      }
    }
    return deco.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});

export function buildActiveChunkDecoration(view: EditorView, chunk?: Chunk, isSideA?: boolean): DecorationSet {
  if (!chunk) return Decoration.none;
  const from = isSideA ? chunk.fromA : chunk.fromB;
  const to = isSideA ? chunk.endA : chunk.endB;
  const doc = view.state.doc;
  const startLine = doc.lineAt(Math.min(from, doc.length));
  const endLine = doc.lineAt(Math.min(to, doc.length));
  const builder: ReturnType<typeof activeDiffLine.range>[] = [];
  for (let l = startLine.number; l <= endLine.number; l++) {
    const line = doc.line(l);
    builder.push(activeDiffLine.range(line.from));
  }
  return Decoration.set(builder);
}

export function editorTheme(dark: boolean) {
  return [
    EditorView.theme({
      '&': { backgroundColor: 'var(--panel)', color: 'var(--text)', fontSize: '14px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': { fontFamily: 'var(--font-code)', padding: '20px 0', caretColor: 'var(--accent)', minHeight: '100%' },
      '.cm-line': { padding: '0 16px 0 12px', lineHeight: '22px' },
      '.cm-placeholder': { color: 'var(--secondary)', fontFamily: 'var(--font-ui)', fontSize: '13px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '22px' },
      '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none', paddingTop: '0' },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 10px 0 8px' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-activeLineGutter': { color: 'var(--muted)', backgroundColor: 'transparent' },
      '&.cm-focused .cm-activeLine': { backgroundColor: 'var(--active-line)' },
      '&.cm-focused .cm-activeLineGutter': { color: 'var(--text)', backgroundColor: 'var(--active-line)' },

      // Diff styling for split and unified
      '&.cm-merge-a .cm-changedLine, .cm-deletedChunk, .cm-deletedLine': { backgroundColor: 'var(--remove-bg)' },
      '&.cm-merge-b .cm-changedLine, .cm-insertedLine': { backgroundColor: 'var(--add-bg)' },
      '.cm-changedLine': { backgroundColor: 'var(--add-bg)' },
      '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { backgroundColor: 'var(--remove-mark)', backgroundImage: 'none' },
      '&.cm-merge-b .cm-changedText, .cm-changedText': { backgroundColor: 'var(--add-mark)', backgroundImage: 'none' },

      '.cm-deletedChunk': { padding: '0 16px 0 12px', fontFamily: 'var(--font-code)' },
      '.cm-deletedLine': { lineHeight: '22px' },
      '.cm-collapsedLines': { margin: '6px 0', padding: '7px 12px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: '12px', cursor: 'pointer', transition: 'background-color 0.15s, color 0.15s' },
      '.cm-collapsedLines:hover': { color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' },
      '.cm-changeGutter': { width: '18px' },
      '.cm-changedLineGutter, .cm-deletedLineGutter, .cm-inlineChangedLineGutter': { backgroundColor: 'transparent !important', color: 'var(--add)', textAlign: 'center', width: '18px', fontWeight: '600' },
      '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { color: 'var(--remove)' },
      '.cm-changedLineGutter::before, .cm-insertedLineGutter::before': { content: '"+"' },
      '&.cm-merge-a .cm-changedLineGutter::before, .cm-deletedLineGutter::before': { content: '"−"' },

      // Active diff chunk indicator
      '.cm-active-diff-chunk': { boxShadow: 'inset 3.5px 0 0 var(--accent)' },
    }, { dark }),
  ];
}

export const accessibleCollapse = ViewPlugin.fromClass(class {
  observer: MutationObserver;
  constructor(view: EditorView) {
    const enhance = () => {
      view.dom.querySelectorAll<HTMLElement>('.cm-collapsedLines:not([role])').forEach(element => {
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            element.click();
          }
        });
      });
    };
    this.observer = new MutationObserver(enhance);
    this.observer.observe(view.dom, { childList: true, subtree: true });
    queueMicrotask(enhance);
  }
  destroy() {
    this.observer.disconnect();
  }
});
