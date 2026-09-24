/**
 * 原型链穿透回归（违反「真实计算」红线）：
 * - JSONPath / JMESPath 的属性存在性与取值必须是 own-property，
 *   不能命中 toString / constructor / __proto__ 等原型成员；
 * - toPlainJson 遇到 JSON 字面量 "__proto__" 键时必须保留为普通自有键，且不改变结果对象原型；
 * - 端到端 jsonpath 步骤遇到原型成员应「匹配 0 项」失败，而不是成功输出 undefined / 函数；
 * - 同时覆盖普通路径，确保正常行为不回归。
 */
import { evalJsonPath } from '../app/utils/jsonpath.ts'
import { evalJmesPath } from '../app/utils/jmespath.ts'
import { parseJson, toPlainJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

async function buildCases() {
  const cases = []

  /* ── JSONPath：原型成员不得命中 ── */
  cases.push(eq('jsonpath $.constructor 匹配 0 项', evalJsonPath({ a: 1 }, '$.constructor').matches.length, 0))
  cases.push(eq('jsonpath $.toString 匹配 0 项', evalJsonPath({ a: 1 }, '$.toString').matches.length, 0))
  cases.push(eq('jsonpath $.__proto__ 匹配 0 项', evalJsonPath({ a: 1 }, '$.__proto__').matches.length, 0))
  cases.push(eq("jsonpath $['constructor'] 匹配 0 项", evalJsonPath({ a: 1 }, "$['constructor']").matches.length, 0))
  cases.push(eq('jsonpath 递归下降 $..constructor 匹配 0 项', evalJsonPath({ a: { b: 1 } }, '$..constructor').matches.length, 0))
  cases.push(
    check('jsonpath 原型成员不返回函数', () => {
      const ms = evalJsonPath({ a: 1 }, '$.constructor').matches
      return ms.every((m) => typeof m.value !== 'function')
    })
  )
  cases.push(
    eq('jsonpath 嵌套原型成员不命中', evalJsonPath({ a: { b: 1 } }, '$.a.constructor').matches.length, 0)
  )
  cases.push(
    eq('jsonpath 过滤器 @.constructor 不命中', evalJsonPath([{ a: 1 }], '$[?(@.constructor)]').matches.length, 0)
  )

  /* ── JMESPath：原型成员不得命中 ── */
  cases.push(eq('jmespath toString 匹配 0 项', evalJmesPath({ a: 1 }, 'toString').matches.length, 0))
  cases.push(eq('jmespath constructor 匹配 0 项', evalJmesPath({ a: 1 }, 'constructor').matches.length, 0))
  cases.push(eq('jmespath __proto__ 匹配 0 项', evalJmesPath({ a: 1 }, '__proto__').matches.length, 0))
  cases.push(
    check('jmespath 原型成员不返回函数', () => evalJmesPath({ a: 1 }, 'constructor').matches.every((m) => typeof m.value !== 'function'))
  )

  /* ── toPlainJson：字面量 "__proto__" 键保真 ── */
  const polluted = () => toPlainJson(parseJson('{"__proto__":{"secret":"LEAKED"},"a":1}').value)
  cases.push(
    check('toPlainJson 保留 __proto__ 为自有键', () => Object.prototype.hasOwnProperty.call(polluted(), '__proto__'))
  )
  cases.push(check('toPlainJson 结果原型仍为 Object.prototype', () => Object.getPrototypeOf(polluted()) === Object.prototype))
  cases.push(check('toPlainJson 不泄漏 secret', () => polluted().secret === undefined))
  cases.push(
    check('toPlainJson 保留 __proto__ 的内容与 a', () => {
      const p = polluted()
      return p.__proto__ && p.__proto__.secret === 'LEAKED' && p.a === 1
    })
  )
  cases.push(
    check('toPlainJson 嵌套 __proto__ 也不改变原型', () => {
      const p = toPlainJson(parseJson('{"outer":{"__proto__":{"x":1},"y":2}}').value)
      return Object.getPrototypeOf(p.outer) === Object.prototype && Object.prototype.hasOwnProperty.call(p.outer, '__proto__') && p.outer.y === 2
    })
  )

  /* ── 端到端：jsonpath 步骤遇到原型成员应失败 ── */
  const e2e = await runStep(createStep('jsonpath', { expr: '$.constructor' }), '{"a":1}', 0)
  cases.push(check('端到端 $.constructor 状态为 fail', () => e2e.status === 'fail'))
  cases.push(check('端到端 $.constructor 失败原因是匹配 0 项', () => /匹配 0 项/.test(e2e.note)))

  const e2eJm = await runStep(createStep('jmespath', { expr: 'constructor' }), '{"a":1}', 0)
  cases.push(check('端到端 jmespath constructor 状态为 fail', () => e2eJm.status === 'fail'))

  /* ── 回归：普通路径行为不变 ── */
  const store = { store: { book: [{ title: 'A', price: 99 }, { title: 'B', price: 199 }] } }
  cases.push(eq('回归 jsonpath $.store.book[*].title', evalJsonPath(store, '$.store.book[*].title').matches.map((m) => m.value), ['A', 'B']))
  cases.push(eq('回归 jsonpath 过滤器', evalJsonPath(store, '$.store.book[?(@.price < 100)].title').matches.map((m) => m.value), ['A']))
  cases.push(eq('回归 jsonpath 数组下标', evalJsonPath(store, '$.store.book[1].title').matches[0].value, 'B'))
  cases.push(eq('回归 jsonpath 联合', evalJsonPath({ a: 1, b: 2 }, "$['a','b']").matches.length, 2))
  cases.push(eq('回归 jsonpath 存在的 __proto__ 自有键可命中', evalJsonPath(toPlainJson(parseJson('{"__proto__":1}').value), '$.__proto__').matches.length, 1))
  cases.push(eq('回归 jmespath 字段投影', evalJmesPath(store, 'store.book[*].title').matches.map((m) => m.value), ['A', 'B']))
  cases.push(eq('回归 jmespath 过滤器', evalJmesPath(store, 'store.book[?price < `100`].title').matches.map((m) => m.value), ['A']))
  cases.push(eq('回归 jmespath 多选对象', evalJmesPath(store, 'store.book[0].{t: title, p: price}').matches[0].value.t, 'A'))

  return cases
}

export const cases = await buildCases()
