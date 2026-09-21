import { siteUrls } from '../utils/site-paths'

// 纯文本 sitemap（每行一个 URL）：百度/Google/Bing 都支持，绕开 XML 解析环节。
// 用途：百度「站点地图」报「无法读取此站点地图」时的兜底提交地址 https://www.t502.fun/sitemap.txt
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return `${siteUrls().join('\n')}\n`
})
