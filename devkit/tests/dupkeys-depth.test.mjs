/**
 * detectDuplicateKeys 深嵌套 / 路径重建回归：
 * - 旧实现为每一层嵌套都 `pathParts.join('.')` 并保存完整路径字符串 → 累计 O(depth²)：
 *   2 万层 ~600MB / 1.3s，5 万层（100KB）直接 OOM；
 * - 现改为「父帧引用 + 本层段名」，仅在真正发现重复键时才按需重建可读路径，深嵌套为 O(n)；
 * - 深嵌套 20000 层应在扫描早期快速、低内存地以中文「嵌套层级过深」失败（旧实现 ~600MB / 1.3s），
 *   100KB（5 万层）同样中文失败且绝不 OOM；
 * - 深度硬上限（JSON_MAX_NESTING_DEPTH）与 parseJson 内部 reviver 的递归上限协调，
 *   使 parseJson 对深嵌套也给出中文提示而非英文 RangeError；
 * - 浅层 / 嵌套 / 数组场景的重复键路径格式与既有断言完全一致（含 `{}` / `[]` 占位风格）。
 */
import { detectDuplicateKeys, JSON_MAX_NESTING_DEPTH, localizeJsonMessage, parseJson } from '../app/utils/json.ts'
import { check, eq, throws } from './helpers.mjs'

const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)

/** 执行并测量耗时 / 堆增量；返回 { result, error, ms, heapDeltaMB }（heapUsed 差值，无需 --expose-gc） */
function measure(fn) {
  const before = process.memoryUsage().heapUsed
  const t0 = Date.now()
  let result
  let error = null
  try {
    result = fn()
  } catch (e) {
    error = e && e.message ? e.message : String(e)
  }
  const ms = Date.now() - t0
  const heapDeltaMB = (process.memoryUsage().heapUsed - before) / 1048576
  return { result, error, ms, heapDeltaMB }
}

