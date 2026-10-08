<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, Columns2, Copy, FileInput,
  FileText, Languages, LockKeyhole, Minus, Monitor, Moon, Plus, Rows2, Sun,
  WrapText, X, AlertCircle, ChevronsDownUp, Trash2, Undo2,
} from '@lucide/vue';
import { messages, type Locale, type MessageKey } from '../lib/i18n';
import {
  accessibleCollapse, activeChunkField, buildActiveChunkDecoration,
  diffConfig, editorTheme, setActiveChunkEffect,
} from '../lib/editor';
import '@fontsource/jetbrains-mono/400.css';

type Side = 'a' | 'b';
type Theme = 'system' | 'light' | 'dark';

const locale = ref<Locale>('zh');
const theme = ref<Theme>('system');
const systemDark = ref(false);
const dark = computed(() => theme.value === 'dark' || (theme.value === 'system' && systemDark.value));
const layout = ref<'split' | 'unified'>('split');
const wrap = ref(true);
const collapse = ref(true);
const ignoreWhitespace = ref(false);

const texts = ref({ a: '', b: '' });
const filenames = ref({ a: '', b: '' });
const cleared = ref<{ texts: Record<Side, string>; filenames: Record<Side, string> } | null>(null);

const count = ref(0);
const current = ref(0);
const busy = ref(false);
const copied = ref<Side | null>(null);
const notice = ref<MessageKey | null>(null);
const dragSide = ref<Side | null>(null);

const splitHost = ref<HTMLElement>();
const unifiedHost = ref<HTMLElement>();
const fileA = ref<HTMLInputElement>();
const fileB = ref<HTMLInputElement>();

let merge: MergeView | undefined;
let unified: EditorView | undefined;
let refreshTimer: ReturnType<typeof setTimeout>;
let copiedTimer: ReturnType<typeof setTimeout>;
let media: MediaQueryList;
let resizeObserver: ResizeObserver | undefined;

const slots = { a: new Compartment(), b: new Compartment() };

const t = (key: MessageKey) => messages[locale.value][key];
const isEmpty = computed(() => !texts.value.a && !texts.value.b);
const status = computed(() => {
  if (isEmpty.value) return t(cleared.value ? 'cleared' : 'waiting');
  if (busy.value) return t('comparing');
  if (count.value) return `${ count.value } ${ t('differences') }`;
  return ignoreWhitespace.value ? t('filteredMatch') : t('match');
});

const sideLabel = (side: Side) => t(side === 'a' ? 'original' : 'modified');
const textLines = (side: Side) => (texts.value[side] ? texts.value[side].split('\n').length : 0);
const lineCountLabel = (side: Side) =>
  `${ textLines(side).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en') } ${ t(
    locale.value === 'en' && textLines(side) === 1 ? 'line' : 'lines',
  ) }`;

function preferences() {
  try {
    localStorage.setItem(
      'diff.preferences',
      JSON.stringify({
        locale: locale.value,
        theme: theme.value,
        layout: layout.value,
        wrap: wrap.value,
        collapse: collapse.value,
      }),
    );
  } catch {
    /* Preferences storage is purely optional. */
  }
}

function visualExtensions(side: Side): Extension[] {
  return [
    editorTheme(dark.value),
    accessibleCollapse,
    wrap.value ? EditorView.lineWrapping : [],
    EditorState.phrases.of({ '$ unchanged lines': t('unchanged') }),
    EditorView.contentAttributes.of({ 'aria-label': sideLabel(side), spellcheck: 'false' }),
  ];
}

function updateActiveChunkHighlight() {
  if (!count.value || !current.value) {
    if (merge) {
      merge.a.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(merge.a)) });
      merge.b.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(merge.b)) });
    }
    if (unified) {
      unified.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(unified)) });
    }
    return;
  }
  const chunk = merge?.chunks[current.value - 1];
  if (!chunk) return;
  if (merge) {
    merge.a.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(merge.a, chunk, true)) });
    merge.b.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(merge.b, chunk, false)) });
  }
  if (unified) {
    unified.dispatch({ effects: setActiveChunkEffect.of(buildActiveChunkDecoration(unified, chunk, false)) });
  }
}

