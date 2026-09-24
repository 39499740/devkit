export type RunStatus = 'idle' | 'ok' | 'error' | 'stale'

/**
 * G04 结果待更新模式：
 * 输入或参数变化后，已产生的成功/失败结果标记为「待更新」，
 * 旧结果保留可查看，但复制/下载禁用，重新执行成功后恢复。
 */
const STALE_NOTE = '输入或参数已修改，结果待更新'

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
        staleNote.value = STALE_NOTE
      }
    }
  )

  /**
   * 当前签名：供工具在发起异步计算前捕获（`const sigAtStart = run.currentSignature()`），
   * 完成时回传给 markOk / markFail，避免用完成时的当前签名覆盖在途期间的 stale 判定。
   */
  function currentSignature() {
    return getSignature()
  }

  /**
   * 完成时记录「发起时」的签名，而不是完成时的当前签名（P2-3 竞态）：
   * 若 await 期间用户改了输入/参数，`lastSig` 仍是旧签名，watcher 的 stale 判定成立；
   * 同时这里再与当前签名核对一次，覆盖「watcher 已在完成前触发」的顺序。
   * 未显式传入 `sigAtStart` 时退回旧行为（用当前签名）。
   */
  function settle(sigAtStart?: string) {
    const sig = sigAtStart ?? getSignature()
    lastSig = sig
    armed = true
    return getSignature() === sig
  }

  function markOk(note = '', sigAtStart?: string) {
    errorMsg.value = ''
    if (!settle(sigAtStart)) {
      // 结果对应的是旧输入：保留结果供查看，但标记「待更新」，复制/下载保持禁用
      status.value = 'stale'
      staleNote.value = STALE_NOTE
      return
    }
    status.value = 'ok'
    staleNote.value = note
  }

  function markFail(msg: string, sigAtStart?: string) {
    if (!settle(sigAtStart)) {
      status.value = 'stale'
      errorMsg.value = ''
      staleNote.value = STALE_NOTE
      return
    }
    status.value = 'error'
    errorMsg.value = msg
    staleNote.value = ''
  }

  function markIdle() {
    status.value = 'idle'
    errorMsg.value = ''
    staleNote.value = ''
    armed = false
  }

  return { status, errorMsg, staleNote, currentSignature, markOk, markFail, markIdle }
}

// errMessage 已收敛到 app/utils/errors.ts（utils 层显式 import，组件仍走自动导入）
