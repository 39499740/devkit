/**
 * G01 / G09 跨工具传递（Nuxt 侧的薄封装）：路由跳转、提示与目标清单在这里，
 * 载荷本身的状态语义在 utils/transfer.ts 里，便于单测。
 */
import { stashPayload, takePayload, type TransferIntent, type TransferPayload } from '~/utils/transfer'
import { isSensitiveStep, stepDef } from '~/utils/workflow'
import type { StepType } from '~/utils/workflow'

export interface TransferTarget {
  slug: string
  name: string
  /** 接收后的行为说明 */
  note: string
  accept: TransferPayload['kind'][]
  /** 需要用户再补充一段内容（如 Schema） */
  needsExtra?: boolean
  /** 需要合法 JSON 才能接收：内容不是 JSON 时该目标应标记不可用 */
  requiresJson?: boolean
  /** 对应的处理流程步骤类型，供「加入处理流程」使用 */
  step?: StepType
}

/** 只列出真正实现了接收的工具 */
export const transferTargets: TransferTarget[] = [
  { slug: 'json-diff', name: 'JSON 差异比较', note: '接收 JSON 对象 · 作为右侧输入', accept: ['json', 'text'], requiresJson: true },
  { slug: 'json-yaml', name: 'JSON / YAML 转换', note: '接收 JSON 对象 · 转换为 YAML', accept: ['json', 'text'], requiresJson: true, step: 'json-yaml' },
  { slug: 'jsonpath-query', name: 'JSONPath 查询', note: '接收 JSON 对象 · 直接作为查询输入', accept: ['json', 'text'], requiresJson: true, step: 'jsonpath' },
  { slug: 'json-schema', name: 'JSON Schema 校验', note: '接收 JSON 对象 · 需再选择一份 Schema', accept: ['json', 'text'], requiresJson: true, needsExtra: true, step: 'schema-validate' },
  { slug: 'json2java', name: 'JSON 转 Java', note: '接收 JSON 对象 · 生成 Java 实体类', accept: ['json', 'text'], requiresJson: true, step: 'json2java' },
  { slug: 'json-format', name: 'JSON 格式化', note: '接收 JSON 文本 · 重新格式化', accept: ['json', 'text'], requiresJson: true, step: 'json-format' },
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

  /** 暂存结果但不跳转，由调用方决定目标 */
  function stash(text: string, fromTool: string, kind: TransferPayload['kind']) {
    stashPayload(text, fromTool, kind)
  }

  /** 取走载荷：一次性消费（含带 intent 的载荷），目标不符时保留给真正的目标 */
  function take(consumerKey?: string): TransferPayload | null {
    return takePayload(consumerKey)
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

  /** 目标工具装载载荷前调用：绑定目标并跳转 */
  function deliver(target: string) {
    const payload = takePayload()
    if (!payload) return
    stashPayload(payload.text, payload.from, payload.kind, { target })
    router.push(`/tools/${target}`)
  }

  /** 加入已有流程：把来源工具对应的步骤追加到流程末尾（载荷绑定到该流程 id） */
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
    const intent: TransferIntent = { workflowId, ...(stepType ? { stepType } : {}) }
    stashPayload(text, fromTool, kind, { intent, target: workflowId })
    router.push(`/workflows/${workflowId}`)
  }

  /** 新建流程并以当前结果为流程输入 */
  function sendToNewWorkflow(
    text: string,
    fromTool: string,
    kind: TransferPayload['kind'],
    name: string,
    stepType?: StepType
  ) {
    if (!text.trim()) {
      toast.warning('没有可发送的内容')
      return
    }
    const store = useWorkflows()
    const wf = store.create(name || '来自工具的新流程', '由「发送到…」创建的流程')
    if (stepType) {
      if (isSensitiveStep(stepType)) {
        // 敏感步骤必须先风险确认，而「发送到」这条路径没有确认弹窗：
        // 这里只把结果作为流程输入带入，由用户在编排页确认后再添加，绝不绕过确认
        toast.warning(`「${stepDef(stepType).name}」包含密钥配置，已只把结果带入流程；请在编排页确认风险后再添加该步骤`)
      } else {
        store.addStep(wf.id, stepType)
      }
    }
    stashPayload(text, fromTool, kind, { intent: { workflowId: wf.id }, target: wf.id })
    router.push(`/workflows/${wf.id}`)
    toast.success(`已新建「${wf.name}」，结果已作为流程输入`)
  }

  return { send, stash, take, compatibleTargets, deliver, sendToWorkflow, sendToNewWorkflow, from }
}
