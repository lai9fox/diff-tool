<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type * as Monaco from 'monaco-editor';
import { diffStats } from '../lib/monaco/stats';
import { loadMonaco } from '../lib/monaco/setup';

type Side = 'original' | 'modified';
type Locale = 'zh' | 'en';
const strings = {
  zh: { settings: '设置', view: '对比视图', split: '左右对比', inline: '内联对比', wrap: '自动折行', collapse: '折叠相同内容', whitespace: '忽略行首尾空白', clear: '清空全部', undo: '撤销清空', original: '原文', modified: '修改后', open: '打开文件', copy: '复制全文', copied: '已复制', previous: '上一处差异', next: '下一处差异', waiting: '等待输入', comparing: '正在比较…', match: '内容一致', filtered: '当前比较规则下无差异', differences: '处差异', line: '行', column: '列', language: '语言模式', empty: '粘贴文本，或拖入文件', failed: '文件读取失败，请使用 UTF-8 文本文件。', copyFailed: '复制失败，请手动复制。', timeout: '比较未完成', retry: '重试', reload: '界面语言已切换。刷新后编辑器内部语言才会生效，刷新将清空正文。现在刷新吗？', loading: '正在加载编辑器…', drop: '松开以导入文件' },
  en: { settings: 'Settings', view: 'Diff view', split: 'Side by side', inline: 'Inline', wrap: 'Word wrap', collapse: 'Collapse unchanged', whitespace: 'Ignore outer whitespace', clear: 'Clear all', undo: 'Undo clear', original: 'Original', modified: 'Modified', open: 'Open file', copy: 'Copy all', copied: 'Copied', previous: 'Previous difference', next: 'Next difference', waiting: 'Waiting for input', comparing: 'Comparing…', match: 'Texts match', filtered: 'No differences with current rules', differences: 'differences', line: 'Ln', column: 'Col', language: 'Language mode', empty: 'Paste text or drop a file', failed: 'Could not read file. Use a UTF-8 text file.', copyFailed: 'Copy failed. Please copy manually.', timeout: 'Comparison incomplete', retry: 'Retry', reload: 'The interface language has changed. Reload to apply it inside the editor; your text will be lost. Reload now?', loading: 'Loading editor…', drop: 'Drop to open file' },
};
const locale = ref<Locale>('zh');
const theme = ref<'light' | 'dark'>('light');
const split = ref(true), wrap = ref(true), collapse = ref(true), whitespace = ref(false), sidebar = ref(true);
const language = ref('plaintext');
const host = ref<HTMLElement>();
const fileOriginal = ref<HTMLInputElement>(), fileModified = ref<HTMLInputElement>();
const ready = ref(false), busy = ref(true), timedOut = ref(false), drag = ref<Side | null>(null);
const contents = ref<Record<Side, string>>({ original: '', modified: '' });
const filenames = ref<Record<Side, string>>({ original: '', modified: '' });
const cleared = ref<{ filenames: Record<Side, string>; changed: Record<Side, boolean> } | null>(null);
const notice = ref('');
const copied = ref<Side | null>(null);
const count = ref(0), current = ref(0), line = ref(1), column = ref(1);
const stats = ref({ added: 0, modified: 0, deleted: 0 });
const t = computed(() => strings[locale.value]);
const empty = computed(() => !contents.value.original && !contents.value.modified);
const status = computed(() => (busy.value ? t.value.comparing : timedOut.value ? t.value.timeout : empty.value ? t.value.waiting : count.value ? `${ current.value } / ${ count.value } ${ t.value.differences }` : whitespace.value ? t.value.filtered : t.value.match));
let monaco: typeof Monaco;
let diff: Monaco.editor.IStandaloneDiffEditor | undefined;
let models: Record<Side, Monaco.editor.ITextModel>;
let changes: Monaco.editor.ILineChange[] = [];
let decorations: Record<Side, Monaco.editor.IEditorDecorationsCollection>;
let changingClear = false;
let disposables: Monaco.IDisposable[] = [];
let noticeTimer: ReturnType<typeof setTimeout>;
const languages = ['plaintext', 'javascript', 'typescript', 'json', 'html', 'css', 'scss', 'markdown', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'sql', 'xml', 'yaml', 'shell'];

