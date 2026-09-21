/**
 * 极简测试运行器：用 esbuild 把 tests/*.test.mjs 打成 ESM 后逐个执行。
 * 没有引入测试框架依赖（离线环境也能跑），断言失败的用例会打印期望/实际值。
 */
import { build } from 'esbuild'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', 'app')
const outDir = join(here, '.tmp')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()
let passed = 0
const failures = []

for (const file of files) {
  const outfile = join(outDir, file.replace(/\.mjs$/, '.bundle.mjs'))
  await build({
    entryPoints: [join(here, file)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    resolveExtensions: ['.ts', '.mjs', '.js'],
    alias: { '~': appDir }
  })
  const mod = await import(pathToFileURL(outfile).href + '?t=' + Date.now())
  const cases = mod.cases ?? (mod.run ? await mod.run() : [])
  for (const c of cases) {
    if (c.ok) {
      passed += 1
    } else {
      failures.push({ file, name: c.name, detail: c.detail })
    }
  }
  console.log(`${file}: ${cases.filter((c) => c.ok).length}/${cases.length} 通过`)
}

console.log('')
if (failures.length) {
  console.error(`✗ ${failures.length} 个用例失败，${passed} 个通过`)
  for (const f of failures) console.error(`  [${f.file}] ${f.name}\n    ${f.detail}`)
  process.exit(1)
}
console.log(`✓ 全部通过：${passed} 个用例`)
