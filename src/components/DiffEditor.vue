<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { editor, IDisposable } from 'monaco-editor/editor/editor.api.js';
import { hasCollapsibleRegions, type Side, type LineChange } from '../lib/diff-stats';
import type { Layout, Theme } from '../lib/preferences';
import { monacoTheme } from '../lib/monaco-theme';

type DiffEditorWithUnchangedRegions = editor.IStandaloneDiffEditor & {
  collapseAllUnchangedRegions?: () => void;
};

const UNCHANGED_REGIONS = { contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 } as const;

const props = defineProps<{
  layout: Layout; wrap: boolean; collapse: boolean; ignoreWhitespace: boolean;
  theme: Theme; placeholder: string; originalLabel: string; modifiedLabel: string; current: number;
}>();
const emit = defineEmits<{
  change: [side: Side, text: string]; diff: [changes: LineChange[]];
  cursor: [side: Side, lineNumber: number]; jump: [direction: number];
  splitLayout: [layout: { left: number; overview: number }];
  ready: []; error: [];
}>();
const MIN_SPLIT_PANE_WIDTH = 180;
const host = ref<HTMLElement>();
const loading = ref(true);
const isSideBySide = ref(false);
const splitLeft = ref(0);
const overviewWidth = ref(30);
const dragging = ref(false);
let monaco: typeof import('../lib/monaco').monaco;
let diffEditor: editor.IStandaloneDiffEditor | undefined;
let models: Record<Side, editor.ITextModel>;
let decorations: Record<Side, editor.IEditorDecorationsCollection>;
const subscriptions: IDisposable[] = [];
let disposed = false;
let navigating = false;
let diffPending = false;
let shouldCollapseNextDiff = false;
let hadCollapsibleRegions = false;
let splitRatio = 0.5;
let lastGlyphMargin: boolean | null = null;
let dragStartX = 0;
let dragStartLeft = 0;

