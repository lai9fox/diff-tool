<script setup lang="ts" generic="T extends string">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  icon?: Component;
}

const props = defineProps<{
  modelValue: T;
  options: SelectOption<T>[];
  icon?: Component;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void;
}>();

const listboxId = `select-listbox-${ Math.random().toString(36).slice(2, 8) }`;

const isOpen = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const activeIndex = ref(-1);

const selectedOption = computed(() => {
  return props.options.find((opt) => opt.value === props.modelValue) ?? props.options[0];
});

const currentIcon = computed(() => {
  return props.icon ?? selectedOption.value?.icon;
});

const currentLabel = computed(() => {
  return selectedOption.value?.label ?? '';
});

function openMenu() {
  isOpen.value = true;
  const idx = props.options.findIndex((opt) => opt.value === props.modelValue);
  activeIndex.value = idx >= 0 ? idx : 0;
}

function closeMenu() {
  isOpen.value = false;
  activeIndex.value = -1;
}

function toggle() {
  if (isOpen.value) {
    closeMenu();
  } else {
    openMenu();
  }
}

function selectOption(value: T) {
  emit('update:modelValue', value);
  closeMenu();
  triggerRef.value?.focus();
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const count = props.options.length;
      activeIndex.value = (activeIndex.value + step + count) % count;
    }
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (isOpen.value && activeIndex.value >= 0 && props.options[activeIndex.value]) {
      selectOption(props.options[activeIndex.value].value);
    } else {
      toggle();
    }
  } else if (event.key === 'Escape') {
    if (isOpen.value) {
      event.preventDefault();
      closeMenu();
      triggerRef.value?.focus();
    }
  } else if (event.key === 'Tab') {
    if (isOpen.value) {
      closeMenu();
    }
  }
}

function handleClickOutside(event: PointerEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    closeMenu();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleClickOutside);
});
</script>

<template>
  <div ref="containerRef" class="custom-select">
    <button
      ref="triggerRef"
      type="button"
      class="select-trigger"
      :class="{ open: isOpen }"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      :aria-label="ariaLabel || currentLabel"
      :aria-activedescendant="isOpen && activeIndex >= 0 ? `${ listboxId }-opt-${ activeIndex }` : undefined"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <component
        :is="currentIcon"
        v-if="currentIcon"
        class="select-prefix-icon"
        :size="15"
      />
      <span class="select-label">{{ currentLabel }}</span>
      <ChevronDown class="select-arrow" :class="{ rotated: isOpen }" :size="12" />
    </button>

    <Transition name="select-dropdown">
      <ul
        v-if="isOpen"
        :id="listboxId"
        class="select-dropdown-menu"
        role="listbox"
        :aria-label="ariaLabel || currentLabel"
      >
        <li
          v-for="(opt, idx) in options"
          :id="listboxId + '-opt-' + idx"
          :key="opt.value"
          role="option"
          class="select-dropdown-item"
          :class="{
            selected: opt.value === modelValue,
            focused: activeIndex === idx,
          }"
          :aria-selected="opt.value === modelValue"
          @click="selectOption(opt.value)"
          @mouseenter="activeIndex = idx"
        >
          <component
            :is="opt.icon"
            v-if="opt.icon"
            class="select-item-icon"
            :size="14"
          />
          <span class="select-item-label">{{ opt.label }}</span>
          <Check
            v-if="opt.value === modelValue"
            class="select-check-icon"
            :size="13"
          />
        </li>
      </ul>
    </Transition>
  </div>
</template>
