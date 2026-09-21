<script setup lang="ts">
import { searchTools, getCategory, type ToolMeta } from '~/data/tools'

const palette = usePalette()
const router = useRouter()
const query = ref('')
const sel = ref(0)
const inputRef = ref<HTMLInputElement>()

const results = computed<ToolMeta[]>(() => searchTools(query.value))

const grouped = computed(() => {
  const map = new Map<string, ToolMeta[]>()
  for (const t of results.value) {
    const list = map.get(t.cat) ?? []
    list.push(t)
    map.set(t.cat, list)
  }
  return Array.from(map.entries())
})

watch(query, () => {
  sel.value = 0
})

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    const root = document.querySelector<HTMLElement>('.palette')
    if (!root) return
    const items = Array.from(
      root.querySelectorAll<HTMLElement>('input, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
    )
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault()
      first.focus()
    }
    return
  }
  onKeydown(e)
}

watch(
  () => palette.open.value,
  (v) => {
    if (import.meta.server) return
    if (v) {
      query.value = ''
      sel.value = 0
      nextTick(() => inputRef.value?.focus())
      document.addEventListener('keydown', onDocKeydown)
    } else {
      document.removeEventListener('keydown', onDocKeydown)
    }
  }
)

onUnmounted(() => {
  if (import.meta.client) document.removeEventListener('keydown', onDocKeydown)
})

function go(t: ToolMeta) {
  palette.hide()
  router.push(`/tools/${t.slug}`)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    sel.value = Math.min(sel.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    sel.value = Math.max(sel.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const t = results.value[sel.value]
    if (t) go(t)
  } else if (e.key === 'Escape') {
    palette.hide()
  }
}

function onMouseOver(i: number) {
  sel.value = i
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="palette.open.value" class="palette__mask" @click.self="palette.hide()">
        <div class="palette" role="dialog" aria-modal="true" aria-label="全局搜索工具">
          <div class="palette__inputrow">
            <DkIcon name="search" :size="16" class="palette__searchicon" />
            <input
              ref="inputRef"
              v-model="query"
              class="palette__input"
              placeholder="搜索工具：名称、英文、缩写或别名，如「国密」「json」「cron」"
            />
            <kbd>Esc</kbd>
          </div>

          <div class="palette__body">
            <template v-if="results.length">
              <div v-for="[cat, list] in grouped" :key="cat" class="palette__group">
                <p class="palette__group-title">{{ getCategory(cat as ToolMeta['cat']).name }}</p>
                <button
                  v-for="t in list"
                  :key="t.id"
                  class="palette__item"
                  :class="{ 'palette__item--sel': results.indexOf(t) === sel }"
                  @click="go(t)"
                  @mouseover="onMouseOver(results.indexOf(t))"
                >
                  <span class="palette__icon" :style="{ background: `var(--cat-${t.cat}-soft)`, color: `var(--cat-${t.cat})` }">
                    <DkIcon :name="t.icon" :size="14" />
                  </span>
                  <span class="palette__name">{{ t.name }}</span>
                  <span v-if="t.isNew" class="palette__new" title="本次新增">新</span>
                  <span class="palette__desc ellipsis">{{ t.desc }}</span>
                  <DkIcon v-if="results.indexOf(t) === sel" name="corner-down-left" :size="13" class="palette__enter" />
                </button>
              </div>
            </template>
            <div v-else class="palette__empty">
              <DkIcon name="search" :size="22" />
              <p class="palette__empty-title">没有找到匹配「{{ query }}」的工具</p>
              <p class="palette__empty-hint">搜索只覆盖工具目录，不会搜索你输入过的内容。</p>
              <div class="palette__empty-actions">
                <DkButton size="sm" @click="query = ''">清空关键词</DkButton>
                <DkButton size="sm" variant="primary" @click="palette.hide(); router.push('/')">回到全部工具</DkButton>
              </div>
            </div>
          </div>

          <div class="palette__foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span class="grow"></span>
            <span class="palette__foot-note">搜索仅限工具目录</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette__mask {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(15, 17, 21, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
}
.palette {
  width: 640px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  overflow: hidden;
}
.palette__inputrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.palette__searchicon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.palette__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--text-primary);
}
.palette__input::placeholder {
  color: var(--text-tertiary);
}
.palette__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.palette__group-title {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 8px 10px 4px;
  letter-spacing: 0.3px;
}
.palette__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
  transition: background 0.08s;
}
.palette__item--sel {
  background: var(--accent-soft);
}
.palette__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  flex-shrink: 0;
}
.palette__name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
/* 「新」徽标：与目录 / 卡片同一套样式 */
.palette__new {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 15px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.palette__desc {
  font-size: 12px;
  color: var(--text-tertiary);
  flex: 1;
  min-width: 0;
}
.palette__enter {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.palette__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 16px;
  color: var(--text-tertiary);
  text-align: center;
}
.palette__empty-title {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}
.palette__empty-hint {
  font-size: 12px;
}
.palette__empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.palette__foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
}
.palette__foot-note {
  font-size: 11px;
}
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.15s;
}
.palette-enter-active .palette,
.palette-leave-active .palette {
  transition: transform 0.15s;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .palette {
  transform: translateY(-10px) scale(0.99);
}
</style>
