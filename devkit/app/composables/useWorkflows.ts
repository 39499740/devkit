/**
 * 处理流程（S11 / S12）的内存状态：只存在于本次页面会话，刷新即回到默认流程。
 * 不写入 localStorage / IndexedDB，也不上传任何输入。
 */
import { defaultWorkflows, stepLibrary, type Workflow, type WorkflowStep } from '~/utils/workflow'

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

const MAX_RUNS = 50

export function useWorkflows() {
  const workflows = useState<Workflow[]>('devkit-workflows', () => defaultWorkflows())
  const runs = useState<RunRecord[]>('devkit-workflow-runs', () => [])
  const toast = useToast()

  function get(id: string): Workflow | undefined {
    return workflows.value.find((w) => w.id === id)
  }

  function create(name: string, desc = ''): Workflow {
    const wf: Workflow = {
      id: `wf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '未命名流程',
      desc: desc.trim(),
      steps: []
    }
    workflows.value = [...workflows.value, wf]
    return wf
  }

  function remove(id: string) {
    workflows.value = workflows.value.filter((w) => w.id !== id)
    runs.value = runs.value.filter((r) => r.workflowId !== id)
  }

  function rename(id: string, name: string, desc: string) {
    workflows.value = workflows.value.map((w) =>
      w.id === id ? { ...w, name: name.trim() || w.name, desc: desc.trim() } : w
    )
  }

  function addStep(id: string, step: WorkflowStep) {
    workflows.value = workflows.value.map((w) => (w.id === id ? { ...w, steps: [...w.steps, step] } : w))
  }

  function insertStep(id: string, index: number, step: WorkflowStep) {
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      const steps = [...w.steps]
      steps.splice(Math.max(0, Math.min(steps.length, index)), 0, step)
      return { ...w, steps }
    })
  }

  function removeStep(id: string, index: number) {
    workflows.value = workflows.value.map((w) =>
      w.id === id ? { ...w, steps: w.steps.filter((_, i) => i !== index) } : w
    )
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
  }

  function updateStepConfig(id: string, index: number, key: string, value: string) {
    workflows.value = workflows.value.map((w) => {
      if (w.id !== id) return w
      return {
        ...w,
        steps: w.steps.map((s, i) => (i === index ? { ...s, config: { ...s.config, [key]: value } } : s))
      }
    })
  }

  function addRun(record: Omit<RunRecord, 'id' | 'at'>) {
    runs.value = [
      { ...record, id: `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: Date.now() },
      ...runs.value
    ].slice(0, MAX_RUNS)
  }

  function clearRuns(workflowId?: string) {
    runs.value = workflowId ? runs.value.filter((r) => r.workflowId !== workflowId) : []
  }

  function runsOf(workflowId: string): RunRecord[] {
    return runs.value.filter((r) => r.workflowId === workflowId)
  }

  /** 导入流程：只接受结构正确的 JSON，字段不合法就整体拒绝 */
  function importWorkflow(text: string): Workflow {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('不是合法的 JSON')
    }
    const obj = parsed as Partial<Workflow>
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.steps)) throw new Error('缺少 steps 数组')
    const types = new Set(stepLibrary.map((s) => s.type))
    for (const s of obj.steps) {
      if (!s || typeof s !== 'object' || !types.has((s as WorkflowStep).type)) {
        throw new Error(`存在不支持的步骤类型：${(s as WorkflowStep)?.type ?? '未知'}`)
      }
    }
    const wf: Workflow = {
      id: `wf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: (obj.name ?? '').trim() || '导入的处理流程',
      desc: (obj.desc ?? '').trim(),
      steps: obj.steps.map((s) => ({ type: s.type, config: { ...(s.config ?? {}) } }))
    }
    workflows.value = [...workflows.value, wf]
    toast.success(`已导入「${wf.name}」，共 ${wf.steps.length} 步`)
    return wf
  }

  return {
    workflows,
    runs,
    get,
    create,
    remove,
    rename,
    addStep,
    insertStep,
    removeStep,
    moveStep,
    updateStepConfig,
    addRun,
    clearRuns,
    runsOf,
    importWorkflow
  }
}

/** 相对时间，只用于真实存在的运行记录 */
export function fmtAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `今天 ${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
