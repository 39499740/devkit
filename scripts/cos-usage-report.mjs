#!/usr/bin/env node
/**
 * DevKit · COS + CDN 用量体检：有多少流量绕过了 CDN、直接打在源站桶上。
 *
 * 背景：站点是 CDN（www.t502.fun）回源到 COS 桶（devkit-1252844153）。
 * 正常访问走 CDN，只计 CDN 流量；一旦有人直接访问 COS 默认域名
 * （`<bucket>.cos.<region>.myqcloud.com`），那部分流量走 COS 的「外网下行流量」计费项，
 * 单价明显高于 CDN，且完全不受 CDN 缓存与防盗链保护。
 *
 * 判据（本脚本的核心输出）：
 *   COS 收到的请求数 ≫ CDN 回源请求数  ⇒  多出来的那部分就是绕过 CDN 的直连请求；
 *   COS「外网下行流量」就是这些直连下载的字节数（腾讯云口径：外网下行 = 直接通过 COS
 *   域名访问资源产生的流量，与 CDN 回源流量是两个独立计费项）。
 *
 * 用法：
 *   node scripts/cos-usage-report.mjs                    # 最近 7 天日报 + 阈值告警
 *   node scripts/cos-usage-report.mjs --days 14          # 看更长的窗口
 *   node scripts/cos-usage-report.mjs --hourly           # 追加今天的逐小时曲线（定位抓取时段）
 *   node scripts/cos-usage-report.mjs --json             # 只输出 JSON，便于接到别的告警里
 *   node scripts/cos-usage-report.mjs --max-direct-mb 30 # 自定义「直连流量」告警阈值
 *
 * 退出码：0 = 正常；1 = 触发告警（最新一天直连流量或直连请求占比超阈值）。
 * 报告同时落盘到 .tools/logs/cos-usage-<日期>.md（.tools/ 已被 .gitignore 忽略）。
 *
 * 凭证/配置：
 *   - 密钥优先取环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY，
 *     否则读 COS_CONFIG（默认 .tools/cos.yaml，与 coscli / cdn-purge.mjs 同一份）。
 *   - 桶与地域默认取配置文件里的 name / region，可用 COS_BUCKET / COS_REGION 覆盖。
 *   - CDN 域名与项目：CDN_DOMAIN（默认 www.t502.fun）、CDN_PROJECT_ID（默认 0）。
 *   - 估算单价（元/GB）：PRICE_EGRESS（默认 0.5，COS 外网下行）、PRICE_ORIGIN（默认 0.15，CDN 回源）。
 *
 * 实现要点（腾讯云监控 API 的坑，别再踩）：
 *   - `monitor.tencentcloudapi.com`，Version=2018-07-24，TC3-HMAC-SHA256 签名；
 *   - **必须带 X-TC-Region**，否则报 MissingParameter Region；
 *   - QCE/COS 维度是 `bucket`，地域用桶所在地域；QCE/CDN 维度是 `domain` + `projectId`，
 *     地域固定用 `ap-guangzhou`（缺任一维度报 Param dimensions error）。
 */
import { createHash, createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MONITOR_HOST = 'monitor.tencentcloudapi.com'
const MONITOR_SERVICE = 'monitor'
const MONITOR_VERSION = '2018-07-24'
const CDN_REGION = 'ap-guangzhou'
const MIB = 1024 * 1024

// ---------------------------------------------------------------- 参数与配置

function parseArgs(argv) {
  const opts = {
    days: 7,
    hourly: false,
    json: false,
    writeFile: true,
    maxDirectMb: Number(process.env.MAX_DIRECT_MB || 100),
    maxDirectRatio: Number(process.env.MAX_DIRECT_RATIO || 0.2)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--days') opts.days = Math.max(1, Math.min(30, Number(next())))
    else if (a === '--hourly') opts.hourly = true
    else if (a === '--json') opts.json = true
    else if (a === '--no-file') opts.writeFile = false
    else if (a === '--max-direct-mb') opts.maxDirectMb = Number(next())
    else if (a === '--max-direct-ratio') opts.maxDirectRatio = Number(next())
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''))
      process.exit(0)
    } else {
      console.error('未知参数：' + a + '（--help 看用法）')
      process.exit(2)
    }
  }
  return opts
}