function queueRefresh() {
  busy.value = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    count.value = merge?.chunks.length || 0;
    current.value = count.value ? Math.max(1, Math.min(current.value, count.value)) : 0;
    busy.value = false;
    updateActiveChunkHighlight();
    if (layout.value === 'unified') buildUnified();
  }, 120);
}

function makeExtensions(side: Side, oldState?: EditorState): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    ...(oldState ? [historyField.init(() => oldState.field(historyField))] : []),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    slots[side].of(visualExtensions(side)),
    activeChunkField,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        cleared.value = null;
        texts.value[side] = update.state.doc.toString();
        queueMicrotask(queueRefresh);
      }
      if (update.selectionSet && merge?.chunks.length) {
        const head = update.state.selection.main.head;
        const chunkIndex = merge.chunks.findIndex((c) =>
          (side === 'a' ? head >= c.fromA && head <= c.endA : head >= c.fromB && head <= c.endB),
        );
        if (chunkIndex !== -1 && current.value !== chunkIndex + 1) {
          current.value = chunkIndex + 1;
          updateActiveChunkHighlight();
        }
      }
    }),
  ];
}

function buildSplit() {
  if (!splitHost.value) return;
  const oldA = merge?.a.state;
  const oldB = merge?.b.state;
  const scroll = merge?.dom.scrollTop || 0;
  merge?.destroy();
  merge = new MergeView({
    a: { doc: texts.value.a, selection: oldA?.selection, extensions: makeExtensions('a', oldA) },
    b: { doc: texts.value.b, selection: oldB?.selection, extensions: makeExtensions('b', oldB) },
    parent: splitHost.value,
    gutter: true,
    highlightChanges: true,
    diffConfig: diffConfig(ignoreWhitespace.value),
    collapseUnchanged: collapse.value ? { margin: 3, minSize: 4 } : undefined,
  });
  merge.dom.scrollTop = scroll;
  queueRefresh();
}

function buildUnified() {
  if (!unifiedHost.value || !merge) return;
  const scroll = unified?.scrollDOM.scrollTop || 0;
  unified?.destroy();
  unified = new EditorView({
    parent: unifiedHost.value,
    doc: texts.value.b,
    extensions: [
      lineNumbers(),
      drawSelection(),
      ...visualExtensions('b'),
      activeChunkField,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      Prec.high(
        EditorView.contentAttributes.of({
          'aria-label': `${ t('unified') } — ${ t('readonly') }`,
          'aria-readonly': 'true',
        }),
      ),
      unifiedMergeView({
        original: texts.value.a,
        mergeControls: false,
        gutter: true,
        diffConfig: diffConfig(ignoreWhitespace.value),
        collapseUnchanged: collapse.value ? { margin: 3, minSize: 4 } : undefined,
      }),
    ],
  });
  unified.scrollDOM.scrollTop = scroll;
  updateActiveChunkHighlight();
}

function replaceText(side: Side, text: string) {
  const view = merge?.[side];
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: isolateHistory.of('full'),
  });
}

function clearAll() {
  if (isEmpty.value || !merge) return;
  const snapshot = { texts: { ...texts.value }, filenames: { ...filenames.value } };
  clearTimeout(copiedTimer);
  notice.value = null;
  copied.value = null;
  filenames.value = { a: '', b: '' };
  replaceText('a', '');
  replaceText('b', '');
  count.value = current.value = 0;
  merge.dom.scrollTop = 0;
  if (unified) unified.scrollDOM.scrollTop = 0;
  // Snapshot saved after editor transactions invalidate previous snapshots
  cleared.value = snapshot;
}

function undoClear() {
  const snapshot = cleared.value;
  if (!snapshot) return;
  cleared.value = null;
  filenames.value = { ...snapshot.filenames };
  replaceText('a', snapshot.texts.a);
  replaceText('b', snapshot.texts.b);
}

