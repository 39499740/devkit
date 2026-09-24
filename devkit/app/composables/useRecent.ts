const RECENT_KEY = 'devkit.recent.v1'

export interface RecentEntry {
  id: string
  /** ISO 时间 */
  at: string
}

function load(): RecentEntry[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? arr.filter((x) => x && typeof x.id === 'string' && typeof x.at === 'string')
      : []
  } catch {
    return []
  }
}

/** 最近使用：只记录工具名称与访问时间，不记录任何输入内容 */
export function useRecent() {
  const entries = useState<RecentEntry[]>('devkit-recent', load)
  const loaded = useState<boolean>('devkit-recent-loaded', () => false)
  const { prefs } = usePrefs()

  onMounted(() => {
    if (!loaded.value) {
      entries.value = load()
      loaded.value = true
    }
  })

  function persist() {
    if (import.meta.server) return
    // 隐私模式 / 存储配额满时 setItem 会抛异常；写入失败不应中断最近使用记录交互。
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(entries.value))
    } catch {
      /* 忽略写入失败：当前会话内最近使用仍生效，仅不持久化 */
    }
  }

  function record(id: string) {
    if (import.meta.server || !prefs.value.recordRecent) return
    if (!loaded.value) {
      entries.value = load()
      loaded.value = true
    }
    entries.value = [{ id, at: new Date().toISOString() }, ...entries.value.filter((e) => e.id !== id)].slice(0, 30)
    persist()
  }

  function remove(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
    persist()
  }

  function clear() {
    entries.value = []
    persist()
  }

  /** 按今天 / 更早分组 */
  const grouped = computed(() => {
    const today: RecentEntry[] = []
    const earlier: RecentEntry[] = []
    const now = new Date()
    for (const e of entries.value) {
      const d = new Date(e.at)
      if (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      ) {
        today.push(e)
      } else {
        earlier.push(e)
      }
    }
    return { today, earlier }
  })

  return { entries, record, remove, clear, grouped }
}
