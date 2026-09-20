const FAV_KEY = 'devkit.favorites.v1'

export interface FavoriteEntry {
  id: string
  /** ISO 收藏时间；旧版本只存了标识，未记录时间时为 null */
  at: string | null
}

/**
 * 兼容两种历史格式：
 * - v1：string[]（只有标识，没有时间）
 * - v2：{ v: 2, items: [{ id, at }] }
 */
function normalize(list: unknown): FavoriteEntry[] {
  if (!Array.isArray(list)) return []
  const out: FavoriteEntry[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      out.push({ id: item, at: null })
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      if (typeof rec.id === 'string') {
        out.push({ id: rec.id, at: typeof rec.at === 'string' ? rec.at : null })
      }
    }
  }
  return out
}

function load(): FavoriteEntry[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(FAV_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalize((parsed as Record<string, unknown>).items)
    }
    return normalize(parsed)
  } catch {
    return []
  }
}

/** 收藏：只保存工具标识与收藏时间，不保存任何输入数据 */
export function useFavorites() {
  const entries = useState<FavoriteEntry[]>('devkit-favorites', load)
  const loaded = useState<boolean>('devkit-favorites-loaded', () => false)

  onMounted(() => {
    if (!loaded.value) {
      entries.value = load()
      loaded.value = true
    }
  })

  const ids = computed(() => entries.value.map((e) => e.id))

  function persist() {
    if (import.meta.server) return
    localStorage.setItem(FAV_KEY, JSON.stringify({ v: 2, items: entries.value }))
  }

  function isFav(id: string) {
    return computed(() => ids.value.includes(id))
  }

  /** 收藏时间；旧数据未记录时返回 null */
  function addedAt(id: string): string | null {
    return entries.value.find((e) => e.id === id)?.at ?? null
  }

  function toggle(id: string) {
    entries.value = entries.value.some((e) => e.id === id)
      ? entries.value.filter((e) => e.id !== id)
      : [...entries.value, { id, at: new Date().toISOString() }]
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

  return { entries, ids, isFav, addedAt, toggle, remove, clear }
}
