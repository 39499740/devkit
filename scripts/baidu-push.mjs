#!/usr/bin/env node
/**
 * 百度「普通收录」API 推送：把 sitemap 里的 URL 主动推给百度，加快收录。
 * 用法：
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs https://www.t502.fun/sitemap.xml
 * 说明：
 *   token 在百度搜索资源平台 → 普通收录 → API 提交 里获取（每个站点一个，切勿泄露）。
 *   百度对未收录/新页面更敏感，建议每次发版后执行一次。
 */
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = process.env.BAIDU_PUSH_SITE || 'https://www.t502.fun'
const token = process.env.BAIDU_PUSH_TOKEN
if (!token) {
  console.error('缺少 BAIDU_PUSH_TOKEN（百度搜索资源平台 → 普通收录 → API 提交 里获取）')
  process.exit(1)
}

const source = process.argv[2] || join(root, 'devkit/.output/public/sitemap.xml')
const xml = source.startsWith('http')
  ? await (await fetch(source)).text()
  : await readFile(source, 'utf8')

const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
if (!urls.length) {
  console.error('sitemap 里没有找到 URL：' + source)
  process.exit(1)
}

const body = urls.join('\n')
const path = '/urls?site=' + encodeURIComponent(site) + '&token=' + encodeURIComponent(token)
const req = request(
  { host: 'data.zz.baidu.com', method: 'POST', path, headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
  (res) => {
    let text = ''
    res.on('data', (d) => (text += d))
    res.on('end', () => {
      console.log('推送 ' + urls.length + ' 条 URL → ' + site)
      console.log(res.statusCode + ' ' + text)
      if (res.statusCode !== 200) process.exitCode = 1
    })
  }
)
req.on('error', (e) => {
  console.error('推送失败：' + e.message)
  process.exitCode = 1
})
req.setTimeout(20000, () => {
  console.error('推送超时')
  req.destroy()
})
req.end(body)
