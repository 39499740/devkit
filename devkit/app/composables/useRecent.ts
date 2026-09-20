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
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.value))
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