function savePreferences() {
  try {
    localStorage.setItem('diff.preferences', JSON.stringify({ locale: locale.value, theme: theme.value, split: split.value, wrap: wrap.value, collapse: collapse.value, whitespace: whitespace.value }));
  } catch { /* Optional. */ }
}
function readPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem('diff.preferences') || '{}');
    if (p.locale === 'en') locale.value = 'en';
    if (p.theme === 'dark') theme.value = 'dark';
    if (typeof p.split === 'boolean') split.value = p.split;
    if (typeof p.wrap === 'boolean') wrap.value = p.wrap;
    if (typeof p.collapse === 'boolean') collapse.value = p.collapse;
    if (typeof p.whitespace === 'boolean') whitespace.value = p.whitespace;
  } catch { /* Optional. */ }
}
function flash(message: string) {
  notice.value = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 4000);
}
function setActive(index: number) {
  current.value = index;
  if (!decorations) return;
  for (const side of ['original', 'modified'] as const) {
    const change = changes[index - 1];
    if (!change) {
      decorations[side].clear(); continue;
    }
    const start = side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    const at = Math.max(1, Math.min(start, models[side].getLineCount()));
    decorations[side].set([{ range: new monaco.Range(at, 1, Math.max(at, end), 1), options: { isWholeLine: true, linesDecorationsClassName: 'active-diff-marker' } }]);
  }
}
function updateCursor(side: Side, position: Monaco.Position) {
  line.value = position.lineNumber; column.value = position.column;
  const index = changes.findIndex(c => {
    const start = side === 'original' ? c.originalStartLineNumber : c.modifiedStartLineNumber;
    const end = side === 'original' ? c.originalEndLineNumber : c.modifiedEndLineNumber;
    return position.lineNumber >= start && position.lineNumber <= Math.max(start, end);
  });
  if (index >= 0) setActive(index + 1);
}
function navigate(direction: 'next' | 'previous') {
  if (!diff || !count.value || busy.value || timedOut.value) return;
  diff.goToDiff(direction);
}
function replace(side: Side, text: string) {
  const model = models[side];
  model.pushStackElement();
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  model.pushStackElement();
}
function clearAll() {
  if (!diff || empty.value) return;
  cleared.value = { filenames: { ...filenames.value }, changed: { original: !!contents.value.original, modified: !!contents.value.modified } };
  changingClear = true;
  if (cleared.value.changed.original) replace('original', '');
  if (cleared.value.changed.modified) replace('modified', '');
  changingClear = false;
  filenames.value = { original: '', modified: '' };
}
function undoClear() {
  if (!cleared.value) return;
  changingClear = true;
  if (cleared.value.changed.original) void models.original.undo();
  if (cleared.value.changed.modified) void models.modified.undo();
  changingClear = false;
  filenames.value = cleared.value.filenames; cleared.value = null;
}
async function readFile(side: Side, file?: File) {
  if (!file || !diff) return;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    replace(side, text); filenames.value[side] = file.name; cleared.value = null;
  } catch {
    flash(t.value.failed);
  }
}
function onFile(side: Side, event: Event) {
  const input = event.target as HTMLInputElement;
  void readFile(side, input.files?.[0]); input.value = '';
}
function dropSide(event: DragEvent): Side {
  if (!host.value || !split.value || host.value.clientWidth < 700) return 'modified';
  return event.clientX < host.value.getBoundingClientRect().left + host.value.clientWidth / 2 ? 'original' : 'modified';
}
function onDrag(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault(); drag.value = dropSide(event);
  }
}
function onDrop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return; event.preventDefault(); event.stopPropagation(); void readFile(dropSide(event), event.dataTransfer.files[0]); drag.value = null;
}
async function copy(side: Side) {
  try {
    await navigator.clipboard.writeText(models[side].getValue()); copied.value = side; setTimeout(() => {
      copied.value = null;
    }, 1800);
  } catch {
    flash(t.value.copyFailed);
  }
}
function changeLocale() {
  locale.value = locale.value === 'zh' ? 'en' : 'zh'; savePreferences();
  flash(locale.value === 'zh' ? '编辑器内部文案暂为英文。' : 'Editor menus are currently available in English.');
}
function retry() {
  if (!diff) return; timedOut.value = false; busy.value = true; diff.updateOptions({ maxComputationTime: 0 });
}
watch([split, wrap, collapse, whitespace], (values, previous) => {
  savePreferences();
  if (!diff) return;
  if (values[3] !== previous[3]) {
    busy.value = true; timedOut.value = false;
  }
  diff.updateOptions({ renderSideBySide: split.value, diffWordWrap: wrap.value ? 'on' : 'off', wordWrap: wrap.value ? 'on' : 'off', ignoreTrimWhitespace: whitespace.value, hideUnchangedRegions: { enabled: collapse.value, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 } });
});
watch(theme, () => {
  document.documentElement.dataset.theme = theme.value; monaco?.editor.setTheme(theme.value === 'dark' ? 'vs-dark' : 'vs'); savePreferences();
});
watch(language, () => {
  if (models) for (const model of Object.values(models)) monaco.editor.setModelLanguage(model, language.value);
});
onMounted(async () => {
  readPreferences();
  if (window.matchMedia('(max-width: 700px)').matches) sidebar.value = false;
  try {
    monaco = await loadMonaco(locale.value);
    if (!host.value) return;
    models = { original: monaco.editor.createModel('', 'plaintext'), modified: monaco.editor.createModel('', 'plaintext') };
    for (const model of Object.values(models)) model.setEOL(monaco.editor.EndOfLineSequence.LF);
    diff = monaco.editor.createDiffEditor(host.value, { automaticLayout: true, originalEditable: true, renderSideBySide: split.value, useInlineViewWhenSpaceIsLimited: true, renderSideBySideInlineBreakpoint: 700, diffAlgorithm: 'advanced', diffWordWrap: wrap.value ? 'on' : 'off', wordWrap: wrap.value ? 'on' : 'off', ignoreTrimWhitespace: whitespace.value, hideUnchangedRegions: { enabled: collapse.value, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 }, maxComputationTime: 5000, minimap: { enabled: false }, scrollBeyondLastLine: false, theme: theme.value === 'dark' ? 'vs-dark' : 'vs', renderIndicators: true, renderMarginRevertIcon: false, renderGutterMenu: false });
    diff.setModel(models);
    const editors = { original: diff.getOriginalEditor(), modified: diff.getModifiedEditor() };
    decorations = { original: editors.original.createDecorationsCollection(), modified: editors.modified.createDecorationsCollection() };
    for (const side of ['original', 'modified'] as const) {
      editors[side].updateOptions({ ariaLabel: side === 'original' ? t.value.original : t.value.modified });
      disposables.push(models[side].onDidChangeContent(() => {
        contents.value[side] = models[side].getValue(); busy.value = true; timedOut.value = false; if (!changingClear) cleared.value = null;
      }));
      disposables.push(editors[side].onDidChangeCursorPosition(e => updateCursor(side, e.position)));
      for (const [key, direction] of [[monaco.KeyCode.F7, 'next'], [monaco.KeyMod.Shift | monaco.KeyCode.F7, 'previous'], [monaco.KeyMod.Alt | monaco.KeyCode.F5, 'next'], [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F5, 'previous']] as const) editors[side].addCommand(key, () => navigate(direction));
      editors[side].addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F7, () => diff?.accessibleDiffViewerNext());
      editors[side].addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.F7, () => diff?.accessibleDiffViewerPrev());
    }
    disposables.push(diff.onDidUpdateDiff(() => {
      const result = (diff as unknown as { getDiffComputationResult(): { quitEarly: boolean } | null }).getDiffComputationResult();
      const resultChanges = diff?.getLineChanges();
      if (!result || !resultChanges) return;
      changes = resultChanges; timedOut.value = result.quitEarly; busy.value = false;
      count.value = changes.length; stats.value = diffStats(changes, !models.original.getValue(), !models.modified.getValue());
      setActive(count.value ? Math.max(1, Math.min(current.value, count.value)) : 0);
    }));
    ready.value = true;
  } catch (error) {
    console.error('Failed to load editor', error); busy.value = false; flash(locale.value === 'zh' ? '编辑器加载失败，请刷新页面。' : 'Editor failed to load. Reload the page.');
  }
});
onBeforeUnmount(() => {
  clearTimeout(noticeTimer); disposables.forEach(d => d.dispose()); diff?.dispose(); if (models) Object.values(models).forEach(m => m.dispose());
});
</script>