function loadConfig() {
  const path = process.env.COS_CONFIG || join(root, '.tools/cos.yaml')
  let conf = ''
  try {
    conf = readFileSync(path, 'utf8')
  } catch {
    console.error('读不到配置文件：' + path + '（可用 COS_CONFIG 指定，或改用环境变量提供密钥）')
  }
  const pick = (key) => (conf.match(new RegExp(key + ':\\s*"?([^"\\s]+)"?')) || [])[1]
  const secretId = process.env.TENCENTCLOUD_SECRET_ID || pick('secretid')
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY || pick('secretkey')
  const bucket = process.env.COS_BUCKET || pick('name')
  const region = process.env.COS_REGION || pick('region')
  if (!secretId || !secretKey) {
    console.error('缺少密钥：设置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY，或在 ' + path + ' 里提供 secretid / secretkey')
    process.exit(2)
  }
  if (!bucket || !region) {
    console.error('缺少桶信息：设置 COS_BUCKET / COS_REGION，或在 ' + path + ' 里提供 name / region')
    process.exit(2)
  }
  return {
    secretId,
    secretKey,
    bucket,
    region,
    cdnDomain: process.env.CDN_DOMAIN || 'www.t502.fun',
    cdnProjectId: process.env.CDN_PROJECT_ID || '0',
    priceEgress: Number(process.env.PRICE_EGRESS || 0.5),
    priceOrigin: Number(process.env.PRICE_ORIGIN || 0.15)
  }
}

// ---------------------------------------------------------------- TC3 签名与调用

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (key, s) => createHmac('sha256', key).update(s).digest()

async function callMonitor(cfg, action, payload, region) {
  const body = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const date = new Date(ts * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:' + contentType,
    'host:' + MONITOR_HOST,
    '',
    'content-type;host',
    sha256(body)
  ].join('\n')
  const scope = date + '/' + MONITOR_SERVICE + '/tc3_request'
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac('TC3' + cfg.secretKey, date), MONITOR_SERVICE), 'tc3_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const res = await fetch('https://' + MONITOR_HOST + '/', {
    method: 'POST',
    headers: {
      Authorization:
        'TC3-HMAC-SHA256 Credential=' + cfg.secretId + '/' + scope + ', SignedHeaders=content-type;host, Signature=' + signature,
      'Content-Type': contentType,
      Host: MONITOR_HOST,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(ts),
      'X-TC-Version': MONITOR_VERSION,
      'X-TC-Region': region
    },
    body
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(action + ' 返回非 JSON：' + text.slice(0, 200))
  }
  if (!res.ok || json.Response?.Error) {
    const err = json.Response?.Error
    throw new Error(action + ' 失败：' + (err ? err.Code + ' ' + err.Message : res.status + ' ' + text.slice(0, 200)))
  }
  return json.Response
}

/** 取一条监控指标的时间序列；失败只警告并返回空数组，不让整份报告挂掉 */
async function series(cfg, { namespace, metric, period, start, end, dimensions, region, warnings }) {
  try {
    const resp = await callMonitor(
      cfg,
      'GetMonitorData',
      {
        Namespace: namespace,
        MetricName: metric,
        Period: period,
        StartTime: start,
        EndTime: end,
        Instances: [{ Dimensions: dimensions }]
      },
      region
    )
    const dp = resp.DataPoints?.[0] || {}
    const timestamps = dp.Timestamps || []
    const values = dp.Values || []
    return timestamps.map((t, i) => ({ ts: Number(t), value: Number(values[i]) }))
  } catch (e) {
    warnings.push(namespace + '/' + metric + '：' + e.message)
    return []
  }
}

// ---------------------------------------------------------------- 时间（北京时间）

const BJ_OFFSET_MS = 8 * 3600 * 1000
const bjDate = (d) => new Date(d.getTime() + BJ_OFFSET_MS).toISOString().slice(0, 10)
const bjTime = (d) => new Date(d.getTime() + BJ_OFFSET_MS).toISOString().slice(11, 16)
function bjDayRange(daysBack) {
  const now = new Date()
  const today = new Date(bjDate(now) + 'T00:00:00Z')
  const first = new Date(today.getTime() - daysBack * 86400000)
  const last = new Date(today.getTime() - 1 * 86400000)
  return {
    start: bjDate(first) + ' 00:00:00',
    end: bjDate(last) + ' 23:59:59',
    todayStart: bjDate(today) + ' 00:00:00',
    todayEnd: bjDate(new Date(today.getTime() + 86400000 - 1000)) + ' 23:59:55'
  }
}

// ---------------------------------------------------------------- 主流程

const opts = parseArgs(process.argv.slice(2))
const cfg = loadConfig()
const warnings = []
const range = bjDayRange(opts.days)

const cosDims = [{ Name: 'bucket', Value: cfg.bucket }]
const cdnDims = [
  { Name: 'domain', Value: cfg.cdnDomain },
  { Name: 'projectId', Value: cfg.cdnProjectId }
]

const cosMetrics = {
  egress: 'InternetTraffic', // 外网下行流量（直连 COS 域名下载）—— 计费项，与 CDN 回源无关
  origin: 'CdnOriginTraffic', // CDN 回源流量
  requests: '2xxResponse' // 桶收到的成功请求数
}
const cdnMetrics = {
  egress: 'Flux', // CDN 到客户端的流量
  originFlux: 'BackOriginFlux', // CDN 回源流量（CDN 侧视角）
  requests: 'Requests', // CDN 边缘请求数
  originRequests: 'BackOriginRequests', // CDN 回源请求数
  hitRate: 'FluxHitRate' // 流量命中率
}