function jump(direction: number) {
  if (!merge || !count.value) return;
  current.value = ((current.value - 1 + direction + count.value) % count.value) + 1;
  const chunk = merge.chunks[current.value - 1];
  if (!chunk) return;
  updateActiveChunkHighlight();

  if (layout.value === 'unified' && unified) {
    const pos = Math.min(chunk.fromB, unified.state.doc.length);
    unified.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  } else {
    for (const side of ['a', 'b'] as Side[]) {
      const view = merge[side];
      const pos = Math.min(side === 'a' ? chunk.fromA : chunk.fromB, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }
}

async function copy(side: Side) {
  try {
    await navigator.clipboard.writeText(texts.value[side]);
    copied.value = side;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), 1800);
  } catch {
    notice.value = 'copyError';
  }
}

function openFile(side: Side) {
  (side === 'a' ? fileA.value : fileB.value)?.click();
}

async function readFile(side: Side, file?: File) {
  if (!file) return;
  try {
    const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (contents.includes('\0')) throw new Error('Binary file');
    cleared.value = null;
    filenames.value[side] = file.name;
    replaceText(side, contents);
  } catch {
    notice.value = side === 'a' ? 'fileErrorA' : 'fileErrorB';
  }
}

function picked(side: Side, event: Event) {
  const input = event.target as HTMLInputElement;
  readFile(side, input.files?.[0]);
  input.value = '';
}

function dragover(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dragSide.value = event.clientX < box.x + box.width / 2 ? 'a' : 'b';
}

function dropped(event: DragEvent) {
  if (!dragSide.value) return;
  event.preventDefault();
  event.stopPropagation();
  readFile(dragSide.value, event.dataTransfer?.files[0]);
  dragSide.value = null;
}

function focusSide(side: Side) {
  merge?.[side].focus();
}

function switchToSplitAndFocus() {
  layout.value = 'split';
  nextTick(() => merge?.a.focus());
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F7') {
    e.preventDefault();
    jump(1);
  } else if ((e.altKey && e.key === 'ArrowUp') || (e.shiftKey && e.key === 'F7')) {
    e.preventDefault();
    jump(-1);
  }
}

function preventWindowDrop(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
  }
}

watch([locale, theme, wrap, collapse, layout], preferences);
watch([dark, locale, wrap], () => {
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
  document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en';
  document.title = `Diff — ${ t('app') }`;
  for (const side of ['a', 'b'] as Side[]) {
    merge?.[side].dispatch({ effects: slots[side].reconfigure(visualExtensions(side)) });
  }
  merge?.reconfigure({ collapseUnchanged: collapse.value ? { margin: 3, minSize: 4 } : undefined });
  if (layout.value === 'unified') buildUnified();
});

watch(collapse, () => {
  merge?.reconfigure({ collapseUnchanged: collapse.value ? { margin: 3, minSize: 4 } : undefined });
  if (layout.value === 'unified') buildUnified();
});

watch(ignoreWhitespace, () => {
  buildSplit();
  if (layout.value === 'unified') buildUnified();
});

watch(layout, async (value) => {
  await nextTick();
  if (value === 'unified') {
    buildUnified();
  } else {
    unified?.destroy();
    unified = undefined;
    merge?.a.requestMeasure();
    merge?.b.requestMeasure();
  }
});

function systemChanged(event: MediaQueryListEvent) {
  systemDark.value = event.matches;
}

