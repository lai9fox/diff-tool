<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlertCircle, ArrowDown, ArrowUp, FileInput, Menu, X } from '@lucide/vue';
import { messages, type Locale, type MessageKey } from '../lib/i18n';
import { findChunkIndex, lineStats, type LineChange, type Side } from '../lib/diff-stats';
import {
  nextSpaceLimited,
  parsePreferences,
  resolveEffectiveLayout,
  SIDEBAR_DRAWER_BREAKPOINT,
  type Layout,
  type Theme,
} from '../lib/preferences';
import DiffEditor from './DiffEditor.vue';
import Sidebar from './Sidebar.vue';
import PaneHeader from './PaneHeader.vue';
import '@fontsource/jetbrains-mono/400.css';

const locale = ref<Locale>('zh');
const theme = ref<Theme>('light');
const layout = ref<Layout>('split');
const wrap = ref(true);
const collapse = ref(true);
const ignoreWhitespace = ref(false);
const texts = ref({ a: '', b: '' });
const filenames = ref({ a: '', b: '' });
const cleared = ref<{ texts: Record<Side, string>; filenames: Record<Side, string> } | null>(null);
const changes = ref<LineChange[]>([]);
const current = ref(0);
const busy = ref(false);
const ready = ref(false);
const initialized = ref(false);
const copied = ref<Side | null>(null);
const notice = ref<MessageKey | null>(null);
const dragSide = ref<Side | null>(null);
const sidebar = ref<HTMLDialogElement>();
const sidebarOpen = ref(false);
const narrowScreen = ref(false);
const spaceLimited = ref(false);
const splitLeft = ref(0);
const overviewWidth = ref(30);
const workspace = ref<HTMLElement>();
const editor = ref<InstanceType<typeof DiffEditor>>();
const fileA = ref<HTMLInputElement>();
const fileB = ref<HTMLInputElement>();
let copiedTimer: ReturnType<typeof setTimeout>;
let noticeTimer: ReturnType<typeof setTimeout>;
let resizeFrame = 0;
let resizeObserver: ResizeObserver | undefined;
let sidebarMedia: MediaQueryList;
let themeMedia: MediaQueryList;
let explicitLocale = false;
let explicitTheme = false;

