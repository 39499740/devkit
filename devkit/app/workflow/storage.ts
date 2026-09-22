/**
 * 流程持久化：devkit-workflows-v2（流程与其中的非敏感参数）。
 * 运行输入、每步输出、中间结果、密钥都不在这里。
 * 所有解析失败都返回可读错误而不是静默丢数据或假装成功。
 */
import { createStep, defaultConfig, hasStep, isSensitiveStep, stepDef } from './catalog'
import { CONSENT_NOTICE_VERSION } from './secrets'
import type { KvStore } from './secrets'
import type { SecretConsent, StepConfig, StepType, Workflow, WorkflowStep } from './types'

export const WORKFLOWS_KEY = 'devkit-workflows-v2'
export const RUNS_KEY = 'devkit-workflow-runs-v1'
export const WORKFLOW_FILE_VERSION = 2
export const RUNS_FILE_VERSION = 1

export interface RunRecord {
  id: string
  workflowId: string
  name: string
  /** 步骤链文案，如 Base64 解码 → JSON 格式化 */
  summary: string
  status: 'ok' | 'fail'
  ms: number
  at: number
}

export interface RunsFile {
  v: number
  items: RunRecord[]
}

let seq = 0

export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function normalizeConsent(raw: unknown): SecretConsent | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Partial<SecretConsent>
  if (c.accepted !== true || typeof c.acceptedAt !== 'number' || typeof c.noticeVersion !== 'number') return undefined
  return { accepted: true, acceptedAt: c.acceptedAt, noticeVersion: c.noticeVersion }
}

/**
 * 步骤规范化：只保留步骤定义里声明的非敏感参数。
 * 旧版本或手改过的流程里多出来的字段不会悄悄影响执行，敏感字段也不会从 config 里被读进来。
 */
export interface SanitizeStats {
  /** 被跳过的无效步骤数：用于「读到的数据有损」时如实告知用户 */
  dropped: number
}

export function sanitizeStep(raw: unknown, seenIds?: Set<string>, stats?: SanitizeStats): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') {
    if (stats) stats.dropped += 1
    return null
  }
  const r = raw as Record<string, unknown>
  if (typeof r.type !== 'string' || !hasStep(r.type)) {
    if (stats) stats.dropped += 1
    return null
  }
  const type = r.type as StepType
  const step = createStep(type)
  if (typeof r.id === 'string' && r.id && !(seenIds?.has(r.id) ?? false)) step.id = r.id
  seenIds?.add(step.id)
  const rawConfig = (r.config ?? {}) as Record<string, unknown>
  for (const f of stepDef(type).fields) {
    if (f.sensitive) continue
    const v = rawConfig[f.key]
    if (typeof v === 'string' || typeof v === 'boolean') step.config[f.key] = v
  }
  if (typeof r.secretRef === 'string' && r.secretRef) step.secretRef = r.secretRef
  const consent = normalizeConsent(r.consent)
  // 旧文案的确认不迁移，避免生成假的确认记录
  if (consent && consent.noticeVersion >= CONSENT_NOTICE_VERSION) step.consent = consent
  return step
}

export function sanitizeWorkflow(raw: unknown, stats?: SanitizeStats): Workflow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.steps)) return null
  const seen = new Set<string>()
  const steps = r.steps.map((s) => sanitizeStep(s, seen, stats)).filter((s): s is WorkflowStep => !!s)
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '未命名流程'
  return {
    id: typeof r.id === 'string' && r.id ? r.id : uid('wf'),
    name,
    desc: typeof r.desc === 'string' ? r.desc : '',
    steps
  }
}

export interface WorkflowsLoad {
  workflows: Workflow[] | null
  error?: string
  /** 有损读取时的提示：跳过了无法识别的步骤 */
  warning?: string
}

/** raw 为 null 表示「本地没有保存过」：调用方用默认流程；解析失败则报错并回退 */
export function parseWorkflows(raw: string | null): WorkflowsLoad {
  if (raw === null) return { workflows: null }
  try {
    const parsed = JSON.parse(raw) as { v?: number; items?: unknown }
    const list = Array.isArray(parsed) ? parsed : parsed?.items
    if (!Array.isArray(list)) {
      return { workflows: null, error: '本地保存的处理流程结构异常，已回退到默认流程；可在设置页清空后重新编排' }
    }
    const stats: SanitizeStats = { dropped: 0 }
    const workflows = list.map((w) => sanitizeWorkflow(w, stats)).filter((w): w is Workflow => !!w)
    return {
      workflows,
      warning: stats.dropped
        ? `本地保存的流程里有 ${stats.dropped} 个无法识别的步骤（可能来自旧版本），已跳过这些步骤`
        : undefined
    }
  } catch {
    return { workflows: null, error: '本地保存的处理流程无法解析（JSON 已损坏），已回退到默认流程；可在设置页清空后重新编排' }
  }
}