const child = (side: Side) => (side === 'a' ? diffEditor?.getOriginalEditor() : diffEditor?.getModifiedEditor());
function clampSplitRatio(targetLeft: number, hostWidth: number, overview: number) {
  const contentWidth = hostWidth - overview;
  if (contentWidth <= 0) return 0.5;
  const minRatio = Math.max(0.1, MIN_SPLIT_PANE_WIDTH / contentWidth);
  const maxRatio = Math.min(0.9, (contentWidth - MIN_SPLIT_PANE_WIDTH) / contentWidth);
  if (minRatio >= maxRatio) return 0.5;
  return Math.min(maxRatio, Math.max(minRatio, targetLeft / contentWidth));
}
function options(): editor.IDiffEditorOptions {
  return {
    renderSideBySide: props.layout === 'split',
    splitViewDefaultRatio: splitRatio,
    wordWrap: props.wrap ? 'on' : 'off', diffWordWrap: props.wrap ? 'on' : 'off',
    ignoreTrimWhitespace: props.ignoreWhitespace,
    hideUnchangedRegions: { ...UNCHANGED_REGIONS, enabled: props.collapse },
  };
}
function collapseAllUnchanged() {
  if (!diffEditor || !props.collapse) return;
  const widget = diffEditor as DiffEditorWithUnchangedRegions;
  if (typeof widget.collapseAllUnchangedRegions === 'function') {
    widget.collapseAllUnchangedRegions();
  } else {
    diffEditor.updateOptions({ hideUnchangedRegions: { ...UNCHANGED_REGIONS, enabled: false } });
    diffEditor.updateOptions({ hideUnchangedRegions: { ...UNCHANGED_REGIONS, enabled: true } });
  }
}
function updateLabels() {
  child('a')?.updateOptions({ placeholder: props.placeholder, ariaLabel: props.originalLabel, wordBasedSuggestions: 'off' });
  child('b')?.updateOptions({ placeholder: props.placeholder, ariaLabel: props.modifiedLabel, wordBasedSuggestions: 'off' });
}
function applyTheme() {
  if (!monaco) return;
  monaco.editor.defineTheme('diff-workbench', monacoTheme(props.theme));
  monaco.editor.setTheme('diff-workbench');
}
function highlight() {
  const change = diffEditor?.getLineChanges()?.[props.current - 1];
  for (const side of ['a', 'b'] as const) {
    const start = change ? side === 'a' ? change.originalStartLineNumber : change.modifiedStartLineNumber : 0;
    const end = change ? side === 'a' ? change.originalEndLineNumber : change.modifiedEndLineNumber : 0;
    decorations?.[side].set(change ? [{
      range: new monaco.Range(Math.max(1, start), 1, end || Math.max(1, start), 1),
      options: { isWholeLine: true, marginClassName: 'diff-active-chunk', zIndex: 10 },
    }] : []);
  }
}
function emitSplitLayout() {
  if (!host.value || !diffEditor) return;
  const orig = child('a')?.getLayoutInfo();
  const mod = child('b')?.getLayoutInfo();
  if (!orig || !mod) return;
  const sideBySide = !!host.value.querySelector('.monaco-diff-editor.side-by-side');
  isSideBySide.value = sideBySide;
  if (lastGlyphMargin !== sideBySide) {
    lastGlyphMargin = sideBySide;
    child('b')?.updateOptions({ glyphMargin: sideBySide });
  }
  const hostWidth = host.value.clientWidth;
  if (sideBySide) {
    const rawOverview = Math.max(0, hostWidth - orig.width - mod.width);
    const overview = rawOverview <= 48 ? rawOverview : 30;
    const clamped = clampSplitRatio(splitRatio * (hostWidth - overview), hostWidth, overview);
    if (Math.abs(clamped - splitRatio) > 0.001) {
      splitRatio = clamped;
      diffEditor.updateOptions({ splitViewDefaultRatio: splitRatio });
      return;
    }
    splitLeft.value = orig.width;
    overviewWidth.value = overview;
    emit('splitLayout', { left: orig.width, overview });
  } else {
    const rawOverview = Math.max(0, hostWidth - mod.width);
    const overview = rawOverview <= 48 ? rawOverview : 30;
    splitLeft.value = 0;
    overviewWidth.value = overview;
    emit('splitLayout', { left: 0, overview });
  }
}
function startResize(event: PointerEvent) {
  if (event.button !== 0 || !host.value || !diffEditor || !isSideBySide.value) return;
  event.preventDefault();
  dragging.value = true;
  dragStartX = event.clientX;
  dragStartLeft = splitLeft.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  document.documentElement.classList.add('resizing-split');
}
function moveResize(event: PointerEvent) {
  if (!dragging.value || !host.value || !diffEditor) return;
  const hostWidth = host.value.clientWidth;
  const nextRatio = clampSplitRatio(dragStartLeft + (event.clientX - dragStartX), hostWidth, overviewWidth.value);
  if (Math.abs(nextRatio - splitRatio) > 0.0005) {
    splitRatio = nextRatio;
    diffEditor.updateOptions({ splitViewDefaultRatio: splitRatio });
  }
}
function endResize(event?: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  document.documentElement.classList.remove('resizing-split');
  if (event) {
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }
}
function resetResize() {
  if (!diffEditor || !isSideBySide.value) return;
  splitRatio = 0.5;
  diffEditor.updateOptions({ splitViewDefaultRatio: splitRatio });
}
function setText(side: Side, text: string) {
  const model = models?.[side];
  if (!model) return;
  if (model.getValue() !== text) shouldCollapseNextDiff = true;
  model.pushStackElement();
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  model.pushStackElement();
}
function goTo(index: number) {
  const change = diffEditor?.getLineChanges()?.[index];
  if (!change) return;
  navigating = true;
  for (const side of ['a', 'b'] as const) {
    const line = Math.min(models[side].getLineCount(), Math.max(1, side === 'a' ? change.originalStartLineNumber : change.modifiedStartLineNumber));
    child(side)?.setPosition({ lineNumber: line, column: 1 });
    child(side)?.revealLineInCenter(line);
  }
  navigating = false;
  child('b')?.focus();
}
defineExpose({ setText, goTo, focus: (side: Side) => child(side)?.focus() });
watch(
  () => [props.layout, props.wrap, props.collapse, props.ignoreWhitespace] as const,
  ([, , collapse, ignoreWhitespace], [, , prevCollapse, prevIgnoreWhitespace]) => {
    if (!diffEditor) return;
    if (ignoreWhitespace !== prevIgnoreWhitespace) {
      diffPending = true;
      shouldCollapseNextDiff = true;
    }
    diffEditor.updateOptions(options());
    if (collapse && !prevCollapse) {
      collapseAllUnchanged();
      shouldCollapseNextDiff = diffPending;
      hadCollapsibleRegions = !diffPending && hasCollapsibleRegions(
        diffEditor.getLineChanges() ?? [],
        models.a.getLineCount(),
        models.b.getLineCount(),
        UNCHANGED_REGIONS.contextLineCount,
        UNCHANGED_REGIONS.minimumLineCount,
      );
    } else if (!collapse) {
      shouldCollapseNextDiff = false;
      hadCollapsibleRegions = false;
    }
    requestAnimationFrame(emitSplitLayout);
  },
);
watch(() => [props.placeholder, props.originalLabel, props.modifiedLabel], updateLabels);
watch(() => props.theme, applyTheme, { flush: 'post' });
watch(() => props.current, highlight);

