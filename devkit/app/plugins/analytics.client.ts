/**
 * 站长统计：只在浏览器端注入第三方统计脚本，未配置 provider / siteId 时完全不加载。
 * - 单页路由切换手动补报 PV（第三方脚本自身只统计进入页面时的第一次）；
 * - 只上报路径，不带 query / hash，避免把任何输入带出去；
 * - 尊重 DNT / GPC，开发环境不上报；
 * - 偏好设置关闭「匿名访问统计」后不再加载脚本，已加载的也不再补报。
 */
interface AnalyticsConfig {
  provider: string
  siteId: string
}

interface AnalyticsAdapter {
  src: (cfg: AnalyticsConfig) => string
  queue?: string
  trackPageview?: (path: string) => void
}

const ADAPTERS: Record<string, AnalyticsAdapter> = {
  baidu: {
    queue: '_hmt',
    src: (cfg) => `https://hm.baidu.com/hm.js?${encodeURIComponent(cfg.siteId)}`,
    trackPageview: (path) => pushQueue('_hmt', ['_trackPageview', path])
  },
  cnzz: {
    queue: '_czc',
    src: (cfg) =>
      `https://s4.cnzz.com/z_stat.php?id=${encodeURIComponent(cfg.siteId)}&web_id=${encodeURIComponent(cfg.siteId)}`,
    trackPageview: (path) => pushQueue('_czc', ['_trackPageview', path])
  }
}

function pushQueue(name: string, args: unknown[]) {
  const w = window as unknown as Record<string, unknown[]>
  w[name] = w[name] || []
  w[name].push(args)
}

/** 偏好状态可能晚于插件初始化才从 localStorage 同步，这里以本地值为准兜底 */
function readStoredAnalytics(): boolean | undefined {
  try {
    const raw = localStorage.getItem('devkit.prefs.v1')
    if (!raw) return undefined
    const value = (JSON.parse(raw) as { analytics?: unknown }).analytics
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const cfg = useRuntimeConfig().public.analytics as AnalyticsConfig
  const adapter = cfg.provider ? ADAPTERS[cfg.provider] : undefined
  if (!adapter || import.meta.dev) return

  const { queue, trackPageview } = adapter
  const src = adapter.src(cfg)
  if (!/^https:\/\/[\w.-]+\//.test(src)) return

  const nav = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean }
  if (nav.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl) return

  const prefState = useState<{ analytics?: boolean } | undefined>('devkit-prefs', () => undefined)
  const allowed = () => prefState.value?.analytics !== false && readStoredAnalytics() !== false

  let injected = false
  // 第三方脚本自己会统计进入页面时的这一次，避免重复计数
  let reported = window.location.pathname

  function inject() {
    if (injected || !allowed()) return
    injected = true
    const globals = window as unknown as Record<string, unknown>
    if (queue && !Array.isArray(globals[queue])) globals[queue] = []
    const el = document.createElement('script')
    el.async = true
    el.src = src
    el.dataset.devkitAnalytics = cfg.provider
    document.head.appendChild(el)
  }

  function report(path: string) {
    if (!injected || !allowed() || !trackPageview || path === reported) return
    reported = path
    trackPageview(path)
  }

  nuxtApp.hook('app:mounted', () => {
    inject()
  })

  watch(
    () => prefState.value?.analytics,
    (on) => {
      if (on) inject()
      report(window.location.pathname)
    }
  )

  nuxtApp.$router.afterEach((to) => {
    report(to.path)
  })
})
