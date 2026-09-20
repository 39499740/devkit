<script setup lang="ts">
useSeoMeta({ title: '帮助与快捷键 · DevKit' })

const palette = usePalette()

const isMac = ref(true)
onMounted(() => {
  isMac.value = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
})

interface Topic {
  icon: string
  tone: string
  title: string
  body: string
  action?: string
  to?: string
  actionLabel?: string
}

const topics: Topic[] = [
  {
    icon: 'search',
    tone: 'accent',
    title: '检索工具',
    body: '支持中文名、英文名、缩写与别名（如“国密”“b64”“时间戳”）。结果按分类分组，↑↓ 选择、Enter 打开。',
    action: 'palette'
  },
  {
    icon: 'upload',
    tone: 'file',
    title: '导入文件',
    body: '从本机选择或拖入文件，读取与处理都在浏览器内完成；过程中可取消，失败时保留原文件供重试。',
    to: '/tools/file-digest',
    actionLabel: '打开文件摘要'
  },
  {
    icon: 'copy',
    tone: 'text',
    title: '复制与下载',
    body: '复制内容不包含行号、地址偏移与语法提示；需要真实换行的文本保留原文换行。',
    to: '/tools/base64',
    actionLabel: '打开 Base64 工具'
  },
  {
    icon: 'hash',
    tone: 'web',
    title: '参数与编码',
    body: '改编码或模式会改变字节结果，因此参数变化后旧输出会标记为“待更新”，需重新执行。',
    to: '/tools/hmac',
    actionLabel: '打开 HMAC 工具'
  }
]

const shortcuts = computed(() => [
  { action: '打开全局搜索', win: 'Ctrl + K', mac: '⌘ + K' },
  { action: '关闭搜索或弹层', win: 'Esc', mac: 'Esc' },
  { action: '在搜索结果间移动', win: '↑ / ↓', mac: '↑ / ↓' },
  { action: '打开选中结果', win: 'Enter', mac: 'Enter' },
  { action: '在支持的工具中执行主操作', win: 'Ctrl + Enter', mac: '⌘ + Enter' },
  { action: '切换明暗主题', win: '顶栏按钮', mac: '顶栏按钮' }
])

const faq = [
  {
    icon: 'languages',
    title: '字符与字节的区别',
    to: '/tools/unicode-bytes',
    rows: [
      { name: '字符数', desc: '按 Unicode 码点计数' },
      { name: '字节数', desc: '按 UTF-8 编码后的长度' },
      { name: '中文与 emoji', desc: '汉字 1 字符 = 3 字节；emoji 多为 4 字节' },
      { name: '大整数', desc: '保留原始数字文本，不转成浮点' }
    ]
  },
  {
    icon: 'alert-triangle',
    title: '结果为什么会“待更新”',
    to: '/tools/json-format',
    rows: [
      { name: '触发条件', desc: '修改输入或影响计算的参数后' },
      { name: '旧结果', desc: '保留可查看，并明确标为旧结果' },
      { name: '复制与下载', desc: '待更新期间默认禁用' },
      { name: '恢复', desc: '重新执行成功后恢复可用' }
    ]
  }
]

const toneVars: Record<string, [string, string]> = {
  accent: ['var(--accent-soft)', 'var(--accent)'],
  file: ['var(--cat-file-soft)', 'var(--cat-file)'],
  text: ['var(--cat-text-soft)', 'var(--cat-text)'],
  web: ['var(--cat-web-soft)', 'var(--cat-web)'],
  api: ['var(--cat-api-soft)', 'var(--cat-api)'],
  time: ['var(--cat-time-soft)', 'var(--cat-time)']
}

function tone(t: string) {
  return toneVars[t] ?? toneVars.accent!
}
</script>

