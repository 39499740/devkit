<script setup lang="ts">
defineProps<{ on: boolean; label?: string }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()
</script>

<template>
  <button
    class="dk-switch"
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    :class="{ 'dk-switch--on': on }"
    @click="emit('toggle')"
  >
    <span class="dk-switch__knob"></span>
  </button>
</template>

<style scoped>
.dk-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--border-strong);
  transition: background 0.15s;
  flex-shrink: 0;
}
.dk-switch--on {
  background: var(--accent);
}
.dk-switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s;
}
.dk-switch--on .dk-switch__knob {
  transform: translateX(16px);
}
</style>