function buildCases() {
  const cases = []

  /* ── 重复键语义与路径格式（与既有断言一致） ── */
  cases.push(eq('无重复键返回空', detectDuplicateKeys('{"a":1,"b":2}'), []))
  cases.push(eq('顶层重复键', detectDuplicateKeys('{"a":1,"b":2,"a":3}'), ['a']))
  cases.push(eq('重复键每次出现都计（3 次报 2 次）', detectDuplicateKeys('{"a":1,"a":2,"a":3}'), ['a', 'a']))
  cases.push(eq('字符串值里的冒号不误判', detectDuplicateKeys('{"a":"x:y","b":1}'), []))
  cases.push(eq('数组内对象重复键', detectDuplicateKeys('{"list":[{"k":1,"k":2}]}'), ['{}.[].k']))
  cases.push(eq('根数组内对象重复键', detectDuplicateKeys('[{"a":1,"a":2}]'), ['[].a']))
  cases.push(eq('多层嵌套对象重复键路径', detectDuplicateKeys('{"a":{"b":{"c":1,"c":2}}}'), ['{}.{}.c']))
  cases.push(eq('对象/数组/对象混合嵌套路径', detectDuplicateKeys('{"a":[{"b":{"c":1,"c":2}}]}'), ['{}.[].{}.c']))
  cases.push(eq('多层数组内对象路径', detectDuplicateKeys('[[{"x":1,"x":2}]]'), ['[].[].x']))
  cases.push(eq('转义键与普通键视为同一键', detectDuplicateKeys('{"a":1,"\\u0061":2}'), ['a']))
  cases.push(eq('转义引号键去转义后比较', detectDuplicateKeys('{"a\\"b":1,"a\\"b":2}'), ['a"b']))
  cases.push(eq('含空格键按原文拼接路径', detectDuplicateKeys('{"a b":1,"a b":2}'), ['a b']))
  cases.push(eq('同名键在不同层级不算重复', detectDuplicateKeys('{"a":1,"b":{"a":1}}'), []))
  cases.push(eq('不同数组元素同名键不算重复', detectDuplicateKeys('[{"a":1},{"a":2}]'), []))
  cases.push(eq('空对象 / 空数组无重复', detectDuplicateKeys('{}[]'), []))
  cases.push(eq('嵌套空容器无重复', detectDuplicateKeys('{"a":{},"b":[]}'), []))
  cases.push(eq('深层重复键重建完整路径', detectDuplicateKeys('{"a":{"b":{"c":{"d":1,"d":2}}}}'), ['{}.{}.{}.d']))
  cases.push(eq('同层多个不同重复键', detectDuplicateKeys('{"a":1,"a":2,"b":1,"b":2}'), ['a', 'b']))

  /* ── 深嵌套性能：20000 层应在扫描早期快速、低内存地中文失败 ── */
  const deep20k = '['.repeat(20000) + ']'.repeat(20000)
  const perf = measure(() => detectDuplicateKeys(deep20k))
  cases.push(check('20000 层抛错（不再 OOM）', () => perf.error !== null))
  cases.push(check('20000 层错误为中文「嵌套层级过深」', () => perf.error !== null && hasChinese(perf.error) && perf.error.includes('嵌套层级过深')))
  cases.push(check(`20000 层耗时 < 300ms（实际 ${perf.ms}ms，旧实现 ~1351ms）`, () => perf.ms < 300))
  cases.push(
    check(`20000 层堆增量 < 100MB（实际 ${perf.heapDeltaMB.toFixed(1)}MB，旧实现 ~600MB）`, () => perf.heapDeltaMB < 100)
  )

  // 上限内的深层对象（每层一个键）快速完成、无重复
  const deepObj = '{"a":'.repeat(2000) + '1' + '}'.repeat(2000)
  const objPerf = measure(() => detectDuplicateKeys(deepObj))
  cases.push(
    check(`2000 层对象不抛错且为空（${objPerf.error ?? 'ok'}）`, () => objPerf.error === null && Array.isArray(objPerf.result) && objPerf.result.length === 0)
  )
  cases.push(check(`2000 层对象耗时 < 300ms（实际 ${objPerf.ms}ms）`, () => objPerf.ms < 300))

  // 深层末尾的重复键：路径只在发现重复时重建，仍正确且快
  const deepDup = '{"a":'.repeat(2000) + '{"x":1,"x":2}' + '}'.repeat(2000)
  const dupPerf = measure(() => detectDuplicateKeys(deepDup))
  const expectedDeepDup = Array.from({ length: 2000 }, () => '{}').join('.') + '.x'
  cases.push(check('深层重复键只报一次', () => Array.isArray(dupPerf.result) && dupPerf.result.length === 1))
  cases.push(check('深层重复键路径正确重建', () => dupPerf.result && dupPerf.result[0] === expectedDeepDup))
  cases.push(check(`深层重复键耗时 < 300ms（实际 ${dupPerf.ms}ms）`, () => dupPerf.ms < 300))

  // 深层同一对象内多个重复键：路径缓存生效，结果与逐次重建一致
  const deepMultiDup = '{"a":'.repeat(2000) + '{"x":1,"x":2,"x":3,"y":1,"y":2}' + '}'.repeat(2000)
  const multiPerf = measure(() => detectDuplicateKeys(deepMultiDup))
  const deepPrefix = Array.from({ length: 2000 }, () => '{}').join('.')
  cases.push(eq('深层同层多个重复键顺序与数量正确', multiPerf.result, [deepPrefix + '.x', deepPrefix + '.x', deepPrefix + '.y']))
  cases.push(check(`深层多重复键耗时 < 300ms（实际 ${multiPerf.ms}ms）`, () => multiPerf.ms < 300))

  /* ── 超深输入：100KB（5 万层）中文失败、不 OOM ── */
  const deep50k = '['.repeat(50000) + ']'.repeat(50000)
  const over = measure(() => detectDuplicateKeys(deep50k))
  cases.push(check('100KB 深嵌套抛错', () => over.error !== null))
  cases.push(check('100KB 深嵌套错误为中文', () => over.error !== null && hasChinese(over.error)))
  cases.push(check('100KB 深嵌套错误提示「嵌套层级过深」', () => over.error !== null && over.error.includes('嵌套层级过深')))
  cases.push(check(`100KB 深嵌套快速失败 < 300ms（实际 ${over.ms}ms）`, () => over.ms < 300))
  cases.push(
    check(`100KB 深嵌套堆增量 < 100MB（实际 ${over.heapDeltaMB.toFixed(1)}MB，旧实现 OOM）`, () => over.heapDeltaMB < 100)
  )

  /* ── 深度硬上限边界 ── */
  const atLimit = '['.repeat(JSON_MAX_NESTING_DEPTH) + ']'.repeat(JSON_MAX_NESTING_DEPTH)
  cases.push(check(`恰好 ${JSON_MAX_NESTING_DEPTH} 层允许通过`, () => detectDuplicateKeys(atLimit).length === 0))
  const overLimit = '['.repeat(JSON_MAX_NESTING_DEPTH + 1) + ']'.repeat(JSON_MAX_NESTING_DEPTH + 1)
  cases.push(throws(`超过 ${JSON_MAX_NESTING_DEPTH} 层抛中文错误`, () => detectDuplicateKeys(overLimit), /嵌套层级过深/))

  /* ── parseJson 入口：深嵌套中文提示，不 OOM、不落到 reviver 的英文 RangeError ── */
  const parsed20k = measure(() => parseJson(deep20k))
  cases.push(
    check('parseJson 20000 层中文失败', () => parsed20k.error !== null && parsed20k.error.includes('嵌套层级过深') && hasChinese(parsed20k.error))
  )
  cases.push(check(`parseJson 20000 层不 OOM 且快速 < 300ms（实际 ${parsed20k.ms}ms）`, () => parsed20k.ms < 300))
  const parsed50k = measure(() => parseJson(deep50k))
  cases.push(
    check('parseJson 100KB 深嵌套中文失败', () => parsed50k.error !== null && parsed50k.error.includes('嵌套层级过深') && hasChinese(parsed50k.error))
  )
  cases.push(check(`parseJson 100KB 深嵌套不 OOM 且快速 < 300ms（实际 ${parsed50k.ms}ms）`, () => parsed50k.ms < 300))
  // 上限内的深嵌套仍可正常解析（值与重复键检测都可用）
  const okDeep = parseJson('{"a":'.repeat(2000) + '1' + '}'.repeat(2000))
  cases.push(check('parseJson 2000 层正常解析且无重复键', () => okDeep.duplicateKeys.length === 0 && okDeep.value !== null && typeof okDeep.value === 'object'))

  /* ── localizeJsonMessage 保留深嵌套中文提示 ── */
  cases.push(
    check('localizeJsonMessage 保留「嵌套层级过深」', () =>
      localizeJsonMessage('JSON 嵌套层级过深（超过 2500 层），已拒绝处理，请减少嵌套层级后重试').includes('嵌套层级过深')
    )
  )
  cases.push(
    check('localizeJsonMessage 仍对英文错误中文化', () => {
      const out = localizeJsonMessage('Unexpected end of JSON input')
      return hasChinese(out) && !out.includes('Unexpected')
    })
  )

  /* ── 回归：浅层大输入仍快速且无重复 ── */
  const big = {}
  for (let i = 0; i < 20000; i++) big[`k${i}`] = i
  const bigText = JSON.stringify(big)
  const bigPerf = measure(() => detectDuplicateKeys(bigText))
  cases.push(check('2 万扁平键无重复', () => Array.isArray(bigPerf.result) && bigPerf.result.length === 0))
  cases.push(check(`2 万扁平键耗时 < 1500ms（实际 ${bigPerf.ms}ms）`, () => bigPerf.ms < 1500))

  return cases
}

export const cases = buildCases()
