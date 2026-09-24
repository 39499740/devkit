/**
 * 计算 Worker：把用户可控的正则/JSONPath 等求值从主线程隔离出去。
 *
 * 主线程通过 run-compute.ts 的 runComputation() 发消息，Worker 内调用与工具页
 * 完全相同的 utils 实现（一份代码），因此结果语义与同步回退路径一致。
 *
 * 协议：
 *   请求 { fn:'validate', instanceText, schemaText, strict } → { ok:true, result: ValidateResult }
 *   请求 { fn:'path', dataText, expr }                        → { ok:true, result: { matches, warnings } }
 *   失败一律回 { ok:false, error: 中文原因 }
 *
 * 注意：实例与 schema 都按原始 JSON 文本传入并交给 parseJson，保留大整数 RawNumber 语义
 * （schema 的 minimum / multipleOf / const / enum 等数值关键字据此做精确比较，不再降级为字符串）。
 */
import { parseJson, toPlainJson } from '~/utils/json'
import { validateInstance } from '~/utils/jsonschema'
import { evalJsonPath } from '~/utils/jsonpath'

/** 用 Worker 作用域的类型别名，避免 DOM lib 下 self 被当成 Window（postMessage 签名不同） */
interface WorkerCtx {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (msg: unknown) => void
}

const ctx = self as unknown as WorkerCtx

type ComputeRequest =
  | { fn: 'validate'; instanceText: string; schemaText: string; strict: boolean }
  | { fn: 'path'; dataText: string; expr: string }

ctx.onmessage = (e: MessageEvent) => {
  const data = e.data as ComputeRequest | null
  try {
    if (data && data.fn === 'validate') {
      const instance = parseJson(data.instanceText).value
      const schema = parseJson(data.schemaText).value
      const result = validateInstance(instance, schema, { strict: !!data.strict })
      ctx.postMessage({ ok: true, result })
      return
    }
    if (data && data.fn === 'path') {
      const value = toPlainJson(parseJson(data.dataText).value)
      const result = evalJsonPath(value, data.expr)
      ctx.postMessage({ ok: true, result })
      return
    }
    ctx.postMessage({ ok: false, error: `未知的计算类型：${String((data as { fn?: unknown } | null)?.fn)}` })
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
