export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  /** 可选操作按钮 */
  action?: { label: string; onClick: () => void }
}

let seq = 0

/** 全局轻提示：不覆盖输入内容，不自动重复 */
export function useToast() {
  const items = useState<ToastItem[]>('devkit-toasts', () => [])

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id)
  }

  function show(kind: ToastKind, message: string, opts?: { action?: ToastItem['action']; duration?: number }) {
    if (import.meta.server) return
    const id = ++seq
    items.value = [...items.value, { id, kind, message, action: opts?.action }]
    const duration = opts?.duration ?? (kind === 'error' ? 5000 : 2600)
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
  }

  return {
    items,
    dismiss,
    show,
    success: (m: string, o?: { action?: ToastItem['action'] }) => show('success', m, o),
    error: (m: string) => show('error', m),
    warning: (m: string) => show('warning', m),
    info: (m: string) => show('info', m)
  }
}
