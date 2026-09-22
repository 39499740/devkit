/**
 * 处理流程的公共类型：步骤定义、步骤间载荷契约、运行结果。
 * 具体步骤清单在 catalog.ts，执行逻辑在 executors/，这里只放类型与最基础的载荷工具。
 */
import { textToBytes } from '../utils/bytes'
import type { InputEncoding } from '../utils/crypto/encoding'
import { decodeInput } from '../utils/crypto/encoding'

export type StepType =
  // 编码与文本
  | 'base64-decode'
  | 'base64-encode'
  | 'url-decode'
  | 'url-encode'
  | 'text-dedup'
  | 'regex-replace'
  // 数据格式
  | 'json-format'
  | 'json-minify'
  | 'jsonpath'
  | 'jmespath'
  | 'json-yaml'
  | 'schema-validate'
  | 'json-schema-gen'
  | 'csv-json'
  | 'sql-format'
  | 'xml'
  // Java 开发
  | 'json2java'
  // 摘要与加解密
  | 'digest'
  | 'hmac'
  | 'aes-gcm'
  | 'sm2'
  | 'sm3'
  | 'sm4'
  // 文件与图片
  | 'download'

export type FieldControl = 'text' | 'select' | 'switch' | 'textarea' | 'secret'

export interface StepConfigField {
  key: string
  label: string
  control: FieldControl
  default?: string | boolean
  placeholder?: string
  /** 必填：未填写时运行前就给出明确失败，而不是执行到一半才报错 */
  required?: boolean
  /**
   * 敏感字段：值保存在独立的密钥存储（devkit-workflow-secrets-v1）里，
   * 不进步骤 config，也不随流程导出、不进日志。
   */
  sensitive?: boolean
  help?: string
  options?: { value: string; label: string }[]
}

export interface StepDef {
  type: StepType
  name: string
  /** 步骤库分类文案，与工具分类同名 */
  cat: string
  desc: string
  fields: StepConfigField[]
}

export type StepConfigValue = string | boolean
export type StepConfig = Record<string, StepConfigValue>

/** 每个敏感步骤各自的确认记录；风险文案版本变化后旧确认自动失效 */
export interface SecretConsent {
  accepted: true
  acceptedAt: number
  noticeVersion: number
}

export interface WorkflowStep {
  id: string
  type: StepType
  config: StepConfig
  /** 指向密钥存储记录；密钥本身不在这里 */
  secretRef?: string
  consent?: SecretConsent
}

export interface Workflow {
  id: string
  name: string
  desc: string
  steps: WorkflowStep[]
}

export type PayloadKind = 'text' | 'json' | 'bytes'

/**
 * 步骤之间的载荷。文本步骤只填 text；二进制结果（解密后的密文、非 UTF-8 字节）
 * 会带上 bytes，此时 text 是给界面看的 Hex 视图。
 */
export interface StepPayload {
  kind: PayloadKind
  text: string
  bytes?: Uint8Array
}

export interface ExecutorResult {
  payload: StepPayload
  note: string
}

export type StepExecutor = (
  input: StepPayload,
  config: StepConfig,
  secrets: Record<string, string>
) => Promise<ExecutorResult> | ExecutorResult

export type StepStatus = 'ok' | 'fail' | 'skipped'

export interface StepResult {
  index: number
  type: StepType
  name: string
  status: StepStatus
  /** 完整载荷：二进制结果靠它把 bytes 传给下一步，界面只看 output */
  payload: StepPayload
  /** payload.text 的快捷方式，供界面展示 */
  output: string
  outputKind: PayloadKind
  note: string
  logs: string[]
  ms: number
}

export interface WorkflowRunResult {
  results: StepResult[]
  finalOutput: string
  status: 'ok' | 'fail'
  ms: number
}

export function textPayload(text: string, kind: PayloadKind = 'text'): StepPayload {
  return { kind, text }
}

export function jsonPayload(value: unknown, indent = 2): StepPayload {
  return { kind: 'json', text: JSON.stringify(value, null, indent) }
}

/** 二进制结果：能按 UTF-8 还原就升级成文本载荷，否则保留字节 + Hex 视图 */
export function bytesPayload(bytes: Uint8Array): StepPayload {
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes }
  } catch {
    return { kind: 'bytes', text: hexView(bytes), bytes }
  }
}

export function hexView(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function asPayload(input: string | StepPayload): StepPayload {
  return typeof input === 'string' ? textPayload(input) : input
}

/** 按声明的编码取字节；auto = 上游给了字节就用字节，否则按 UTF-8 文本 */
export function payloadBytes(payload: StepPayload, enc: InputEncoding | 'auto'): Uint8Array {
  if (enc === 'auto') return payload.bytes ?? textToBytes(payload.text)
  return decodeInput(payload.text, enc)
}

export const payloadKindLabel: Record<PayloadKind, string> = {
  text: '文本',
  json: 'JSON',
  bytes: '二进制（Hex 视图）'
}
