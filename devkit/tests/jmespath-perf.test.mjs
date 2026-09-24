/**
 * JMESPath 性能与语义回归 + json2java 类名校验：
 * - evalJmesPath 对 @[*] 大数组（12000 / 20000 对象）不再 O(n²)：耗时断言（宽松上限）；
 * - 固定表达式的取值 / 路径与既有语义一致（对照 tests/jsonpath.test.mjs）；
 * - jmespath 步骤在 Node（同步回退）对 @[*] 大数组也能快速完成；
 * - json2java 非法类名（数字开头 / Java 关键字）给出中文失败，合法类名保持不变。
 *
 * 性能断言取宽松上限（20000 < 800ms），避免 CI 抖动误报；实测见报告。
 */
import { evalJmesPath } from '../app/utils/jmespath.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s)

/** 生成 n 个同构对象，模拟 @[*] 全量投影的真实负载 */
function bigArray(n) {
  const arr = new Array(n)
  for (let i = 0; i < n; i += 1) arr[i] = { i, name: `item-${i}`, value: i * 2 }
  return arr
}

const store = {
  store: {
    name: '城南书店',
    book: [
      { title: '深入理解 Java 虚拟机', price: 99, category: 'tech' },
      { title: '设计中的设计', price: 68, category: 'design' },
      { title: 'Vue.js 设计与实现', price: 119, category: 'tech' },
      { title: '代码整洁之道', price: 59, category: 'tech' }
    ],
    bicycle: { color: 'red', price: 399 }
  }
}
const jm = (expr, data = store) => evalJmesPath(data, expr)

export const cases = []

/* ─────────────── 1. 语义对照（与 jsonpath.test.mjs 一致） ─────────────── */

cases.push(eq('JMESPath 通配投影', jm('store.book[*].title').matches.map((m) => m.value), [
  '深入理解 Java 虚拟机',
  '设计中的设计',
  'Vue.js 设计与实现',
  '代码整洁之道'
]))
cases.push(eq('JMESPath 过滤（反引号字面量）', jm('store.book[?price < `100`].title').matches.length, 3))
cases.push(eq('JMESPath 函数 length', jm('length(store.book)').matches[0].value, 4))
cases.push(eq('JMESPath sort_by + 投影', jm('sort_by(store.book, &price)[*].title').matches[0].value, '代码整洁之道'))
cases.push(eq('JMESPath 多选对象', jm('store.book[?price < `100`].{t: title, p: price}').matches.length, 3))
cases.push(eq('JMESPath 管道', jm('store.book[*].price | max(@)').matches[0].value, 119))

// 路径定位：索引方案对原对象引用给出准确路径
cases.push(eq('JMESPath 对象投影路径', jm('store.book[*]').matches.map((m) => m.path), [
  '$.store.book[0]',
  '$.store.book[1]',
  '$.store.book[2]',
  '$.store.book[3]'
]))
cases.push(eq('JMESPath 对象结果路径', jm('store.bicycle').matches[0].path, '$.store.bicycle'))
cases.push(eq('JMESPath 根数组 @[*] 路径', evalJmesPath([{ a: 1 }, { a: 2 }], '@[*]').matches.map((m) => m.path), ['$[0]', '$[1]']))
// 标量结果无法唯一反查，保持历史行为：数组结果回退为下标路径
cases.push(eq('JMESPath 标量投影路径回退为下标', jm('store.book[*].title').matches.map((m) => m.path), ['$[0]', '$[1]', '$[2]', '$[3]']))

/* ─────────────── 2. 性能：@[*] 大数组不再 O(n²) ─────────────── */

for (const n of [12000, 20000]) {
  const data = bigArray(n)
  const t0 = performance.now()
  const res = evalJmesPath(data, '@[*]')
  const ms = performance.now() - t0
  cases.push(
    check(`evalJmesPath @[*] ${n} 对象 < 800ms（实际 ${ms.toFixed(1)}ms）`, () => {
      return res.matches.length === n && ms < 800
    })
  )
}

// 结果值正确性：每个元素保留原对象引用
cases.push(
  check('evalJmesPath @[*] 大数组取值正确', () => {
    const data = bigArray(12000)
    const res = evalJmesPath(data, '@[*]')
    return res.matches[0].value === data[0] && res.matches[11999].value === data[11999] && res.matches[5000].value.i === 5000
  })
)

/* ─────────────── 3. jmespath 步骤（Node 同步回退）大数组 ─────────────── */

const bigData = bigArray(12000)
const tStep = performance.now()
const stepRes = await runStep(createStep('jmespath', { expr: '@[*]' }), JSON.stringify(bigData), 0)
const stepMs = performance.now() - tStep
cases.push(
  check(`runStep jmespath @[*] 12000 对象快速完成（实际 ${stepMs.toFixed(1)}ms）`, () => {
    return stepRes.status === 'ok' && stepMs < 2000 && JSON.parse(stepRes.output).length === 12000
  })
)

/* ─────────────── 4. json2java 类名校验 ─────────────── */

const badCls = await runStep(createStep('json2java', { className: '1 Bad' }), '{"a":1}', 0)
cases.push(
  check('json2java 非法类名 "1 Bad" 失败且中文', () => badCls.status === 'fail' && hasChinese(badCls.note))
)
const kwCls = await runStep(createStep('json2java', { className: 'class' }), '{"a":1}', 0)
cases.push(
  check('json2java 关键字类名 "class" 失败且中文', () => kwCls.status === 'fail' && hasChinese(kwCls.note))
)
const okCls = await runStep(createStep('json2java', { className: 'Order' }), '{"a":1}', 0)
cases.push(
  check('json2java 合法类名 Order 正常', () => okCls.status === 'ok' && okCls.output.includes('public class Order'))
)
const defCls = await runStep(createStep('json2java'), '{"a":1}', 0)
cases.push(
  check('json2java 空类名回退默认 Order', () => defCls.status === 'ok' && defCls.output.includes('public class Order'))
)

void check
