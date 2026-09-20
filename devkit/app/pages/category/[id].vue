<script setup lang="ts">
import {
  categories,
  toolsOfCategory,
  getCategory,
  getToolById,
  searchTools,
  type CategoryKey
} from '~/data/tools'

const route = useRoute()
const key = computed(() => route.params.id as CategoryKey)

const valid = computed(() => categories.some((c) => c.key === key.value))
if (!valid.value) {
  throw createError({ statusCode: 404, statusMessage: '分类不存在', fatal: true })
}

const cat = computed(() => getCategory(key.value))

useSeo({
  title: computed(() => `${cat.value.name} · DevKit`),
  description: computed(() => `${cat.value.desc} 共 ${toolsOfCategory(cat.value.key).length} 个工具，全部在浏览器本地运行，输入不上传。`)
})

const catIcons: Record<string, string> = {
  format: 'braces',
  text: 'type',
  crypto: 'shield-check',
  time: 'clock',
  java: 'coffee',
  web: 'code-2',
  api: 'terminal',
  file: 'folder'
}

const pageDescs: Record<string, string> = {
  crypto: '对消息计算摘要、做完整性校验，或按算法做对称 / 非对称加解密；全部在本机完成',
  java: '面向 JVM 工程的代码与配置转换：从 JSON 生成类、整理配置与堆栈、转换依赖声明'
}

interface GroupDef {
  title: string
  note: string
  ids: string[]
}

const groupDefs: Record<string, GroupDef[]> = {
  crypto: [
    {
      title: '摘要（单向，不可逆）',
      note: '计算摘要值，用于校验完整性；摘要不可逆，不提供解密',
      ids: ['t12', 't16']
    },
    {
      title: '对称加密（同一密钥加解密）',
      note: '加密与解密使用同一密钥；密钥不是口令，不做密码派生',
      ids: ['t14', 't17', 't13']
    },
    {
      title: '非对称加密（公私钥）',
      note: '公钥加密 / 验签，私钥解密 / 签名；不自动请求远端服务',
      ids: ['t15']
    }
  ],
  java: [
    {
      title: '代码生成与转义',
      note: '生成的是源码文本，不在本机编译或运行',
      ids: ['t22', 't23']
    },
    {
      title: '配置转换',
      note: '键冲突先报错；scope 与 configuration 不等价时要求手动选择映射',
      ids: ['t24', 't26']
    },
    {
      title: '日志与诊断',
      note: '只做文本整理与折叠，不自动判定根因',
      ids: ['t25']
    }
  ]
}

const groups = computed(() =>
  (groupDefs[key.value] ?? [])
    .map((g) => ({
      title: g.title,
      note: g.note,
      tools: g.ids.flatMap((id) => {
        const tool = getToolById(id)
        return tool && tool.cat === key.value ? [tool] : []
      })
    }))
    .filter((g) => g.tools.length > 0)
)

const icon = computed(() => catIcons[key.value] ?? 'grid')
const desc = computed(() => pageDescs[key.value] ?? cat.value.desc)
const count = computed(() => toolsOfCategory(key.value).length)

const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim()
  if (!q) return toolsOfCategory(key.value)
  return searchTools(q).filter((t) => t.cat === key.value)
})

watch(key, () => {
  query.value = ''
})
</script>

