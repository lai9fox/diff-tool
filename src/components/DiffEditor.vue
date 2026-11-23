<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { editor, IDisposable } from 'monaco-editor/editor/editor.api.js';
import type { Side, LineChange } from '../lib/diff-stats';
import type { Layout, Theme } from '../lib/preferences';
import { monacoTheme } from '../lib/monaco-theme';

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
const host = ref<HTMLElement>();
const loading = ref(true);
let monaco: typeof import('../lib/monaco').monaco;
let diffEditor: editor.IStandaloneDiffEditor | undefined;
let models: Record<Side, editor.ITextModel>;
let decorations: Record<Side, editor.IEditorDecorationsCollection>;
const subscriptions: IDisposable[] = [];
let disposed = false;
let navigating = false;

const child = (side: Side) => (side === 'a' ? diffEditor?.getOriginalEditor() : diffEditor?.getModifiedEditor());
function options(): editor.IDiffEditorOptions {
  return {
    renderSideBySide: props.layout === 'split',
    wordWrap: props.wrap ? 'on' : 'off', diffWordWrap: props.wrap ? 'on' : 'off',
    ignoreTrimWhitespace: props.ignoreWhitespace,
    hideUnchangedRegions: { enabled: props.collapse, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
  };
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
  const hostWidth = host.value.clientWidth;
  if (sideBySide) {
    const overview = Math.max(0, hostWidth - orig.width - mod.width);
    emit('splitLayout', { left: orig.width, overview: overview <= 48 ? overview : 30 });
  } else {
    const overview = Math.max(0, hostWidth - mod.width);
    emit('splitLayout', { left: 0, overview: overview <= 48 ? overview : 30 });
  }
}
function setText(side: Side, text: string) {
  const model = models?.[side];
  if (!model) return;
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
watch(() => [props.layout, props.wrap, props.collapse, props.ignoreWhitespace], () => {
  diffEditor?.updateOptions(options());
  requestAnimationFrame(emitSplitLayout);
});
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
      enableSplitViewResizing: true, splitViewDefaultRatio: 0.5, diffAlgorithm: 'advanced',
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
      subscriptions.push(models[side].onDidChangeContent(() => emit('change', side, models[side].getValue())));
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
      emit('diff', diffEditor!.getLineChanges() ?? []);
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
