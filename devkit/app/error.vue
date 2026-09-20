<script setup lang="ts">
import type { NuxtError } from '#app'
import { getTool, toolCount } from '~/data/tools'

const props = defineProps<{ error: NuxtError }>()

const statusCode = computed(() => Number(props.error?.statusCode ?? 500))
const is404 = computed(() => statusCode.value === 404)

useSeoMeta({ title: computed(() => (is404.value ? '工具不存在 · DevKit' : '出错了 · DevKit')) })

const palette = usePalette()

const common = ['json-format', 'base64', 'sm4', 'timestamp']
const commonTools = common.flatMap((s) => {
  const t = getTool(s)
  return t ? [t] : []
})

const statusLine = computed(() => `HTTP ${statusCode.value}`)

const statusDetail = computed(() => {
  const msg = props.error?.statusMessage?.trim()
  return msg && msg !== statusLine.value ? msg : ''
})

const errorMessage = computed(() => {
  const msg = props.error?.message?.trim()
  if (msg) return msg
  const sm = props.error?.statusMessage?.trim()
  if (sm) return sm
  return '页面没有携带更多错误信息，可以返回首页或刷新重试。'
})

function goHome() {
  clearError({ redirect: '/' })
}

function goSearch() {
  palette.show()
  clearError({ redirect: '/' })
}
</script>

<template>
  <NuxtLayout>
    <div class="err">
      <header class="err__head">
        <div class="err__title-group">
          <span class="err__head-icon" :class="{ 'err__head-icon--error': !is404 }">
            <DkIcon :name="is404 ? 'search' : 'alert-triangle'" :size="17" />
          </span>
          <div class="err__head-text">
            <h1 class="err__head-title">
              {{ is404 ? '工具不存在或链接已失效' : '页面出现了错误' }}
            </h1>
            <p class="err__head-sub">
              {{
                is404
                  ? '链接可能已失效，或该工具尚未发布。'
                  : statusDetail || '页面在加载或渲染时发生了错误。'
              }}
            </p>
          </div>
        </div>
        <NuxtLink to="/privacy" class="err__badge" title="查看本地处理与隐私说明">
          <DkIcon name="shield-check" :size="13" />
          本地处理
        </NuxtLink>
      </header>

      <section class="err__workspace">
        <div class="err__empty">
          <span class="err__empty-icon" :class="{ 'err__empty-icon--error': !is404 }">
            <DkIcon :name="is404 ? 'search' : 'alert-triangle'" :size="28" />
          </span>
          <p class="err__code mono">{{ statusLine }}</p>
          <h2 class="err__empty-title">
            {{ is404 ? '找不到这个工具' : '这个页面没能正常加载' }}
          </h2>
          <p class="err__desc">
            {{
              is404
                ? `这个地址没有匹配到 DevKit 的 ${toolCount} 个工具。请检查链接是否完整，也可以改用搜索或左侧分类浏览。`
                : errorMessage
            }}
          </p>

          <button class="err__search" type="button" aria-label="打开全局搜索" @click="goSearch">
            <DkIcon name="search" :size="15" />
            <span class="err__search-ph">搜索工具名称、缩写或别名…</span>
            <span class="grow"></span>
            <span class="err__kbd mono">Ctrl/⌘ K</span>
          </button>

          <div class="err__actions">
            <DkButton variant="primary" size="sm" @click="goHome">
              <DkIcon name="home" :size="13" />返回首页
            </DkButton>
            <NuxtLink to="/" class="err__link-btn">
              <DkIcon name="grid" :size="13" />浏览全部工具
            </NuxtLink>
          </div>

          <div class="err__divider"><span class="err__line"></span></div>

          <div class="err__common">
            <span class="err__common-label">常用：</span>
            <NuxtLink
              v-for="t in commonTools"
              :key="t.id"
              :to="`/tools/${t.slug}`"
              class="err__common-item"
            >
              <DkIcon :name="t.icon" :size="13" />
              {{ t.name }}
            </NuxtLink>
          </div>
        </div>
      </section>

      <section class="err__note">
        <div class="err__note-text">
          <h2 class="err__note-title">{{ is404 ? '仍然找不到？' : '还是打不开？' }}</h2>
          <p class="err__note-desc">
            {{
              is404
                ? '在首页搜索框输入工具名、英文名或缩写；也可以从左侧分类逐级浏览，或在“最近使用”里找回上次打开的工具。'
                : '可以返回首页或刷新当前地址重试；若问题持续出现，请把上面的错误信息一并记录下来。'
            }}
          </p>
        </div>
        <div class="err__note-actions">
          <DkButton variant="primary" size="sm" @click="goHome">
            <DkIcon name="home" :size="13" />返回首页
          </DkButton>
          <DkButton size="sm" @click="goSearch">
            <DkIcon name="search" :size="13" />打开全局搜索
          </DkButton>
          <NuxtLink to="/privacy" class="err__link-btn">
            <DkIcon name="shield-check" :size="13" />隐私说明
          </NuxtLink>
        </div>
      </section>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.err {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.err__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}
.err__title-group {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.err__head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--cat-time-soft);
  color: var(--cat-time);
  flex-shrink: 0;
}
.err__head-icon--error {
  background: var(--error-soft);
  color: var(--error);
}
.err__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.err__head-title {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.err__head-sub {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.err__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.err__badge:hover {
  color: var(--accent);
  text-decoration: none;
}
.err__workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 460px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.err__empty {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 48px 60px;
  text-align: center;
}
.err__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.err__empty-icon--error {
  background: var(--error-soft);
  color: var(--error);
}
.err__code {
  font-size: 11px;
  color: var(--text-secondary);
}
.err__empty-title {
  font-size: 19px;
  font-weight: 700;
}
.err__desc {
  max-width: 520px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.err__search {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  max-width: 440px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-secondary);
  text-align: left;
}
.err__search:hover {
  border-color: var(--accent);
  color: var(--text-secondary);
}
.err__search-ph {
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.err__kbd {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.err__actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.err__link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.err__link-btn:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.err__divider {
  width: 100%;
  max-width: 440px;
  padding: 8px 0;
}
.err__line {
  display: block;
  height: 1px;
  background: var(--border);
}
.err__common {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.err__common-label {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.err__common-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 12px;
}
.err__common-item:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.err__note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 4px;
}
.err__note-title {
  font-size: 13.5px;
  font-weight: 600;
}
.err__note-desc {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.err__note-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
@media (max-width: 820px) {
  .err__empty {
    padding: 36px 20px;
  }
  .err__note {
    flex-direction: column;
    align-items: flex-start;
  }
  .err__note-actions {
    flex-wrap: wrap;
  }
}
</style>
