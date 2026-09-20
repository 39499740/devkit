<script setup lang="ts">
import { tools } from '~/data/tools'

useSeo({
  title: '离线与缓存状态 · DevKit',
  description: '查看 DevKit 的 Service Worker 与浏览器缓存状态，了解哪些工具已经可以离线使用。'
})

const PAGE_CACHE = 'devkit-pages'
const PRECACHE_PREFIX = 'workbox-precache'

const ready = ref(false)
const online = ref(true)
const swSupported = ref(false)
const swRegistered = ref(false)
const swControlled = ref(false)
const swStateValue = ref('')
const cacheNames = ref<string[]>([])
const cachedRoutes = ref<string[]>([])
const precacheCount = ref(0)
const checking = ref(false)
const lastProbe = ref('')
const lastChecked = ref('')

type OfflineState = 'checking' | 'unsupported' | 'unregistered' | 'uncached' | 'controlled'

const state = computed<OfflineState>(() => {
  if (!ready.value) return 'checking'
  if (!swSupported.value) return 'unsupported'
  if (swControlled.value) return 'controlled'
  if (swRegistered.value) return 'uncached'
  return 'unregistered'
})

const toolPath = (slug: string) => `/tools/${slug}`

const cachedTools = computed(() => tools.filter((t) => cachedRoutes.value.includes(toolPath(t.slug))))
const uncachedTools = computed(() => tools.filter((t) => !cachedRoutes.value.includes(toolPath(t.slug))))

const title = computed(() => {
  switch (state.value) {
    case 'checking':
      return '正在检测离线缓存状态'
    case 'unsupported':
      return '当前浏览器不支持离线缓存'
    case 'unregistered':
      return '离线缓存尚未注册'
    case 'uncached':
      return '首次访问尚未缓存'
    default:
      return online.value ? '离线缓存已接管' : '离线模式 · 已缓存'
  }
})

const desc = computed(() => {
  switch (state.value) {
    case 'checking':
      return '正在读取 Service Worker 与浏览器 Cache Storage 的真实状态。'
    case 'unsupported':
      return '该浏览器没有可用的 Service Worker，DevKit 无法把页面与静态资源预缓存到本机，离线时只能依赖浏览器自身的 HTTP 缓存，不保证可用。'
    case 'unregistered':
      return '当前页面没有检测到已注册的 Service Worker。开发服务器默认不注册；生产构建首次加载后会自动注册，刷新一次即可接管。'
    case 'uncached':
      return 'Service Worker 已注册但尚未接管本页面，页面脚本与样式必须至少在线加载一次才能离线使用。'
    default:
      return online.value
        ? 'Service Worker 已接管本页面，已缓存的资源与页面可在断网时继续打开。'
        : '设备当前离线，但已缓存的工具仍可继续在本地处理。'
  }
})

const bannerTitle = computed(() => {
  if (!ready.value) return '正在读取缓存状态'
  if (state.value === 'controlled') return online.value ? '离线缓存已就绪' : '当前离线，正在使用本地缓存'
  if (state.value === 'uncached') return '首次访问尚未缓存'
  if (state.value === 'unregistered') return 'Service Worker 未注册'
  return '浏览器不支持离线缓存'
})

const bannerDesc = computed(() => {
  if (!ready.value) return '正在读取 Service Worker 与 Cache Storage。'
  if (state.value === 'controlled') {
    return precacheCount.value > 0
      ? `已预缓存 ${precacheCount.value} 项脚本、样式与图标；字体与其它资源在首次显示时按需缓存，已访问过的页面导航也保存在本机。未缓存的页面仍需联网一次。`
      : 'Service Worker 已接管，但当前没有检测到预缓存条目，离线能力取决于浏览器缓存。'
  }
  if (state.value === 'uncached') return '已注册但尚未接管：加载一次后页面才会进入缓存。离线不等于所有工具都不可用。'
  if (state.value === 'unregistered') return '未检测到注册记录，离线时页面能否打开取决于浏览器自身的缓存，不保证可用。'
  return '没有可用于预缓存的 Service Worker，DevKit 不会声称任何页面可离线打开。'
})

