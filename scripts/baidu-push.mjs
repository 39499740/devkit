#!/usr/bin/env node
/**
 * 百度「普通收录」API 推送：把 sitemap 里的 URL 主动推给百度，加快收录。
 *
 * 用法：
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs                      # 推全部待推 URL
 *   BAIDU_PUSH_TOKEN=xxxx BAIDU_PUSH_LIMIT=10 node scripts/baidu-push.mjs   # 新站配额 10 条/天 → 每天推一批
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs --dry-run             # 只打印将推什么，不发请求
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs --reset               # 清空游标后重推
 *   BAIDU_PUSH_TOKEN=xxxx node scripts/baidu-push.mjs https://其他站点/sitemap.xml
 *
 * 说明：
 *   token 在百度搜索资源平台 → 普通收录 → API 提交 里获取（每个站点一个，切勿泄露；本脚本只从环境变量读）。
 *   百度推送接口只有 HTTP（http://data.zz.baidu.com/urls）——它的证书不含 data.zz.baidu.com，走 https 会证书校验失败。
 *   新站配额很小（常见 10 条/天，且与「手动提交」共享），所以脚本用游标文件记录已推 URL：
 *   每天跑一次自动推下一批，不会把配额浪费在重复推同一批上（`--reset` / `BAIDU_PUSH_FORCE=1` 可强制重推）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argValue = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dryRun = args.includes('--dry-run')
const reset = args.includes('--reset')
const mark = Number(argValue('--mark') || 0)
const source =
  args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--mark') ||
  join(root, 'devkit/.output/public/sitemap.xml')

const site = process.env.BAIDU_PUSH_SITE || 'https://www.t502.fun'
const token = process.env.BAIDU_PUSH_TOKEN

const STATE = process.env.BAIDU_PUSH_STATE || join(root, '.tools/baidu-pushed.json')
const limit = Number(process.env.BAIDU_PUSH_LIMIT || 0)

// 首页与主力工具页优先；游标只管「推没推过」，顺序仍按这张表
const PRIORITY = [
  'https://www.t502.fun/',
  'https://www.t502.fun/tools/json-format/',
  'https://www.t502.fun/tools/base64/',
  'https://www.t502.fun/tools/timestamp/',
  'https://www.t502.fun/tools/md5/',
  'https://www.t502.fun/tools/aes/'
]
const rank = (u) => {
  const i = PRIORITY.indexOf(u)
  return i === -1 ? 99 : i + 1
}

const xml = source.startsWith('http') ? await (await fetch(source)).text() : await readFile(source, 'utf8')
const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
if (!all.length) {
  console.error('sitemap 里没有找到 URL：' + source)
  process.exit(1)
}

let pushed = {}
try {
  pushed = JSON.parse(await readFile(STATE, 'utf8'))
} catch {
  pushed = {}
}
if (reset) {
  pushed = {}
  console.log('已清空推送游标（--reset）')
}
if (process.env.BAIDU_PUSH_FORCE === '1') {
  pushed = {}
  console.log('BAIDU_PUSH_FORCE=1：忽略游标，重推全部')
}

const pending = all.filter((u) => !pushed[u]).sort((a, b) => rank(a) - rank(b))
const batch = limit > 0 ? pending.slice(0, limit) : pending

console.log(`站点 ${site}｜sitemap ${all.length} 条｜已推 ${all.length - pending.length} 条｜待推 ${pending.length} 条`)
if (!batch.length) {
  console.log('没有待推 URL：全部推过了。要重推用 --reset 或 BAIDU_PUSH_FORCE=1')
  process.exit(0)
}

// 手工提交（资源平台「手动提交」）时用它记账：--mark N 把「接下来会推的 N 条」直接标为已提交，
// 使它和 API 推送共用同一份游标，避免之后 API 推送重复消耗配额。
if (mark > 0) {
  const markBatch = pending.slice(0, mark)
  const today = new Date().toISOString().slice(0, 10)
  for (const u of markBatch) pushed[u] = today
  await mkdir(dirname(STATE), { recursive: true })
  await writeFile(STATE, JSON.stringify(pushed, null, 2) + '\n')
  console.log(`已标记 ${markBatch.length} 条为已提交（${today}）：`)
  markBatch.forEach((u, i) => console.log(`  ${i + 1}. ${u}`))
  const leftAfterMark = all.filter((u) => !pushed[u]).length
  console.log(`累计 ${all.length - leftAfterMark}/${all.length} 条｜剩余 ${leftAfterMark} 条`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[dry-run] 本次将推送 ${batch.length} 条：`)
  batch.forEach((u, i) => console.log(`  ${i + 1}. ${u}`))
  process.exit(0)
}

if (!token) {
  console.error('缺少 BAIDU_PUSH_TOKEN（百度搜索资源平台 → 普通收录 → API 提交 里获取）')
  process.exit(1)
}

const body = batch.join('\n')
// 注意：site/token 不能 URL 编码，百度只认控制台给出的原文（site=https://www.t502.fun）
const res = await fetch(`http://data.zz.baidu.com/urls?site=${site}&token=${token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body
})
const text = await res.text()
console.log(`推送 ${batch.length} 条 URL → ${site}`)
console.log(res.status + ' ' + text)

let json = null
try {
  json = JSON.parse(text)
} catch {
  json = null
}
if (res.status !== 200 || (json && json.error)) {
  console.error('推送未成功，游标未更新（配额会在次日重置，稍后重跑即可）')
  process.exit(1)
}

// 只有整体成功才记账；百度只回总成功数，无法逐条区分，故按整批记录
const today = new Date().toISOString().slice(0, 10)
for (const u of batch) pushed[u] = today
await mkdir(dirname(STATE), { recursive: true })
await writeFile(STATE, JSON.stringify(pushed, null, 2) + '\n')

const left = all.filter((u) => !pushed[u]).length
console.log(`已记录游标：${STATE}`)
console.log(`累计 ${all.length - left}/${all.length} 条｜剩余 ${left} 条${left ? '（配额次日重置，明天再跑一次继续推）' : '（全部推完）'}`)
