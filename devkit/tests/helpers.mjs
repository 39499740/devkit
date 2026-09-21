/** 测试用的最小断言集合：返回 { name, ok, detail } */
export function check(name, fn) {
  try {
    const r = fn()
    if (r === true || r === undefined) return { name, ok: true }
    return { name, ok: false, detail: `期望 true，实际 ${JSON.stringify(r)}` }
  } catch (e) {
    return { name, ok: false, detail: `抛出异常：${e && e.message ? e.message : String(e)}` }
  }
}

export function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  return { name, ok: a === b, detail: a === b ? '' : `期望 ${b}，实际 ${a}` }
}

export function throws(name, fn, matcher) {
  try {
    fn()
    return { name, ok: false, detail: '期望抛出异常，但没有抛出' }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (matcher && !matcher.test(msg)) return { name, ok: false, detail: `异常信息不匹配 ${matcher}：${msg}` }
    return { name, ok: true }
  }
}
