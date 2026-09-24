/**
 * P2-1 预算改为「按放大程度」判定 + P3-2 复杂键识别 + P3-4 JSON BOM 回归：
 *
 * - P2-1：assertYamlExpansionWithinBudget 之前把所有节点计入展开规模（阈值 20 万），
 *   导致合法的 21 万节点扁平大数组被误拒、且报「疑似别名放大」误导。现改为：
 *   `expandedNodes > uniqueNodes * 10 + 20 万` 才判别名放大；另设绝对硬上限（2000 万节点 / 800 万字符）。
 *   → 21 万节点扁平数组（ratio≈1，<2MB 文本，<1s）通过；bomb / 自引用拒绝且中文。
 * - P3-2：不再用字面量 "[object Object]" 判定复杂键；改为探针层对映射/序列键打随机标记。
 *   → 合法字符串键 `"[object Object]": 1` 通过；真正的映射/序列键仍被拒绝。
 * - P3-4：parseJson 解析前剥离前导 BOM（\uFEFF），`parseJson('\uFEFF{"a":1}')` 正常。
 */
import {
  assertYamlExpansionWithinBudget,
  jsonErrorPosition,
  loadYamlPreservingNumbers,
  parseJson,
  toPlainJson
} from '../app/utils/json.ts'
import { check, eq } from './helpers.mjs'

const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)

/** 执行并返回错误信息；未抛错返回 null */
function errMessage(fn) {
  try {
    fn()
    return null
  } catch (e) {
    return e && e.message ? e.message : String(e)
  }
}

/** 每层 aN: &aN [*a(N-1) × width]，展开成树后节点数随 depth 指数增长 */
function bomb(depth, width) {
  const lines = ['a0: &a0 x']
  for (let i = 1; i <= depth; i++) {
    const refs = Array.from({ length: width }, () => `*a${i - 1}`).join(', ')
    lines.push(`a${i}: &a${i} [${refs}]`)
  }
  return lines.join('\n')
}

/** 21 万节点扁平数组（flow 写法，文本约 1.36MB < 2MB） */
const FLAT_N = 210_000
const FLAT_YAML = '[' + Array.from({ length: FLAT_N }, (_, i) => String(i)).join(',') + ']'