function loadCached() {
  if (import.meta.server) return Promise.resolve()
  const nav = navigator
  swSupported.value = 'serviceWorker' in nav
  online.value = nav.onLine
  return (async () => {
    let registration: ServiceWorkerRegistration | null = null
    try {
      registration = swSupported.value ? ((await nav.serviceWorker.getRegistration()) ?? null) : null
    } catch {
      registration = null
    }
    swRegistered.value = !!registration
    swControlled.value = !!(nav.serviceWorker && nav.serviceWorker.controller)
    swStateValue.value =
      registration?.active?.state ?? registration?.waiting?.state ?? registration?.installing?.state ?? ''

    let names: string[] = []
    try {
      names = await caches.keys()
    } catch {
      names = []
    }
    cacheNames.value = names
    let routes: string[] = []
    let precache = 0
    for (const name of names) {
      try {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        if (name === PAGE_CACHE) {
          routes = keys.map((req) => {
            try {
              return new URL(req.url).pathname
            } catch {
              return req.url
            }
          })
        } else if (name.startsWith(PRECACHE_PREFIX)) {
          precache += keys.length
        }
      } catch {
        continue
      }
    }
    cachedRoutes.value = routes
    precacheCount.value = precache
  })()
}

async function refresh() {
  if (import.meta.server) return
  await loadCached()
}

