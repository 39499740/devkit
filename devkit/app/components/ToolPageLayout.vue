<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()

const fav = useFavorites()
const recent = useRecent()
const isFav = computed(() => fav.ids.value.includes(props.tool.id))

onMounted(() => {
  recent.record(props.tool.id)
  try {
    const seen: string[] = JSON.parse(localStorage.getItem('devkit.visited.v1') ?? '[]')
    if (!seen.includes(props.tool.id)) {
      seen.push(props.tool.id)
      localStorage.setItem('devkit.visited.v1', JSON.stringify(seen))
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
})

function toggleFav() {
  fav.toggle(props.tool.id)
}
</script>

<template>
  <div class="tool-page">
    <header class="tool-page__head">
      <div class="tool-page__title">
        <span class="tool-page__icon" :style="{ background: `var(--cat-${tool.cat}-soft)`, color: `var(--cat-${tool.cat})` }">
          <DkIcon :name="tool.icon" :size="17" />
        </span>
        <div class="tool-page__titletext">
          <h1 class="tool-page__name">{{ tool.name }}</h1>
          <p class="tool-page__desc">{{ tool.desc }}</p>
        </div>
      </div>
      <div class="tool-page__actions">
        <NuxtLink to="/privacy" class="tool-page__local" title="了解本地处理与隐私">
          <DkIcon name="shield-check" :size="13" />
          在线可用 · 输入不出浏览器
        </NuxtLink>
        <DkButton size="sm" :variant="isFav ? 'primary' : 'secondary'" @click="toggleFav">
          <DkIcon :name="isFav ? 'star-filled' : 'star'" :size="13" />
          {{ isFav ? '已收藏' : '收藏' }}
        </DkButton>
      </div>
    </header>

    <div class="tool-page__body">
      <slot />
    </div>

    <footer v-if="$slots.docs" class="tool-page__docs">
      <slot name="docs" />
    </footer>
  </div>
</template>

<style scoped>
.tool-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
.tool-page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}
.tool-page__title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.tool-page__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  flex-shrink: 0;
}
.tool-page__name {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}
.tool-page__desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.tool-page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.tool-page__local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 12px;
  white-space: nowrap;
}
.tool-page__local:hover {
  text-decoration: none;
  filter: brightness(0.97);
}
.tool-page__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.tool-page__docs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 960px) {
  .tool-page__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
