/**
 * 处理流程：兼容入口。
 * 实现已拆分到 app/workflow/：types（类型与载荷）/ catalog（步骤库）/ runner（顺序执行）/
 * storage（持久化与导入导出）/ secrets（密钥与风险确认）/ executors（各步骤执行器）/ presets（默认与预设流程）。
 * 只传「流程」相关的类型与函数，输入与中间结果依然只在页面内存里。
 */
export * from '../workflow/types'
export * from '../workflow/catalog'
export * from '../workflow/runner'
export * from '../workflow/storage'
export * from '../workflow/secrets'
export * from '../workflow/presets'
export * from '../workflow/selection'
