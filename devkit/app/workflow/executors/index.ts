/** 步骤类型 → 执行器映射；新增步骤时这里与 catalog.ts 必须同时补齐（单测会校验完整性） */
import type { StepExecutor, StepType } from '../types'
import { cryptoExecutors } from './crypto'
import { textExecutors } from './text'

export const executors: Record<StepType, StepExecutor> = {
  ...(textExecutors as Record<StepType, StepExecutor>),
  ...(cryptoExecutors as Record<StepType, StepExecutor>)
}
