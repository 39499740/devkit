#!/usr/bin/env node
/**
 * IndexNow 主动提交（Bing / Yandex / Seznam / Naver 共用一套协议，不需要任何账号）
 *
 * 用法：
 *   node scripts/indexnow-push.mjs                  # 推送 https://www.t502.fun/sitemap.xml 里的全部 URL
 *   node scripts/indexnow-push.mjs --dry-run        # 只打印将提交什么，不发请求
 *   node scripts/indexnow-push.mjs https://其他站点/sitemap.xml
 *   INDEXNOW_KEY=xxx node scripts/indexnow-push.mjs # 临时指定 key（默认自动发现）
 *   INDEXNOW_ENDPOINT=https://www.bing.com/indexnow node scripts/indexnow-push.mjs  # 只打 Bing，排障用
 *
 * 前置：key 文件必须已上线。仓库里 `devkit/public/<key>.txt` 的**文件名就是 key、内容也是 key**，
 * 脚本会先去 `https://<host>/<key>.txt` 校验它能访问且内容一致——校验不过直接退出，
 * 因为密钥校验失败时 IndexNow 只会回 403/422，提交等于白跑。
 *
 * 注意：协议要求同一 URL 每天不要重复提交。发版后跑一次即可，不要放进高频定时任务。
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const source = args.find((a) => !a.startsWith('--')) || 'https://www.t502.fun/sitemap.xml'
const endpoint = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow'
const KEY_RE = /^[a-zA-Z0-9-]{8,128}$/
const BATCH = 10000 // 协议单次上限

const explain = (code) =>
  ({
    200: '全部接受',
    202: '已接受，key 校验待完成',
    400: '请求格式错误',
    403: 'key 校验失败（key 文件不可访问或内容不符）',
    422: 'URL 不属于该 host，或 key 与 keyLocation 不匹配',
    429: '提交过于频繁'
  })[code] || '未知状态'

async function discoverKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY
  const dir = join(root, 'devkit/public')
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.txt')) continue
    const bare = name.slice(0, -4)
    if (!KEY_RE.test(bare)) continue
    const body = (await readFile(join(dir, name), 'utf8')).trim()
    if (body === bare) return bare // 文件名即 key，内容也是 key
  }
  return null
}

const key = await discoverKey()
if (!key) {
  console.error('未找到 IndexNow key：应在 devkit/public/ 下放一个 <key>.txt，文件名与内容同为 key')
  process.exit(1)
}

const xml = source.startsWith('http')
  ? await (await fetch(source)).text()
  : await readFile(source, 'utf8')
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
if (!urls.length) {
  console.error('没有从 sitemap 解析到 URL：' + source)
  process.exit(1)
}

const { origin, host } = new URL(urls[0])
const foreign = urls.filter((u) => new URL(u).host !== host)
if (foreign.length) {
  console.error(`sitemap 里混有其他 host 的 URL（IndexNow 要求同一 host）：${foreign.slice(0, 3).join(' ')}`)
  process.exit(1)
}

const keyLocation = `${origin}/${key}.txt`
const check = await fetch(keyLocation, { redirect: 'follow' })
const checkBody = check.ok ? (await check.text()).trim() : ''
if (!check.ok || checkBody !== key) {
  console.error(`key 文件校验失败：${keyLocation} → HTTP ${check.status}${checkBody ? '，内容与 key 不一致' : ''}`)
  console.error('先部署（devkit/public/' + key + '.txt 会随 deploy-cos.sh 同步）再重跑本脚本。')
  process.exit(1)
}
console.log(`key 校验通过：${keyLocation}`)
console.log(`URL 来源：${source}（${urls.length} 条，host=${host}）`)

if (dryRun) {
  console.log('[dry-run] 未发送请求。提交体预览：')
  console.log(JSON.stringify({ host, key, keyLocation, urlList: urls.slice(0, 3) }, null, 2))
  process.exit(0)
}

let failed = false
for (let i = 0; i < urls.length; i += BATCH) {
  const urlList = urls.slice(i, i + BATCH)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList })
  })
  const text = (await res.text()).slice(0, 300)
  console.log(`${endpoint} → HTTP ${res.status} ${explain(res.status)}（${urlList.length} 条）${text ? ' | ' + text : ''}`)
  if (res.status !== 200 && res.status !== 202) failed = true
}

console.log(failed ? '\n结论：存在失败批次' : '\n结论：提交成功（各参与引擎会异步抓取，收录以引擎侧为准）')
process.exit(failed ? 1 : 0)