const t = (key: MessageKey) => messages[locale.value][key];
const effectiveLayout = computed<Layout>(() => resolveEffectiveLayout(layout.value, spaceLimited.value));
const inline = computed(() => effectiveLayout.value === 'inline');
const count = computed(() => changes.value.length);
const stats = computed(() => lineStats(changes.value));
const isEmpty = computed(() => !texts.value.a && !texts.value.b);
const status = computed(() => {
  if (isEmpty.value) return t(cleared.value ? 'cleared' : 'waiting');
  if (busy.value) return t('comparing');
  if (count.value) return `${ count.value } ${ t('differences') }`;
  return ignoreWhitespace.value ? t('filteredMatch') : t('match');
});
function savePreferences() {
  try {
    localStorage.setItem('diff.preferences', JSON.stringify({
      ...(explicitLocale ? { locale: locale.value } : {}),
      ...(explicitTheme ? { theme: theme.value } : {}),
      layout: layout.value, wrap: wrap.value, collapse: collapse.value,
    }));
  } catch {}
}
function toggleLocale() {
  explicitLocale = true;
  locale.value = locale.value === 'zh' ? 'en' : 'zh';
}
function toggleTheme() {
  explicitTheme = true;
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}
function applyAppearance() {
  document.documentElement.dataset.theme = theme.value;
  document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en';
  document.title = `Diff — ${ t('app') }`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
}
function systemThemeChanged() {
  if (!explicitTheme) theme.value = themeMedia.matches ? 'dark' : 'light';
}
function changed(side: Side, text: string) {
  cleared.value = null;
  texts.value[side] = text;
  busy.value = true;
}
function diffUpdated(value: LineChange[]) {
  changes.value = value;
  current.value = value.length ? Math.max(1, Math.min(current.value, value.length)) : 0;
  busy.value = false;
}
function cursorMoved(side: Side, line: number) {
  if (busy.value) return;
  const index = findChunkIndex(changes.value, side, line);
  if (index !== -1) current.value = index + 1;
}
function jump(direction: number) {
  if (!ready.value || busy.value || !count.value) return;
  closeSidebar();
  current.value = ((current.value - 1 + direction + count.value) % count.value) + 1;
  editor.value?.goTo(current.value - 1);
}
function clearOrUndo() {
  if (!ready.value) return;
  const snapshot = cleared.value;
  if (snapshot) {
    editor.value?.setText('a', snapshot.texts.a);
    editor.value?.setText('b', snapshot.texts.b);
    filenames.value = { ...snapshot.filenames };
    cleared.value = null;
  } else if (!isEmpty.value) {
    const saved = { texts: { ...texts.value }, filenames: { ...filenames.value } };
    editor.value?.setText('a', '');
    editor.value?.setText('b', '');
    filenames.value = { a: '', b: '' };
    copied.value = null;
    notice.value = null;
    clearTimeout(copiedTimer);
    cleared.value = saved;
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
  if (!file || !ready.value) return;
  try {
    const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (contents.includes('\0')) throw new Error('Binary file');
    cleared.value = null;
    filenames.value[side] = file.name;
    editor.value?.setText(side, contents);
  } catch {
    notice.value = side === 'a' ? 'fileErrorA' : 'fileErrorB';
  }
}
function picked(side: Side, event: Event) {
  const input = event.target as HTMLInputElement;
  readFile(side, input.files?.[0]);
  input.value = '';
}
const editorAreaStyle = computed(() => ({
  ...(!inline.value && splitLeft.value > 0 ? { '--split-left': `${ splitLeft.value }px` } : {}),
  '--overview-width': `${ overviewWidth.value }px`,
}));
function splitLayoutUpdated(value: { left: number; overview: number }) {
  splitLeft.value = value.left;
  overviewWidth.value = value.overview;
}
function targetSide(event: DragEvent): Side {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const divider = !inline.value && splitLeft.value > 0 ? splitLeft.value : box.width / 2;
  return event.clientX < box.x + divider ? 'a' : 'b';
}
function dragover(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
  dragSide.value = targetSide(event);
}
function dropped(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
  readFile(targetSide(event), event.dataTransfer.files[0]);
  dragSide.value = null;
}
function preventWindowDrop(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
}
function updateSpaceLimited() {
  spaceLimited.value = nextSpaceLimited(workspace.value?.clientWidth ?? 0, spaceLimited.value);
}
function syncSidebar() {
  narrowScreen.value = sidebarMedia.matches;
  sidebar.value?.close();
  sidebarOpen.value = false;
  if (sidebar.value && !narrowScreen.value) sidebar.value.open = true;
}
function openSidebar() {
  sidebar.value?.showModal();
  sidebarOpen.value = true;
}
function closeSidebar() {
  if (narrowScreen.value) sidebar.value?.close();
}
function dismissSidebar(event: MouseEvent) {
  if (event.target !== sidebar.value || !narrowScreen.value) return;
  const box = sidebar.value.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX >= box.right) closeSidebar();
}
function keydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.key === 'F7' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
    e.preventDefault();
    jump(e.key === 'ArrowUp' || (e.key === 'F7' && e.shiftKey) ? -1 : 1);
  }
}
watch([locale, theme, layout, wrap, collapse], savePreferences);
watch([theme, locale], applyAppearance);
watch(ignoreWhitespace, () => {
  if (ready.value) busy.value = true;
}, { flush: 'sync' });
watch(sidebarOpen, open => document.documentElement.toggleAttribute('data-sidebar-open', open));
watch(notice, value => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => (notice.value = null), 5000);
});
onMounted(async () => {
  themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  let raw = null;
  try {
    raw = localStorage.getItem('diff.preferences');
  } catch {}
  const p = parsePreferences(raw, navigator.language, themeMedia.matches);
  explicitLocale = p.explicitLocale;
  explicitTheme = p.explicitTheme;
  locale.value = p.locale;
  theme.value = p.theme;
  layout.value = p.layout;
  wrap.value = p.wrap;
  collapse.value = p.collapse;
  applyAppearance();
  themeMedia.addEventListener('change', systemThemeChanged);
  sidebarMedia = window.matchMedia(`(max-width: ${ SIDEBAR_DRAWER_BREAKPOINT }px)`);
  sidebarMedia.addEventListener('change', syncSidebar);
  syncSidebar();
  updateSpaceLimited();
  window.addEventListener('keydown', keydown);
  window.addEventListener('dragover', preventWindowDrop);
  window.addEventListener('drop', preventWindowDrop);
  initialized.value = true;
  await nextTick();
  resizeObserver = new ResizeObserver(() => {
    if (!resizeFrame) {
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        updateSpaceLimited();
      });
    }
  });
  if (workspace.value) resizeObserver.observe(workspace.value);
  updateSpaceLimited();
});
onBeforeUnmount(() => {
  themeMedia?.removeEventListener('change', systemThemeChanged);
  sidebarMedia?.removeEventListener('change', syncSidebar);
  resizeObserver?.disconnect();
  cancelAnimationFrame(resizeFrame);
  clearTimeout(copiedTimer);
  clearTimeout(noticeTimer);
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('dragover', preventWindowDrop);
  window.removeEventListener('drop', preventWindowDrop);
  document.documentElement.removeAttribute('data-sidebar-open');
});
</script>

