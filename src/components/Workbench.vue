<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import {
  ArrowDown, ArrowUp, Check, Columns2, Copy, FileInput,
  FileText, GitCompareArrows, LockKeyhole, Minus, Moon, Plus, Rows2, Sun,
  WrapText, X, AlertCircle, AlignLeft, Pencil, ChevronsDownUp, Trash2, Undo2, Space, Menu,
} from '@lucide/vue';
import { messages, type Locale, type MessageKey } from '../lib/i18n';
import SwitchControl from './SwitchControl.vue';
import CustomSelect from './CustomSelect.vue';
import { diffStats, type ComparisonMethod, type DiffStats } from '../lib/diff';
import { useResponsiveChrome } from '../lib/responsive-chrome';
import {
  accessibleCollapse, activeChunkField, buildActiveChunkDecoration,
  diffConfig, editorTheme, setActiveChunkEffect,
} from '../lib/editor';
import '@fontsource/jetbrains-mono/400.css';

type Side = 'a' | 'b';
type Theme = 'light' | 'dark';

const locale = ref<Locale>('zh');
const theme = ref<Theme>('light');
const dark = computed(() => theme.value === 'dark');

const layout = ref<'split' | 'unified'>('split');
const wrap = ref(true);
const collapse = ref(true);
const ignoreWhitespace = ref(false);
const comparisonMethod = ref<ComparisonMethod>('line');
const stats = ref<DiffStats>({ added: 0, modified: 0, deleted: 0 });

const texts = ref({ a: '', b: '' });
const filenames = ref({ a: '', b: '' });
const cleared = ref<{ texts: Record<Side, string>; filenames: Record<Side, string> } | null>(null);

const count = ref(0);
const current = ref(0);
const busy = ref(false);
const copied = ref<Side | null>(null);
const notice = ref<MessageKey | null>(null);
const dragSide = ref<Side | null>(null);
const sidebar = ref<HTMLDialogElement>();
const sidebarOpen = ref(false);
const narrowScreen = ref(false);

const splitHost = ref<HTMLElement>();
const workspace = ref<HTMLElement>();
useResponsiveChrome(workspace);
const unifiedHost = ref<HTMLElement>();
const fileA = ref<HTMLInputElement>();
const fileB = ref<HTMLInputElement>();

let merge: MergeView | undefined;
let unified: EditorView | undefined;
let refreshTimer: ReturnType<typeof setTimeout>;
let copiedTimer: ReturnType<typeof setTimeout>;
let resizeObserver: ResizeObserver | undefined;
let sidebarMedia: MediaQueryList | undefined;

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
        comparisonMethod: comparisonMethod.value,
      }),
    );
  } catch {
    /* Preferences storage is purely optional. */
  }
}

