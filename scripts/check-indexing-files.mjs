#!/usr/bin/env node
/**
 * 收录文件线上自检（可随时复跑，不需要任何密钥）：
 *   node scripts/check-indexing-files.mjs                      # 检查 https://www.t502.fun
 *   node scripts/check-indexing-files.mjs https://other.host   # 换站点
 *
 * 检查项：robots.txt 可读且声明了 sitemap；sitemap.xml 返回 200 / application/xml / XML 结构完整；
 * sitemap.txt 返回 200 / text/plain 且行数一致；两者 URL 集合与本地构建产物完全一致。
 * 任一不符 → 退出码 1（可直接用于发版门禁）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = (process.argv[2] || 'https://www.t502.fun').replace(/\/$/, '')
const localXml = join(root, 'devkit/.output/public/sitemap.xml')
const localTxtPath = join(root, 'devkit/.output/public/sitemap.txt')

const fails = []
const ok = (msg) => console.log('  ✅ ' + msg)
const bad = (msg) => {
  console.log('  ❌ ' + msg)
  fails.push(msg)
}

async function get(path) {
  const res = await fetch(site + path, { redirect: 'follow' })
  const body = await res.text()
  return { status: res.status, type: res.headers.get('content-type') || '', body, headers: res.headers }
}

const locsOf = (xml) => (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.slice(5, -6))
const linesOf = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean)

console.log(`检查站点：${site}\n`)

// 1. robots.txt
console.log('[1] robots.txt')
try {
  const r = await get('/robots.txt')
  if (r.status !== 200) bad(`状态码 ${r.status}`)
  else ok('200')
  const declared = (r.body.match(/^Sitemap:\s*(\S+)/gim) || []).map((l) => l.replace(/^Sitemap:\s*/i, ''))
  if (!declared.length) bad('未声明任何 Sitemap')
  else ok('声明了 ' + declared.length + ' 个 sitemap：' + declared.join(' , '))
  if (/^Disallow:\s*\/\s*$/im.test(r.body)) bad('存在 Disallow: /（会拦截爬虫）')
} catch (e) {
  bad('robots.txt 请求失败：' + e.message)
}

// 2. sitemap.xml
console.log('[2] sitemap.xml')
let remoteXml = null
try {
  const r = await get('/sitemap.xml')
  if (r.status !== 200) bad(`状态码 ${r.status}`)
  else ok('200')
  if (!/xml/.test(r.type)) bad('Content-Type 不是 xml：' + r.type)
  else ok('Content-Type ' + r.type)
  if (!r.body.startsWith('<?xml')) bad('首行不是 XML 声明（可能有 BOM 或前导空白）')
  else ok('首行是 XML 声明')
  if (!r.body.trimEnd().endsWith('</urlset>')) bad('结尾不是 </urlset>（XML 不完整）')
  else ok('XML 闭合完整')
  const locs = locsOf(r.body)
  if (!locs.length) bad('未解析到任何 <loc>')
  else ok(`${locs.length} 条 URL`)
  if (locs.some((u) => u.length > 256)) bad('存在超过 256 字节的 loc')
  if (locs.some((u) => !u.startsWith(site))) bad('存在不属于本站点的 loc')
  if (locs.some((u) => !u.endsWith('/') && !/\.[a-z0-9]+$/i.test(u))) {
    bad('存在不以 / 结尾的目录地址（会 302，百度对重定向 URL 打折）')
  }
  remoteXml = locs
} catch (e) {
  bad('sitemap.xml 请求失败：' + e.message)
}

// 3. sitemap.txt（百度「无法读取站点地图」时的兜底格式）
console.log('[3] sitemap.txt')
let remoteTxt = null
try {
  const r = await get('/sitemap.txt')
  if (r.status !== 200) bad(`状态码 ${r.status}`)
  else ok('200')
  if (!/text\/plain/.test(r.type)) bad('Content-Type 不是 text/plain：' + r.type)
  else ok('Content-Type ' + r.type)
  remoteTxt = linesOf(r.body)
  ok(`${remoteTxt.length} 行 URL`)
} catch (e) {
  bad('sitemap.txt 请求失败：' + e.message)
}

// 4. 与本地构建产物一致
console.log('[4] 与本地 .output/public 一致性')
try {
  const local = locsOf(readFileSync(localXml, 'utf8'))
  ok(`本地 sitemap.xml ${local.length} 条`)
  if (remoteXml) {
    const miss = local.filter((u) => !remoteXml.includes(u))
    const extra = remoteXml.filter((u) => !local.includes(u))
    if (miss.length || extra.length) {
      bad(`线上与本地不一致（线上缺 ${miss.length} 条、多 ${extra.length} 条）：${[...miss, ...extra].slice(0, 5).join(' ')}`)
    } else ok('线上 URL 集合与本地一致')
  }
  const localTxt = linesOf(readFileSync(localTxtPath, 'utf8'))
  if (remoteTxt && (localTxt.length !== remoteTxt.length || localTxt.some((u, i) => u !== remoteTxt[i]))) {
    bad('线上 sitemap.txt 与本地不一致')
  } else if (remoteTxt) ok('线上 sitemap.txt 与本地一致')
} catch (e) {
  bad('读取本地产物失败（先跑 npm run generate）：' + e.message)
}

console.log('')
if (fails.length) {
  console.log(`结论：${fails.length} 项不通过`)
  process.exit(1)
}
console.log('结论：全部通过')