const [cosEgress, cosOrigin, cosRequests, cdnEgress, cdnOriginFlux, cdnRequests, cdnOriginRequests, cdnHitRate] =
  await Promise.all([
    series(cfg, { namespace: 'QCE/COS', metric: cosMetrics.egress, period: 86400, start: range.start, end: range.end, dimensions: cosDims, region: cfg.region, warnings }),
    series(cfg, { namespace: 'QCE/COS', metric: cosMetrics.origin, period: 86400, start: range.start, end: range.end, dimensions: cosDims, region: cfg.region, warnings }),
    series(cfg, { namespace: 'QCE/COS', metric: cosMetrics.requests, period: 86400, start: range.start, end: range.end, dimensions: cosDims, region: cfg.region, warnings }),
    series(cfg, { namespace: 'QCE/CDN', metric: cdnMetrics.egress, period: 86400, start: range.start, end: range.end, dimensions: cdnDims, region: CDN_REGION, warnings }),
    series(cfg, { namespace: 'QCE/CDN', metric: cdnMetrics.originFlux, period: 86400, start: range.start, end: range.end, dimensions: cdnDims, region: CDN_REGION, warnings }),
    series(cfg, { namespace: 'QCE/CDN', metric: cdnMetrics.requests, period: 86400, start: range.start, end: range.end, dimensions: cdnDims, region: CDN_REGION, warnings }),
    series(cfg, { namespace: 'QCE/CDN', metric: cdnMetrics.originRequests, period: 86400, start: range.start, end: range.end, dimensions: cdnDims, region: CDN_REGION, warnings }),
    series(cfg, { namespace: 'QCE/CDN', metric: cdnMetrics.hitRate, period: 86400, start: range.start, end: range.end, dimensions: cdnDims, region: CDN_REGION, warnings })
  ])

const byDay = (rows) => new Map(rows.map((r) => [bjDate(new Date(r.ts * 1000)), r.value]))
const day = {
  cosEgress: byDay(cosEgress),
  cosOrigin: byDay(cosOrigin),
  cosRequests: byDay(cosRequests),
  cdnEgress: byDay(cdnEgress),
  cdnOriginFlux: byDay(cdnOriginFlux),
  cdnRequests: byDay(cdnRequests),
  cdnOriginRequests: byDay(cdnOriginRequests),
  cdnHitRate: byDay(cdnHitRate)
}

const dates = [...new Set([...day.cosEgress.keys(), ...day.cdnEgress.keys()])].sort()
const report = dates.map((date) => {
  const cosEgressMb = (day.cosEgress.get(date) || 0) / MIB
  const cosOriginMb = (day.cosOrigin.get(date) || 0) / MIB
  const cosReq = day.cosRequests.get(date) || 0
  const cdnEgressMb = day.cdnEgress.get(date) || 0
  const cdnOriginReq = day.cdnOriginRequests.get(date) || 0
  const directReq = Math.max(0, cosReq - cdnOriginReq)
  const cosReqBase = cosReq || 1
  return {
    date,
    cosEgressMb,
    cosOriginMb,
    cosReq,
    cdnEgressMb,
    cdnOriginFluxMb: day.cdnOriginFlux.get(date) || 0,
    cdnRequests: day.cdnRequests.get(date) || 0,
    cdnOriginRequests: cdnOriginReq,
    cdnHitRate: day.cdnHitRate.get(date) || 0,
    directReq,
    directRatio: directReq / cosReqBase,
    costYuan: (cosEgressMb / 1024) * cfg.priceEgress + (cosOriginMb / 1024) * cfg.priceOrigin
  }
})

// 今天的逐小时曲线：用来把直连峰值和抓取时间对上
let hourly = []
if (opts.hourly) {
  const rows = await series(cfg, {
    namespace: 'QCE/COS',
    metric: cosMetrics.egress,
    period: 3600,
    start: range.todayStart,
    end: range.todayEnd,
    dimensions: cosDims,
    region: cfg.region,
    warnings
  })
  hourly = rows.map((r) => ({ time: bjTime(new Date(r.ts * 1000)), mb: r.value / MIB })).filter((r) => r.mb > 0)
}

// ---------------------------------------------------------------- 输出

