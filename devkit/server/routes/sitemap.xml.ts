import { tools, categories } from '../../app/data/tools'

const SITE = 'https://www.t502.fun'

export default defineEventHandler((event) => {
  // 收藏 / 最近使用 / 设置是私有且内容为空的页面，加 noindex 后不再进 sitemap
  const paths = ['/', '/privacy', '/help', '/offline', '/workflows']
  for (const c of categories) paths.push(`/category/${c.key}`)
  for (const t of tools) paths.push(`/tools/${t.slug}`)

  const lastmod = new Date().toISOString().slice(0, 10)
  const urls = paths
    .map(
      (p) =>
        `  <url><loc>${SITE}${p === '/' ? '/' : `${p}/`}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${
          p === '/' ? '1.0' : '0.7'
        }</priority></url>`
    )
    .join('\n')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
