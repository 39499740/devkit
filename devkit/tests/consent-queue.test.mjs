/**
 * 单测：useSecretConsent 中抽出的纯函数 createConsentQueue（单飞/队列核心逻辑）。
 * 直接 import 真实实现（模块顶层不调用 Nuxt，可在 Node 运行）。
 */
import { createConsentQueue } from '../app/composables/useSecretConsent.ts'
import { eq } from './helpers.mjs'

async function buildCases() {
  const cases = []

  // 1) 正常确认：只 resolve 一次 true
  {
    const q = createConsentQueue()
    const before = q.pending
    const p = q.request()
    const during = q.pending
    q.settle(true)
    cases.push(eq('单次 request + settle(true) → true', { before, during, result: await p, after: q.pending }, { before: false, during: true, result: true, after: false }))
  }

  // 2) 取消 → false
  {
    const q = createConsentQueue()
    const p = q.request()
    q.cancel()
    cases.push(eq('request + cancel() → false', { result: await p, after: q.pending }, { result: false, after: false }))
  }

  // 3) 连续两次 request：第一个 false，第二个 true（不悬挂）
  {
    const q = createConsentQueue()
    const first = q.request()
    const second = q.request()
    const r1 = await first
    const pendingAfter = q.pending
    q.settle(true)
    cases.push(eq('连续两次 request：第一个 false、第二个 true，不悬挂', { r1, pendingAfter, r2: await second, after: q.pending }, { r1: false, pendingAfter: true, r2: true, after: false }))
  }

  // 4) 先 A 后 B，再 settle(true)
  {
    const q = createConsentQueue()
    const a = q.request()
    const b = q.request()
    q.settle(true)
    cases.push(eq('先 request A、再 request B、再 settle(true)：A=false, B=true', await Promise.all([a, b]), [false, true]))
  }

  // 5) settle 后再次 request 正常
  {
    const q = createConsentQueue()
    const a = q.request()
    q.settle(false)
    const r1 = await a
    const b = q.request()
    q.settle(true)
    cases.push(eq('settle 之后再次 request 正常工作', { r1, r2: await b }, { r1: false, r2: true }))
  }

  // 6) 重复 settle/cancel 幂等
  {
    const q = createConsentQueue()
    const p = q.request()
    q.settle(true)
    q.settle(false)
    q.cancel()
    cases.push(eq('重复 settle/cancel 幂等，不重复 resolve', { result: await p, after: q.pending }, { result: true, after: false }))
  }

  // 7) 无待决请求时 cancel 安全
  {
    const q = createConsentQueue()
    q.cancel()
    cases.push(eq('无待决请求时 cancel 安全', q.pending, false))
  }

  // 8) 大量连续 request：前 9 个 false，最后一个由 settle 决定
  {
    const q = createConsentQueue()
    const ps = Array.from({ length: 10 }, () => q.request())
    q.settle(true)
    const settled = await Promise.all(ps)
    cases.push(eq('10 次连续 request：前 9 个 false、最后一个 true', settled, [...Array(9).fill(false), true]))
  }

  return cases
}

export const cases = await buildCases()
