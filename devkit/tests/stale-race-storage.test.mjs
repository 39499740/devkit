/**
 * 异步结果竞态（P2-3）与本地存储写入健壮性（P3-1）回归。
 *
 * 背景（盲测）：
 * - P2-3：useToolRun 的 markOk/markFail 在异步完成后用「完成时的当前签名」刷新 lastSig；
 *   若 await 期间用户改了输入/参数，watcher 置的 stale 会被覆盖，旧输入的结果被当成
 *   当前输入的成功结果。t12/t13/t14 受影响（t12 文件模式此前还无 busy 守卫）。
 *   修复：工具在 execute 开始捕获 sigAtStart 并回传，markOk/markFail 记录发起时签名；
 *   完成时若当前签名已变，仍置 stale。
 * - P3-1：useRecent.persist / useFavorites.persist 直接 localStorage.setItem，
 *   隐私模式/配额满会抛异常；应与 usePrefs 一致地 try/catch。
 *
 * 测试策略（参考 t45-format-race.test.mjs / t45-fallback.test.mjs）：
 *  1. @vue/compiler-sfc 自检 t12/t13/t14 三个 SFC（parse + compile <script setup>）；
 *  2. 源码层断言：三工具均捕获 sigAtStart 且所有 markOk/markFail 都传入；
 *     t12 onFiles 有 busy 守卫；useRecent/useFavorites persist 有 try/catch；
 *  3. 直接执行真实的 useToolRun（注入最小 ref/watch 桩），验证签名语义：
 *     await 期间签名变化 → 完成后仍为 stale（含 watcher 先/后于完成触发的两种顺序）；
 *  4. 抽取真实的 persist 函数体，用会抛异常的 localStorage 桩执行，验证不外抛。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check } from './helpers.mjs'

const projectRoot = process.cwd()

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 0. 执行真实 useToolRun：注入最小 ref / watch 桩
 *    （useToolRun.ts 的 ref/watch 由 Nuxt 自动导入，测试里用全局桩替代）
 * ──────────────────────────────────────────────────────────── */
function makeWatchers() {
  const watchers = []
  globalThis.ref = (v) => ({ value: v })
  globalThis.watch = (source, cb) => {
    watchers.push({ source, cb, last: source() })
    return () => {}
  }
  return {
    watchers,
    /** 模拟 Vue 调度器 flush：签名变化时回调（可在 await 完成前/后手动触发） */
    flush() {
      for (const w of watchers) {
        const cur = w.source()
        if (cur !== w.last) {
          w.last = cur
          w.cb(cur)
        }
      }
    }
  }
}

const { watchers, flush } = makeWatchers()
const { useToolRun } = await import('../app/composables/useToolRun.ts')

/* 真实签名语义：await 期间签名变化，且 watcher 先于完成触发（最常见顺序） */
let sigA = 'A'
watchers.length = 0
const runA = useToolRun(() => sigA)
runA.markOk('成功（输入 A）', 'A')
sigA = 'B' // 用户在 await 期间改了输入
flush() // watcher 在完成前把状态置为 stale
runA.markOk('成功（输入 A）', 'A') // 完成：传入发起时签名
cases.push(
  check('await 期间签名变化（watcher 先触发）：完成后仍为 stale', () => runA.status.value === 'stale')
)
cases.push(
  check('此时 staleNote 为「待更新」提示', () => /待更新/.test(runA.staleNote.value))
)

/* 真实签名语义：完成早于 watcher（lastSig 必须记为发起时签名，watcher 后到才会置 stale） */
let sigB = 'A'
watchers.length = 0
const runB = useToolRun(() => sigB)
runB.markOk('成功（输入 A）', 'A')
sigB = 'B'
flush()
cases.push(
  check('await 期间签名变化（完成先于 watcher）：watcher 后到仍置 stale', () => runB.status.value === 'stale')
)

/* 无竞态：签名不变，保持成功与说明 */
let sigC = 'A'
watchers.length = 0
const runC = useToolRun(() => sigC)
runC.markOk('成功说明', 'A')
cases.push(check('签名不变：状态为 ok', () => runC.status.value === 'ok'))
cases.push(check('签名不变：成功说明保留', () => runC.staleNote.value === '成功说明'))
cases.push(check('currentSignature() 暴露当前签名', () => runC.currentSignature() === 'A'))

/* 改回原签名：await 期间 A→B→A，watcher 曾置 stale，完成时签名一致则恢复 ok */
let sigD = 'A'
watchers.length = 0
const runD = useToolRun(() => sigD)
runD.markOk('首次成功', 'A') // ok
sigD = 'B'
flush() // watcher 置 stale
sigD = 'A'
flush() // 又改回 A
runD.markOk('成功', 'A') // 完成：签名与发起时一致
cases.push(check('签名改回发起时值：完成后恢复 ok（结果与当前输入一致）', () => runD.status.value === 'ok'))

