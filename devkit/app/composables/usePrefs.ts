export interface Prefs {
  theme: 'light' | 'dark' | 'system'
  codeFontSize: number
  editorWrap: boolean
  defaultIndent: '2' | '4' | 'tab'
  reduceMotion: boolean
  recordRecent: boolean
  /** 匿名访问统计：只让统计脚本知道页面路径与来源，不涉及任何输入内容 */
  analytics: boolean
}

export const defaultPrefs: Prefs = {
  theme: 'system',
  codeFontSize: 13,
  editorWrap: true,
  defaultIndent: '2',
  reduceMotion: false,
  recordRecent: true,
  analytics: true
}

const STORAGE_KEY = 'devkit.prefs.v1'

function loadPrefs(): Prefs {
  if (import.meta.server) return { ...defaultPrefs }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultPrefs, ...JSON.parse(raw) }
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return { ...defaultPrefs }
}

export function usePrefs() {
  const prefs = useState<Prefs>('devkit-prefs', loadPrefs)
  const systemDark = useState<boolean>('devkit-system-dark', () => false)
  let media: MediaQueryList | undefined

  const isDark = computed(
    () => prefs.value.theme === 'dark' || (prefs.value.theme === 'system' && systemDark.value)
  )

  function persist() {
    if (import.meta.server) return
    // 隐私模式 / 存储配额满时 setItem 会抛异常；写入失败不应中断设置交互。
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.value))
    } catch {
      /* 忽略写入失败：当前会话内偏好仍然生效，仅不持久化 */
    }
  }

  function update(patch: Partial<Prefs>) {
    prefs.value = { ...prefs.value, ...patch }
    persist()
  }

  function reset() {
    prefs.value = { ...defaultPrefs }
    persist()
  }

  function applyTheme() {
    if (import.meta.server) return
    document.documentElement.classList.toggle('dark', isDark.value)
    document.body.classList.toggle('reduce-motion', prefs.value.reduceMotion)
    document.documentElement.style.setProperty('--code-font-size', `${prefs.value.codeFontSize}px`)
  }

  onMounted(() => {
    prefs.value = { ...defaultPrefs, ...loadPrefs() }
    media = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = media.matches
    media.addEventListener('change', onSystemChange)
    applyTheme()
  })

  function onSystemChange(e: MediaQueryListEvent) {
    systemDark.value = e.matches
  }

  watch(isDark, applyTheme)
  watch(
    () => [prefs.value.codeFontSize, prefs.value.reduceMotion],
    applyTheme
  )

  onUnmounted(() => {
    media?.removeEventListener('change', onSystemChange)
  })

  return { prefs, isDark, update, reset }
}
