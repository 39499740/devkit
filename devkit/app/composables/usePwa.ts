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

  let deferred: InstallPromptEvent | null = null
  let runtime: PwaRuntime | undefined

  const canPrompt = computed(() => !!runtime?.install || !!deferred)

  function onBeforeInstall(e: Event) {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    installable.value = true
  }

  function onInstalled() {
    installed.value = true
    installable.value = false
    deferred = null
  }

  function onOnline() {
    online.value = true
  }

  function onOffline() {
    online.value = false
  }

  /** 调用安装弹窗（优先走 $pwa.install）；unavailable 表示当前浏览器没有提供入口 */
  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (installed.value) return 'unavailable'
    if (runtime?.install) {
      const choice = await runtime.install()
      if (choice?.outcome) return choice.outcome
    }
    if (!deferred) return 'unavailable'
    await deferred.prompt()
    const choice = await deferred.userChoice
    deferred = null
    installable.value = false
    return choice.outcome
  }

  function dismissOfflineReady() {
    offlineReady.value = false
    runtime?.cancelPrompt?.()
  }

  function postponeUpdate() {
    needRefresh.value = false
    runtime?.cancelPrompt?.()
  }

  /** 立即更新：让等待中的 Service Worker 接管并重新加载当前页面 */
  function applyUpdate() {
    needRefresh.value = false
    if (runtime?.updateServiceWorker) runtime.updateServiceWorker(true)
    else if (typeof window !== 'undefined') window.location.reload()
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
      watch(() => runtime?.needRefresh, (v) => (needRefresh.value = !!v), { immediate: true })
      watch(() => runtime?.isPWAInstalled, (v) => (installed.value = !!v), { immediate: true })
      watch(() => runtime?.showInstallPrompt, (v) => (installable.value = !!v), { immediate: true })
      watch(() => runtime?.swActivated, (v) => (swActivated.value = !!v), { immediate: true })
    } else {
      window.addEventListener('beforeinstallprompt', onBeforeInstall)
    }

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
