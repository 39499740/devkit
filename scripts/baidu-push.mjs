#!/usr/bin/env node
/**
 * 百度「普通收录」API 推送：把 sitemap 里的 URL 主动推给百度，加快收录。
 * 用法：
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs https://www.t502.fun/sitemap.xml
 * 说明：
 *   token 在百度搜索资源平台 → 普通收录 → API 提交 里获取（每个站点一个，切勿泄露）。
 *   注意：百度推送接口只有 HTTP（http://data.zz.baidu.com/urls），它的证书不含 data.zz.baidu.com，走 https 会证书校验失败。
 *   百度对未收录/新页面更敏感，建议每次发版后执行一次。
 */
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
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

// 新站 API 配额很小（常见 10 条/天，与手动提交共享），按优先级排序后可只推前 N 条：BAIDU_PUSH_LIMIT=5
const PRIORITY = [
  'https://www.t502.fun/',
  'https://www.t502.fun/tools/json-format/',
  'https://www.t502.fun/tools/base64/',
  'https://www.t502.fun/tools/timestamp/',
  'https://www.t502.fun/tools/md5/',
  'https://www.t502.fun/tools/aes/'
]
const limit = Number(process.env.BAIDU_PUSH_LIMIT || 0)
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .sort((a, b) => (PRIORITY.indexOf(a) + 1 || 99) - (PRIORITY.indexOf(b) + 1 || 99))
  .slice(0, limit > 0 ? limit : undefined)
if (!urls.length) {
  console.error('sitemap 里没有找到 URL：' + source)
  process.exit(1)
}

const body = urls.join('\n')
// 注意：site/token 不能 URL 编码，百度只认控制台给出的原文（site=https://www.t502.fun）
const path = '/urls?site=' + site + '&token=' + token
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