<template>
  <div v-if="valid" class="cat-page">
    <header class="cat-page__head">
      <div class="cat-page__head-main">
        <span
          class="cat-page__icon"
          :style="{ background: `var(--cat-${key}-soft)`, color: `var(--cat-${key})` }"
        >
          <DkIcon :name="icon" :size="17" />
        </span>
        <div class="cat-page__head-text">
          <div class="cat-page__title-row">
            <h1 class="cat-page__title">{{ cat.name }}</h1>
            <span class="cat-page__count-tag">{{ count }} 个工具</span>
          </div>
          <p class="cat-page__desc">{{ desc }}</p>
        </div>
      </div>
      <div class="cat-page__head-actions">
        <span class="cat-page__badge">
          <DkIcon class="cat-page__badge-icon" name="shield-check" :size="13" />
          本地处理 · 输入不上传
        </span>
        <NuxtLink to="/" class="cat-page__back">
          <DkIcon name="grid" :size="13" />
          全部工具
        </NuxtLink>
      </div>
    </header>

    <div class="cat-page__search">
      <label class="cat-page__search-box">
        <DkIcon name="search" :size="15" />
        <input
          v-model="query"
          class="cat-page__search-input"
          type="search"
          :aria-label="`在${cat.name}内搜索工具`"
          :placeholder="`在「${cat.name}」内搜索工具`"
        />
        <button
          v-if="query"
          class="cat-page__search-clear"
          type="button"
          aria-label="清空搜索"
          @click="query = ''"
        >
          <DkIcon name="x" :size="13" />
        </button>
      </label>
      <span class="cat-page__search-note">分类切换保留左侧导航与当前筛选</span>
    </div>

    <template v-if="query.trim()">
      <div v-if="filtered.length" class="cat-page__grid">
        <ToolCard v-for="t in filtered" :key="t.id" :tool="t" />
      </div>
      <div v-else class="cat-page__empty">
        <p>当前分类下没有匹配「{{ query }}」的工具</p>
        <DkButton size="sm" @click="query = ''">清空搜索</DkButton>
      </div>
    </template>
    <div v-else-if="groups.length" class="cat-page__groups">
      <section v-for="g in groups" :key="g.title" class="cat-page__group">
        <div class="cat-page__group-head">
          <h2 class="cat-page__group-title">{{ g.title }}</h2>
          <span class="cat-page__group-note">{{ g.note }}</span>
          <span class="grow"></span>
          <span class="cat-page__group-count">{{ g.tools.length }} 个</span>
        </div>
        <div class="cat-page__grid">
          <ToolCard v-for="t in g.tools" :key="t.id" :tool="t" />
        </div>
      </section>
    </div>
    <div v-else class="cat-page__grid">
      <ToolCard v-for="t in filtered" :key="t.id" :tool="t" />
    </div>
  </div>
</template>

<style scoped>
.cat-page {
  max-width: 1680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.cat-page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}
.cat-page__head-main {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.cat-page__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  flex-shrink: 0;
}
.cat-page__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cat-page__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cat-page__title {
  font-size: 22px;
  font-weight: 700;
  white-space: nowrap;
}
.cat-page__count-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 5px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.cat-page__desc {
  font-size: 13px;
  color: var(--text-secondary);
}
.cat-page__head-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.cat-page__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.cat-page__badge-icon {
  color: var(--ok);
}
.cat-page__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
}
.cat-page__back:hover {
  color: var(--accent);
  border-color: var(--accent);
  text-decoration: none;
}
.cat-page__search {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-tertiary);
}
.cat-page__search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
}
.cat-page__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
}
.cat-page__search-input::placeholder {
  color: var(--text-tertiary);
}
.cat-page__search-clear {
  display: inline-flex;
  color: var(--text-tertiary);
  padding: 3px;
  border-radius: 4px;
}
.cat-page__search-clear:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.cat-page__search-note {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.cat-page__groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.cat-page__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cat-page__group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cat-page__group-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.cat-page__group-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cat-page__group-count {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.cat-page__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.cat-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 13px;
}
@media (max-width: 820px) {
  .cat-page__search {
    flex-wrap: wrap;
    padding: 10px 14px;
  }
  .cat-page__search-box {
    flex-basis: 100%;
  }
  .cat-page__search-note {
    white-space: normal;
  }
}
@media (max-width: 720px) {
  .cat-page__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .cat-page__head-actions {
    flex-wrap: wrap;
  }
  .cat-page__title {
    font-size: 20px;
  }
}
</style>
