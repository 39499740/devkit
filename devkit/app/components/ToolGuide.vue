<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { toolsOfCategory, getCategory, toolCount } from '~/data/tools'
import { toolNotes } from '~/data/tool-notes'

const props = defineProps<{ tool: ToolMeta }>()

const note = computed(() => toolNotes[props.tool.slug])
const cat = computed(() => getCategory(props.tool.cat))
const related = computed(() =>
  toolsOfCategory(props.tool.cat)
    .filter((t) => t.slug !== props.tool.slug)
    .slice(0, 5)
)
</script>

<template>
  <section v-if="note" class="guide">
    <h2 class="guide__title">什么时候用「{{ tool.name }}」</h2>
    <p class="guide__when">{{ note.when }}</p>

    <h3 class="guide__sub">使用要点</h3>
    <ul class="guide__tips">
      <li v-for="tip in note.tips" :key="tip">{{ tip }}</li>
    </ul>

    <h3 class="guide__sub">相关工具</h3>
    <div class="guide__links">
      <NuxtLink v-for="t in related" :key="t.slug" :to="`/tools/${t.slug}`" class="guide__chip">
        {{ t.name }}
      </NuxtLink>
      <NuxtLink v-if="cat" :to="`/category/${cat.key}`" class="guide__chip guide__chip--all">
        全部{{ cat.name }}工具
      </NuxtLink>
    </div>

    <p class="guide__foot">
      {{ tool.name }}与其他 {{ toolCount - 1 }} 个工具一样，全部计算都在你的浏览器里完成：输入、密钥与文件不会发送到服务器，页面首次加载后可离线使用。
    </p>
  </section>
</template>

<style scoped>
.guide {
  margin-top: 20px;
  padding: 18px 20px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.guide__title {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
}
.guide__when {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.75;
}
.guide__sub {
  margin-top: 16px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}
.guide__tips {
  margin-top: 8px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.guide__tips li::marker {
  color: var(--accent);
}
.guide__links {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.guide__chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 11px;
  border-radius: 13px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  text-decoration: none;
  transition: color 0.12s, border-color 0.12s;
}
.guide__chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.guide__chip--all {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}
.guide__foot {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.7;
}
@media (max-width: 960px) {
  .guide {
    padding: 14px 14px 12px;
  }
}
</style>
