<script setup lang="ts">
defineProps<{ title: string; defaultOpen?: boolean }>()
</script>

<template>
  <section class="dk-card">
    <header class="dk-card__head">
      <span class="dk-card__title">{{ title }}</span>
    </header>
    <div class="dk-card__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.dk-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.dk-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
}
.dk-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.dk-card__body {
  padding: 12px 16px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.dk-card__body :deep(h4) {
  font-size: 13px;
  color: var(--text-primary);
  margin: 10px 0 2px;
}
.dk-card__body :deep(code) {
  background: var(--surface-subtle);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}
.dk-card__body :deep(ul) {
  padding-left: 18px;
  list-style: disc;
}
.dk-card__body :deep(li) {
  margin: 2px 0;
}
</style>
