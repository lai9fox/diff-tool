<script setup lang="ts">
import { ArrowDown, ArrowUp, Columns2, GitCompareArrows, Moon, Rows2, Sun, Trash2, Undo2, X } from '@lucide/vue';
import { messages, type Locale } from '../lib/i18n';
import type { Layout, Theme } from '../lib/preferences';
import SwitchControl from './SwitchControl.vue';

defineProps<{
  locale: Locale; theme: Theme;
  status: string; count: number; current: number;
  busy: boolean; stats: { added: number; deleted: number }; isEmpty: boolean; cleared: boolean; ready: boolean;
}>();
const layout = defineModel<Layout>('layout', { required: true });
const wrap = defineModel<boolean>('wrap', { required: true });
const collapse = defineModel<boolean>('collapse', { required: true });
const ignoreWhitespace = defineModel<boolean>('ignoreWhitespace', { required: true });
const emit = defineEmits<{ jump: [direction: number]; clear: []; close: []; selectLayout: []; toggleLocale: []; toggleTheme: [] }>();

function selectLayout(mode: Layout) {
  layout.value = mode;
  emit('selectLayout');
}
</script>

<template>
  <div class="sidebar-heading">
    <div class="brand">
      <GitCompareArrows :size="26" aria-hidden="true" /><h1>Diff<span class="brand-period">.</span></h1>
    </div>
    <button class="icon-button sidebar-close" :aria-label="messages[locale].closeSidebar" @click="emit('close')">
      <X :size="18" />
    </button>
  </div>
  <div
    class="layout-control"
    :data-layout="layout"
    role="group"
    :aria-label="messages[locale].layout"
  >
    <button
      v-for="mode in (['split', 'inline'] as const)"
      :key="mode"
      :aria-pressed="layout === mode"
      @click="selectLayout(mode)"
    >
      <Columns2 v-if="mode === 'split'" :size="16" /><Rows2 v-else :size="16" />{{ messages[locale][mode] }}
    </button>
  </div>
  <div class="comparison-options">
    <SwitchControl v-model="ignoreWhitespace" :label="messages[locale].whitespace" />
    <SwitchControl v-model="wrap" :label="messages[locale].wrap" />
    <SwitchControl v-model="collapse" :label="messages[locale].collapse" />
  </div>
  <div class="diff-summary" :aria-busy="busy">
    <div class="summary-row">
      <span class="nav-label" aria-live="polite">
        <template v-if="count && !busy"><strong>{{ current }}</strong> / {{ count }} {{ messages[locale].differences }}</template>
        <template v-else>{{ status }}</template>
      </span>
      <div class="nav-buttons">
        <button
          v-for="direction in ([-1, 1] as const)"
          :key="direction"
          class="icon-button"
          :disabled="!count || busy"
          :title="messages[locale][direction === -1 ? 'previous' : 'next']"
          :aria-label="messages[locale][direction === -1 ? 'previous' : 'next']"
          @click="emit('jump', direction)"
        >
          <ArrowUp v-if="direction === -1" :size="16" /><ArrowDown v-else :size="16" />
        </button>
      </div>
    </div>
    <div v-if="!isEmpty && count && !busy" class="diff-stats" :aria-label="messages[locale].diffStats">
      <span class="stat-added" :title="messages[locale].added">+{{ stats.added.toLocaleString(locale) }}</span>
      <span class="stat-deleted" :title="messages[locale].deleted">−{{ stats.deleted.toLocaleString(locale) }}</span>
    </div>
  </div>
  <div class="sidebar-bottom">
    <button
      class="clear-button"
      :class="{ 'undo-clear': cleared }"
      :disabled="!ready || (isEmpty && !cleared)"
      @click="emit('clear')"
    >
      <Undo2 v-if="cleared" :size="15" /><Trash2 v-else :size="15" />{{ messages[locale][cleared ? 'undoClear' : 'clearAll'] }}
    </button>
    <div class="preferences">
      <button
        class="icon-button"
        :title="messages[locale][locale === 'zh' ? 'switchToEnglish' : 'switchToChinese']"
        :aria-label="messages[locale][locale === 'zh' ? 'switchToEnglish' : 'switchToChinese']"
        @click="emit('toggleLocale')"
      >
        {{ locale === 'zh' ? '中' : 'EN' }}
      </button>
      <button
        class="icon-button"
        :title="messages[locale][theme === 'dark' ? 'switchToLight' : 'switchToDark']"
        :aria-label="messages[locale][theme === 'dark' ? 'switchToLight' : 'switchToDark']"
        @click="emit('toggleTheme')"
      >
        <Moon v-if="theme === 'dark'" :size="17" /><Sun v-else :size="17" />
      </button>
    </div>
  </div>
</template>
