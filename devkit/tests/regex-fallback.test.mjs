/**
 * Worker 不可用（Node / SSR）时的同步兜底回归：
 * - execRegexWithTimeout：安全正则正常执行；危险正则（^(a+)+$）由 regexRiskReason 兜底判定，
 *   直接返回 ok:false 拒绝执行（绝不真正同步执行，避免冻结线程）；
 * - runComputation：无 Worker 时调用调用方提供的同步 fallback，保证 schema/jsonpath 仍可用。
 *
 * 本文件只在无 Worker 的 Node 环境运行；浏览器侧的 Worker 行为由浏览器验证线程覆盖。
 */
import { execRegexWithTimeout, regexRiskReason } from '../app/utils/regex.ts'
import { hasWorker, runComputation } from '../app/workflow/workers/run-compute.ts'
import { check } from './helpers.mjs'

export const cases = []

cases.push(check('Node 环境 hasWorker() 为 false（前提）', () => hasWorker() === false))

/* ─────────────── 1. execRegexWithTimeout 同步兜底 ─────────────── */

const safe = await execRegexWithTimeout('(\\d+)', 'g', 'a1b22', '#$1')
cases.push(
  check('无 Worker 时安全正则正常执行（替换语义不变）', () => safe.ok === true && safe.replaced === 'a#1b#22' && safe.matches.length === 2)
)

const safeSyntax = await execRegexWithTimeout('(', 'g', 'x')
cases.push(check('无 Worker 时非法正则如实返回错误（不误判为风险）', () => safeSyntax.ok === false && typeof safeSyntax.error === 'string'))

cases.push(check('^(a+)+$ 确实被 regexRiskReason 判定为危险（兜底前提）', () => regexRiskReason('^(a+)+$') !== null))

// 若真的同步执行，长非匹配输入会长时间回溯；这里必须立即返回失败。
const t0 = Date.now()
const risky = await execRegexWithTimeout('^(a+)+$', '', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')
const riskyMs = Date.now() - t0
cases.push(
  check('无 Worker 时危险正则被兜底拒绝：ok:false 且未真正执行', () => {
    return (
      risky.ok === false &&
      risky.matches.length === 0 &&
      risky.replaced === null &&
      typeof risky.error === 'string' &&
      risky.error.includes('已拒绝执行')
    )
  })
)
cases.push(check(`危险正则兜底立即返回（实际 ${riskyMs}ms，未触发回溯）`, () => riskyMs < 500))

/* ─────────────── 2. runComputation 同步 fallback ─────────────── */

let called = false
const fallbackResult = await runComputation(
  { fn: 'path', dataText: '{"a":1}', expr: '$.a' },
  () => {
    called = true
    return { matches: [{ value: 1 }], warnings: [] }
  }
)
cases.push(check('无 Worker 时 runComputation 调用同步回退并返回其结果', () => called === true && fallbackResult.matches[0].value === 1))

// fallback 抛错时应以 reject 呈现（不吞错、不悬挂）
let rejected = false
let rejectedMsg = ''
try {
  await runComputation({ fn: 'validate' }, () => {
    throw new Error('同步回退失败')
  })
} catch (e) {
  rejected = true
  rejectedMsg = e && e.message ? e.message : String(e)
}
cases.push(check('同步回退抛错时 runComputation reject（不悬挂）', () => rejected && rejectedMsg.includes('同步回退失败')))
