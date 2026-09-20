export type RunStatus = 'idle' | 'ok' | 'error' | 'stale'

/**
 * G04 结果待更新模式：
 * 输入或参数变化后，已产生的成功/失败结果标记为「待更新」，
 * 旧结果保留可查看，但复制/下载禁用，重新执行成功后恢复。
 */
export function useToolRun(getSignature: () => string) {
  const status = ref<RunStatus>('idle')
  const errorMsg = ref('')
  const staleNote = ref('')
  let lastSig = getSignature()
  let armed = false

  watch(
    () => getSignature(),
    (sig) => {
      if (!armed) return
      if (sig === lastSig) return
      if (status.value === 'ok' || status.value === 'error') {
        status.value = 'stale'
        staleNote.value = '输入或参数已修改，结果待更新'
      }
    }
  )

  function markOk(note = '') {
    status.value = 'ok'
    errorMsg.value = ''
    staleNote.value = note
    lastSig = getSignature()
    armed = true
  }

  function markFail(msg: string) {
    status.value = 'error'
    errorMsg.value = msg
    staleNote.value = ''
    lastSig = getSignature()
    armed = true
  }

  function markIdle() {
    status.value = 'idle'
    errorMsg.value = ''
    staleNote.value = ''
    armed = false
  }

  return { status, errorMsg, staleNote, markOk, markFail, markIdle }
}

/** 统一的错误信息提取 */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
