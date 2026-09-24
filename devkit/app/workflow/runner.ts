/**
 * 顺序执行器：挑执行器、取密钥、计时、脱敏日志、错误转换。
 * 输入与中间结果只存在于内存；这里不读写任何存储。
 */
import { errMessage } from '../utils/errors'
import { isSensitiveStep, stepDef } from './catalog'
import { executors } from './executors'
import { isCurrentConsent, missingRequiredSecrets, redactSecrets } from './secrets'
import { asPayload, textPayload } from './types'
import type { StepPayload, StepResult, Workflow, WorkflowRunResult, WorkflowStep } from './types'

export interface RunStepOptions {
  /** 该步骤的密钥字段。值来自密钥存储，绝不放进 config */
  secrets?: Record<string, string>
}

export interface RunWorkflowOptions {
  stopOnError: boolean
  onlyFrom?: number
  secretOf?: (step: WorkflowStep) => Record<string, string> | undefined
}

export const MISSING_SECRET_HINT =
  '提示：加解密步骤的密钥保存在本机浏览器 localStorage，可在「偏好设置 → 清空已保存密钥」里一次性清除'

function formatByteSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/** 字节数：bytes 载荷按真实字节数（Hex 视图长度是两倍），文本载荷按 UTF-8 编码长度 */
function payloadByteLength(payload: StepPayload): number {
  if (payload.kind === 'bytes' && payload.bytes) return payload.bytes.length
  return new TextEncoder().encode(payload.text).length
}

export async function runStep(
  step: WorkflowStep,
  input: string | StepPayload,
  index: number,
  opts: RunStepOptions = {}
): Promise<StepResult> {
  const def = stepDef(step.type)
  const t0 = Date.now()
  const payload = asPayload(input)
  const secrets = opts.secrets ?? {}
  const logs: string[] = [
    `运行步骤 ${index + 1} · ${def.name}`,
    `输入 ${formatByteSize(payloadByteLength(payload))}${payload.kind === 'bytes' ? '（二进制，按 Hex 传递）' : ''}`
  ]
  const finish = (
    status: StepResult['status'],
    out: StepPayload,
    note: string
  ): StepResult => {
    // 日志与提示统一走一次脱敏：密钥值永远不会被主动写进这里，这里再兜一次底
    const safeNote = redactSecrets(note, secrets)
    logs.push(`${status === 'ok' ? '完成' : '失败'}：${safeNote}`)
    logs.push(`耗时 ${Math.max(1, Date.now() - t0)} ms`)
    return {
      index,
      type: step.type,
      name: def.name,
      status,
      payload: out,
      output: out.text,
      outputKind: out.kind,
      note: safeNote,
      logs,
      ms: Math.max(1, Date.now() - t0)
    }
  }

  // 风险确认门禁：敏感步骤的确认文案版本过旧或缺失时，旧密钥一律不可用，
  // 必须重新确认风险后才能运行（先于「缺少密钥」判断，确认优先）。
  if (isSensitiveStep(step.type) && !isCurrentConsent(step.consent)) {
    logs.push('风险确认已失效或缺失：敏感步骤需要重新确认风险后才能运行')
    return finish('fail', textPayload(''), '该步骤的风险确认已失效或缺失，请重新确认风险后再运行')
  }

  const missing = missingRequiredSecrets(step.type, secrets)
  if (missing.length) {
    logs.push(MISSING_SECRET_HINT)
    return finish(
      'fail',
      textPayload(''),
      `缺少密钥：${missing.map((m) => m.label).join('、')}（在「当前步骤」里填写并确认风险后会保存到本机浏览器）`
    )
  }

  const exec = executors[step.type]
  if (!exec) return finish('fail', textPayload(''), `未知步骤类型：${step.type}`)

  try {
    const res = await exec(payload, step.config, secrets)
    logs.push(`输出 ${formatByteSize(payloadByteLength(res.payload))}${res.payload.kind === 'bytes' ? '（二进制结果，界面按 Hex 展示）' : ''}`)
    return finish('ok', res.payload, res.note)
  } catch (e) {
    return finish('fail', textPayload(''), errMessage(e))
  }
}

/** 顺序执行整条流程；失败时按「失败时中断流程」决定是否继续 */
export async function runWorkflow(
  workflow: Workflow,
  input: string | StepPayload,
  opts: RunWorkflowOptions
): Promise<WorkflowRunResult> {
  const t0 = Date.now()
  const results: StepResult[] = []
  let cur = asPayload(input)
  let status: 'ok' | 'fail' = 'ok'
  const start = Math.max(0, opts.onlyFrom ?? 0)
  for (let i = start; i < workflow.steps.length; i += 1) {
    const step = workflow.steps[i]!
    const r = await runStep(step, cur, i, { secrets: opts.secretOf?.(step) })
    results.push(r)
    if (r.status === 'ok') {
      cur = r.payload
      continue
    }
    status = 'fail'
    if (opts.stopOnError) break
  }
  return { results, finalOutput: cur.text, status, ms: Date.now() - t0 }
}
