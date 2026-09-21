/**
 * 跨工具内存传递的纯状态层（不依赖 Nuxt，便于单测）。
 * 语义：载荷是一次性的（one-shot）——被消费或过期即清除，含「加入处理流程」意图；
 * 指定了目标时，只有目标来取才会被消费，其他人取不到也不会把载荷吃掉。
 */
import type { StepType } from './workflow'

export interface TransferIntent {
  /** 目标流程 id */
  workflowId: string
  /** 要追加的步骤类型 */
  stepType?: StepType
}

export interface TransferPayload {
  /** 文本内容 */
  text: string
  /** 来源工具 slug */
  from: string
  /** 内容类型提示 */
  kind: 'json' | 'text'
  ts: number
  /** 加入处理流程时携带的意图 */
  intent?: TransferIntent
}

/** 载荷有效期：超时视为失效，避免残留内容被后来进入的工具误用 */
export const TRANSFER_TTL_MS = 5 * 60 * 1000

let pending: TransferPayload | null = null
let pendingTarget: string | null = null

export function dropPayload() {
  pending = null
  pendingTarget = null
}

export function stashPayload(
  text: string,
  from: string,
  kind: TransferPayload['kind'],
  options: { intent?: TransferIntent; target?: string } = {}
) {
  pending = { text, from, kind, ts: Date.now(), ...(options.intent ? { intent: options.intent } : {}) }
  pendingTarget = options.target ?? null
}

/**
 * 取走载荷（一次性）。consumerKey 与目标不符时返回 null 且保留载荷，
 * 消费成功（含带 intent 的载荷）一律清除，不会在返回列表后重复生效。
 */
export function takePayload(consumerKey?: string): TransferPayload | null {
  if (!pending) return null
  if (Date.now() - pending.ts > TRANSFER_TTL_MS) {
    dropPayload()
    return null
  }
  if (pendingTarget && consumerKey !== pendingTarget) return null
  const payload = pending
  dropPayload()
  return payload
}

export function hasPendingPayload(): boolean {
  return !!pending
}

export function pendingTargetKey(): string | null {
  return pendingTarget
}