<template>
  <div class="help">
    <header class="help__head">
      <div class="help__title">
        <span class="help__icon"><DkIcon name="help" :size="17" /></span>
        <div>
          <h1 class="help__name">帮助与快捷键</h1>
          <p class="help__desc">工具检索、文件导入、复制下载、字符与字节口径，以及结果状态说明。</p>
        </div>
      </div>
      <NuxtLink to="/privacy" class="help__local" title="了解本地处理与隐私">
        <DkIcon name="shield-check" :size="13" />
        本地处理
      </NuxtLink>
    </header>

    <section class="panel">
      <div class="quick">
        <article v-for="t in topics" :key="t.title" class="card card--soft">
          <div class="card__head">
            <span class="card__icon" :style="{ background: tone(t.tone)[0], color: tone(t.tone)[1] }">
              <DkIcon :name="t.icon" :size="14" />
            </span>
            <h2 class="card__title">{{ t.title }}</h2>
          </div>
          <p class="card__body">{{ t.body }}</p>
          <div class="card__action">
            <DkButton v-if="t.action === 'palette'" size="sm" @click="palette.show()">
              <DkIcon name="search" :size="13" />打开搜索（Ctrl / ⌘ K）
            </DkButton>
            <NuxtLink v-else :to="t.to">
              <DkButton size="sm"><DkIcon name="arrow-right" :size="13" />{{ t.actionLabel }}</DkButton>
            </NuxtLink>
          </div>
        </article>
      </div>

      <section class="kbd">
        <div class="kbd__head">
          <DkIcon name="keyboard" :size="14" style="color: var(--cat-time)" />
          <h2 class="card__title">快捷键对照</h2>
          <span class="grow"></span>
          <span class="kbd__note">同时给出 Windows / Linux 与 macOS 写法；macOS 快捷键不是唯一操作方式</span>
        </div>
        <table class="kbd__table">
          <thead>
            <tr>
              <th>操作</th>
              <th>Windows / Linux</th>
              <th>macOS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shortcuts" :key="s.action">
              <td>{{ s.action }}</td>
              <td class="mono">{{ s.win }}</td>
              <td class="mono">{{ s.mac }}</td>
            </tr>
          </tbody>
        </table>
        <p class="kbd__foot">
          复制、下载、清空输入、显示 / 隐藏密钥、只看输入 / 只看结果目前通过界面按钮完成，未绑定键盘快捷键；Ctrl / ⌘ + Enter 也只在部分工具中可用。
        </p>
      </section>

      <div class="faq">
        <section v-for="f in faq" :key="f.title" class="faq__col">
          <div class="faq__head">
            <DkIcon :name="f.icon" :size="14" style="color: var(--text-tertiary)" />
            <h2 class="card__title">{{ f.title }}</h2>
            <span class="grow"></span>
            <NuxtLink :to="f.to" class="faq__link">打开工具</NuxtLink>
          </div>
          <div v-for="r in f.rows" :key="r.name" class="faq__row">
            <span class="faq__name">{{ r.name }}</span>
            <span class="grow"></span>
            <span class="faq__desc">{{ r.desc }}</span>
          </div>
        </section>
      </div>

      <div class="duo">
        <article class="card card--soft">
          <div class="card__head">
            <span class="card__icon" style="background: var(--cat-api-soft); color: var(--cat-api)">
              <DkIcon name="send" :size="14" />
            </span>
            <h2 class="card__title">反馈入口的位置</h2>
          </div>
          <p class="card__body">
            顶部导航右侧有「源码」外链入口（指向 github.com/39499740/devkit）。本站没有内置反馈表单或工单系统，不会显示提交成功，也不会产生真实工单。
          </p>
        </article>
        <article class="card card--soft">
          <div class="card__head">
            <span class="card__icon" style="background: var(--cat-time-soft); color: var(--cat-time)">
              <DkIcon name="wifi-off" :size="14" />
            </span>
            <h2 class="card__title">离线与缓存</h2>
          </div>
          <p class="card__body">
            页面资源本身仍需联网加载。是否可离线使用取决于该工具是否已被缓存，详见
            <NuxtLink to="/offline" class="card__inline">离线状态页</NuxtLink>。
          </p>
        </article>
      </div>
    </section>

    <section class="outro">
      <div>
        <h2 class="outro__title">返回工具继续操作</h2>
        <p class="outro__desc">每个工具页的说明区都包含与自身相关的最小帮助；更完整的解释始终在本页。</p>
      </div>
      <div class="outro__actions">
        <NuxtLink to="/"><DkButton variant="primary" size="sm"><DkIcon name="grid" :size="13" />返回全部工具</DkButton></NuxtLink>
        <NuxtLink to="/settings"><DkButton size="sm"><DkIcon name="sliders" :size="13" />偏好设置</DkButton></NuxtLink>
        <NuxtLink to="/privacy"><DkButton size="sm"><DkIcon name="shield-check" :size="13" />隐私说明</DkButton></NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.help {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.help__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.help__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.help__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.help__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.help__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.help__local {
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
.help__local:hover {
  text-decoration: none;
  color: var(--accent);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px 30px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.quick {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.card--soft {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}
.card__head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  flex-shrink: 0;
}
.card__title {
  font-size: 13px;
  font-weight: 600;
}
.card__body {
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.card__inline {
  color: var(--accent);
}
.card__action {
  margin-top: 12px;
  display: flex;
}
.kbd {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.kbd__head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.kbd__note {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: right;
}
.kbd__table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 12px;
}
.kbd__table th,
.kbd__table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.kbd__table thead th {
  background: var(--surface-subtle);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.kbd__table tbody tr:last-child td {
  border-bottom: none;
}
.kbd__table td:first-child {
  font-size: 12.5px;
  color: var(--text-primary);
}
.kbd__table td.mono {
  color: var(--text-secondary);
  font-size: 12px;
}
.kbd__table th:nth-child(2),
.kbd__table td:nth-child(2) {
  width: 220px;
}
.kbd__table th:nth-child(3),
.kbd__table td:nth-child(3) {
  width: 160px;
}
.kbd__foot {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.faq {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.faq__col {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.faq__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.faq__link {
  font-size: 11.5px;
  color: var(--accent);
}
.faq__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.faq__name {
  font-size: 12px;
  font-weight: 500;
}
.faq__desc {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
}
.duo {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.outro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 4px;
}
.outro__title {
  font-size: 13.5px;
  font-weight: 600;
}
.outro__desc {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.outro__actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
@media (max-width: 1240px) {
  .quick {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .faq,
  .duo {
    grid-template-columns: 1fr;
  }
  .kbd__head {
    flex-wrap: wrap;
  }
  .kbd__note {
    text-align: left;
    width: 100%;
  }
  .outro {
    flex-direction: column;
    align-items: flex-start;
  }
  .outro__actions {
    flex-wrap: wrap;
  }
}
@media (max-width: 620px) {
  .quick {
    grid-template-columns: 1fr;
  }
  .faq__name,
  .faq__desc {
    text-align: left;
  }
}
</style>