function visualExtensions(side: Side, editable = true): Extension[] {
  return [
    editorTheme(dark.value),
    accessibleCollapse,
    editable ? placeholder(t('emptyHint')) : [],
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
    stats.value = diffStats(texts.value.a, texts.value.b, ignoreWhitespace.value);
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
  const scroll = merge?.a.scrollDOM.scrollTop || 0;
  merge?.destroy();
  merge = new MergeView({
    a: { doc: texts.value.a, selection: oldA?.selection, extensions: makeExtensions('a', oldA) },
    b: { doc: texts.value.b, selection: oldB?.selection, extensions: makeExtensions('b', oldB) },
    parent: splitHost.value,
    gutter: true,
    highlightChanges: comparisonMethod.value !== 'line',
    diffConfig: diffConfig(ignoreWhitespace.value, comparisonMethod.value),
    collapseUnchanged: collapse.value ? { margin: 3, minSize: 4 } : undefined,
  });
  const { a, b } = merge;
  const syncScroll = (source: EditorView, target: EditorView) => {
    if (target.scrollDOM.scrollTop !== source.scrollDOM.scrollTop) {
      target.scrollDOM.scrollTop = source.scrollDOM.scrollTop;
    }
  };
  a.scrollDOM.addEventListener('scroll', () => syncScroll(a, b));
  b.scrollDOM.addEventListener('scroll', () => syncScroll(b, a));
  a.scrollDOM.scrollTop = b.scrollDOM.scrollTop = scroll;
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
      ...visualExtensions('b', false),
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
        highlightChanges: comparisonMethod.value !== 'line',
        gutter: true,
        diffConfig: diffConfig(ignoreWhitespace.value, comparisonMethod.value),
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

function clearAll(event?: Event) {
  (event?.currentTarget as HTMLElement | null)?.blur();
  if (isEmpty.value || !merge) return;
  const snapshot = { texts: { ...texts.value }, filenames: { ...filenames.value } };
  clearTimeout(copiedTimer);
  notice.value = null;
  copied.value = null;
  filenames.value = { a: '', b: '' };
  replaceText('a', '');
  replaceText('b', '');
  count.value = current.value = 0;
  stats.value = { added: 0, modified: 0, deleted: 0 };
  merge.a.scrollDOM.scrollTop = merge.b.scrollDOM.scrollTop = 0;
  if (unified) unified.scrollDOM.scrollTop = 0;
  // Snapshot saved after editor transactions invalidate previous snapshots
  cleared.value = snapshot;
}

function undoClear(event?: Event) {
  (event?.currentTarget as HTMLElement | null)?.blur();
  const snapshot = cleared.value;
  if (!snapshot) return;
  cleared.value = null;
  filenames.value = { ...snapshot.filenames };
  replaceText('a', snapshot.texts.a);
  replaceText('b', snapshot.texts.b);
}

function jump(direction: number, event?: Event) {
  (event?.currentTarget as HTMLElement | null)?.blur();
  if (!merge || !count.value) return;
  closeMobileSidebar();
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

async function copy(side: Side, event?: Event) {
  (event?.currentTarget as HTMLElement | null)?.blur();
  try {
    await navigator.clipboard.writeText(texts.value[side]);
    copied.value = side;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), 1800);
  } catch {
    notice.value = 'copyError';
  }
}

function openFile(side: Side, event?: Event) {
  (event?.currentTarget as HTMLElement | null)?.blur();
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

function switchToSplitAndFocus() {
  layout.value = 'split';
  nextTick(() => merge?.a.focus());
}

function syncSidebar() {
  narrowScreen.value = sidebarMedia?.matches ?? false;
  sidebar.value?.close();
  sidebarOpen.value = false;
  // Desktop chrome must not run the dialog's automatic focus steps.
  if (sidebar.value && !narrowScreen.value) sidebar.value.open = true;
}

function openSidebar() {
  sidebar.value?.showModal();
  sidebarOpen.value = true;
}

function closeMobileSidebar() {
  if (narrowScreen.value) sidebar.value?.close();
}

function selectLayout(value: 'split' | 'unified') {
  layout.value = value;
  closeMobileSidebar();
}

function dismissSidebar(event: MouseEvent) {
  if (event.target !== sidebar.value || !narrowScreen.value) return;
  const bounds = sidebar.value.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX >= bounds.right) sidebar.value.close();
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

function applyTheme(isDark: boolean) {
  const nextTheme = isDark ? 'dark' : 'light';
  if (document.documentElement.dataset.theme === nextTheme) return;
  const style = document.createElement('style');
  style.textContent = '*:not(.switch-thumb), *::before, *::after { transition: none !important; }';
  document.head.appendChild(style);
  document.documentElement.dataset.theme = nextTheme;
  void document.documentElement.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      style.remove();
    });
  });
}

