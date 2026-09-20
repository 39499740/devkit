<script setup lang="ts">
import { toolCount } from '~/data/tools'

useSeo({
  title: '本地处理与隐私 · DevKit',
  description: 'DevKit 如何处理你的输入、偏好与文件：计算全部在浏览器本地完成，并说明访问统计的采集范围与关闭方式。'
})

interface Principle {
  icon: string
  tone: string
  title: string
  body: string
  badge?: string
}

const principles: Principle[] = [
  {
    icon: 'shield-check',
    tone: 'accent',
    title: '浏览器本地计算',
    body: '输入、转换、摘要、加解密全部在你的浏览器中执行，页面不会把内容发送到服务器。',
    badge: '默认'
  },
  {
    icon: 'wifi-off',
    tone: 'time',
    title: '静态资源仍需加载',
    body: '首次打开仍需从网络加载页面、字体与脚本；加载完成后，已缓存工具即可离线使用。'
  },
  {
    icon: 'history',
    tone: 'text',
    title: '不提供云端历史',
    body: '没有账号、没有云端同步；工具输入只会留在当前页面，刷新即消失。除匿名页面访问量外，服务端不记录任何工具输入。'
  }
]

const stages = [
  { icon: 'corner-down-left', name: '你的输入', desc: '键盘粘贴或本机文件' },
  { icon: 'zap', name: '浏览器内处理', desc: 'Web Crypto / 本地解析' },
  { icon: 'download', name: '结果与导出', desc: '复制或保存到本机' }
]

const saved = [
  { icon: 'sliders', tone: 'accent', name: '界面偏好', desc: '主题、代码字号、缩进、自动换行' },
  { icon: 'clock', tone: 'time', name: '最近使用记录', desc: '仅工具名称与访问时间' },
  { icon: 'star', tone: 'star', name: '收藏', desc: '工具标识与收藏时间，不含输入' },
  { icon: 'info', tone: 'tertiary', name: '可关闭项', desc: '以上均可在偏好设置中清空' }
]

const unsaved = [
  { name: '输入正文', desc: '不含编辑器内容' },
  { name: '密钥与 IV', desc: '不写入本地存储' },
  { name: 'Token 与认证头', desc: '不记录、不入 URL' },
  { name: '原始文件', desc: '留在本机，不上传' }
]

const triggers = [
  {
    icon: 'copy',
    tone: 'web',
    title: '剪贴板与下载由你主动触发',
    body: '只有点击复制或下载时才会写入剪贴板、保存文件；若浏览器未授权剪贴板，会提示手动选择文本，不会自动重试。'
  },
  {
    icon: 'wifi-off',
    tone: 'api',
    title: '离线可用性以缓存状态为准',
    body: '已缓存工具可继续本地处理；首次访问且未缓存的工具无法加载，可重试或改用已缓存工具。'
  }
]

const boundaries = [
  {
    icon: 'alert-triangle',
    tone: 'warn',
    title: '我们不作过度承诺',
    body: '本地处理降低传输风险，但不代表绝对安全：设备、浏览器扩展与剪贴板仍可能被他人访问。'
  },
  {
    icon: 'activity',
    tone: 'tertiary',
    title: '性能取决于你的设备',
    body: '超大文件与超长文本的耗时取决于本机内存与 CPU，我们会明确提示当前限制并提供取消。'
  }
]

const toneVars: Record<string, [string, string]> = {
  accent: ['var(--accent-soft)', 'var(--accent)'],
  time: ['var(--cat-time-soft)', 'var(--cat-time)'],
  text: ['var(--cat-text-soft)', 'var(--cat-text)'],
  web: ['var(--cat-web-soft)', 'var(--cat-web)'],
  api: ['var(--cat-api-soft)', 'var(--cat-api)'],
  warn: ['var(--warn-soft)', 'var(--warn)'],
  star: ['var(--accent-soft)', 'var(--star)'],
  tertiary: ['var(--surface)', 'var(--text-secondary)']
}

