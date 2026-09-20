/**
 * G01 跨工具传递：仅在当前浏览器内存中进行，刷新即失。
 * 只传递计算结果文本，不传密钥/Token 类敏感参数。
 */
export interface TransferPayload {
  /** 文本内容 */
  text: string
  /** 来源工具 slug */
  from: string
  /** 内容类型提示，如 json / text */
  kind: 'json' | 'text'
  ts: number
}

/** 载荷有效期：超过后视为失效，避免残留内容被后来进入的工具误用 */
const TTL_MS = 5 * 60 * 1000

// 模块级内存态：SPA 内跨路由存活，刷新即清空
let pending: TransferPayload | null = null
/** 本次传递指定的目标工具；只有它才能取走载荷 */
let pendingTarget: string | null = null

/** 兼容目标定义：只列出真正实现了接收的工具 */
export const transferTargets: { slug: string; name: string; accept: TransferPayload['kind'][] }[] = [
  { slug: 'json-format', name: 'JSON 格式化', accept: ['json', 'text'] },
  { slug: 'json-diff', name: 'JSON 差异比较', accept: ['json', 'text'] },
  { slug: 'json-yaml', name: 'JSON / YAML 转换', accept: ['json', 'text'] }
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
    drop()
    return p
  }

  function send(text: string, fromTool: string, kind: TransferPayload['kind']) {
    if (!text.trim()) {
      toast.warning('没有可发送的内容')
      return
    }
    pending = { text, from: fromTool, kind, ts: Date.now() }
    pendingTarget = null
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

  return { send, take, peek: take, consume: take, compatibleTargets, deliver, from }
}