<template>
  <main class="app-shell">
    <div class="mobile-bar">
      <button aria-controls="sidebar" :aria-expanded="sidebarOpen" @click="openSidebar">
        <Menu :size="18" />{{ t('controls') }}
      </button>
      <div v-if="count && !busy" class="mobile-nav">
        <span class="nav-label" aria-live="polite"><strong>{{ current }}</strong> / {{ count }}</span>
        <div class="nav-buttons">
          <button
            v-for="direction in ([-1, 1] as const)"
            :key="direction"
            class="icon-button"
            :disabled="!count || busy"
            :title="t(direction === -1 ? 'previous' : 'next')"
            :aria-label="t(direction === -1 ? 'previous' : 'next')"
            @click="jump(direction)"
          >
            <ArrowUp v-if="direction === -1" :size="16" /><ArrowDown v-else :size="16" />
          </button>
        </div>
      </div>
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
      <Sidebar
        v-model:layout="layout"
        v-model:wrap="wrap"
        v-model:collapse="collapse"
        v-model:ignore-whitespace="ignoreWhitespace"
        :locale="locale"
        :theme="theme"
        :effective-layout="effectiveLayout"
        :space-limited="spaceLimited"
        :status="status"
        :count="count"
        :current="current"
        :busy="busy"
        :stats="stats"
        :is-empty="isEmpty"
        :cleared="!!cleared"
        :ready="ready"
        @jump="jump"
        @clear="clearOrUndo"
        @close="closeSidebar"
        @select-layout="closeSidebar"
        @toggle-locale="toggleLocale"
        @toggle-theme="toggleTheme"
      />
    </dialog>
    <section ref="workspace" class="workspace" :aria-label="t('app')">
      <PaneHeader
        :inline="inline"
        :locale="locale"
        :texts="texts"
        :filenames="filenames"
        :copied="copied"
        :ready="ready"
        :split-left="splitLeft"
        :overview-width="overviewWidth"
        @open="openFile"
        @copy="copy"
      />
      <div
        class="editor-area"
        :style="editorAreaStyle"
        @dragover.capture="dragover"
        @drop.capture="dropped"
        @dragleave="event => {
          if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) dragSide = null;
        }"
      >
        <DiffEditor
          v-if="initialized"
          ref="editor"
          :layout="effectiveLayout"
          :wrap="wrap"
          :collapse="collapse"
          :ignore-whitespace="ignoreWhitespace"
          :theme="theme"
          :placeholder="t('emptyHint')"
          :original-label="t('original')"
          :modified-label="t('modified')"
          :current="current"
          @change="changed"
          @diff="diffUpdated"
          @cursor="cursorMoved"
          @jump="jump"
          @split-layout="splitLayoutUpdated"
          @ready="ready = true"
          @error="notice = 'editorError'"
        />
        <div v-if="dragSide && !inline" class="drop-overlay" :class="dragSide">
          <div class="drop-card active">
            <FileInput :size="26" /><strong>{{ t(dragSide === 'a' ? 'dropA' : 'dropB') }}</strong>
          </div>
        </div>
        <div v-if="dragSide && inline" class="drop-zones">
          <div
            v-for="side in (['a', 'b'] as const)"
            :key="side"
            class="drop-card"
            :class="{ active: dragSide === side }"
          >
            <FileInput :size="24" /><strong>{{ t(side === 'a' ? 'dropA' : 'dropB') }}</strong>
          </div>
        </div>
        <div v-if="notice" class="notice" role="alert">
          <AlertCircle :size="15" /><span>{{ t(notice) }}</span><button class="icon-button" :aria-label="t('close')" @click="notice = null">
            <X :size="14" />
          </button>
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