function tone(t: string) {
  return toneVars[t] ?? toneVars.tertiary!
}

const runtime = useRuntimeConfig()
const statsOn = computed(
  () => Boolean(runtime.public.analytics.provider) && Boolean(runtime.public.analytics.siteId)
)
const statsName = computed(() => (runtime.public.analytics.provider === 'cnzz' ? 'CNZZ 站长统计' : '百度统计'))
</script>

<template>
  <div class="privacy">
    <header class="privacy__head">
      <div class="privacy__title">
        <span class="privacy__icon"><DkIcon name="shield-check" :size="17" /></span>
        <div>
          <h1 class="privacy__name">本地处理与隐私</h1>
          <p class="privacy__desc">了解 DevKit 在浏览器内如何处理你的输入、偏好与文件。</p>
        </div>
      </div>
      <NuxtLink to="/help" class="privacy__local" title="查看帮助与快捷键">
        <DkIcon name="shield-check" :size="13" />
        本地处理
      </NuxtLink>
    </header>

    <section class="panel">
      <div class="principles">
        <article v-for="p in principles" :key="p.title" class="card card--soft">
          <div class="card__head">
            <span class="card__icon" :style="{ background: tone(p.tone)[0], color: tone(p.tone)[1] }">
              <DkIcon :name="p.icon" :size="14" />
            </span>
            <h2 class="card__title">{{ p.title }}</h2>
            <span v-if="p.badge" class="grow"></span>
            <span v-if="p.badge" class="badge badge--ok">{{ p.badge }}</span>
          </div>
          <p class="card__body">{{ p.body }}</p>
        </article>
      </div>

      <section class="flow card--soft">
        <div class="card__head">
          <DkIcon name="swap" :size="14" style="color: var(--accent)" />
          <h2 class="card__title">数据流向</h2>
          <span class="grow"></span>
          <span class="badge badge--ok"><DkIcon name="shield-check" :size="12" />全程不离开你的设备</span>
        </div>
        <div class="flow__steps">
          <template v-for="(s, i) in stages" :key="s.name">
            <div class="flow__step">
              <DkIcon :name="s.icon" :size="16" style="color: var(--accent)" />
              <div>
                <p class="flow__name">{{ s.name }}</p>
                <p class="flow__desc">{{ s.desc }}</p>
              </div>
            </div>
            <DkIcon v-if="i < stages.length - 1" name="arrow-right" :size="16" class="flow__arrow" />
          </template>
        </div>
      </section>

      <div class="scope">
        <section class="scope__col">
          <h2 class="scope__title">会保存在本地的内容</h2>
          <div v-for="s in saved" :key="s.name" class="scope__row">
            <DkIcon :name="s.icon" :size="14" :style="{ color: tone(s.tone)[1] }" />
            <span class="scope__name">{{ s.name }}</span>
            <span class="grow"></span>
            <span class="scope__desc">{{ s.desc }}</span>
          </div>
        </section>
        <section class="scope__col">
          <h2 class="scope__title">不会保存的内容</h2>
          <div v-for="u in unsaved" :key="u.name" class="scope__row">
            <DkIcon name="x" :size="14" style="color: var(--error)" />
            <span class="scope__name">{{ u.name }}</span>
            <span class="grow"></span>
            <span class="scope__desc">{{ u.desc }}</span>
          </div>
        </section>
      </div>

      <div class="duo">
        <article v-for="t in triggers" :key="t.title" class="card card--soft">
          <div class="card__head">
            <span class="card__icon" :style="{ background: tone(t.tone)[0], color: tone(t.tone)[1] }">
              <DkIcon :name="t.icon" :size="14" />
            </span>
            <h2 class="card__title">{{ t.title }}</h2>
          </div>
          <p class="card__body">{{ t.body }}</p>
        </article>
      </div>

      <div class="duo">
        <article v-for="b in boundaries" :key="b.title" class="card card--soft">
          <div class="card__head">
            <span class="card__icon" :style="{ background: tone(b.tone)[0], color: tone(b.tone)[1] }">
              <DkIcon :name="b.icon" :size="14" />
            </span>
            <h2 class="card__title">{{ b.title }}</h2>
          </div>
          <p class="card__body">{{ b.body }}</p>
        </article>
      </div>

      <section class="card--soft">
        <div class="card__head">
          <DkIcon name="activity" :size="14" style="color: var(--accent)" />
          <h2 class="card__title">访问统计</h2>
          <span class="grow"></span>
          <span class="badge badge--ok">{{ statsOn ? '已启用 · 可关闭' : '未启用' }}</span>
        </div>
        <p v-if="statsOn" class="card__body">
          本站使用第三方统计服务（{{ statsName }}）了解有多少人访问、哪些工具最常被打开。它会记录页面路径、来源、访问时间、浏览器与设备信息，以及由服务商处理的 IP，并写入它自己的 Cookie 或本地标识用于区分访客（UV）；上报的路径不含 query 与 hash，输入框内容、密钥、Token 与文件从不上报。
        </p>
        <p v-else class="card__body">
          当前构建未接入任何第三方统计脚本，也没有其它形式的用户行为采集；服务端只保留静态资源访问日志。
        </p>
        <p v-if="statsOn" class="card__body">
          你可以在 <NuxtLink to="/settings">偏好设置</NuxtLink> →「匿名访问统计」随时关闭：关闭后不再加载统计脚本，已加载的也不再补报页面切换。浏览器开启 DNT / GPC 时同样不会被统计。
        </p>
        <p v-else class="card__body">
          若后续接入统计，会先在本页说明采集范围，并在 <NuxtLink to="/settings">偏好设置</NuxtLink> 提供关闭开关。
        </p>
      </section>
    </section>

    <section class="outro">
      <div>
        <h2 class="outro__title">返回并继续处理</h2>
        <p class="outro__desc">
          本说明适用于全部 {{ toolCount }} 个工具；每个工具页顶部的“本地处理”标记指向同一份说明。
        </p>
      </div>
      <div class="outro__actions">
        <NuxtLink to="/"><DkButton variant="primary" size="sm"><DkIcon name="grid" :size="13" />返回全部工具</DkButton></NuxtLink>
        <NuxtLink to="/help"><DkButton size="sm"><DkIcon name="keyboard" :size="13" />帮助与快捷键</DkButton></NuxtLink>
        <NuxtLink to="/offline"><DkButton size="sm"><DkIcon name="wifi-off" :size="13" />查看离线说明</DkButton></NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.privacy {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.privacy__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.privacy__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.privacy__icon {
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
.privacy__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.privacy__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.privacy__local {
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
.privacy__local:hover {
  text-decoration: none;
  color: var(--accent);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 28px 30px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.card--soft {
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
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.principles,
.duo {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.principles {
  grid-template-columns: repeat(3, 1fr);
}
.duo {
  gap: 20px;
}
.flow {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.flow__steps {
  display: flex;
  align-items: center;
  gap: 12px;
}
.flow__step {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.flow__arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.flow__name {
  font-size: 12.5px;
  font-weight: 600;
}
.flow__desc {
  font-size: 10.5px;
  color: var(--text-tertiary);
}
.scope {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.scope__col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.scope__title {
  font-size: 13px;
  font-weight: 600;
}
.scope__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.scope__name {
  font-size: 12px;
  font-weight: 500;
}
.scope__desc {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
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
@media (max-width: 900px) {
  .principles {
    grid-template-columns: 1fr;
  }
  .scope,
  .duo {
    grid-template-columns: 1fr;
  }
  .flow__steps {
    flex-direction: column;
    align-items: stretch;
  }
  .flow__arrow {
    align-self: center;
    transform: rotate(90deg);
  }
  .outro {
    flex-direction: column;
    align-items: flex-start;
  }
  .outro__actions {
    flex-wrap: wrap;
  }
}
</style>