async function buildCases() {
  const cases = []

  /* ── P2-1：21 万节点扁平数组通过（不再被误拒） ── */
  cases.push(check(`扁平数组文本约 ${FLAT_YAML.length} 字符 < 2MB`, () => FLAT_YAML.length < 2_000_000))
  const t0 = Date.now()
  let flatErr = null
  let flatValue = null
  try {
    flatValue = loadYamlPreservingNumbers(FLAT_YAML).value
  } catch (e) {
    flatErr = e
  }
  const flatMs = Date.now() - t0
  cases.push(check(`21 万节点扁平数组通过（实际错误：${flatErr ? flatErr.message : '无'}）`, () => flatErr === null))
  cases.push(check(`21 万节点扁平数组 < 1000ms（实际 ${flatMs}ms）`, () => flatMs < 1000))
  cases.push(check('21 万节点扁平数组长度正确', () => Array.isArray(flatValue) && flatValue.length === FLAT_N))
  cases.push(check('扁平数组直接过预算检查（ratio≈1）', () => assertYamlExpansionWithinBudget(flatValue) === undefined))

  /* ── P2-1：别名放大 / 自引用仍拒绝且中文 ── */
  const bigMsg = errMessage(() => loadYamlPreservingNumbers(bomb(8, 9)))
  cases.push(check('bomb(8,9) 被拒绝', () => bigMsg !== null))
  cases.push(check('bomb(8,9) 中文且含「别名」「放大/过大」', () => bigMsg !== null && hasChinese(bigMsg) && /别名/.test(bigMsg) && /放大|过大/.test(bigMsg)))
  cases.push(check('bomb(8,9) 不被误报为「输入规模过大」', () => bigMsg !== null && !/输入规模过大/.test(bigMsg)))

  const t1 = Date.now()
  const bigMsg2 = errMessage(() => loadYamlPreservingNumbers(bomb(8, 9)))
  const bigMs = Date.now() - t1
  cases.push(check(`bomb(8,9) 快速拒绝 < 1000ms（实际 ${bigMs}ms）`, () => bigMsg2 !== null && bigMs < 1000))

  // bomb(6,9) 约 60 万节点 → 相对放大超阈值，拒绝；bomb(5,10) 约 12 万节点 → 轻度放大，仍可用
  cases.push(check('bomb(6,9) 相对放大被拒绝', () => errMessage(() => loadYamlPreservingNumbers(bomb(6, 9))) !== null))
  cases.push(check('bomb(5,10) 轻度放大仍可用', () => errMessage(() => loadYamlPreservingNumbers(bomb(5, 10))) === null))
  cases.push(check('浅层别名可用', () => errMessage(() => loadYamlPreservingNumbers(bomb(3, 2))) === null))

  const selfMsg = errMessage(() => loadYamlPreservingNumbers('a: &x\n  b: *x'))
  cases.push(check('自引用循环被拒绝且中文含「别名」', () => selfMsg !== null && hasChinese(selfMsg) && /别名/.test(selfMsg)))
  cases.push(
    check('自引用直接进预算检查也被拒绝', () => {
      const t = Date.now()
      const m = errMessage(() => {
        // 用 JS 直接构造循环别名，等价于 `a: &x\n  b: *x`
        const a = {}
        a.b = a
        assertYamlExpansionWithinBudget(a)
      })
      return m !== null && hasChinese(m) && Date.now() - t < 1000
    })
  )

  /* ── P2-1：文本长度上限仍拒绝，文案含「文本过长」+「输入规模过大」 ── */
  const hugeMsg = errMessage(() => loadYamlPreservingNumbers('a: ' + 'x'.repeat(2_000_000)))
  cases.push(check('超长文本被拒绝且文案正确', () => hugeMsg !== null && /文本过长/.test(hugeMsg) && /输入规模过大/.test(hugeMsg)))

  // 绝对硬上限（与别名无关）：单个超长字符串触发字符上限，报「输入规模过大」而非「别名放大」
  const absMsg = errMessage(() => assertYamlExpansionWithinBudget('x'.repeat(9_000_000)))
  cases.push(
    check('绝对规模硬上限报「输入规模过大」且不提别名', () => absMsg !== null && /输入规模过大/.test(absMsg) && !/别名/.test(absMsg))
  )

  /* ── P3-2：合法字符串键 "[object Object]" 通过，复杂键仍拒绝 ── */
  const dotKey = loadYamlPreservingNumbers('"[object Object]": 1')
  cases.push(eq('合法字符串键 "[object Object]" 通过', toPlainJson(dotKey.value)['[object Object]'], 1))
  const dotKeyNested = loadYamlPreservingNumbers('outer:\n  "[object Object]": 2')
  cases.push(eq('嵌套的合法 "[object Object]" 键通过', toPlainJson(dotKeyNested.value).outer['[object Object]'], 2))

  const mapKeyMsg = errMessage(() => loadYamlPreservingNumbers('? {a: 1}\n: v'))
  cases.push(check('映射键被拒绝且中文含「键」', () => mapKeyMsg !== null && hasChinese(mapKeyMsg) && /键/.test(mapKeyMsg)))
  cases.push(check('映射键错误不出现 "[object Object]"', () => mapKeyMsg !== null && !mapKeyMsg.includes('[object Object]')))

  const seqKeyMsg = errMessage(() => loadYamlPreservingNumbers('? [1, 2]\n: v'))
  cases.push(check('序列键被拒绝且中文含「键」', () => seqKeyMsg !== null && hasChinese(seqKeyMsg) && /键/.test(seqKeyMsg)))
  const flowSeqKeyMsg = errMessage(() => loadYamlPreservingNumbers('[1, 2]: v'))
  cases.push(check('流式序列键被拒绝且中文含「键」', () => flowSeqKeyMsg !== null && hasChinese(flowSeqKeyMsg) && /键/.test(flowSeqKeyMsg)))

  // 探针解析后必须还原被临时改写的原型，避免污染全局
  cases.push(eq('探针解析后 Object.prototype.toString 已还原', Object.prototype.toString.call({}), '[object Object]'))
  cases.push(eq('探针解析后 Array.prototype.toString 已还原', String([1, 2]), '1,2'))
  cases.push(eq('普通字符串键 "1,2" 仍按字符串通过', toPlainJson(loadYamlPreservingNumbers('"1,2": v').value)['1,2'], 'v'))

  /* ── P3-4：前导 BOM 的 JSON 正常解析 ── */
  cases.push(eq('带 BOM 的 JSON 正常解析', toPlainJson(parseJson('\uFEFF{"a":1}').value), { a: 1 }))
  cases.push(eq('带 BOM 的 JSON 数组正常解析', toPlainJson(parseJson('\uFEFF[1,2,3]').value), [1, 2, 3]))
  cases.push(eq('带 BOM 的 JSON 重复键检测正常', parseJson('\uFEFF{"a":1,"a":2}').duplicateKeys, ['a']))
  cases.push(
    check(
      '带 BOM 的大整数仍保留原文',
      () => toPlainJson(parseJson('\uFEFF{"big":12345678901234567890}').value).big === '12345678901234567890'
    )
  )

  // jsonErrorPosition 的行列计算不受影响（普通输入 + BOM 输入都能给出位置）
  let caught = null
  try {
    parseJson('{oops')
  } catch (e) {
    caught = e
  }
  const pos = jsonErrorPosition(caught, '{oops')
  cases.push(check('jsonErrorPosition 普通输入仍是第 1 行且有列号', () => !!pos && pos.line === 1 && pos.column >= 1))
  cases.push(check('jsonErrorPosition.message 仍为中文', () => !!pos && hasChinese(pos.message)))

  return cases
}

export const cases = await buildCases()
