import { tools, categories } from '../../app/data/tools'

export const SITE = 'https://www.t502.fun'

/**
 * 站点公开 URL 全集（尾斜杠形式，与线上真实 200 地址一致）。
 * 收藏 / 最近使用 / 设置是私有且内容为空的页面，已加 noindex，不进 sitemap。
 */
export function siteUrls(): string[] {
  const paths = ['/', '/tools', '/privacy', '/help', '/offline', '/workflows']
  for (const c of categories) paths.push(`/category/${c.key}`)
  for (const t of tools) paths.push(`/tools/${t.slug}`)
  return paths.map((p) => (p === '/' ? `${SITE}/` : `${SITE}${p}/`))
}
