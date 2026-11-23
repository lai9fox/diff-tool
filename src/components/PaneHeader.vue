<script setup lang="ts">
import { ArrowRight, Check, ChevronDown, ClipboardPaste, Copy, FileInput } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { messages, type Locale } from '../lib/i18n';
import type { Side } from '../lib/diff-stats';
import { useResponsiveChrome } from '../lib/responsive-chrome';

const props = defineProps<{
  inline: boolean;
  locale: Locale;
  texts: Record<Side, string>;
  filenames: Record<Side, string>;
  copied: Side | null;
  ready: boolean;
  splitLeft: number;
  overviewWidth: number;
}>();
const emit = defineEmits<{ open: [side: Side]; copy: [side: Side]; paste: [] }>();
const INLINE_MENU_ENTER = 460;
const INLINE_MENU_EXIT = 476;
const root = ref<HTMLElement>();
const openMenu = ref<Side | null>(null);
const narrowInline = ref(false);
const triggerA = ref<HTMLButtonElement>();
const triggerB = ref<HTMLButtonElement>();
let headerObserver: ResizeObserver | undefined;
useResponsiveChrome(root);

const showInlineMenus = computed(() => props.inline && narrowInline.value);
const headerStyle = computed(() => {
  if (props.inline) return undefined;
  return {
    ...(props.splitLeft > 0 ? { '--split-left': `${ props.splitLeft }px` } : {}),
    '--overview-width': `${ props.overviewWidth }px`,
  };
});

function updateNarrowInline() {
  const width = root.value?.getBoundingClientRect().width ?? 0;
  if (!width) return;
  narrowInline.value = narrowInline.value ? width < INLINE_MENU_EXIT : width < INLINE_MENU_ENTER;
}

function setTriggerRef(side: Side, el: unknown) {
  const button = el instanceof HTMLButtonElement ? el : undefined;
  if (side === 'a') triggerA.value = button;
  else triggerB.value = button;
}

function toggleMenu(side: Side) {
  openMenu.value = openMenu.value === side ? null : side;
}

function closeMenu(restoreFocus = false) {
  const prev = openMenu.value;
  openMenu.value = null;
  if (restoreFocus && prev) (prev === 'a' ? triggerA.value : triggerB.value)?.focus();
}

function runAction(action: () => void) {
  action();
  closeMenu();
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!openMenu.value) return;
  if (!root.value?.contains(event.target as Node)) closeMenu();
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && openMenu.value) {
    event.preventDefault();
    closeMenu(true);
  }
}

watch([() => props.inline, showInlineMenus], () => closeMenu());

onMounted(() => {
  headerObserver = new ResizeObserver(updateNarrowInline);
  if (root.value) headerObserver.observe(root.value);
  updateNarrowInline();
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeydown);
});
onBeforeUnmount(() => {
  headerObserver?.disconnect();
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <div
    ref="root"
    class="pane-headers"
    :class="{ 'inline-headers': inline, 'inline-menus-mode': showInlineMenus }"
    :style="headerStyle"
  >
    <template v-if="!showInlineMenus">
      <div v-for="side in (['a', 'b'] as const)" :key="side" class="pane-heading">
        <div class="pane-info">
          <h2>{{ messages[locale][side === 'a' ? 'original' : 'modified'] }}</h2>
          <span v-if="texts[side]" class="pane-stats">{{ texts[side].split('\n').length.toLocaleString(locale) }} {{ messages[locale][locale === 'en' && !texts[side].includes('\n') ? 'line' : 'lines'] }}</span>
          <span v-if="filenames[side]" class="file-name" :title="filenames[side]">{{ filenames[side] }}</span>
        </div>
        <div class="pane-actions">
          <button
            :disabled="!ready"
            :title="messages[locale].open"
            :aria-label="messages[locale].open"
            @click="emit('open', side)"
          >
            <FileInput :size="14" /><span class="control-label">{{ messages[locale].open }}</span>
          </button>
          <button
            v-if="inline && side === 'a'"
            :disabled="!ready"
            :title="messages[locale].paste"
            :aria-label="messages[locale].paste"
            @click="emit('paste')"
          >
            <ClipboardPaste :size="14" /><span class="control-label">{{ messages[locale].paste }}</span>
          </button>
          <button
            :disabled="!ready || !texts[side]"
            :title="messages[locale][copied === side ? 'copied' : 'copy']"
            :aria-label="messages[locale][copied === side ? 'copied' : 'copy']"
            @click="emit('copy', side)"
          >
            <Check v-if="copied === side" class="stat-added" :size="14" /><Copy v-else :size="14" /><span class="control-label">{{ messages[locale][copied === side ? 'copied' : 'copy'] }}</span>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="inline-header-bar">
      <div class="inline-summary">
        <span class="inline-side">
          <span class="inline-side-title">{{ messages[locale].original }}</span>
          <span v-if="filenames.a" class="inline-file-name" :title="filenames.a">{{ filenames.a }}</span>
        </span>
        <ArrowRight class="inline-arrow" :size="13" aria-hidden="true" />
        <span class="inline-side">
          <span class="inline-side-title">{{ messages[locale].modified }}</span>
          <span v-if="filenames.b" class="inline-file-name" :title="filenames.b">{{ filenames.b }}</span>
        </span>
      </div>

      <div class="inline-menus">
        <div v-for="side in (['a', 'b'] as const)" :key="side" class="pane-menu-wrap">
          <button
            :ref="el => setTriggerRef(side, el)"
            type="button"
            class="pane-menu-trigger"
            :class="{ open: openMenu === side }"
            :disabled="!ready"
            aria-haspopup="menu"
            :aria-expanded="openMenu === side"
            :aria-label="messages[locale][side === 'a' ? 'originalActions' : 'modifiedActions']"
            @click="toggleMenu(side)"
          >
            <Check v-if="copied === side" class="stat-added" :size="13" />
            <span>{{ messages[locale][side === 'a' ? 'original' : 'modified'] }}</span>
            <ChevronDown class="menu-chevron" :size="13" aria-hidden="true" />
          </button>
          <div
            v-if="openMenu === side"
            class="pane-menu"
            role="menu"
            :aria-label="messages[locale][side === 'a' ? 'originalActions' : 'modifiedActions']"
          >
            <button
              type="button"
              class="pane-menu-item"
              role="menuitem"
              :disabled="!ready"
              @click="runAction(() => emit('open', side))"
            >
              <FileInput :size="14" /><span>{{ messages[locale].open }}</span>
            </button>
            <button
              v-if="side === 'a'"
              type="button"
              class="pane-menu-item"
              role="menuitem"
              :disabled="!ready"
              @click="runAction(() => emit('paste'))"
            >
              <ClipboardPaste :size="14" /><span>{{ messages[locale].paste }}</span>
            </button>
            <button
              type="button"
              class="pane-menu-item"
              role="menuitem"
              :disabled="!ready || !texts[side]"
              @click="runAction(() => emit('copy', side))"
            >
              <Check v-if="copied === side" class="stat-added" :size="14" /><Copy v-else :size="14" /><span>{{ messages[locale][copied === side ? 'copied' : 'copy'] }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
