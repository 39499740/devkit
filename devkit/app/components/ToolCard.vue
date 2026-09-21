<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { getCategory } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta; compact?: boolean; variant?: 'grid' | 'row' }>()

const fav = useFavorites()
const cat = computed(() => getCategory(props.tool.cat))
const isFav = computed(() => fav.ids.value.includes(props.tool.id))

function toggleFav(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  fav.toggle(props.tool.id)
}
</script>

<template>
  <NuxtLink
    :to="`/tools/${tool.slug}`"
    class="tool-card"
    :class="[`tool-card--${variant ?? 'grid'}`, { 'tool-card--compact': compact }]"
  >
    <template v-if="variant === 'row'">
      <span class="tool-card__icon tool-card__icon--row" :style="{ background: `var(--cat-${tool.cat}-soft)`, color: `var(--cat-${tool.cat})` }">
        <DkIcon :name="tool.icon" :size="15" />
      </span>
      <span class="tool-card__text">
        <span class="tool-card__nameline">
          <span class="tool-card__name tool-card__name--row ellipsis">{{ tool.name }}</span>
          <span v-if="tool.isNew" class="tool-card__new" title="本次新增">新</span>
        </span>
        <span class="tool-card__use ellipsis">{{ tool.desc }}</span>
      </span>
      <button
        class="tool-card__star tool-card__star--row"
        :class="{ 'tool-card__star--on': isFav }"
        :title="isFav ? '取消收藏' : '收藏'"
        :aria-label="isFav ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`"
        @click="toggleFav"
      >
        <DkIcon :name="isFav ? 'star-filled' : 'star'" :size="13" />
      </button>
    </template>
    <template v-else>
      <div class="tool-card__head">
        <span class="tool-card__icon" :style="{ background: `var(--cat-${tool.cat}-soft)`, color: `var(--cat-${tool.cat})` }">
          <DkIcon :name="tool.icon" :size="16" />
        </span>
        <span class="tool-card__name ellipsis">{{ tool.name }}</span>
        <span v-if="tool.isNew" class="tool-card__new" title="本次新增">新</span>
        <button
          class="tool-card__star"
          :class="{ 'tool-card__star--on': isFav }"
          :title="isFav ? '取消收藏' : '收藏'"
          :aria-label="isFav ? `取消收藏 ${tool.name}` : `收藏 ${tool.name}`"
          @click="toggleFav"
        >
          <DkIcon :name="isFav ? 'star-filled' : 'star'" :size="15" />
        </button>
      </div>
      <p class="tool-card__desc">{{ tool.desc }}</p>
      <div class="tool-card__tags">
        <span class="tool-card__tag" :style="{ background: `var(--cat-${tool.cat}-soft)`, color: `var(--cat-${tool.cat})` }">
          {{ cat.name }}
        </span>
        <span v-for="t in tool.tags" :key="t" class="tool-card__tag tool-card__tag--plain">{{ t }}</span>
      </div>
    </template>
  </NuxtLink>
</template>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    transform 0.12s;
}
.tool-card:hover {
  border-color: var(--accent-ring);
  box-shadow: var(--shadow-2);
}
.tool-card:active {
  transform: translateY(1px);
}
.tool-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tool-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.tool-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.tool-card__nameline {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* 「新」徽标：本次新增的工具在目录 / 列表里标出来 */
.tool-card__new {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.tool-card__star {
  margin-left: auto;
  display: inline-flex;
  color: var(--text-tertiary);
  padding: 4px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color 0.12s;
}
.tool-card__star:hover {
  color: var(--star);
  background: var(--surface-hover);
}
.tool-card__star--on {
  color: var(--star);
}
.tool-card__desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
}
.tool-card--compact .tool-card__desc {
  min-height: 0;
}
.tool-card__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tool-card__tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  white-space: nowrap;
}
.tool-card__tag--plain {
  background: var(--surface-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.tool-card--row {
  flex-direction: row;
  align-items: center;
  gap: 9px;
  height: 70px;
  padding: 0 11px;
  border-radius: 10px;
}
.tool-card--row .tool-card__icon--row {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}
.tool-card__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.tool-card__name--row {
  font-size: 13px;
}
.tool-card__use {
  font-size: 11px;
  color: var(--text-tertiary);
}
.tool-card__star--row {
  margin-left: 0;
  padding: 5px;
}
</style>
