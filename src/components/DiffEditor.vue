<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { editor, IDisposable } from 'monaco-editor/editor/editor.api.js';
import { hasCollapsibleRegions, nextUnchangedCollapseState, type Side, type LineChange } from '../lib/diff-stats';
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
  ready: []; error: [];
}>();
const host = ref<HTMLElement>();
const loading = ref(true);
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

const child = (side: Side) => (side === 'a' ? diffEditor?.getOriginalEditor() : diffEditor?.getModifiedEditor());
function options(): editor.IDiffEditorOptions {
  const split = props.layout === 'split';
  return {
    renderSideBySide: split,
    readOnly: !split,
    originalEditable: split,
    wordWrap: props.wrap ? 'on' : 'off',
    diffWordWrap: props.wrap ? 'on' : 'off',
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
function syncOriginalWordWrap() {
  const original = child('a');
  if (!original || !monaco) return;
  // Monaco sets wordWrapOverride2='off' on the hidden original editor in inline mode
  // and never resets it back to 'inherit' when switching to side-by-side mode.
  const target = props.layout === 'split' ? 'inherit' : 'off';
  if (original.getOption(monaco.editor.EditorOption.wordWrapOverride2) !== target) {
    original.updateOptions({ wordWrapOverride2: target });
  }
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
  ([layout, wrap, collapse, ignoreWhitespace], [prevLayout, prevWrap, prevCollapse, prevIgnoreWhitespace]) => {
    if (!diffEditor) return;
    const changed: editor.IDiffEditorOptions = {};
    if (layout !== prevLayout) {
      const split = layout === 'split';
      changed.renderSideBySide = split;
      changed.readOnly = !split;
      changed.originalEditable = split;
    }
    if (wrap !== prevWrap) {
      changed.wordWrap = wrap ? 'on' : 'off';
      changed.diffWordWrap = wrap ? 'on' : 'off';
    }
    if (ignoreWhitespace !== prevIgnoreWhitespace) {
      diffPending = true;
      changed.ignoreTrimWhitespace = ignoreWhitespace;
    }
    if (collapse !== prevCollapse) {
      changed.hideUnchangedRegions = { ...UNCHANGED_REGIONS, enabled: collapse };
    }
    if (Object.keys(changed).length) {
      diffEditor.updateOptions(changed);
    }
    if (layout !== prevLayout) {
      child('b')?.updateOptions({ glyphMargin: layout === 'split' });
      syncOriginalWordWrap();
    }
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
      ...options(), automaticLayout: true,
      useInlineViewWhenSpaceIsLimited: false,
      enableSplitViewResizing: false, diffAlgorithm: 'advanced',
      glyphMargin: props.layout === 'split',
      renderIndicators: true, renderMarginRevertIcon: false, renderGutterMenu: false, renderOverviewRuler: true,
      lineNumbersMinChars: 4, lineDecorationsWidth: 16,
      scrollbar: {
        verticalScrollbarSize: 8, horizontalScrollbarSize: 8,
        verticalSliderSize: 6, horizontalSliderSize: 6,
        useShadows: false, ignoreHorizontalScrollbarInContentHeight: true,
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
      child(side)!.addCommand(monaco.KeyCode.F7, () => emit('jump', 1));
      child(side)!.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => emit('jump', -1));
      child(side)!.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => emit('jump', 1));
      child(side)!.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => emit('jump', -1));
    }
    subscriptions.push(child('a')!.onDidLayoutChange(syncOriginalWordWrap));
    subscriptions.push(diffEditor.onDidUpdateDiff(() => {
      diffPending = false;
      const changes = diffEditor!.getLineChanges() ?? [];
      const nextState = nextUnchangedCollapseState({
        collapse: props.collapse,
        changes,
        originalLineCount: models.a.getLineCount(),
        modifiedLineCount: models.b.getLineCount(),
        contextLineCount: UNCHANGED_REGIONS.contextLineCount,
        minimumLineCount: UNCHANGED_REGIONS.minimumLineCount,
        shouldCollapseNextDiff,
        hadCollapsibleRegions,
      });
      if (nextState.shouldCollapse) {
        collapseAllUnchanged();
      }
      shouldCollapseNextDiff = false;
      hadCollapsibleRegions = nextState.hadCollapsibleRegions;
      emit('diff', changes);
      highlight();
    }));
    diffEditor.setModel({ original: models.a, modified: models.b });
    updateLabels();
    syncOriginalWordWrap();
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
  subscriptions.forEach(s => s.dispose());
  diffEditor?.dispose();
  models?.a.dispose();
  models?.b.dispose();
});
</script>

<template>
  <div ref="host" class="monaco-host" :aria-busy="loading">
    <div v-if="loading" class="editor-skeleton" role="status">
      {{ placeholder }}
    </div>
  </div>
</template>
