/** 剪贴板与下载反馈（G03）：复制失败时提示手动选择，不自动重复提交 */
export function useClipboard() {
  const toast = useToast()

  async function copy(text: string, label = '内容'): Promise<boolean> {
    if (import.meta.server) return false
    if (!text) {
      toast.warning('没有可复制的内容')
      return false
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        toast.success(`已复制${label}`)
        return true
      }
      throw new Error('clipboard-unavailable')
    } catch {
      // 回退：临时 textarea + execCommand
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          toast.success(`已复制${label}`)
          return true
        }
      } catch {
        /* 继续走手动提示 */
      }
      toast.error('剪贴板不可用，请在结果框中手动选择并复制')
      return false
    }
  }

  return { copy }
}
