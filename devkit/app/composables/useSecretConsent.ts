/**
 * 风险确认弹窗的唯一入口。
 *
 * 「步骤库添加」「复制步骤」「导入流程」「预设流程」「发送到 → 流程」都必须 await 这里的结果，
 * 不允许各写一套绕过逻辑。未确认时调用方必须放弃添加，且不产生任何密钥记录。
 */
import { CONSENT_ACCEPT_TEXT, CONSENT_NOTICE_TEXT, CONSENT_NOTICE_VERSION } from '~/workflow/secrets'

type ConsentResolver = (accepted: boolean) => void

export interface ConsentQueue {
  /** 当前是否有待决请求 */
  readonly pending: boolean
  /** 挂入一个新的待决请求；若已有待决请求，先把它 settle 为 false（取消），避免旧 Promise 永久悬挂 */
  request: () => Promise<boolean>
  /** 以 accepted 结束当前待决请求（若有），并清空状态 */
  settle: (accepted: boolean) => void
  /** 等价于 settle(false) */
  cancel: () => void
}

/**
 * 纯逻辑的「单飞」确认队列（不依赖 Vue/Nuxt，便于单测）。
 *
 * 关键不变量：
 * - 任意时刻至多一个待决 resolver；
 * - 再次 request() 时，旧 resolver 会被立即 settle(false)，绝不悬挂、绝不错配；
 * - settle/cancel 后状态清空，可安全重复调用。
 */
export function createConsentQueue(): ConsentQueue {
  let current: ConsentResolver | null = null

  function settle(accepted: boolean) {
    const resolve = current
    current = null
    resolve?.(accepted)
  }

  return {
    get pending() {
      return current !== null
    },
    request() {
      // 先把旧的取消，再挂新的：旧调用方拿到 false，不会永久等待，也不会误吞本次结果
      if (current) settle(false)
      return new Promise<boolean>((resolve) => {
        current = resolve
      })
    },
    settle,
    cancel: () => settle(false)
  }
}

/**
 * 同一时刻只会有一个确认弹窗挂在页面上，所以待决 resolver 放在模块作用域的单飞队列里即可；
 * 组件卸载（onBeforeUnmount，仍打开时）与用户取消都会走到 cancel()，不会留下悬挂的 Promise。
 * 服务端不会创建待决请求（request() 直接返回 false），因此模块级状态不会跨 SSR 请求泄漏。
 */
const queue = createConsentQueue()

export function useSecretConsent() {
  const open = useState<boolean>('devkit-secret-consent-open', () => false)

  function request(): Promise<boolean> {
    if (import.meta.server) return Promise.resolve(false)
    // queue.request() 会先把上一个待决请求 settle(false)，再挂入本次请求
    const result = queue.request()
    open.value = true
    return result
  }

  function settle(accepted: boolean) {
    open.value = false
    queue.settle(accepted)
  }

  return {
    open,
    request,
    accept: () => settle(true),
    cancel: () => settle(false),
    noticeText: CONSENT_NOTICE_TEXT,
    acceptText: CONSENT_ACCEPT_TEXT,
    noticeVersion: CONSENT_NOTICE_VERSION
  }
}
