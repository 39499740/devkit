/**
 * S13 / G10 PWA 状态：安装能力、离线状态与版本更新。
 * 优先使用 @vite-pwa/nuxt 注入的 $pwa（响应式），并补上它没有提供的在线/离线与条件检查；
 * 文案全部按运行时真实状态输出，不写死版本号或缓存条目数。
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaRuntime {
  offlineReady?: boolean
  needRefresh?: boolean
  isPWAInstalled?: boolean
  showInstallPrompt?: boolean
  swActivated?: boolean
  install?: () => Promise<{ outcome: 'accepted' | 'dismissed' } | undefined>
  cancelPrompt?: () => void
  updateServiceWorker?: (reload?: boolean) => Promise<void>
}

/** 会话级「稍后」标记：同一次会话里不重复弹更新提示 */
const UPDATE_SNOOZE_KEY = 'devkit.pwa.update-snooze'

export function usePwa() {
  const installed = ref(false)
  const installable = ref(false)
  const offlineReady = ref(false)
  const needRefresh = ref(false)
  const online = ref(true)
  const swRegistered = ref(false)
  const swActivated = ref(false)
  const manifestReady = ref(false)
  const initialized = ref(false)

  // 用 shallowRef 而不是普通变量：安装入口是否可用要能驱动 UI 更新，
  // 同时又不能把事件对象包成 Proxy（prompt() 必须是原始事件实例的方法）
  const deferred = shallowRef<InstallPromptEvent | null>(null)
  let runtime: PwaRuntime | undefined

  /**
   * 是否真的能唤起安装弹窗：只有浏览器确实给过 beforeinstallprompt（我们自己接到的 deferred，
   * 或 $pwa.showInstallPrompt 为 true）才算。
   * 不能用「$pwa.install 函数存在」来判断——那个函数永远存在，会让按钮一直可点，
   * 点下去却拿不到弹窗，只能报「当前浏览器没有给出安装入口」。
   */
  const canPrompt = computed(() => !!deferred.value || runtime?.showInstallPrompt === true)

  function onBeforeInstall(e: Event) {
    e.preventDefault()
    deferred.value = e as InstallPromptEvent
    installable.value = true
  }

  function onInstalled() {
    installed.value = true
    installable.value = false
    deferred.value = null
  }

  function onOnline() {
    online.value = true
  }

  function onOffline() {
    online.value = false
  }

  /**
   * 唤起安装弹窗：优先用我们自己接到的 beforeinstallprompt（同一个事件实例只能 prompt 一次），
   * 再兜底 @vite-pwa/nuxt 的 $pwa.install()；都没有时返回 unavailable，由调用方给出手动步骤。
   */
  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (installed.value) return 'unavailable'
    if (deferred.value) {
      const event = deferred.value
      deferred.value = null
      installable.value = false
      await event.prompt()
      const choice = await event.userChoice
      return choice.outcome
    }
    if (runtime?.showInstallPrompt && runtime.install) {
      const choice = await runtime.install()
      if (choice?.outcome) return choice.outcome
    }
    return 'unavailable'
  }

  function dismissOfflineReady() {
    offlineReady.value = false
    runtime?.cancelPrompt?.()
  }

  /** 本轮会话内已选过「稍后」：同一次刷新周期内不再反复弹，避免每次刷新都来一次 */
  function snoozeUpdate() {
    try {
      sessionStorage.setItem(UPDATE_SNOOZE_KEY, '1')
    } catch {
      /* 隐私模式下写不了 sessionStorage 就算了，只是会再提示一次 */
    }
  }

  function readSnooze() {
    try {
      return sessionStorage.getItem(UPDATE_SNOOZE_KEY) === '1'
    } catch {
      return false
    }
  }

  function postponeUpdate() {
    needRefresh.value = false
    snoozeUpdate()
    runtime?.cancelPrompt?.()
  }

  /**
   * 立即更新：显式把等待中的新 Service Worker 切上来，等它真正接管（controllerchange）后再刷新。
   * 不依赖 $pwa.updateServiceWorker —— 少一层封装就少一处竞态：早刷新会让新 worker 还停在 waiting，
   * 于是刷新后又弹同一个「新版本已就绪」。
   */
  async function applyUpdate() {
    needRefresh.value = false
    try {
      sessionStorage.removeItem(UPDATE_SNOOZE_KEY)
    } catch {
      /* 同上，忽略 */
    }
    runtime?.cancelPrompt?.()
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      window.location.reload()
      return
    }
    const registration = await navigator.serviceWorker.getRegistration()
    const waiting = registration?.waiting
    if (!waiting) {
      // 没有等待中的 worker：要么已经接管了，要么浏览器还没拿到新版本，直接刷新即可
      window.location.reload()
      return
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, 4000)
      navigator.serviceWorker.addEventListener('controllerchange', done, { once: true })
      waiting.postMessage({ type: 'SKIP_WAITING' })
    })
    window.location.reload()
  }

  onMounted(() => {
    initialized.value = true
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    installed.value = !!standalone || (navigator as unknown as { standalone?: boolean }).standalone === true
    online.value = navigator.onLine
    manifestReady.value = !!document.querySelector('link[rel="manifest"]')

    runtime = (useNuxtApp() as unknown as { $pwa?: PwaRuntime }).$pwa

    if (runtime) {
      watch(() => runtime?.offlineReady, (v) => (offlineReady.value = !!v), { immediate: true })
      // 用户点过「稍后」就安静到本次会话结束，不再每次刷新都弹一遍
      watch(() => runtime?.needRefresh, (v) => (needRefresh.value = !!v && !readSnooze()), { immediate: true })
      watch(() => runtime?.isPWAInstalled, (v) => (installed.value = !!v), { immediate: true })
      watch(() => runtime?.showInstallPrompt, (v) => (installable.value = !!v), { immediate: true })
      watch(() => runtime?.swActivated, (v) => (swActivated.value = !!v), { immediate: true })
    }
    // 无论有没有 $pwa 都自己接一份：安装入口的判定与实际 prompt() 都必须基于真实事件
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          swRegistered.value = !!reg
          if (reg?.active?.state === 'activated') swActivated.value = true
        })
        .catch(() => {
          swRegistered.value = false
        })
    }
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    window.removeEventListener('appinstalled', onInstalled)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })

  return {
    installed,
    installable,
    canPrompt,
    offlineReady,
    needRefresh,
    online,
    swRegistered,
    swActivated,
    manifestReady,
    initialized,
    promptInstall,
    dismissOfflineReady,
    postponeUpdate,
    applyUpdate
  }
}