export function serializeWorkflows(workflows: Workflow[]): string {
  return JSON.stringify({ v: WORKFLOW_FILE_VERSION, items: workflows })
}

export interface WriteResult {
  ok: boolean
  error?: string
}

export function persistWorkflows(kv: KvStore | null, workflows: Workflow[]): WriteResult {
  if (!kv) return { ok: false, error: '当前环境不支持本地存储，流程改动未保存' }
  try {
    kv.setItem(WORKFLOWS_KEY, serializeWorkflows(workflows))
    return { ok: true }
  } catch {
    return { ok: false, error: '流程未保存：浏览器本地存储写入失败（可能已满或处于隐私模式）' }
  }
}

export function parseRuns(raw: string | null): { runs: RunRecord[]; error?: string } {
  if (!raw) return { runs: [] }
  try {
    const parsed = JSON.parse(raw) as { items?: unknown }
    const list = Array.isArray(parsed) ? parsed : parsed?.items
    if (!Array.isArray(list)) return { runs: [], error: '本地运行记录结构异常，已清空' }
    const runs: RunRecord[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const r = item as Partial<RunRecord>
      // 只接受状态、耗时与步骤摘要：输入/输出/密钥不可能出现在这里
      if (typeof r.workflowId !== 'string' || typeof r.name !== 'string' || typeof r.summary !== 'string') continue
      runs.push({
        id: typeof r.id === 'string' ? r.id : uid('run'),
        workflowId: r.workflowId,
        name: r.name,
        summary: r.summary,
        status: r.status === 'fail' ? 'fail' : 'ok',
        ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
        at: typeof r.at === 'number' ? r.at : 0
      })
    }
    return { runs }
  } catch {
    return { runs: [], error: '本地运行记录无法解析，已清空' }
  }
}

export function serializeRuns(runs: RunRecord[]): string {
  return JSON.stringify({ v: RUNS_FILE_VERSION, items: runs })
}

export function persistRuns(kv: KvStore | null, runs: RunRecord[]): WriteResult {
  if (!kv) return { ok: false, error: '当前环境不支持本地存储，运行记录未保存' }
  try {
    kv.setItem(RUNS_KEY, serializeRuns(runs))
    return { ok: true }
  } catch {
    return { ok: false, error: '运行记录未保存：浏览器本地存储写入失败' }
  }
}

export interface ExportedStep {
  type: StepType
  config: StepConfig
  /** 该步骤的密钥不在导出内容里，导入后需要重新填写 */
  requiresSecret?: true
}

export interface ExportedWorkflow {
  version: number
  name: string
  desc: string
  steps: ExportedStep[]
}

/** 导出：只含算法、方向、编码等非敏感参数，密钥/私钥/IV/AAD 一律不导出 */
export function exportWorkflow(wf: Workflow): ExportedWorkflow {
  const steps: ExportedStep[] = wf.steps.map((s) => {
    const config: StepConfig = { ...s.config }
    for (const f of stepDef(s.type).fields) {
      if (f.sensitive) delete config[f.key]
    }
    const out: ExportedStep = { type: s.type, config }
    if (isSensitiveStep(s.type)) out.requiresSecret = true
    return out
  })
  return { version: WORKFLOW_FILE_VERSION, name: wf.name, desc: wf.desc, steps }
}

export function exportWorkflowText(wf: Workflow): string {
  return JSON.stringify(exportWorkflow(wf), null, 2)
}

export interface ImportResult {
  workflow: Workflow
  /** 需要风险确认的步骤类型：调用方必须先取得确认再落地 */
  secretTypes: StepType[]
}

/** 导入：结构不合法整体拒绝；含敏感步骤时把类型回报给调用方走同一个确认入口 */
export function parseImportText(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('不是合法的 JSON')
  }
  const obj = parsed as Partial<ExportedWorkflow>
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.steps)) throw new Error('缺少 steps 数组')
  const seen = new Set<string>()
  const steps: WorkflowStep[] = []
  for (const raw of obj.steps) {
    const step = sanitizeStep(raw, seen)
    if (!step) {
      const t = (raw as { type?: unknown })?.type
      throw new Error(`存在不支持的步骤类型：${typeof t === 'string' ? t : '未知'}`)
    }
    // 导入的步骤一律重新走风险确认：不继承来源流程里的确认记录
    delete step.consent
    delete step.secretRef
    steps.push(step)
  }
  const workflow: Workflow = {
    id: uid('wf'),
    name: (typeof obj.name === 'string' ? obj.name : '').trim() || '导入的处理流程',
    desc: (typeof obj.desc === 'string' ? obj.desc : '').trim(),
    steps
  }
  const secretTypes = [...new Set(steps.filter((s) => isSensitiveStep(s.type)).map((s) => s.type))]
  return { workflow, secretTypes }
}
