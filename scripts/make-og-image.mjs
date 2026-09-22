#!/usr/bin/env node
/**
 * 生成 1200×630 的分享卡（og:image / twitter:image）。
 * 用本机 Chrome 无头渲染一段静态 HTML，再把截图写进 devkit/public/og-cover.png。
 * 卡片不放工具数量等会随迭代变化的数字，避免图与站点数据不同步。
 *
 * 用法：node scripts/make-og-image.mjs
 * 覆盖浏览器路径：CHROME_BIN=/path/to/chrome node scripts/make-og-image.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'devkit', 'public', 'og-cover.png')
const CHROME =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CHIPS = ['JSON / YAML', '编码转换', '摘要与加密', '国密 SM2 / SM3 / SM4', '时间与 Cron', 'Java 工程', '前端与 CSS', '文件处理']

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #12161f;
    background:
      radial-gradient(900px 520px at 88% -10%, #eff4ff 0%, rgba(239, 244, 255, 0) 62%),
      linear-gradient(180deg, #ffffff 0%, #f4f5f7 100%);
  }
  .card { position: relative; width: 1200px; height: 630px; padding: 74px 80px; display: flex; flex-direction: column; }
  .grid { position: absolute; inset: 0; opacity: 0.5;
    background-image: linear-gradient(#e4e7ec 1px, transparent 1px), linear-gradient(90deg, #e4e7ec 1px, transparent 1px);
    background-size: 60px 60px; -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 45%, transparent 100%); }
  .brand { display: flex; align-items: center; gap: 14px; position: relative; }
  .logo { width: 54px; height: 54px; border-radius: 14px; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 12px 26px -14px rgba(37, 99, 235, 0.85); }
  .brand-name { font-size: 27px; font-weight: 700; letter-spacing: 0.4px; }
  .brand-tag { margin-left: 6px; padding: 5px 12px; border-radius: 999px; background: #eaf7f1; color: #0e9f6e; font-size: 15px; font-weight: 600; }
  h1 { position: relative; margin-top: 44px; font-size: 62px; line-height: 1.16; letter-spacing: -0.5px; }
  .sub { position: relative; margin-top: 16px; font-size: 23px; color: #5a6472; line-height: 1.5; }
  .flow { position: relative; margin-top: 26px; display: inline-flex; align-items: center; gap: 12px; align-self: flex-start; padding: 11px 18px; border: 1px solid #bfd4fe; border-radius: 12px; background: #eff4ff; color: #1d4fd7; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19px; }
  .chips { position: relative; margin-top: 26px; display: flex; flex-wrap: wrap; gap: 9px; }
  .chip { padding: 7px 14px; border: 1px solid #e4e7ec; border-radius: 999px; background: #fff; color: #5a6472; font-size: 16px; }
  .foot { position: relative; margin-top: auto; display: flex; align-items: center; gap: 10px; font-size: 17px; color: #5a6472; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: #d3d8e0; }
</style>
</head>
<body>
  <div class="card">
    <div class="grid"></div>
    <div class="brand">
      <span class="logo">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8.2 7.6V6c0-1.1.9-2 2-2h3.6c1.1 0 2 .9 2 2v1.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M6 7.6h12a3.4 3.4 0 0 1 3.4 3.4v5.6a3.4 3.4 0 0 1-3.4 3.4H6a3.4 3.4 0 0 1-3.4-3.4V11A3.4 3.4 0 0 1 6 7.6Z M2.6 11.8h18.8v1.8H2.6Z M11.1 13.6h1.8v6.4h-1.8Z" fill="currentColor" fill-rule="evenodd" />
        </svg>
      </span>
      <span class="brand-name">DevKit</span>
      <span class="brand-tag">本地处理 · 输入不上传</span>
    </div>
    <h1>本地离线<br />开发者工具箱</h1>
    <p class="sub">JSON、编码、摘要加密、国密、时间、Java、前端与文件处理，全部在浏览器里完成。</p>
    <div class="flow">Base64 解码 → JSON 格式化 → JSONPath 提取</div>
    <div class="chips">
      ${CHIPS.map((c) => `<span class="chip">${c}</span>`).join('\n      ')}
    </div>
    <div class="foot">
      <span>免账号 · 免登录</span><span class="dot"></span>
      <span>可安装为 PWA 并离线使用</span><span class="dot"></span>
      <span>www.t502.fun</span>
    </div>
  </div>
</body>
</html>
`

function pngSize(file) {
  const buf = readFileSync(file)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const dir = mkdtempSync(join(tmpdir(), 'devkit-og-'))
const page = join(dir, 'og-cover.html')
const profile = join(dir, 'profile')
writeFileSync(page, html)

const args = [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  `--user-data-dir=${profile}`,
  `--crash-dumps-dir=${join(dir, 'crash')}`,
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--no-first-run',
  '--no-default-browser-check',
  '--virtual-time-budget=3000',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  `--screenshot=${OUT}`,
  `file://${page}`
]

/** 无头 Chrome 截图后偶有不自行退出，用超时回收；只要图真的写出来就算成功 */
const started = Date.now()
const run = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 45000 })
rmSync(dir, { recursive: true, force: true })

const wrote = existsSync(OUT) && statSync(OUT).mtimeMs >= started
if (!wrote) {
  if (run.error) console.error('✗ 无法启动浏览器：' + run.error.message)
  else console.error('✗ 渲染失败（退出码 ' + run.status + '）')
  console.error((run.stderr || '').slice(-500))
  console.error('  可用 CHROME_BIN 指定 Chrome / Chromium 路径')
  process.exit(1)
}

const size = pngSize(OUT)
const kb = (statSync(OUT).size / 1024).toFixed(1)
if (size.width !== 1200 || size.height !== 630) {
  console.error(`✗ 尺寸不对：${size.width}×${size.height}，期望 1200×630`)
  process.exit(1)
}
console.log(`✓ 已生成 ${OUT}（${size.width}×${size.height}, ${kb} KB）`)
if (run.signal || run.error) console.log('  提示：Chrome 产出文件后未自行退出，已按超时结束进程。')
