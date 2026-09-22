/**
 * 密钥存储：敏感字段与普通流程分开存放（devkit-workflow-secrets-v1），
 * 风险确认文案与每个敏感步骤的确认记录也定义在这里。
 *
 * 必须明确的事实：localStorage 不是密钥保险箱——明文保存、同源脚本可读、
 * 浏览器扩展与共享浏览器配置都可能读到。这里不做任何加密，也不暗示更安全。
 */
import { secretFieldsOf } from './catalog'
import type { SecretConsent, StepConfigField, StepType } from './types'

export const SECRETS_KEY = 'devkit-workflow-secrets-v1'
export const SECRETS_FILE_VERSION = 1

/** 风险文案有实质变化时提升版本，旧确认自动失效、需要重新确认 */
export const CONSENT_NOTICE_VERSION = 1

export const CONSENT_NOTICE_TEXT = [
  '此步骤包含密钥或私钥配置。填写后，这些敏感信息会以明文形式保存到当前网站的 localStorage，关闭浏览器或刷新页面后仍可能保留。',
  '任何能够访问本浏览器配置、同源页面脚本或浏览器扩展的程序，都可能读取这些信息。请勿在共享电脑、公共电脑或不受信任的浏览器环境中保存生产密钥。',
  'localStorage 没有加密保护，也不是系统钥匙串；运行输入与中间结果仍然只在页面内存中，不会上传服务器。'
].join('')

export const CONSENT_ACCEPT_TEXT = '我已了解上述风险，并同意将此步骤的密钥配置保存到本机浏览器 localStorage。'

export interface StoredSecret {
  id: string
  workflowId: string
  stepId: string
  fields: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface SecretsFile {
  v: number
  items: StoredSecret[]
}

export interface KvStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 内存实现：单测与 SSR 环境使用，接口与 localStorage 对齐 */
export function memoryKv(seed: Record<string, string> = {}): KvStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  }
}

/** 配额超限时 setItem 抛异常：这里换成返回值，让调用方必须处理「没保存成功」 */
export function browserKv(): KvStore | null {
  if (import.meta.server) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function emptySecrets(): SecretsFile {
  return { v: SECRETS_FILE_VERSION, items: [] }
}

export function makeConsent(now: number): SecretConsent {
  return { accepted: true, acceptedAt: now, noticeVersion: CONSENT_NOTICE_VERSION }
}

/** 旧文案时期（noticeVersion 更低）的确认不算数 */
export function isCurrentConsent(consent?: SecretConsent): boolean {
  return !!consent && consent.accepted === true && consent.noticeVersion >= CONSENT_NOTICE_VERSION
}

export function parseSecrets(raw: string | null): { file: SecretsFile; error?: string } {
  if (!raw) return { file: emptySecrets() }
  try {
    const parsed = JSON.parse(raw) as Partial<SecretsFile>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return { file: emptySecrets(), error: '本地保存的密钥记录结构异常，已按空记录处理' }
    }
    const items: StoredSecret[] = []
    for (const item of parsed.items) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Partial<StoredSecret>
      if (typeof rec.stepId !== 'string' || typeof rec.workflowId !== 'string') continue
      const fields: Record<string, string> = {}
      for (const [k, v] of Object.entries(rec.fields ?? {})) {
        if (typeof v === 'string') fields[k] = v
      }
      items.push({
        id: typeof rec.id === 'string' && rec.id ? rec.id : `sec-${rec.stepId}`,
        workflowId: rec.workflowId,
        stepId: rec.stepId,
        fields,
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0
      })
    }
    return { file: { v: SECRETS_FILE_VERSION, items } }
  } catch {
    return { file: emptySecrets(), error: '本地保存的密钥记录无法解析（JSON 已损坏），已按空记录处理；建议在设置页清空后重新填写' }
  }
}

export function serializeSecrets(file: SecretsFile): string {
  return JSON.stringify({ v: SECRETS_FILE_VERSION, items: file.items })
}

