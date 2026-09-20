#!/usr/bin/env node
/**
 * 刷新腾讯云 CDN 缓存（发版后必须执行）。
 * 用法：
 *   node scripts/cdn-purge.mjs https://www.t502.fun/ https://www.t502.fun/_nuxt/
 *   FLUSH_TYPE=flush node scripts/cdn-purge.mjs https://www.t502.fun/
 * 默认刷新 https://www.t502.fun/ 与 https://www.t502.fun/_nuxt/（delete 模式，适合旧文件已删除）。
 * 密钥取自 .tools/cos.yaml（与 coscli 同一份，实测该密钥具备 CDN 刷新权限）。
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const conf = readFileSync(process.env.COS_CONFIG || join(root, '.tools/cos.yaml'), 'utf8')
const secretId = (conf.match(/secretid:\s*"?([^"\s]+)"?/) || [])[1]
const secretKey = (conf.match(/secretkey:\s*"?([^"\s]+)"?/) || [])[1]
if (!secretId || !secretKey) {
  console.error('未在 .tools/cos.yaml 找到 secretid / secretkey')
  process.exit(1)
}

const paths = process.argv.slice(2)
if (!paths.length) paths.push('https://www.t502.fun/', 'https://www.t502.fun/_nuxt/')
for (const p of paths) {
  if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) {
    console.error('目录路径必须以 / 结尾：' + p)
    process.exit(1)
  }
}

const host = 'cdn.tencentcloudapi.com'
const service = 'cdn'
const payload = JSON.stringify({ Paths: paths, FlushType: process.env.FLUSH_TYPE || 'delete' })
const ts = Math.floor(Date.now() / 1000)
const date = new Date(ts * 1000).toISOString().slice(0, 10)
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (key, s) => createHmac('sha256', key).update(s).digest()
const contentType = 'application/json; charset=utf-8'
const canonicalRequest = ['POST', '/', '', 'content-type:' + contentType, 'host:' + host, '', 'content-type;host', sha256(payload)].join('\n')
const scope = date + '/' + service + '/tc3_request'
const stringToSign = ['TC3-HMAC-SHA256', String(ts), scope, sha256(canonicalRequest)].join('\n')
const signature = createHmac('sha256', hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request'))
  .update(stringToSign)
  .digest('hex')
const authorization = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + scope + ', SignedHeaders=content-type;host, Signature=' + signature

const req = request(
  {
    host,
    method: 'POST',
    path: '/',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': 'PurgePathCache',
      'X-TC-Timestamp': String(ts),
      'X-TC-Version': '2018-06-06',
      'X-TC-Region': 'ap-beijing'
    }
  },
  (res) => {
    let body = ''
    res.on('data', (d) => (body += d))
    res.on('end', () => {
      console.log('提交刷新：' + paths.join(', '))
      console.log(res.statusCode + ' ' + body)
      if (res.statusCode !== 200 || body.includes('"Error"')) process.exitCode = 1
    })
  }
)
req.on('error', (e) => {
  console.error('请求失败：' + e.message)
  process.exitCode = 1
})
req.setTimeout(20000, () => {
  console.error('请求超时')
  req.destroy()
})
req.end(payload)
