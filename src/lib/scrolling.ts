import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars';
import { type EditorView, ViewPlugin } from '@codemirror/view';

const scrollbars: PartialOptions['scrollbars'] = {
  theme: 'os-theme-workbench',
  autoHide: 'scroll',
  autoHideDelay: 700,
  dragScroll: true,
  clickScroll: 'instant',
};

export function pageScrollbars() {
  return OverlayScrollbars(document.body, {
    overflow: { x: 'hidden', y: 'scroll' },
    scrollbars,
  });
}

export function drawerScrollbars(target: HTMLElement) {
  return OverlayScrollbars({ target, elements: { viewport: target } }, {
    overflow: { x: 'hidden', y: 'scroll' },
    scrollbars,
  });
}

// Reuse CodeMirror's viewport without wrapping or moving its managed content.
export const editorScrollbars = ViewPlugin.define(view => {
  const instance = OverlayScrollbars({
    target: view.dom,
    elements: { viewport: view.scrollDOM },
  }, {
    overflow: { x: 'scroll', y: 'scroll' },
    scrollbars,
  });
  // Merge alignment adds blank spacer rows even to an empty document.
  // Keep its input hint and caret at the top when that blank area is clicked.
  const keepEmptyAtTop = () => {
    if (!view.state.doc.length) view.scrollDOM.scrollTop = 0;
  };
  view.scrollDOM.addEventListener('scroll', keepEmptyAtTop);
  return {
    update: keepEmptyAtTop,
    destroy() {
      view.scrollDOM.removeEventListener('scroll', keepEmptyAtTop);
      instance.destroy();
    },
  };
});

// MergeView inserts alignment spacers, so equal vertical offsets keep rows paired.
export function syncEditorScroll(a: EditorView, b: EditorView) {
  const positions = new Map<EditorView, number>();
  const sync = (source: EditorView, target: EditorView) => {
    const top = source.scrollDOM.scrollTop;
    if (positions.get(source) === top) return;
    positions.set(source, top);
    if (!source.state.doc.length || !target.state.doc.length) return;
    target.scrollDOM.scrollTop = top;
    // Ignore the resulting scroll event, including offsets clamped at the end.
    positions.set(target, target.scrollDOM.scrollTop);
  };
  const fromA = () => sync(a, b);
  const fromB = () => sync(b, a);
  a.scrollDOM.addEventListener('scroll', fromA);
  b.scrollDOM.addEventListener('scroll', fromB);
  return () => {
    a.scrollDOM.removeEventListener('scroll', fromA);
    b.scrollDOM.removeEventListener('scroll', fromB);
  };
}
