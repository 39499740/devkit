/**
 * G01 / G09 跨工具传递：仅在当前浏览器内存中进行，刷新即失。
 * 只传递计算结果文本，不传密钥/Token 类敏感参数。
 */
import type { StepType } from '~/utils/workflow'

export interface TransferPayload {
  /** 文本内容 */
  text: string
  /** 来源工具 slug */
  from: string
  /** 内容类型提示，如 json / text */
  kind: 'json' | 'text'
  ts: number
  /** 加入处理流程时携带的意图 */
  intent?: { workflowId: string; stepType?: StepType }
}

/** 载荷有效期：超过后视为失效，避免残留内容被后来进入的工具误用 */
const TTL_MS = 5 * 60 * 1000

// 模块级内存态：SPA 内跨路由存活，刷新即清空
let pending: TransferPayload | null = null
/** 本次传递指定的目标工具；只有它才能取走载荷 */
let pendingTarget: string | null = null

export interface TransferTarget {
  slug: string
  name: string
  /** 接收后的行为说明 */
  note: string
  accept: TransferPayload['kind'][]
  /** 需要用户再补充一段内容（如 Schema） */
  needsExtra?: boolean
  /** 对应的处理流程步骤类型，供「加入处理流程」使用 */
  step?: StepType
}

/** 只列出真正实现了接收的工具 */
export const transferTargets: TransferTarget[] = [
  { slug: 'json-diff', name: 'JSON 差异比较', note: '接收 JSON 对象 · 作为右侧输入', accept: ['json', 'text'] },
  { slug: 'json-yaml', name: 'JSON / YAML 转换', note: '接收 JSON 对象 · 转换为 YAML', accept: ['json', 'text'], step: 'json-yaml' },
  { slug: 'jsonpath-query', name: 'JSONPath 查询', note: '接收 JSON 对象 · 直接作为查询输入', accept: ['json', 'text'], step: 'jsonpath' },
  { slug: 'json-schema', name: 'JSON Schema 校验', note: '接收 JSON 对象 · 需再选择一份 Schema', accept: ['json', 'text'], needsExtra: true, step: 'schema-validate' },
  { slug: 'json2java', name: 'JSON 转 Java', note: '接收 JSON 对象 · 生成 Java 实体类', accept: ['json', 'text'], step: 'json2java' },
  { slug: 'json-format', name: 'JSON 格式化', note: '接收 JSON 文本 · 重新格式化', accept: ['json', 'text'], step: 'json-format' },
  { slug: 'xml-toolbox', name: 'XML 工具箱', note: '接收文本 · 作为 XML 输入', accept: ['text', 'json'] },
  { slug: 'base64', name: 'Base64 编解码', note: '接收文本 · 尝试解码', accept: ['text'], step: 'base64-decode' },
  { slug: 'url-encode', name: 'URL 编解码', note: '接收文本 · 尝试解码', accept: ['text'], step: 'url-decode' }
]

export function useTransfer() {
  const router = useRouter()
  const route = useRoute()
  const toast = useToast()

  const from = computed(() => {
    const m = route.path.match(/^\/tools\/([^/]+)/)
    return m ? m[1] : undefined
  })

  function drop() {
    pending = null
    pendingTarget = null
  }

  /** 暂存结果但不跳转，由调用方决定目标 */
  function stash(text: string, fromTool: string, kind: TransferPayload['kind']) {
    pending = { text, from: fromTool, kind, ts: Date.now() }
    pendingTarget = null
  }

  /** 取出待传递内容：一次性、带有效期，且只交给指定目标工具 */
  function take(): TransferPayload | null {
    if (!pending) return null
    if (Date.now() - pending.ts > TTL_MS) {
      drop()
      return null
    }
    if (pendingTarget && from.value !== pendingTarget) {
      drop()
      return null
    }
    const p = pending
    if (!p.intent) drop()
    return p
  }

  function send(text: string, fromTool: string, kind: TransferPayload['kind']) {
    if (!text.trim()) {
      toast.warning('没有可发送的内容')
      return
    }
    stash(text, fromTool, kind)
    toast.success('已暂存结果，请选择目标工具（仅内存传递，刷新失效）')
  }

  function compatibleTargets(kind: TransferPayload['kind']) {
    return transferTargets.filter((t) => t.accept.includes(kind))
  }

  /** 目标工具装载载荷后调用 */
  function deliver(target: string) {
    if (!pending) return
    pendingTarget = target
    router.push(`/tools/${target}`)
  }

  /** 加入已有流程：把来源工具对应的步骤追加到流程末尾 */
  function sendToWorkflow(
    text: string,
    fromTool: string,
    kind: TransferPayload['kind'],
    workflowId: string,
    stepType?: StepType
  ) {
    if (!text.trim()) {
      toast.warning('没有可发送的内容')
      return
    }
    pending = { text, from: fromTool, kind, ts: Date.now(), intent: { workflowId, stepType } }
    pendingTarget = null
    router.push(`/workflows/${workflowId}`)
  }

  /** 新建流程并以当前结果为第一步 */
  function sendToNewWorkflow(
    text: string,
    fromTool: string,
    kind: TransferPayload['kind'],
    name: string,
    stepType?: StepType
  ) {
    const store = useWorkflows()
    const wf = store.create(name || '来自工具的新流程', '由「发送到…」创建的流程')
    if (stepType) store.addStep(wf.id, { type: stepType, config: {} })
    sendToWorkflow(text, fromTool, kind, wf.id, undefined)
    toast.success(`已新建「${wf.name}」，结果已作为流程输入`)
  }

  return {
    send,
    stash,
    take,
    peek: take,
    consume: take,
    compatibleTargets,
    deliver,
    sendToWorkflow,
    sendToNewWorkflow,
    from
  }
}
