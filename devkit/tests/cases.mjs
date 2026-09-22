/** 测试里重复用的小工具：把断言收集成 run.mjs 需要的 { name, ok, detail } 列表 */
export function makeCases() {
  const cases = []
  const ok = (name, cond, detail = '') => cases.push({ name, ok: !!cond, detail: cond ? '' : detail || '断言失败' })
  const eqj = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    cases.push({ name, ok: a === b, detail: a === b ? '' : `期望 ${b}，实际 ${a}` })
  }
  const rejects = async (name, fn, matcher) => {
    try {
      await fn()
      cases.push({ name, ok: false, detail: '期望抛错，但没有抛出' })
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      const pass = matcher.test(msg)
      cases.push({ name, ok: pass, detail: pass ? '' : `错误消息不匹配 ${matcher}：${msg}` })
    }
  }
  return { cases, ok, eqj, rejects }
}
