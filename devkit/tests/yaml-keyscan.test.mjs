/**
 * YAML 非字符串键扫描的性能与正确性回归：
 * - 退役文本层逐行正则扫描后，「一行大量 "- " 且无冒号」不再发生二次回溯：
 *   2 万字符输入在函数层与 runStep 层都 < 200ms；
 * - 数字 / 布尔 / null / 带标签 !!int / 带锚点 &k / 流式 {1: x} 非字符串键都报中文错误；
 * - 字符串键（含 "80" / "true"）与多行引号标量（内含 "1: x"）正常通过；
 * - 普通 YAML / merge / anchor 不受影响。
 */
import { loadYamlPreservingNumbers, toPlainJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq, throws } from './helpers.mjs'

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

/** 「一行大量 "- " 且无冒号」的合法 YAML：第二行是 5000 组 "- "（约 2 万字符） */
function pathological() {
  return '- a\n' + '  - '.repeat(5000)
}

async function buildCases() {
  const cases = []

  /* ── 性能：消除二次回溯 ── */
  const patho = pathological()
  cases.push(check(`病态输入约 2 万字符（实际 ${patho.length}）`, () => patho.length >= 20000))

  const t0 = Date.now()
  const pathoLoaded = loadYamlPreservingNumbers(patho)
  const loadMs = Date.now() - t0
  cases.push(check(`函数层加载病态输入 < 200ms（实际 ${loadMs}ms）`, () => loadMs < 200))
  cases.push(check('病态输入仍正常加载（未被误判）', () => pathoLoaded && pathoLoaded.value !== undefined))

  const t1 = Date.now()
  const pathoStep = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), patho, 0)
  const stepMs = Date.now() - t1
  cases.push(check(`runStep 层处理病态输入 < 200ms（实际 ${stepMs}ms）`, () => stepMs < 200))
  cases.push(eq('runStep 层病态输入状态 ok', pathoStep.status, 'ok'))

  /* ── 非字符串键：全部报中文错误 ── */
  const badKeys = [
    ['数字键', '80: http', '数字'],
    ['布尔键', 'true: x', '布尔值'],
    ['null 键', '~: x', 'null'],
    ['标签数字键', '!!int 1: x', '数字'],
    ['锚点数字键', '&k 1: x', '数字'],
    ['流式数字键', '{1: x}', '数字']
  ]
  for (const [label, doc, type] of badKeys) {
    const msg = errMessage(() => loadYamlPreservingNumbers(doc))
    cases.push(check(`${label} 抛错`, () => msg !== null))
    cases.push(check(`${label} 错误为中文且含「键」`, () => msg !== null && hasChinese(msg) && /键/.test(msg)))
    cases.push(check(`${label} 错误标注类型「${type}」`, () => msg !== null && msg.includes(type)))
    cases.push(check(`${label} 不产出 [object Object]`, () => msg !== null && !msg.includes('[object Object]')))
  }
  cases.push(throws('数字键抛中文 Error（helper）', () => loadYamlPreservingNumbers('80: http'), /键/))
  cases.push(throws('布尔键抛中文 Error（helper）', () => loadYamlPreservingNumbers('true: x'), /键/))
  cases.push(throws('null 键抛中文 Error（helper）', () => loadYamlPreservingNumbers('~: x'), /键/))

  // 行号尽量保留 + 计数
  const lineMsg = errMessage(() => loadYamlPreservingNumbers('a: 1\ntrue: b'))
  cases.push(check('第二行的非字符串键报出行号', () => lineMsg !== null && lineMsg.includes('第 2 行')))
  const flowMsg = errMessage(() => loadYamlPreservingNumbers('{80: a, true: b}'))
  cases.push(check('流式多个非字符串键计数为 2', () => flowMsg !== null && flowMsg.includes('共 2 处')))

  // 端到端：runStep 对非字符串键 fail + 中文
  const badStep = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), '80: http', 0)
  cases.push(eq('runStep 非字符串键状态 fail', badStep.status, 'fail'))
  cases.push(check('runStep 非字符串键 note 中文且含「键」', () => hasChinese(badStep.note) && badStep.note.includes('键')))

  /* ── 字符串键 / 多行引号标量：正常通过 ── */
  const quotedNum = loadYamlPreservingNumbers('"80": http')
  cases.push(eq('引号 "80" 键按字符串通过', toPlainJson(quotedNum.value)['80'], 'http'))
  const quotedBool = loadYamlPreservingNumbers('"true": x')
  cases.push(eq('引号 "true" 键按字符串通过', toPlainJson(quotedBool.value)['true'], 'x'))

  const multiline = 'k: "line1\\n  1: not a key\\n  line3"'
  const mlLoaded = loadYamlPreservingNumbers(multiline)
  cases.push(
    eq('多行引号标量里的 "1: x" 不被误判为键', toPlainJson(mlLoaded.value).k, 'line1\n  1: not a key\n  line3')
  )
  const blockScalar = 'k: |\n  80: not a key\n  true: nope'
  cases.push(
    eq('块标量内容不被误判为键', toPlainJson(loadYamlPreservingNumbers(blockScalar).value).k, '80: not a key\ntrue: nope\n')
  )

  /* ── 回归：普通 YAML / merge / anchor ── */
  cases.push(eq('普通 YAML 正常', toPlainJson(loadYamlPreservingNumbers('a: 1\nb: 2').value), { a: 1, b: 2 }))
  const merged = toPlainJson(loadYamlPreservingNumbers('defaults: &d\n  a: 1\nitem:\n  <<: *d\n  b: 2').value)
  cases.push(eq('merge 键合并出 a/b', [merged.item.a, merged.item.b], [1, 2]))
  cases.push(check('merge 后不残留 << 键', () => !Object.prototype.hasOwnProperty.call(merged.item, '<<')))
  const alias = toPlainJson(loadYamlPreservingNumbers('base: &a\n  x: 1\nref: *a').value)
  cases.push(eq('普通 anchor/alias 正常', alias.ref.x, 1))

  // 列表里的数字/布尔值不是键，正常
  cases.push(eq('序列里的数字/布尔值正常', toPlainJson(loadYamlPreservingNumbers('list:\n  - 80\n  - true').value).list, [80, true]))

  return cases
}

export const cases = await buildCases()
