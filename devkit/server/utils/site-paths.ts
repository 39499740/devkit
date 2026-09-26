import { tools, categories } from '../../app/data/tools'
import { scenarios } from '../../app/data/scenarios'

export const SITE = 'https://www.t502.fun'

/**
 * 站点公开 URL 全集（尾斜杠形式，与线上真实 200 地址一致）。
 * 收藏 / 最近使用 / 设置是私有且内容为空的页面，已加 noindex，不进 sitemap。
 * 场景页与工具页一样从注册表（app/data/scenarios.ts）生成，加页面时不必改这里。
 */
export function siteUrls(): string[] {
  const paths = ['/', '/tools', '/privacy', '/help', '/offline', '/workflows']
  for (const s of scenarios) paths.push(`/scenarios/${s.slug}`)
  for (const c of categories) paths.push(`/category/${c.key}`)
  for (const t of tools) paths.push(`/tools/${t.slug}`)
  return paths.map((p) => (p === '/' ? `${SITE}/` : `${SITE}${p}/`))
}