export function loadSecrets(kv: KvStore | null): { file: SecretsFile; error?: string } {
  if (!kv) return { file: emptySecrets() }
  try {
    return parseSecrets(kv.getItem(SECRETS_KEY))
  } catch {
    return { file: emptySecrets(), error: '读取本地密钥记录失败，已按空记录处理' }
  }
}

export interface PersistResult {
  ok: boolean
  error?: string
}

export function persistSecrets(kv: KvStore | null, file: SecretsFile): PersistResult {
  if (!kv) return { ok: false, error: '当前环境不支持本地存储，密钥未保存（本次运行仍可继续，但刷新后会丢失）' }
  try {
    kv.setItem(SECRETS_KEY, serializeSecrets(file))
    return { ok: true }
  } catch {
    return { ok: false, error: '密钥未保存：浏览器本地存储写入失败（可能已满或处于隐私模式）' }
  }
}

export function clearSecrets(kv: KvStore | null): PersistResult {
  if (!kv) return { ok: true }
  try {
    kv.removeItem(SECRETS_KEY)
    return { ok: true }
  } catch {
    return { ok: false, error: '清空本地密钥失败：浏览器本地存储不可写' }
  }
}

export function secretOf(file: SecretsFile, workflowId: string, stepId: string): StoredSecret | undefined {
  return file.items.find((s) => s.stepId === stepId && s.workflowId === workflowId)
}

export function secretFields(file: SecretsFile, workflowId: string, stepId: string): Record<string, string> {
  return secretOf(file, workflowId, stepId)?.fields ?? {}
}

function compact(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/** 写入某步骤的密钥；全部字段为空时删除记录，避免留下空壳 */
export function upsertSecret(
  file: SecretsFile,
  args: { workflowId: string; stepId: string; fields: Record<string, string>; now: number }
): SecretsFile {
  const fields = compact(args.fields)
  const items = file.items.filter((s) => s.stepId !== args.stepId)
  if (!Object.keys(fields).length) return { ...file, items }
  const prev = file.items.find((s) => s.stepId === args.stepId)
  items.push({
    id: prev?.id ?? `sec-${args.stepId}`,
    workflowId: args.workflowId,
    stepId: args.stepId,
    fields,
    createdAt: prev?.createdAt ?? args.now,
    updatedAt: args.now
  })
  return { ...file, items }
}

export function removeSecretOfStep(file: SecretsFile, stepId: string): SecretsFile {
  return { ...file, items: file.items.filter((s) => s.stepId !== stepId) }
}

export function removeSecretsOfWorkflow(file: SecretsFile, workflowId: string): SecretsFile {
  return { ...file, items: file.items.filter((s) => s.workflowId !== workflowId) }
}

/** 删除步骤/流程时同步清理，避免密钥记录变成孤儿 */
export function removeSecretsOfSteps(file: SecretsFile, stepIds: string[]): SecretsFile {
  const drop = new Set(stepIds)
  return { ...file, items: file.items.filter((s) => !drop.has(s.stepId)) }
}

/** 必填敏感字段（如 HMAC 密钥、AES 密钥）缺失时给出字段定义，便于提示「缺少密钥」 */
export function missingRequiredSecrets(type: StepType, fields: Record<string, string>): StepConfigField[] {
  return secretFieldsOf(type).filter((f) => f.required && !(fields[f.key] ?? '').trim())
}

/**
 * 日志/提示的兜底脱敏：密钥值永远不会被主动写进日志，
 * 这里再挡一次「密钥字符串恰好出现在错误消息里」的情况。
 * 只处理长度 ≥ 3 的值，避免把 1 个字符的密钥变成全文本替换。
 */
export function redactSecrets(text: string, fields: Record<string, string>): string {
  let out = text
  for (const v of Object.values(fields)) {
    if (typeof v === 'string' && v.length >= 3 && out.includes(v)) out = out.split(v).join('••••')
  }
  return out
}