<template>
  <div class="workbench">
    <div class="main">
      <aside v-if="sidebar" class="sidebar" :aria-label="t.settings">
        <div class="sidebar-heading">
          <strong>{{ t.settings }}</strong><button type="button" :aria-label="t.settings" @click="sidebar = false">
            ×
          </button>
        </div>
        <label class="setting-label">{{ t.view }}<select v-model="split"><option :value="true">{{ t.split }}</option><option :value="false">{{ t.inline }}</option></select></label>
        <label class="setting"><input v-model="wrap" type="checkbox"> {{ t.wrap }}</label>
        <label class="setting"><input v-model="collapse" type="checkbox"> {{ t.collapse }}</label>
        <label class="setting"><input v-model="whitespace" type="checkbox"> {{ t.whitespace }}</label>
        <button
          class="clear-button"
          type="button"
          :disabled="empty && !cleared"
          @click="cleared ? undoClear() : clearAll()"
        >
          {{ cleared ? t.undo : t.clear }}
        </button>
      </aside>
      <section class="editor-group">
        <header class="titlebar">
          <button
            type="button"
            class="icon-button"
            :title="t.settings"
            :aria-label="t.settings"
            @click="sidebar = !sidebar"
          >
            ☰
          </button>
          <div class="side-title">
            <span>{{ t.original }}<small v-if="filenames.original"> · {{ filenames.original }}</small></span><button
              type="button"
              :title="t.open"
              :aria-label="`${ t.open } ${ t.original }`"
              @click="fileOriginal?.click()"
            >
              ↥
            </button><button
              type="button"
              :title="t.copy"
              :aria-label="`${ t.copy } ${ t.original }`"
              @click="copy('original')"
            >
              {{ copied === 'original' ? '✓' : '⧉' }}
            </button>
          </div>
          <span class="separator">↔</span>
          <div class="side-title">
            <span>{{ t.modified }}<small v-if="filenames.modified"> · {{ filenames.modified }}</small></span><button
              type="button"
              :title="t.open"
              :aria-label="`${ t.open } ${ t.modified }`"
              @click="fileModified?.click()"
            >
              ↥
            </button><button
              type="button"
              :title="t.copy"
              :aria-label="`${ t.copy } ${ t.modified }`"
              @click="copy('modified')"
            >
              {{ copied === 'modified' ? '✓' : '⧉' }}
            </button>
          </div>
          <div class="title-actions">
            <button
              type="button"
              :title="t.previous"
              :aria-label="t.previous"
              :disabled="!count || busy || timedOut"
              @click="navigate('previous')"
            >
              ↑
            </button><button
              type="button"
              :title="t.next"
              :aria-label="t.next"
              :disabled="!count || busy || timedOut"
              @click="navigate('next')"
            >
              ↓
            </button><button type="button" :title="split ? t.inline : t.split" @click="split = !split">
              {{ split ? '◫' : '▤' }}
            </button><button type="button" :title="t.collapse" @click="collapse = !collapse">
              ⊟
            </button>
          </div>
          <input
            ref="fileOriginal"
            type="file"
            hidden
            @change="onFile('original', $event)"
          ><input
            ref="fileModified"
            type="file"
            hidden
            @change="onFile('modified', $event)"
          >
        </header>
        <div
          class="editor-container"
          @dragover.capture="onDrag"
          @dragleave.self="drag = null"
          @drop.capture="onDrop"
        >
          <div ref="host" class="editor-host" />
          <div v-if="!ready" class="loading">
            {{ t.loading }}
          </div>
          <template v-else>
            <div v-if="!contents.original && split" class="placeholder original-placeholder">
              {{ t.empty }}
            </div><div v-if="!contents.modified" class="placeholder modified-placeholder" :class="{ inline: !split }">
              {{ t.empty }}
            </div>
          </template>
          <div v-if="drag" class="drop-overlay" :class="drag">
            {{ t.drop }} · {{ drag === 'original' ? t.original : t.modified }}
          </div>
          <div v-if="notice" class="notice" role="alert">
            {{ notice }} <button type="button" @click="notice = ''">
              ×
            </button>
          </div>
        </div>
      </section>
    </div>
    <footer class="statusbar">
      <span aria-live="polite">{{ status }}</span><button v-if="timedOut" type="button" @click="retry">
        {{ t.retry }}
      </button><span v-if="!empty && !busy && !timedOut" class="statistics">+{{ stats.added }} ~{{ stats.modified }} −{{ stats.deleted }}</span><span class="status-spacer" /><span>{{ t.line }} {{ line }}, {{ t.column }} {{ column }}</span><label><span class="sr-only">{{ t.language }}</span><select v-model="language" :aria-label="t.language"><option v-for="item in languages" :key="item" :value="item">{{ item === 'plaintext' ? 'Plain Text' : item }}</option></select></label><button type="button" @click="changeLocale">
        {{ locale === 'zh' ? '中' : 'EN' }}
      </button><button type="button" :aria-label="theme === 'dark' ? 'Light mode' : 'Dark mode'" @click="theme = theme === 'dark' ? 'light' : 'dark'">
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>
    </footer>
  </div>
</template>