/* markFail 同样按发起时签名判定：期间变化 → stale */
let sigE = 'A'
watchers.length = 0
const runE = useToolRun(() => sigE)
runE.markOk('成功', 'A')
sigE = 'B'
runE.markFail('失败（输入 A）', 'A')
cases.push(check('markFail 完成时签名已变：置为 stale 而非 error', () => runE.status.value === 'stale'))

/* 向后兼容：不传 sigAtStart 时退回旧行为（用当前签名），正常失败/成功 */
let sigF = 'A'
watchers.length = 0
const runF = useToolRun(() => sigF)
runF.markFail('参数错误', undefined)
cases.push(check('未传发起时签名：markFail 仍为 error（旧行为）', () => runF.status.value === 'error'))
runF.markOk('成功')
cases.push(check('未传发起时签名：markOk 仍为 ok（旧行为）', () => runF.status.value === 'ok'))
sigF = 'B'
flush()
cases.push(check('未传发起时签名：后续签名变化仍能被 watcher 置 stale', () => runF.status.value === 'stale'))

/* markIdle 重置 armed：idle 后签名变化不再变成 stale */
let sigG = 'A'
watchers.length = 0
const runG = useToolRun(() => sigG)
runG.markOk('成功', 'A')
runG.markIdle()
sigG = 'B'
flush()
cases.push(check('markIdle 后签名变化不产生 stale（armed 已复位）', () => runG.status.value === 'idle'))

/* ────────────────────────────────────────────────────────────
 * 1. SFC 自检（t12 / t13 / t14）
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const sfcFiles = [
  ['t12-md5-sha.vue', 't12-md5-sha'],
  ['t13-hmac.vue', 't13-hmac'],
  ['t14-aes.vue', 't14-aes']
]
const sfcSources = {}
for (const [file, id] of sfcFiles) {
  const src = readFileSync(join(projectRoot, 'app/components/tools', file), 'utf8')
  sfcSources[file] = src
  const parsed = parseSfc(src, { filename: file })
  let compileError = ''
  try {
    compileSfcScript(parsed.descriptor, { id })
  } catch (e) {
    compileError = e && e.message ? e.message : String(e)
  }
  cases.push(check(`SFC 解析 ${file} 无错误`, () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
  cases.push(check(`SFC 编译 ${file} <script setup> 成功`, () => !compileError, compileError))
}

/* ────────────────────────────────────────────────────────────
 * 2. 源码层约束
 * ──────────────────────────────────────────────────────────── */

