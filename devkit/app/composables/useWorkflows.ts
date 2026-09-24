/**
 * 处理流程状态：客户端 hydration + localStorage 持久化 + 密钥与风险确认。
 *
 * 存储边界（与页面隐私文案一致）：
 * - 进 localStorage：流程名称/说明/步骤顺序、非敏感参数、密钥字段（明文）；
 * - 不进 localStorage：流程输入、每步输出、中间结果；运行记录只留状态、耗时与步骤摘要。
 *
 * 写入策略：每次用户改动同步写一次。流程数据只有几 KB，节流省下的时间抵不上
 * 「改完立刻关页」丢改动的风险，所以不做延迟写。
 */
import { createStep, isSensitiveStep, stepDef, stepLibrary } from '~/workflow/catalog'
import {
  buildWorkflowFromPreset,
  defaultWorkflows,
  findPreset,
  presetSecretTypes,
  workflowPresets,
  type WorkflowPreset
} from '~/workflow/presets'
import {
  browserKv,
  clearSecrets as clearStoredSecrets,
  emptySecrets,
  isCurrentConsent,
  loadSecrets,
  makeConsent,
  missingRequiredSecrets,
  persistSecrets,
  removeSecretOfStep,
  removeSecretsOfWorkflow,
  secretFields,
  upsertSecret
} from '~/workflow/secrets'
import type { SecretsFile } from '~/workflow/secrets'
import type { SecretConsent, StepConfigValue, StepType, Workflow, WorkflowStep } from '~/workflow/types'
import {
  exportWorkflowText,
  parseImportText,
  parseRuns,
  parseWorkflows,
  persistRuns,
  persistWorkflows,
  RUNS_KEY,
  uid,
  WORKFLOWS_KEY,
  type RunRecord,
  type WriteResult
} from '~/workflow/storage'

const MAX_RUNS = 50

