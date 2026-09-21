import { SITE, siteUrls } from '../utils/site-paths'

export default defineEventHandler((event) => {
  const lastmod = new Date().toISOString().slice(0, 10)
  const urls = siteUrls()
    .map(
      (u) =>
        `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${
          u === `${SITE}/` ? '1.0' : '0.7'
        }</priority></url>`
    )
    .join('\n')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
