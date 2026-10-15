<script setup lang="ts">
defineProps<{
  label: string;
  accessibleLabel?: string;
  tooltip?: string;
}>();

const checked = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    class="switch-control control-row"
    role="switch"
    :aria-checked="checked"
    :aria-label="accessibleLabel || label"
    @click="checked = !checked"
  >
    <span class="switch-icon" aria-hidden="true"><slot /></span>
    <span class="switch-label">{{ label }}</span>
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
    <span v-if="tooltip" class="switch-tooltip" aria-hidden="true">{{ tooltip }}</span>
  </button>
</template>

<style scoped>
.switch-control {
  position: relative;
  width: 100%;
  min-height: 40px;
  color: var(--secondary);
}

.switch-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.switch-label {
  min-width: 0;
  text-align: left;
  white-space: normal;
  font-size: 12px;
  line-height: 1.5;
}

.switch-track {
  display: inline-flex;
  align-items: center;
  width: 30px;
  height: 18px;
  padding: 2px;
  border: 1px solid var(--secondary);
  border-radius: 9px;
  background: var(--surface);
}

.switch-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--secondary);
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.switch-control[aria-checked='true'] .switch-track {
  border-color: var(--accent);
  background: var(--accent);
}

.switch-control[aria-checked='true'] .switch-thumb {
  background: var(--panel);
  transform: translateX(12px);
}

.switch-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 100;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
  box-shadow: var(--shadow-popover);
  visibility: hidden;
  pointer-events: none;
}

.switch-control:focus-visible .switch-tooltip {
  visibility: visible;
}

@media (hover: hover) {
  .switch-control:hover .switch-tooltip {
    visibility: visible;
  }
}
</style>