watch([locale, theme, wrap, collapse, layout, comparisonMethod], preferences);
watch([dark, locale, wrap], () => {
  applyTheme(dark.value);
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

watch([ignoreWhitespace, comparisonMethod], () => {
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

onMounted(async () => {
  sidebarMedia = window.matchMedia('(max-width: 820px)');
  sidebarMedia.addEventListener('change', syncSidebar);
  syncSidebar();
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('dragover', preventWindowDrop);
  window.addEventListener('drop', preventWindowDrop);

  try {
    const p = JSON.parse(localStorage.getItem('diff.preferences') || '{}');
    if (p.locale === 'zh' || p.locale === 'en') locale.value = p.locale;
    if (p.theme === 'light' || p.theme === 'dark') theme.value = p.theme;
    if (p.layout === 'split' || p.layout === 'unified') layout.value = p.layout;
    if (typeof p.wrap === 'boolean') wrap.value = p.wrap;
    if (typeof p.collapse === 'boolean') collapse.value = p.collapse;
    if (['line', 'word', 'character'].includes(p.comparisonMethod)) comparisonMethod.value = p.comparisonMethod;
  } catch {}

  await nextTick();
  applyTheme(dark.value);
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
  sidebarMedia?.removeEventListener('change', syncSidebar);
  merge?.destroy();
  unified?.destroy();
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
    <div class="mobile-bar">
      <button
        class="sidebar-trigger"
        aria-controls="sidebar"
        :aria-expanded="sidebarOpen"
        @click="openSidebar"
      >
        <Menu :size="18" />{{ t('controls') }}
      </button>
    </div>

    <dialog
      id="sidebar"
      ref="sidebar"
      class="sidebar"
      :role="narrowScreen ? 'dialog' : 'complementary'"
      :aria-label="t('controls')"
      @close="sidebarOpen = false"
      @click="dismissSidebar"
    >
      <div class="sidebar-heading">
        <div class="brand control-row" aria-label="Diff">
          <GitCompareArrows
            class="brand-symbol"
            :size="26"
            aria-hidden="true"
          />
          <h1>Diff<span class="brand-period">.</span></h1>
        </div>
        <button class="icon-button sidebar-close" :aria-label="t('closeSidebar')" @click="sidebar?.close()">
          <X :size="18" />
        </button>
      </div>

      <div class="sidebar-controls">
        <div class="comparison-controls">
          <SwitchControl
            :model-value="layout === 'unified'"
            :label="t(layout)"
            @update:model-value="selectLayout($event ? 'unified' : 'split')"
          >
            <Rows2 v-if="layout === 'unified'" :size="16" />
            <Columns2 v-else :size="16" />
          </SwitchControl>

          <div class="comparison-method control-row">
            <AlignLeft :size="16" aria-hidden="true" />
            <label for="comparison-method">{{ t('comparisonMethod') }}</label>
            <CustomSelect
              v-model="comparisonMethod"
              trigger-id="comparison-method"
              :aria-label="t('comparisonMethod')"
              :options="[
                { value: 'line', label: t('byLine') },
                { value: 'word', label: t('byWord') },
                { value: 'character', label: t('byCharacter') },
              ]"
            />
          </div>

          <div class="options">
            <SwitchControl v-model="wrap" :label="t('wrap')">
              <WrapText :size="16" />
            </SwitchControl>
            <SwitchControl v-model="collapse" :label="t('collapse')">
              <ChevronsDownUp :size="16" />
            </SwitchControl>
            <SwitchControl v-model="ignoreWhitespace" :label="t('whitespace')">
              <Space :size="16" />
            </SwitchControl>
          </div>
        </div>
        <div class="toolbar-actions">
          <button
            class="clear-button control-row"
            :class="{ 'undo-clear': cleared }"
            :disabled="isEmpty && !cleared"
            :aria-label="t(cleared ? 'undoClear' : 'clearAll')"
            :title="t(cleared ? 'undoClear' : 'clearAll')"
            @click="cleared ? undoClear($event) : clearAll($event)"
          >
            <Undo2 v-if="cleared" :size="15" />
            <Trash2 v-else class="icon-remove" :size="15" />
            <span>{{ t(cleared ? 'undoClear' : 'clearAll') }}</span>
          </button>
        </div>
        <div class="diff-navigation">
          <div class="control-row">
            <span class="navigation-icon" aria-hidden="true">
              <span class="status-dot" :class="{ success: !isEmpty && !busy && !count }" />
            </span>
            <span
              class="nav-label"
              :class="{ 'has-diff': count && !busy }"
              aria-live="polite"
              :title="status"
            >
              <template v-if="count && !busy">
                <strong>{{ current }}</strong><span class="nav-slash">/</span>{{ count
                }}<span class="nav-word">{{ t('differences') }}</span>
              </template>
              <template v-else>
                <span class="status-text">{{ status }}</span>
              </template>
            </span>
            <div class="nav-buttons">
              <button
                class="icon-button"
                :disabled="!count || busy"
                :aria-label="t('previous')"
                :title="t('previous')"
                @click="jump(-1, $event)"
              >
                <ArrowUp :size="16" />
              </button>
              <button
                class="icon-button"
                :disabled="!count || busy"
                :aria-label="t('next')"
                :title="t('next')"
                @click="jump(1, $event)"
              >
                <ArrowDown :size="16" />
              </button>
            </div>
          </div>
          <dl
            v-if="!isEmpty"
            class="diff-stats"
            :aria-label="t('diffStats')"
            :aria-busy="busy"
          >
            <div
              v-for="kind in (['added', 'modified', 'deleted'] as const)"
              :key="kind"
              class="control-row"
              :class="`stat-${ kind }`"
            >
              <dt>
                <span class="stat-icon" aria-hidden="true">
                  <Plus v-if="kind === 'added'" :size="14" />
                  <Pencil v-else-if="kind === 'modified'" :size="14" />
                  <Minus v-else :size="14" />
                </span>
                <span>{{ t(kind === 'modified' ? 'changedLines' : kind) }}</span>
              </dt>
              <dd>{{ busy ? '…' : stats[kind].toLocaleString(locale === 'zh' ? 'zh-CN' : 'en') }} {{ t(locale === 'en' && stats[kind] === 1 ? 'line' : 'lines') }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div class="preferences">
        <SwitchControl
          :model-value="locale === 'en'"
          :label="t('language')"
          :accessible-label="t('englishMode')"
          :tooltip="t(locale === 'zh' ? 'switchToEnglish' : 'switchToChinese')"
          @update:model-value="locale = $event ? 'en' : 'zh'"
        >
          {{ locale === 'zh' ? '中' : 'EN' }}
        </SwitchControl>
        <SwitchControl
          :model-value="dark"
          :label="t('theme')"
          :accessible-label="t('darkMode')"
          :tooltip="t(dark ? 'switchToLight' : 'switchToDark')"
          @update:model-value="theme = $event ? 'dark' : 'light'"
        >
          <Moon v-if="dark" :size="17" />
          <Sun v-else :size="17" />
        </SwitchControl>
      </div>
    </dialog>

    <section ref="workspace" class="workspace" :aria-label="t('app')">
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

      <div v-if="layout === 'split'" class="pane-headers">
        <div v-for="side in (['a', 'b'] as const)" :key="side" class="pane-heading">
          <div class="pane-info">
            <h2 :title="sideLabel(side)">
              {{ sideLabel(side) }}
            </h2>
            <div v-if="texts[side]" class="pane-stats">
              <span>{{ lineCountLabel(side) }}</span>
            </div>
            <span v-if="filenames[side]" class="file-name" :title="filenames[side]">{{
              filenames[side]
            }}</span>
          </div>
          <div class="pane-actions">
            <button :aria-label="t('open')" :title="t('open')" @click="openFile(side, $event)">
              <FileInput :size="14" />
              <span class="control-label"><span>{{ t('open') }}</span></span>
            </button>
            <button
              :class="{ copied: copied === side }"
              :disabled="!texts[side]"
              :aria-label="copied === side ? t('copied') : t('copy')"
              :title="copied === side ? t('copied') : t('copy')"
              @click="copy(side, $event)"
            >
              <Check v-if="copied === side" class="icon-add" :size="14" />
              <Copy v-else :size="14" />
              <span class="control-label"><span>{{ copied === side ? t('copied') : t('copy') }}</span></span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="layout === 'unified'" class="readonly-bar">
        <div class="readonly-heading">
          <h2>{{ t('unified') }}</h2>
          <span class="readonly-status"><LockKeyhole :size="12" />{{ t('readonly') }}</span>
        </div>
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