onMounted(async () => {
  media = matchMedia('(prefers-color-scheme: dark)');
  systemDark.value = media.matches;
  media.addEventListener('change', systemChanged);
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('dragover', preventWindowDrop);
  window.addEventListener('drop', preventWindowDrop);

  try {
    const p = JSON.parse(localStorage.getItem('diff.preferences') || '{}');
    if (p.locale === 'zh' || p.locale === 'en') locale.value = p.locale;
    if (['system', 'light', 'dark'].includes(p.theme)) theme.value = p.theme;
    if (p.layout === 'split' || p.layout === 'unified') layout.value = p.layout;
    if (typeof p.wrap === 'boolean') wrap.value = p.wrap;
    if (typeof p.collapse === 'boolean') collapse.value = p.collapse;
  } catch {}

  await nextTick();
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
  buildSplit();
  if (layout.value === 'unified') buildUnified();

  if (splitHost.value) {
    resizeObserver = new ResizeObserver(() => {
      (merge as unknown as { scheduleMeasure?: () => void })?.scheduleMeasure?.();
    });
    resizeObserver.observe(splitHost.value);
  }
});

onBeforeUnmount(() => {
  merge?.destroy();
  unified?.destroy();
  media?.removeEventListener('change', systemChanged);
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('dragover', preventWindowDrop);
  window.removeEventListener('drop', preventWindowDrop);
  resizeObserver?.disconnect();
  clearTimeout(refreshTimer);
  clearTimeout(copiedTimer);
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="Diff">
        <svg
          class="brand-symbol"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path class="icon-add" d="M12 3v14M5 10h14" />
          <path class="icon-remove" d="M5 21h14" />
        </svg>
        <h1>Diff<span class="brand-period">.</span></h1>
      </div>

      <div class="layout-switch" role="group" :aria-label="t('layout')">
        <button
          :class="{ selected: layout === 'split' }"
          :aria-pressed="layout === 'split'"
          @click="layout = 'split'"
        >
          <Columns2 :size="15" />{{ t('split') }}
        </button>
        <button
          :class="{ selected: layout === 'unified' }"
          :aria-pressed="layout === 'unified'"
          @click="layout = 'unified'"
        >
          <Rows2 :size="15" />{{ t('unified') }}
        </button>
      </div>

      <div class="diff-navigation">
        <span class="nav-label" :class="{ 'has-diff': count && !busy }" aria-live="polite">
          <template v-if="count && !busy">
            <strong>{{ current }}</strong><span class="nav-slash">/</span>{{ count
            }}<span class="nav-word">{{ t('differences') }}</span>
          </template>
          <template v-else>
            <span class="status-dot" :class="{ success: !isEmpty && !busy }" />{{ status }}
          </template>
        </span>
        <div class="nav-buttons">
          <button
            class="icon-button"
            :disabled="!count || busy"
            :aria-label="t('previous')"
            :title="t('previous')"
            @click="jump(-1)"
          >
            <ArrowUp :size="16" />
          </button>
          <button
            class="icon-button"
            :disabled="!count || busy"
            :aria-label="t('next')"
            :title="t('next')"
            @click="jump(1)"
          >
            <ArrowDown :size="16" />
          </button>
        </div>
      </div>

      <div class="preferences">
        <label class="select-control">
          <Languages :size="15" />
          <select v-model="locale" :aria-label="t('language')">
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
          <ChevronDown :size="12" />
        </label>
        <label class="select-control">
          <component :is="theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun" :size="15" />
          <select v-model="theme" :aria-label="t('theme')">
            <option value="system">{{ t('system') }}</option>
            <option value="light">{{ t('light') }}</option>
            <option value="dark">{{ t('dark') }}</option>
          </select>
          <ChevronDown :size="12" />
        </label>
      </div>
    </header>

    <section class="workspace" :aria-label="t('app')">
      <div class="toolbar">
        <div class="options">
          <label class="option">
            <input v-model="wrap" type="checkbox">
            <WrapText :size="15" />
            <span>{{ t('wrap') }}</span>
          </label>
          <label class="option">
            <input v-model="collapse" type="checkbox">
            <ChevronsDownUp :size="15" />
            <span>{{ t('collapse') }}</span>
          </label>
          <span class="toolbar-divider" />
          <label class="option" :class="{ 'rule-active': ignoreWhitespace }">
            <input v-model="ignoreWhitespace" type="checkbox">
            <span>{{ t('whitespace') }}</span>
          </label>
        </div>
        <div class="toolbar-actions">
          <button
            class="clear-button"
            :class="{ 'undo-clear': cleared }"
            :disabled="isEmpty && !cleared"
            @click="cleared ? undoClear() : clearAll()"
          >
            <Undo2 v-if="cleared" :size="15" />
            <Trash2 v-else class="icon-remove" :size="15" />
            {{ t(cleared ? 'undoClear' : 'clearAll') }}
          </button>
        </div>
      </div>

      <div
        v-if="notice"
        class="notice"
        role="alert"
      >
        <AlertCircle :size="16" />
        <span>{{ t(notice) }}</span>
        <button class="icon-button" :aria-label="t('close')" @click="notice = null">
          <X :size="15" />
        </button>
      </div>

      <div class="pane-headers">
        <div v-for="side in (['a', 'b'] as const)" :key="side" class="pane-heading">
          <div class="pane-info">
            <div class="pane-name">
              <span class="side-sign" :class="side">
                <Minus v-if="side === 'a'" :size="13" />
                <Plus v-else :size="13" />
              </span>
              <h2>{{ sideLabel(side) }}</h2>
            </div>
            <div v-if="texts[side]" class="pane-stats">
              <span>{{ lineCountLabel(side) }}</span>
            </div>
            <span v-if="filenames[side]" class="file-name" :title="filenames[side]">{{
              filenames[side]
            }}</span>
          </div>
          <div class="pane-actions">
            <button @click="openFile(side)">
              <FileInput :size="14" />
              <span>{{ t('open') }}</span>
            </button>
            <button :disabled="!texts[side]" @click="copy(side)">
              <Check v-if="copied === side" class="icon-add" :size="14" />
              <Copy v-else :size="14" />
              <span>{{ copied === side ? t('copied') : t('copy') }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="layout === 'unified'" class="readonly-bar">
        <LockKeyhole :size="12" />
        <span>{{ t('readonly') }}</span>
        <button @click="switchToSplitAndFocus">
          {{ t('edit') }}
        </button>
      </div>

      <div
        class="editor-area"
        @dragover="dragover"
        @dragleave="
          (event) => {
            if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node))
              dragSide = null;
          }
        "
        @drop.capture="dropped"
      >
        <div v-show="layout === 'split'" ref="splitHost" class="split-host" />
        <div v-show="layout === 'unified'" ref="unifiedHost" class="unified-host" />

        <div v-if="layout === 'split'" class="empty-overlays">
          <div
            v-for="side in (['a', 'b'] as const)"
            :key="side"
            class="empty-cell"
            @click="focusSide(side)"
          >
            <div v-if="!texts[side]" class="empty-state">
              <div class="empty-file">
                <FileText :size="28" :stroke-width="1.25" />
                <span :class="side">
                  <Minus v-if="side === 'a'" :size="12" />
                  <Plus v-else :size="12" />
                </span>
              </div>
              <h3>{{ t(side === 'a' ? 'emptyA' : 'emptyB') }}</h3>
              <p>{{ t('dropHint') }}</p>
            </div>
          </div>
        </div>

        <div v-if="layout === 'unified' && isEmpty" class="unified-empty">
          <FileText :size="26" />
          <p>{{ t('waiting') }}</p>
          <button class="format-button" @click="switchToSplitAndFocus">
            {{ t('edit') }}
          </button>
        </div>

        <div v-if="dragSide" class="drop-overlay" :class="dragSide">
          <FileInput :size="30" />
          <strong>{{ t(dragSide === 'a' ? 'dropA' : 'dropB') }}</strong>
        </div>
      </div>
    </section>

    <input
      ref="fileA"
      class="file-input"
      type="file"
      tabindex="-1"
      @change="picked('a', $event)"
    >
    <input
      ref="fileB"
      class="file-input"
      type="file"
      tabindex="-1"
      @change="picked('b', $event)"
    >
    <span class="sr-only" aria-live="polite">{{ copied ? t('copied') : '' }}</span>
  </main>
</template>