async function retry() {
  if (checking.value) return
  checking.value = true
  lastProbe.value = ''
  let note = ''
  try {
    if (swSupported.value) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.update()
        note = '已触发 Service Worker 更新检查'
      } else {
        note = '未找到 Service Worker 注册'
      }
    } else {
      note = '浏览器不支持 Service Worker'
    }
  } catch (e) {
    note = `更新检查失败：${errMessage(e)}`
  }
  let reachable = false
  let failure = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    await fetch(`${location.origin}/pwa-192.png?_=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal
    })
    reachable = true
  } catch (e) {
    failure = errMessage(e)
  } finally {
    clearTimeout(timer)
  }
  await refresh()
  lastProbe.value = `${reachable ? '可访问本站静态资源' : `无法访问本站静态资源（${failure}）`}；${note}`
  lastChecked.value = new Date().toLocaleTimeString()
  checking.value = false
}

let registration: ServiceWorkerRegistration | null = null
function onControllerChange() {
  void refresh()
}

onMounted(() => {
  void (async () => {
    await refresh()
    ready.value = true
    try {
      registration = (await navigator.serviceWorker?.getRegistration()) ?? null
      registration?.addEventListener('updatefound', onControllerChange)
      navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange)
    } catch {
      registration = null
    }
  })()
  window.addEventListener('online', onControllerChange)
  window.addEventListener('offline', onControllerChange)
})

onUnmounted(() => {
  window.removeEventListener('online', onControllerChange)
  window.removeEventListener('offline', onControllerChange)
  navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange)
  registration?.removeEventListener('updatefound', onControllerChange)
})
</script>

<template>
  <div class="offline">
    <div class="offline__state">
      <span
        class="offline__icon"
        :class="state === 'controlled' ? 'offline__icon--ok' : 'offline__icon--off'"
      >
        <DkIcon :name="state === 'controlled' ? 'shield-check' : 'wifi-off'" :size="22" />
      </span>
      <h1 class="offline__title">{{ title }}</h1>
      <p class="offline__desc">{{ desc }}</p>
      <div class="offline__banner">
        <DkIcon :name="state === 'controlled' ? 'check' : 'alert-triangle'" :size="16" />
        <span>
          <strong>{{ bannerTitle }}</strong>
          {{ bannerDesc }}
        </span>
      </div>
      <div class="offline__facts">
        <span>Service Worker：{{ swSupported ? (swRegistered ? `已注册${swStateValue ? `（${swStateValue}）` : ''}` : '未注册') : '不支持' }}</span>
        <span>当前页面接管：{{ swControlled ? '是' : '否' }}</span>
        <span>预缓存条目：{{ precacheCount }}</span>
        <span>Cache Storage：{{ cacheNames.length }} 个缓存</span>
      </div>
      <div class="offline__actions">
        <DkButton variant="primary" :loading="checking" @click="retry">
          <DkIcon name="refresh" :size="13" />重新检测
        </DkButton>
        <NuxtLink to="/" class="offline__link">返回首页</NuxtLink>
      </div>
      <p v-if="lastChecked" class="offline__probe">{{ lastChecked }} 检测结果：{{ lastProbe }}</p>
    </div>

    <section v-if="state === 'controlled'" class="offline__list">
      <div class="offline__columns">
        <div class="offline__col">
          <h2 class="offline__list-title">已缓存 · 可离线打开（{{ cachedTools.length }}）</h2>
          <p v-if="!cachedTools.length" class="offline__list-empty">
            缓存中没有已访问的工具页面。在线打开一次工具后，页面导航会被保存到本机，随后可离线打开。
          </p>
          <div v-else class="offline__grid">
            <NuxtLink
              v-for="t in cachedTools"
              :key="t.id"
              :to="toolPath(t.slug)"
              class="offline__item"
            >
              <span
                class="offline__item-icon"
                :style="{ background: `var(--cat-${t.cat}-soft)`, color: `var(--cat-${t.cat})` }"
              >
                <DkIcon :name="t.icon" :size="14" />
              </span>
              <span class="offline__item-name">{{ t.name }}</span>
              <span class="offline__item-badge offline__item-badge--ok">可离线</span>
            </NuxtLink>
          </div>
        </div>
        <div class="offline__col">
          <h2 class="offline__list-title">未缓存 · 需要联网（{{ uncachedTools.length }}）</h2>
          <p class="offline__list-empty">
            这些工具尚未访问或未进入本机缓存，离线时无法加载。在线打开一次后即可加入上方缓存。
          </p>
          <div class="offline__grid">
            <div v-for="t in uncachedTools" :key="t.id" class="offline__item offline__item--muted">
              <span
                class="offline__item-icon"
                :style="{ background: `var(--cat-${t.cat}-soft)`, color: `var(--cat-${t.cat})` }"
              >
                <DkIcon :name="t.icon" :size="14" />
              </span>
              <span class="offline__item-name">{{ t.name }}</span>
              <span class="offline__item-badge">需联网</span>
            </div>
          </div>
        </div>
      </div>
      <p class="offline__note">
        缓存由浏览器按页面与资源粒度决定：即使同一分类，也可能只有部分工具被缓存。DevKit
        不会声称所有工具都可离线使用。
      </p>
    </section>

    <section v-else class="offline__list">
      <h2 class="offline__list-title">当前可离线使用范围</h2>
      <p class="offline__list-empty">
        {{
          state === 'checking'
            ? '正在检测，检测完成后会列出真实的可离线范围。'
            : 'Service Worker 尚未接管当前页面，因此没有任何页面被确认预缓存。恢复网络并刷新一次后，DevKit 会注册并接管，届时这里会列出真实的可离线工具。'
        }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.offline {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.offline__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 32px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.offline__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
}
.offline__icon--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.offline__icon--off {
  background: var(--warn-soft);
  color: var(--warn);
}
.offline__title {
  font-size: 18px;
  font-weight: 700;
}
.offline__desc {
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 520px;
}
.offline__banner {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 8px;
  padding: 10px 14px;
  max-width: 620px;
  text-align: left;
  font-size: 12.5px;
  color: var(--text-secondary);
  background: var(--warn-soft);
  border-radius: var(--radius-sm);
}
.offline__banner strong {
  display: block;
  font-weight: 600;
  color: var(--text-primary);
}
.offline__facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 14px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.offline__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.offline__link {
  font-size: 12.5px;
}
.offline__probe {
  font-size: 12px;
  color: var(--text-secondary);
  max-width: 620px;
  word-break: break-word;
}
.offline__columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
}
.offline__col {
  min-width: 0;
}
.offline__list-title {
  font-size: 14px;
  font-weight: 600;
}
.offline__list-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 6px;
}
.offline__grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.offline__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-primary);
  transition: border-color 0.12s;
}
.offline__item:hover {
  border-color: var(--accent-ring);
  text-decoration: none;
}
.offline__item--muted {
  opacity: 0.72;
}
.offline__item--muted:hover {
  border-color: var(--border);
}
.offline__item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  flex: none;
}
.offline__item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.offline__item-badge {
  flex: none;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--surface-subtle);
  border-radius: 10px;
}
.offline__item-badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.offline__note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
