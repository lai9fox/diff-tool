import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars';
import { EditorView, ViewPlugin } from '@codemirror/view';

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
    overflow: { x: 'scroll', y: 'visible' },
    scrollbars,
  });
  return { destroy: () => instance.destroy() };
});

// Account for the sticky header when CodeMirror reveals a cursor or a diff.
export const pageScrollIntoView = EditorView.scrollHandler.of((view, range, options) => {
  if (!view.dom.getClientRects().length) return false;
  // Handlers run during CodeMirror's write phase. Read coordinates in its
  // next measurement phase, then perform both scrolls together.
  view.requestMeasure({
    key: pageScrollIntoView,
    read() {
      const rect = view.coordsAtPos(Math.min(range.head, view.state.doc.length));
      if (!rect) return null;
      const header = view.dom.closest('.workspace')?.querySelector('.pane-headers, .readonly-bar');
      const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0) + options.yMargin;
      const bottom = (window.visualViewport?.height ?? window.innerHeight) - options.yMargin;
      let y = 0;
      if (options.y === 'center') y = (rect.top + rect.bottom - top - bottom) / 2;
      else if (options.y === 'start') y = rect.top - top;
      else if (options.y === 'end') y = rect.bottom - bottom;
      else if (rect.top < top) y = rect.top - top;
      else if (rect.bottom > bottom) y = rect.bottom - bottom;

      const viewport = view.scrollDOM.getBoundingClientRect();
      const gutters = view.dom.querySelector('.cm-gutters')?.getBoundingClientRect().right ?? viewport.left;
      const left = Math.max(viewport.left, gutters) + options.xMargin;
      const right = viewport.right - options.xMargin;
      let x = 0;
      if (options.x === 'center') x = (rect.left + rect.right - left - right) / 2;
      else if (options.x === 'start') x = rect.left - left;
      else if (options.x === 'end') x = rect.right - right;
      else if (rect.left < left) x = rect.left - left;
      else if (rect.right > right) x = rect.right - right;
      return { x, y };
    },
    write(delta) {
      if (!delta) return;
      if (delta.y) window.scrollBy({ top: delta.y, behavior: 'instant' });
      if (delta.x) view.scrollDOM.scrollLeft += delta.x;
    },
  });
  return true;
});
