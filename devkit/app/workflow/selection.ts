export type WorkflowSelection = { kind: 'input' } | { kind: 'step'; index: number } | { kind: 'output' }

/**
 * 把「当前选中项」规范化为输入 / 步骤 / 输出三种状态：
 * -1 及以下 = 流程输入；0..stepCount-1 = 对应步骤；stepCount 及以上 = 流程输出。
 * 越界（例如删除步骤后选中项还停在旧下标）不会再去访问不存在的步骤。
 */
export function normalizeSelection(stepCount: number, selected: number): WorkflowSelection {
  const count = Number.isFinite(stepCount) ? Math.max(0, Math.trunc(stepCount)) : 0
  if (!Number.isFinite(selected)) return { kind: 'input' }
  const index = Math.trunc(selected)
  if (index < 0) return { kind: 'input' }
  if (index >= count) return { kind: 'output' }
  return { kind: 'step', index }
}
