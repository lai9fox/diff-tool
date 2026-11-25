<script setup lang="ts">
import { ArrowRight, Check, ChevronDown, Copy, FileInput, Pencil } from '@lucide/vue';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { messages, type Locale } from '../lib/i18n';
import type { Side } from '../lib/diff-stats';

const HEADER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const props = defineProps<{
  inline: boolean;
  locale: Locale;
  texts: Record<Side, string>;
  filenames: Record<Side, string>;
  copied: Side | null;
  ready: boolean;
}>();
const emit = defineEmits<{ open: [side: Side]; copy: [side: Side]; edit: [] }>();
const root = ref<HTMLElement>();
const openMenu = ref<Side | null>(null);
const animating = ref(false);
const triggerA = ref<HTMLButtonElement>();
const triggerB = ref<HTMLButtonElement>();
let hasPainted = false;
let paintFrame = 0;
let animationToken = 0;
let activeAnimations: Animation[] = [];

function cancelAnimations() {
  for (const animation of activeAnimations) animation.cancel();
  activeAnimations = [];
}

function playAnimation(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  started: Animation[],
) {
  if (typeof el.animate !== 'function') return;
  started.push(el.animate(keyframes, options));
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

watch(() => props.inline, async (isInline) => {
  closeMenu();
  const token = ++animationToken;
  const container = root.value;
  if (!hasPainted || !container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cancelAnimations();
    animating.value = false;
    return;
  }

  const firstRects = new Map<string, DOMRect>();
  for (const el of container.querySelectorAll<HTMLElement>('[data-flip]')) {
    const key = el.dataset.flip;
    if (!key) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) firstRects.set(key, rect);
  }

  cancelAnimations();
  animating.value = true;
  await nextTick();
  if (token !== animationToken || !root.value) return;

  const started: Animation[] = [];
  for (const el of root.value.querySelectorAll<HTMLElement>('[data-flip]')) {
    const key = el.dataset.flip;
    if (!key) continue;
    const last = el.getBoundingClientRect();
    if (last.width === 0 || last.height === 0) continue;
    const first = firstRects.get(key);
    if (first) {
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        playAnimation(
          el,
          [
            { transform: `translate(${ dx }px, ${ dy }px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: 260, easing: HEADER_EASING },
          started,
        );
      }
    } else {
      playAnimation(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }, started);
    }
  }

  if (isInline) {
    const arrow = root.value.querySelector('.inline-arrow');
    if (arrow) {
      playAnimation(
        arrow,
        [
          { opacity: 0, transform: 'translateX(-6px) scale(0.85)' },
          { opacity: 1, transform: 'translateX(0) scale(1)' },
        ],
        { duration: 200, delay: 50, easing: HEADER_EASING, fill: 'backwards' },
        started,
      );
    }
    const badge = root.value.querySelector('.readonly-badge');
    if (badge) {
      playAnimation(
        badge,
        [
          { opacity: 0, transform: 'translateX(-8px) scale(0.92)' },
          { opacity: 1, transform: 'translateX(0) scale(1)' },
        ],
        { duration: 200, delay: 80, easing: HEADER_EASING, fill: 'backwards' },
        started,
      );
    }
    const menus = root.value.querySelector('.inline-menus');
    if (menus) {
      playAnimation(
        menus,
        [
          { opacity: 0, transform: 'translateX(8px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 200, easing: HEADER_EASING },
        started,
      );
    }
  } else {
    for (const stats of root.value.querySelectorAll('.pane-stats')) {
      playAnimation(
        stats,
        [
          { opacity: 0, transform: 'translateX(-4px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 180, delay: 40, easing: HEADER_EASING, fill: 'backwards' },
        started,
      );
    }
    for (const actions of root.value.querySelectorAll('.pane-actions')) {
      playAnimation(
        actions,
        [
          { opacity: 0, transform: 'translateX(6px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 200, easing: HEADER_EASING },
        started,
      );
    }
  }

  if (!started.length) {
    animating.value = false;
    return;
  }

  activeAnimations = started;
  await Promise.allSettled(started.map(animation => animation.finished));
  if (token === animationToken) {
    activeAnimations = [];
    animating.value = false;
  }
});

onMounted(() => {
  paintFrame = requestAnimationFrame(() => {
    hasPainted = true;
  });
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeydown);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(paintFrame);
  cancelAnimations();
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <div
    ref="root"
    class="pane-headers"
    :class="{ 'inline-mode': inline, 'is-animating': animating }"
  >
    <template v-if="!inline">
      <div v-for="side in (['a', 'b'] as const)" :key="side" class="pane-heading">
        <div class="pane-info">
          <h2 :data-flip="`title-${ side }`">
            {{ messages[locale][side === 'a' ? 'original' : 'modified'] }}
          </h2>
          <span v-if="texts[side]" class="pane-stats">{{ texts[side].split('\n').length.toLocaleString(locale) }} {{ messages[locale][locale === 'en' && !texts[side].includes('\n') ? 'line' : 'lines'] }}</span>
          <span
            v-if="filenames[side]"
            class="file-name"
            :data-flip="`file-${ side }`"
            :title="filenames[side]"
          >{{ filenames[side] }}</span>
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
            :disabled="!ready || !texts[side]"
            :title="messages[locale][copied === side ? 'copied' : 'copy']"
            :aria-label="messages[locale][copied === side ? 'copied' : 'copy']"
            @click="emit('copy', side)"
          >
            <Check v-if="copied === side" class="stat-added copy-check-icon" :size="14" /><Copy v-else :size="14" /><span class="control-label">{{ messages[locale][copied === side ? 'copied' : 'copy'] }}</span>
          </button>
        </div>
      </div>
    </template>

    <div v-else class="inline-header-bar">
      <div class="inline-summary">
        <span class="inline-side">
          <span class="inline-side-title" data-flip="title-a">{{ messages[locale].original }}</span>
          <span
            v-if="filenames.a"
            class="inline-file-name"
            data-flip="file-a"
            :title="filenames.a"
          >{{ filenames.a }}</span>
        </span>
        <ArrowRight class="inline-arrow" :size="13" aria-hidden="true" />
        <span class="inline-side">
          <span class="inline-side-title" data-flip="title-b">{{ messages[locale].modified }}</span>
          <span
            v-if="filenames.b"
            class="inline-file-name"
            data-flip="file-b"
            :title="filenames.b"
          >{{ filenames.b }}</span>
        </span>
        <span class="readonly-badge">{{ messages[locale].readonly }}</span>
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
            <Check v-if="copied === side" class="stat-added copy-check-icon" :size="13" />
            <span>{{ messages[locale][side === 'a' ? 'original' : 'modified'] }}</span>
            <ChevronDown class="menu-chevron" :size="13" aria-hidden="true" />
          </button>
          <Transition name="pane-menu">
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
                type="button"
                class="pane-menu-item"
                role="menuitem"
                :disabled="!ready || !texts[side]"
                @click="runAction(() => emit('copy', side))"
              >
                <Check v-if="copied === side" class="stat-added copy-check-icon" :size="14" /><Copy v-else :size="14" /><span>{{ messages[locale][copied === side ? 'copied' : 'copy'] }}</span>
              </button>
            </div>
          </Transition>
        </div>
        <button
          type="button"
          class="inline-edit-button"
          :title="messages[locale].backToEdit"
          :aria-label="messages[locale].backToEdit"
          @click="emit('edit')"
        >
          <Pencil :size="13" /><span>{{ messages[locale].edit }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