/** 抽取顶层函数体（以行首 } 收尾） */
function extractTopLevelFn(source, header) {
  const re = new RegExp(`${header}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = source.match(re)
  if (!m) throw new Error(`未找到函数 ${header}`)
  return m[1]
}

/**
 * 每个 run.markOk( / run.markFail( 调用的参数区间内是否都出现 sigAtStart。
 * 拆分后每段截到下一个 markOk/markFail 标记，因此「未传」的调用段不会串到后一个调用的参数。
 */
function allMarkCallsPassStartSig(source) {
  const parts = source.split(/run\.(markOk|markFail)\(/)
  let calls = 0
  let passing = 0
  for (let i = 1; i < parts.length; i += 2) {
    calls++
    if ((parts[i + 1] ?? '').includes('sigAtStart')) passing++
  }
  return { calls, passing }
}

for (const [file] of sfcFiles) {
  const src = sfcSources[file]
  cases.push(
    check(`${file} 在 execute 开始捕获发起时签名 run.currentSignature()`, () =>
      /const\s+sigAtStart\s*=\s*run\.currentSignature\(\)/.test(src)
    )
  )
  const stat = allMarkCallsPassStartSig(src)
  cases.push(
    check(
      `${file} 全部 markOk/markFail 调用均传入发起时签名（${stat.passing}/${stat.calls}）`,
      () => stat.calls > 0 && stat.passing === stat.calls
    )
  )
}

/* t12 文件模式：onFiles 有 busy 守卫，避免 A 文件字节按 B 文件签名标记 */
const t12src = sfcSources['t12-md5-sha.vue']
let onFilesBody = ''
try {
  onFilesBody = extractTopLevelFn(t12src, 'async function onFiles\\(fs: File\\[\\]\\)')
} catch {
  onFilesBody = ''
}
cases.push(
  check('t12 onFiles 存在 busy 守卫（运行中忽略新文件）', () =>
    /if\s*\(\s*busy\.value\s*\)/.test(onFilesBody)
  )
)
cases.push(
  check('t12 onFiles 拒绝新文件时给出提示', () =>
    /toast\.warning\(/.test(onFilesBody)
  )
)

/* useToolRun：API 与签名语义源码证据 */
const runSrc = readFileSync(join(projectRoot, 'app/composables/useToolRun.ts'), 'utf8')
cases.push(
  check('useToolRun 暴露 currentSignature()', () =>
    /function\s+currentSignature\(\)/.test(runSrc) && /return\s*\{[^}]*currentSignature[^}]*\}/s.test(runSrc)
  )
)
cases.push(
  check('markOk 接受可选发起时签名 sigAtStart', () =>
    /function\s+markOk\(note = '',\s*sigAtStart\?:\s*string\)/.test(runSrc)
  )
)
cases.push(
  check('markFail 接受可选发起时签名 sigAtStart', () =>
    /function\s+markFail\(msg:\s*string,\s*sigAtStart\?:\s*string\)/.test(runSrc)
  )
)
cases.push(
  check('完成时记录发起时签名（sigAtStart ?? getSignature()）并与当前签名核对', () =>
    /sigAtStart\s*\?\?\s*getSignature\(\)/.test(runSrc) && /getSignature\(\)\s*===\s*sig/.test(runSrc)
  )
)

/* useRecent / useFavorites：persist 以 try/catch 包裹写入 */
function persistBody(source, closeIndent) {
  const re = new RegExp(`function persist\\(\\) \\{([\\s\\S]*?)\\n${closeIndent}\\}`)
  const m = source.match(re)
  return m ? m[1] : ''
}
const recentSrc = readFileSync(join(projectRoot, 'app/composables/useRecent.ts'), 'utf8')
const favSrc = readFileSync(join(projectRoot, 'app/composables/useFavorites.ts'), 'utf8')
const recentPersist = persistBody(recentSrc, '  ')
const favPersist = persistBody(favSrc, '  ')
cases.push(
  check('useRecent.persist 用 try/catch 包裹 localStorage.setItem', () =>
    /try\s*\{[\s\S]*localStorage\.setItem[\s\S]*\}\s*catch/.test(recentPersist)
  )
)
cases.push(
  check('useFavorites.persist 用 try/catch 包裹 localStorage.setItem', () =>
    /try\s*\{[\s\S]*localStorage\.setItem[\s\S]*\}\s*catch/.test(favPersist)
  )
)

/* ────────────────────────────────────────────────────────────
 * 3. 执行真实 persist 函数体：localStorage 抛异常时不外抛
 * ──────────────────────────────────────────────────────────── */
function runPersist(body, storage, entries, keyName) {
  const executable = body.replace(/import\.meta\.server/g, 'false')
  const fn = new Function('localStorage', 'entries', keyName, executable)
  fn(storage, entries, keyName)
}

const quotaError = new Error('QuotaExceededError')
let recentThrew = false
try {
  runPersist(recentPersist, { setItem() { throw quotaError } }, { value: [{ id: 't1', at: '2026-01-01T00:00:00.000Z' }] }, 'RECENT_KEY')
} catch {
  recentThrew = true
}
cases.push(check('useRecent.persist：setItem 抛异常时不向外抛（隐私模式/配额满）', () => !recentThrew))

let favThrew = false
try {
  runPersist(favPersist, { setItem() { throw quotaError } }, { value: [{ id: 't1', at: null }] }, 'FAV_KEY')
} catch {
  favThrew = true
}
cases.push(check('useFavorites.persist：setItem 抛异常时不向外抛（隐私模式/配额满）', () => !favThrew))

/* 正常写入路径仍生效（写入失败被吞，不代表不再持久化） */
let recentWritten = null
runPersist(recentPersist, { setItem(k, v) { recentWritten = [k, v] } }, { value: [{ id: 't9', at: '2026-09-24T00:00:00.000Z' }] }, 'RECENT_KEY')
cases.push(
  check('useRecent.persist：正常时仍写入 localStorage', () =>
    Array.isArray(recentWritten) && recentWritten[0] === 'RECENT_KEY' && /t9/.test(recentWritten[1])
  )
)
let favWritten = null
runPersist(favPersist, { setItem(k, v) { favWritten = [k, v] } }, { value: [{ id: 't9', at: null }] }, 'FAV_KEY')
cases.push(
  check('useFavorites.persist：正常时仍写入 v2 结构', () =>
    Array.isArray(favWritten) && favWritten[0] === 'FAV_KEY' && /"v":2/.test(favWritten[1]) && /t9/.test(favWritten[1])
  )
)