onMounted(async () => {
  try {
    ({ monaco } = await import('../lib/monaco'));
    if (disposed || !host.value) return;
    applyTheme();
    diffEditor = monaco.editor.createDiffEditor(host.value, {
      ...options(), automaticLayout: true, originalEditable: true,
      useInlineViewWhenSpaceIsLimited: true, renderSideBySideInlineBreakpoint: 820,
      enableSplitViewResizing: false, splitViewDefaultRatio: splitRatio, diffAlgorithm: 'advanced',
      glyphMargin: props.layout === 'split',
      renderIndicators: true, renderMarginRevertIcon: false, renderGutterMenu: false, renderOverviewRuler: true,
      lineNumbersMinChars: 4, lineDecorationsWidth: 16,
      scrollbar: {
        verticalScrollbarSize: 8, horizontalScrollbarSize: 8,
        verticalSliderSize: 6, horizontalSliderSize: 6,
        useShadows: false,
      },
      minimap: { enabled: false }, fontFamily: '\'JetBrains Mono\', \'PingFang SC\', \'Microsoft YaHei\', monospace',
      fontSize: 14, lineHeight: 22, padding: { top: 8, bottom: 8 }, scrollBeyondLastLine: false,
      renderLineHighlightOnlyWhenFocus: true,
      quickSuggestions: false, suggestOnTriggerCharacters: false,
      hover: { enabled: 'off' }, parameterHints: { enabled: false }, codeLens: false,
      occurrencesHighlight: 'off', selectionHighlight: false, links: false, contextmenu: false,
      unicodeHighlight: { ambiguousCharacters: false }, dropIntoEditor: { enabled: false },
    });
    models = { a: monaco.editor.createModel('', 'plaintext'), b: monaco.editor.createModel('', 'plaintext') };
    decorations = { a: child('a')!.createDecorationsCollection(), b: child('b')!.createDecorationsCollection() };
    for (const side of ['a', 'b'] as const) {
      subscriptions.push(models[side].onDidChangeContent(() => {
        diffPending = true;
        emit('change', side, models[side].getValue());
      }));
      subscriptions.push(child(side)!.onDidChangeCursorPosition(e => {
        if (!navigating) emit('cursor', side, e.position.lineNumber);
      }));
      subscriptions.push(child(side)!.onDidLayoutChange(emitSplitLayout));
      child(side)!.addCommand(monaco.KeyCode.F7, () => emit('jump', 1));
      child(side)!.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => emit('jump', -1));
      child(side)!.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => emit('jump', 1));
      child(side)!.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => emit('jump', -1));
    }
    subscriptions.push(diffEditor.onDidUpdateDiff(() => {
      diffPending = false;
      const changes = diffEditor!.getLineChanges() ?? [];
      const hasCollapsible = hasCollapsibleRegions(
        changes,
        models.a.getLineCount(),
        models.b.getLineCount(),
        UNCHANGED_REGIONS.contextLineCount,
        UNCHANGED_REGIONS.minimumLineCount,
      );
      if (props.collapse && hasCollapsible && (shouldCollapseNextDiff || !hadCollapsibleRegions)) {
        collapseAllUnchanged();
      }
      shouldCollapseNextDiff = false;
      hadCollapsibleRegions = props.collapse && hasCollapsible;
      emit('diff', changes);
      highlight();
    }));
    diffEditor.setModel({ original: models.a, modified: models.b });
    updateLabels();
    emitSplitLayout();
    loading.value = false;
    emit('ready');
    await document.fonts.ready;
    if (!disposed) monaco.editor.remeasureFonts();
  } catch {
    if (!disposed) emit('error');
  }
});
onBeforeUnmount(() => {
  disposed = true;
  endResize();
  subscriptions.forEach(s => s.dispose());
  diffEditor?.dispose();
  models?.a.dispose();
  models?.b.dispose();
});
</script>

<template>
  <div class="diff-editor-shell">
    <div ref="host" class="monaco-host" :aria-busy="loading">
      <div v-if="loading" class="editor-skeleton" role="status">
        {{ placeholder }}
      </div>
    </div>
    <div
      v-if="isSideBySide && splitLeft > 0"
      class="split-sash"
      :class="{ dragging }"
      :style="{ left: `${ splitLeft }px` }"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startResize"
      @pointermove="moveResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      @dblclick="resetResize"
    />
  </div>
</template>
