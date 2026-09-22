/**
 * 统计埋点的域名白名单。
 *
 * 背景（2026-09-22 事故）：百度统计按埋点 ID（`hm.js?<站点ID>`）归属站点，与访问域名无关。
 * 只要同一份 HTML 在**别的域名**下被渲染——COS 桶默认域名
 * （`<bucket>.cos.<region>.myqcloud.com`）、数据万象签名预览链接、镜像站等——
 * 那次访问就会计进 `www.t502.fun` 这个站点的报表里，把页面 URL 统计污染成一堆源站地址。
 * 因此埋点只在**站点自己的域名**下注入与上报。
 *
 * 白名单为空数组时表示不限制（本地预览、临时域名等场景）；默认值由
 * `nuxt.config.ts` 的 `DEVKIT_ANALYTICS_HOSTS` 提供，形如 `www.t502.fun,t502.fun`。
 */

/** 规范化一条白名单：去掉协议、路径、端口与前导通配符，统一小写 */
export function normalizeHostEntry(entry: string): string {
  return String(entry ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\*\./, '')
}

/** 解析逗号/分号分隔的白名单字符串 */
export function parseAnalyticsHosts(raw: string | null | undefined): string[] {
  if (!raw) return []
  return String(raw)
    .split(/[,;\s]+/)
    .map(normalizeHostEntry)
    .filter(Boolean)
}

/** 判断当前 hostname 是否允许上报：白名单为空则不限制；命中同域或其子域即通过 */
export function isAnalyticsHostAllowed(hostname: string, allow: readonly string[]): boolean {
  if (!allow || allow.length === 0) return true
  const host = normalizeHostEntry(hostname)
  if (!host) return false
  return allow.some((entry) => {
    const h = normalizeHostEntry(entry)
    return h !== '' && (host === h || host.endsWith('.' + h))
  })
}
