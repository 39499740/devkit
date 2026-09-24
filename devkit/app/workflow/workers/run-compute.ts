/**
 * 计算 Worker 的主线程入口。
 *
 * - hasWorker()：当前环境能否创建 Worker（浏览器为 true，Node / 测试为 false）；
 * - runComputation()：把一次纯计算（schema 校验 / JSONPath 求值）丢进 Worker 并加超时，
 *   超时后 terminate() 并 reject 中文错误，绝不悬挂主线程。
 *
 * Worker 用 Vite 标准的 `new URL('./compute.worker.ts', import.meta.url)` 形式创建
 * （module worker），构建时会被 Vite 自动识别、打包并改写为正确的产物 URL。
 */
export function hasWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

interface ComputeReply<T> {
  ok?: boolean
  result?: T
  error?: unknown
}

export function runComputation<T>(data: unknown, timeoutMs = 2000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }

    let settled = false
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      action()
    }
    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`计算超时（超过 ${timeoutMs}ms）：表达式可能存在灾难性回溯，请简化表达式或减少输入`)
        )
      )
    }, timeoutMs)

    worker.onmessage = (ev: MessageEvent) => {
      const reply = ev.data as ComputeReply<T> | null
      settle(() => {
        if (reply && reply.ok) resolve(reply.result as T)
        else reject(new Error(reply && reply.error ? String(reply.error) : '计算失败：未知错误'))
      })
    }
    worker.onerror = (ev: ErrorEvent) => {
      settle(() => reject(new Error(`计算 Worker 执行错误：${ev.message || '未知错误'}`)))
    }
    worker.onmessageerror = () => {
      settle(() => reject(new Error('计算 Worker 消息无法反序列化')))
    }
    worker.postMessage(data)
  })
}
