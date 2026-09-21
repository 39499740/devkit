/** 统一的错误信息提取：utils 层的模块要显式 import，不依赖 Nuxt 自动导入 */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