export function useWorkflows() {
  const workflows = useState<Workflow[]>('devkit-workflows', () => defaultWorkflows())
  const runs = useState<RunRecord[]>('devkit-workflow-runs', () => [])
  const secrets = useState<SecretsFile>('devkit-workflow-secrets', () => emptySecrets())
  const hydrated = useState<boolean>('devkit-workflows-hydrated', () => false)
  /** 本地存储损坏 / 写不进去时的可读错误，页面据此提示用户 */
  const storageError = useState<string>('devkit-workflows-storage-error', () => '')
  const toast = useToast()

  function note(res: WriteResult): WriteResult {
    if (!res.ok && res.error) {
      storageError.value = res.error
      toast.warning(res.error)
    }
    return res
  }

  function persistWorkflowsState(): WriteResult {
    return note(persistWorkflows(browserKv(), workflows.value))
  }

  function persistSecretsState(): WriteResult {
    return note(persistSecrets(browserKv(), secrets.value))
  }

  function persistRunsState(): WriteResult {
    return note(persistRuns(browserKv(), runs.value))
  }

  /** 客户端挂载后读一次本地数据；SSR 阶段先用默认流程，不访问 window */
  function hydrate() {
    if (hydrated.value || import.meta.server) return
    const kv = browserKv()
    const wfLoad = parseWorkflows(kv?.getItem(WORKFLOWS_KEY) ?? null)
    if (wfLoad.workflows) workflows.value = wfLoad.workflows
    if (wfLoad.error) {
      storageError.value = wfLoad.error
      toast.warning(wfLoad.error)
    }
    const secretLoad = loadSecrets(kv)
    secrets.value = secretLoad.file
    if (secretLoad.error) {
      storageError.value = secretLoad.error
      toast.warning(secretLoad.error)
    }
    const runLoad = parseRuns(kv?.getItem(RUNS_KEY) ?? null)
    runs.value = runLoad.runs
    if (runLoad.error) toast.warning(runLoad.error)
    hydrated.value = true
  }

  onMounted(hydrate)

  function get(id: string): Workflow | undefined {
    return workflows.value.find((w) => w.id === id)
  }

  function create(name: string, desc = ''): Workflow {
    const wf: Workflow = { id: uid('wf'), name: name.trim() || '未命名流程', desc: desc.trim(), steps: [] }
    workflows.value = [...workflows.value, wf]
    persistWorkflowsState()
    return wf
  }

  function remove(id: string) {
    workflows.value = workflows.value.filter((w) => w.id !== id)
    runs.value = runs.value.filter((r) => r.workflowId !== id)
    // 删除流程必须同时清掉它的全部密钥记录，避免留下读不到的密钥
    secrets.value = removeSecretsOfWorkflow(secrets.value, id)
    persistWorkflowsState()
    persistSecretsState()
    persistRunsState()
  }

  function rename(id: string, name: string, desc: string) {
    workflows.value = workflows.value.map((w) =>
      w.id === id ? { ...w, name: name.trim() || w.name, desc: desc.trim() } : w
    )
    persistWorkflowsState()
  }

  interface AddResult {
    ok: boolean
    error?: string
    step?: WorkflowStep
  }

  /** 敏感步骤必须带有效的风险确认；这里是「添加步骤」的唯一入口，各页面不要绕过 */
  function makeStep(type: StepType, consent?: SecretConsent): WorkflowStep {
    const step = createStep(type)
    if (isSensitiveStep(type)) {
      step.consent = consent
      step.secretRef = step.id
    }
    return step
  }

  function checkConsent(type: StepType, consent?: SecretConsent): string | undefined {
    if (isSensitiveStep(type) && !isCurrentConsent(consent)) {
      return `「${stepDef(type).name}」包含密钥配置，需要先确认风险后才能添加`
    }
    return undefined
  }

  function addStep(id: string, type: StepType, opts: { consent?: SecretConsent } = {}): AddResult {
    const error = checkConsent(type, opts.consent)
    if (error) return { ok: false, error }
    const step = makeStep(type, opts.consent)
    workflows.value = workflows.value.map((w) => (w.id === id ? { ...w, steps: [...w.steps, step] } : w))
    persistWorkflowsState()
    return { ok: true, step }
  }

  function insertStep(
    id: string,
    index: number,
    type: StepType,
    opts: { consent?: SecretConsent } = {}
  ): AddResult {
    const error = checkConsent(type, opts.consent)
    if (error) return { ok: false, error }
    const step = makeStep(type, opts.consent)
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      const steps = [...w.steps]
      steps.splice(Math.max(0, Math.min(steps.length, index)), 0, step)
      return { ...w, steps }
    })
    persistWorkflowsState()
    return { ok: true, step }
  }

  /** 复制步骤同样要重新确认风险，并且不复制密钥（新步骤一开始就是空密钥） */
  function duplicateStep(id: string, index: number, opts: { consent?: SecretConsent } = {}): AddResult {
    const wf = get(id)
    const source = wf?.steps[index]
    if (!source) return { ok: false, error: '该位置没有步骤可复制' }
    const error = checkConsent(source.type, opts.consent)
    if (error) return { ok: false, error }
    const step = makeStep(source.type, opts.consent)
    step.config = { ...source.config }
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      const steps = [...w.steps]
      steps.splice(index + 1, 0, step)
      return { ...w, steps }
    })
    persistWorkflowsState()
    return { ok: true, step }
  }

  function removeStep(id: string, index: number) {
    const step = get(id)?.steps[index]
    workflows.value = workflows.value.map((w) =>
      w.id === id ? { ...w, steps: w.steps.filter((_, i) => i !== index) } : w
    )
    if (step && isSensitiveStep(step.type)) {
      // 密钥按 (workflowId, stepId) 定位：别的流程可能正好有同名步骤
      secrets.value = removeSecretOfStep(secrets.value, id, step.id)
      persistSecretsState()
    }
    persistWorkflowsState()
  }

  function moveStep(id: string, index: number, dir: -1 | 1) {
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      const steps = [...w.steps]
      const to = index + dir
      if (to < 0 || to >= steps.length) return w
      const [item] = steps.splice(index, 1)
      steps.splice(to, 0, item!)
      return { ...w, steps }
    })
    persistWorkflowsState()
  }

  function updateStepConfig(id: string, index: number, key: string, value: StepConfigValue) {
    // 敏感字段永远不进 config：写密钥请走 setStepSecret
    if (stepDef(get(id)?.steps[index]?.type ?? stepLibrary[0]!.type).fields.some((f) => f.key === key && f.sensitive)) {
      return
    }
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      return {
        ...w,
        steps: w.steps.map((s, i) => (i === index ? { ...s, config: { ...s.config, [key]: value } } : s))
      }
    })
    persistWorkflowsState()
  }

  function stepSecrets(workflowId: string, stepId: string): Record<string, string> {
    return secretFields(secrets.value, workflowId, stepId)
  }

  function secretUpdatedAt(workflowId: string, stepId: string): number | null {
    return secrets.value.items.find((s) => s.stepId === stepId && s.workflowId === workflowId)?.updatedAt ?? null
  }

  function setStepSecret(workflowId: string, stepId: string, key: string, value: string): { ok: boolean; error?: string } {
    const step = get(workflowId)?.steps.find((s) => s.id === stepId)
    if (!step) return { ok: false, error: '步骤不存在' }
    if (!isSensitiveStep(step.type)) return { ok: false, error: '该步骤没有密钥字段' }
    if (!isCurrentConsent(step.consent)) return { ok: false, error: '风险确认已失效，请重新确认后再填写密钥' }
    const current = stepSecrets(workflowId, stepId)
    secrets.value = upsertSecret(secrets.value, {
      workflowId,
      stepId,
      fields: { ...current, [key]: value },
      now: Date.now()
    })
    const res = persistSecretsState()
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  }

  function confirmStep(workflowId: string, stepId: string): { ok: boolean; error?: string } {
    const step = get(workflowId)?.steps.find((s) => s.id === stepId)
    if (!step) return { ok: false, error: '步骤不存在' }
    const consent = makeConsent(Date.now())
    workflows.value = workflows.value.map((w) =>
      w.id === workflowId
        ? { ...w, steps: w.steps.map((s) => (s.id === stepId ? { ...s, consent, secretRef: s.secretRef ?? s.id } : s)) }
        : w
    )
    persistWorkflowsState()
    return { ok: true }
  }

  function missingSecretsOf(workflowId: string, step: WorkflowStep): string[] {
    if (!isSensitiveStep(step.type)) return []
    return missingRequiredSecrets(step.type, stepSecrets(workflowId, step.id)).map((f) => f.label)
  }

  /** 清空全部已保存密钥：步骤保留，但会重新变成「缺少密钥」 */
  function clearSecrets(): { ok: boolean; error?: string } {
    const kv = browserKv()
    // 没有可用存储时不能假装清空成功：否则用户以为密钥已删除，实际什么都没发生
    if (!kv) return { ok: false, error: '当前环境不支持本地存储，无法清除密钥' }
    secrets.value = emptySecrets()
    const res = clearStoredSecrets(kv)
    if (!res.ok && res.error) {
      storageError.value = res.error
      return { ok: false, error: res.error }
    }
    return { ok: true }
  }

  /** 清空所有流程：流程与密钥一起清掉（设置页的数据清理入口） */
  function clearAll(): { ok: boolean; error?: string } {
    workflows.value = []
    runs.value = []
    const a = clearSecrets()
    const b = persistWorkflowsState()
    persistRunsState()
    if (!a.ok) return a
    return b.ok ? { ok: true } : { ok: false, error: b.error }
  }

  /** 导出：不含密钥、私钥、IV、AAD */
  function exportText(id: string): string {
    const wf = get(id)
    return wf ? exportWorkflowText(wf) : ''
  }

  interface ImportPreview {
    name: string
    steps: number
    secretTypes: StepType[]
  }

  /** 导入前先看清楚：含敏感步骤时调用方必须先取得风险确认 */
  function inspectImport(text: string): ImportPreview {
    const res = parseImportText(text)
    return { name: res.workflow.name, steps: res.workflow.steps.length, secretTypes: res.secretTypes }
  }

  function importWorkflow(text: string, opts: { consent?: SecretConsent } = {}): Workflow {
    const res = parseImportText(text)
    if (res.secretTypes.length && !isCurrentConsent(opts.consent)) {
      throw new Error('该流程包含密钥步骤，需要先确认风险后才能导入')
    }
    const wf: Workflow = {
      ...res.workflow,
      steps: res.workflow.steps.map((s) =>
        isSensitiveStep(s.type) ? { ...s, consent: opts.consent, secretRef: s.id } : s
      )
    }
    workflows.value = [...workflows.value, wf]
    persistWorkflowsState()
    toast.success(`已导入「${wf.name}」，共 ${wf.steps.length} 步`)
    return wf
  }

  /** 从预设库创建：含密钥的预设同样先走风险确认 */
  function addPreset(key: string, opts: { consent?: SecretConsent } = {}): Workflow {
    const preset = findPreset(key)
    if (!preset) throw new Error('预设流程不存在')
    if (presetSecretTypes(preset).length && !isCurrentConsent(opts.consent)) {
      throw new Error(`预设「${preset.name}」包含密钥步骤，需要先确认风险后才能添加`)
    }
    // 构建即产生独立流程 ID 与步骤 ID：同一预设可以重复添加，密钥互不覆盖
    const wf = buildWorkflowFromPreset(preset, { consent: opts.consent })
    workflows.value = [...workflows.value, wf]
    persistWorkflowsState()
    toast.success(`已添加预设「${wf.name}」，共 ${wf.steps.length} 步`)
    return wf
  }

  function addRun(record: Omit<RunRecord, 'id' | 'at'>) {
    runs.value = [{ ...record, id: uid('run'), at: Date.now() }, ...runs.value].slice(0, MAX_RUNS)
    persistRunsState()
  }

  function clearRuns(workflowId?: string) {
    runs.value = workflowId ? runs.value.filter((r) => r.workflowId !== workflowId) : []
    persistRunsState()
  }

  function runsOf(workflowId: string): RunRecord[] {
    return runs.value.filter((r) => r.workflowId === workflowId)
  }

  return {
    workflows,
    runs,
    secrets,
    hydrated,
    storageError,
    presets: workflowPresets as WorkflowPreset[],
    stepLibrary,
    hydrate,
    get,
    create,
    remove,
    rename,
    addStep,
    insertStep,
    duplicateStep,
    removeStep,
    moveStep,
    updateStepConfig,
    stepSecrets,
    secretUpdatedAt,
    setStepSecret,
    confirmStep,
    missingSecretsOf,
    clearSecrets,
    clearAll,
    exportText,
    inspectImport,
    importWorkflow,
    addPreset,
    addRun,
    clearRuns,
    runsOf
  }
}

/** 相对时间，只用于真实存在的运行记录 */
export function fmtAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000)
    return `今天 ${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
