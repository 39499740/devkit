/**
 * DOM 相关用例（XML 工具箱）在真实浏览器里执行：
 * tests/*.browser.mjs 用 esbuild 打成 IIFE，注入 about:blank 页面求值，结果回传 Node 汇总。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', 'app')
const outDir = join(here, '.tmp')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const files = readdirSync(here).filter((f) => f.endsWith('.browser.mjs')).sort()
if (!files.length) {
  console.log('没有 DOM 用例')
  process.exit(0)
}

const bundles = []
for (const file of files) {
  const result = await build({
    entryPoints: [join(here, file)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    resolveExtensions: ['.ts', '.mjs', '.js'],
    alias: { '~': appDir }
  })
  bundles.push({ file, code: result.outputFiles[0].text })
}

const payload = JSON.stringify(bundles)
const script = [
  'const task = await taskSpace("devkit dom tests");',
  'const page = task.page("p1");',
  'await page.goto("about:blank");',
  'const raw = await page.evaluate(async (json) => {',
  '  const list = JSON.parse(json);',
  '  const out = [];',
  '  for (const item of list) {',
  '    try {',
  '      const url = URL.createObjectURL(new Blob([item.code], { type: "text/javascript" }));',
  '      const mod = await import(url);',
  '      URL.revokeObjectURL(url);',
  '      out.push({ file: item.file, cases: mod.cases, error: null });',
  '    } catch (e) {',
  '      out.push({ file: item.file, cases: [], error: String(e && e.message ? e.message : e) });',
  '    }',
  '  }',
  '  return JSON.stringify(out);',
  '}, ' + JSON.stringify(payload) + ');',
  'console.log(raw);',
  'await task.finish({ keep: [] });'
].join('\n')

// ego-browser 的 nodejs 子命令把脚本输出写到 stderr，这里两个流都收
const proc = spawnSync('ego-browser', ['nodejs'], { input: script, encoding: 'utf8', timeout: 180000 })
if (proc.error) {
  console.error('✗ 浏览器用例执行失败：' + proc.error.message)
  process.exit(1)
}
const raw = `${proc.stdout || ''}\n${proc.stderr || ''}`

const line = raw
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('[') && l.endsWith(']'))
  .pop()
if (!line) {
  console.error('✗ 没有拿到浏览器返回的用例结果')
  console.error(raw.slice(-800))
  process.exit(1)
}

let passed = 0
const failures = []
for (const group of JSON.parse(line)) {
  if (group.error) failures.push({ file: group.file, name: '模块执行', detail: group.error })
  for (const c of group.cases || []) {
    if (c.ok) passed += 1
    else failures.push({ file: group.file, name: c.name, detail: c.detail })
  }
  console.log(group.file + ': ' + (group.cases || []).filter((c) => c.ok).length + '/' + (group.cases || []).length + ' 通过')
}

console.log('')
if (failures.length) {
  console.error('✗ ' + failures.length + ' 个用例失败，' + passed + ' 个通过')
  for (const f of failures) console.error('  [' + f.file + '] ' + f.name + '\n    ' + f.detail)
  process.exit(1)
}
console.log('✓ 浏览器用例全部通过：' + passed + ' 个')