const mb = (n) => n.toFixed(2)
const pct = (n) => (n * 100).toFixed(1) + '%'
const last = report[report.length - 1]
const alerts = []
if (last) {
  if (last.cosEgressMb > opts.maxDirectMb) {
    alerts.push(`直连源站流量 ${mb(last.cosEgressMb)} MB > 阈值 ${opts.maxDirectMb} MB（${last.date}）`)
  }
  if (last.directRatio > opts.maxDirectRatio) {
    alerts.push(
      `直连请求占比 ${pct(last.directRatio)} > 阈值 ${pct(opts.maxDirectRatio)}（${last.date}：COS ${last.cosReq} 次 / CDN 回源 ${last.cdnOriginRequests} 次）`
    )
  }
}

if (opts.json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), config: { bucket: cfg.bucket, region: cfg.region, cdnDomain: cfg.cdnDomain }, report, hourly, alerts, warnings }, null, 2))
} else {
  console.log(`COS/CDN 用量体检 · 桶 ${cfg.bucket} (${cfg.region}) · CDN ${cfg.cdnDomain}`)
  console.log(`窗口：最近 ${opts.days} 天（北京时间，数据按天汇总，当日数据次日才完整）\n`)
  console.log('日期        直连下载(MB)  COS请求  CDN回源请求  直连请求  直连占比  CDN下行(MB)  命中率   估算费用(元)')
  for (const r of report) {
    console.log(
      [
        r.date,
        mb(r.cosEgressMb).padStart(11),
        String(r.cosReq).padStart(8),
        String(r.cdnOriginRequests).padStart(11),
        String(r.directReq).padStart(9),
        pct(r.directRatio).padStart(8),
        mb(r.cdnEgressMb).padStart(11),
        (r.cdnHitRate.toFixed(1) + '%').padStart(7),
        r.costYuan.toFixed(3).padStart(13)
      ].join('  ')
    )
  }
  console.log('\n注：直连下载(MB) 取 COS「外网下行流量」（字节按 1 MiB 折算）；CDN 下行/命中率取 CDN 侧监控原值。')
  console.log('    直连请求 = COS 请求数 − CDN 回源请求数（估算，用于看趋势）。')
  console.log(`    估算费用按 COS 外网下行 ${cfg.priceEgress} 元/GB、CDN 回源 ${cfg.priceOrigin} 元/GB（可用 PRICE_EGRESS / PRICE_ORIGIN 覆盖），仅作量级参考。`)
  if (hourly.length) {
    console.log('\n今日逐小时直连下载(MB)：')
    for (const h of hourly) console.log(`    ${h.time}  ${mb(h.mb)}`)
  }
  if (warnings.length) {
    console.log('\n取数告警：')
    for (const w of warnings) console.log('    ! ' + w)
  }
  console.log('')
  if (alerts.length) {
    for (const a of alerts) console.log('⚠️  ' + a)
    console.log('建议：确认桶的读权限与 CDN 回源鉴权（见 docs/DEPLOY-COS.md「源站域名防直连」一节）。')
  } else {
    console.log('✅ 未触发阈值：直连源站的流量与请求占比都在预期内。')
  }
}

if (opts.writeFile) {
  const dir = join(root, '.tools/logs')
  try {
    mkdirSync(dir, { recursive: true })
    const md = [
      `# COS/CDN 用量体检 · ${bjDate(new Date())}`,
      '',
      `- 桶：\`${cfg.bucket}\`（${cfg.region}）· CDN 域名：\`${cfg.cdnDomain}\``,
      `- 窗口：最近 ${opts.days} 天 · 阈值：直连流量 ≤ ${opts.maxDirectMb} MB、直连请求占比 ≤ ${pct(opts.maxDirectRatio)}`,
      '',
      '| 日期 | 直连下载(MB) | COS请求 | CDN回源请求 | 直连请求 | 直连占比 | CDN下行(MB) | 命中率 | 估算费用(元) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...report.map(
        (r) =>
          `| ${r.date} | ${mb(r.cosEgressMb)} | ${r.cosReq} | ${r.cdnOriginRequests} | ${r.directReq} | ${pct(r.directRatio)} | ${mb(r.cdnEgressMb)} | ${r.cdnHitRate.toFixed(1)}% | ${r.costYuan.toFixed(3)} |`
      ),
      ...(hourly.length ? ['', '今日逐小时直连下载(MB)：' + hourly.map((h) => `${h.time}=${mb(h.mb)}`).join('、')] : []),
      ...(alerts.length ? ['', ...alerts.map((a) => '- ⚠️ ' + a)] : ['', '- ✅ 未触发阈值']),
      ...(warnings.length ? ['', ...warnings.map((w) => '- 取数告警：' + w)] : []),
      ''
    ].join('\n')
    const file = join(dir, `cos-usage-${bjDate(new Date())}.md`)
    writeFileSync(file, md)
    if (!opts.json) console.log('\n报告已写入 ' + file.replace(root + '/', ''))
  } catch (e) {
    console.error('写报告失败：' + e.message)
  }
}

process.exitCode = alerts.length ? 1 : 0
