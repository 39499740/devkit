/**
 * 风险确认弹窗的唯一入口。
 *
 * 「步骤库添加」「复制步骤」「导入流程」「预设流程」「发送到 → 流程」都必须 await 这里的结果，
 * 不允许各写一套绕过逻辑。未确认时调用方必须放弃添加，且不产生任何密钥记录。
 */
import { CONSENT_ACCEPT_TEXT, CONSENT_NOTICE_TEXT, CONSENT_NOTICE_VERSION } from '~/workflow/secrets'

/**
 * 同一时刻只会有一个确认弹窗挂在页面上，所以待决回调放在模块作用域即可；
 * 组件卸载或用户取消都会走到 cancel()，不会留下悬挂的 Promise。
 */
let pending: ((accepted: boolean) => void) | null = null

export function useSecretConsent() {
  const open = useState<boolean>('devkit-secret-consent-open', () => false)

  function request(): Promise<boolean> {
    if (import.meta.server) return Promise.resolve(false)
    open.value = true
    return new Promise<boolean>((resolve) => {
      pending = resolve
    })
  }

  function settle(accepted: boolean) {
    open.value = false
    const resolve = pending
    pending = null
    resolve?.(accepted)
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
