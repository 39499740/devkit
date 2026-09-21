import { defaultWorkflows, normalizeSelection, runStep, runWorkflow, stepDef, stepLibrary } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

export const cases = [
  // 选中项规范化（回归：点「流程输出」时越界访问 steps[n] 导致整页崩掉）
  eq('-1 是流程输入', normalizeSelection(4, -1), { kind: 'input' }),
  eq('-5 仍是流程输入', normalizeSelection(4, -5), { kind: 'input' }),
  eq('0 是第 1 步', normalizeSelection(4, 0), { kind: 'step', index: 0 }),
  eq('3 是第 4 步', normalizeSelection(4, 3), { kind: 'step', index: 3 }),
  eq('4 是流程输出', normalizeSelection(4, 4), { kind: 'output' }),
  eq('越界（10）落回流程输出', normalizeSelection(4, 10), { kind: 'output' }),
  eq('空流程的 0 是流程输出', normalizeSelection(0, 0), { kind: 'output' }),
  eq('NaN 落回流程输入', normalizeSelection(4, Number.NaN), { kind: 'input' }),
  check('规范化结果永远不会指向不存在的步骤', () => {
    for (const n of [0, 1, 3, 6]) {
      for (const s of [-3, -1, 0, 1, n - 1, n, n + 5, 99]) {
        const sel = normalizeSelection(n, s)
        if (sel.kind === 'step' && (sel.index < 0 || sel.index >= n)) return false
      }
    }
    return true
  }),

  // 步骤库与默认流程
  eq('步骤库 8 个步骤', stepLibrary.length, 8),
  eq('默认 3 条流程', defaultWorkflows().length, 3),
  check('步骤类型都能查到定义', () => defaultWorkflows().every((w) => w.steps.every((s) => stepDef(s.type)?.type === s.type))),

  // 端到端：订单快照解析（Base64 → JSON → JSONPath → Java）
  check('订单快照解析端到端成功', () => {
    const wf = defaultWorkflows()[0]
    const input = Buffer.from(JSON.stringify({ order: { id: 'o-1', total: 199.5, items: [{ sku: 'A-1', qty: 2 }] } })).toString('base64')
    const res = runWorkflow(wf, input, { stopOnError: true })
    return (
      res.status === 'ok' &&
      res.results.length === 4 &&
      res.results.every((r) => r.status === 'ok') &&
      res.finalOutput.includes('public class Order') &&
      res.finalOutput.includes('private double total')
    )
  }),
  check('JSONPath 步骤对 RawNumber 也能过滤（回归）', () => {
    const step = { type: 'jsonpath', config: { expr: '$.list[?(@.price < 100)].title' } }
    const input = JSON.stringify({ list: [{ title: 'a', price: 99 }, { title: 'b', price: 199 }] })
    const res = runStep(step, input, 0)
    return res.status === 'ok' && res.output.includes('a') && !res.output.includes('b')
  }),
  check('Schema 校验步骤失败时中断', () => {
    const wf = defaultWorkflows()[2]
    const res = runWorkflow(wf, encodeURIComponent('{"code":"x"}'), { stopOnError: true })
    return res.status === 'fail' && res.results[2].status === 'fail' && res.results.length === 3
  }),
  check('失败时中断关闭则继续跑完', () => {
    const wf = defaultWorkflows()[2]
    const res = runWorkflow(wf, encodeURIComponent('{"code":"x"}'), { stopOnError: false })
    return res.status === 'fail' && res.results.length === 3
  }),
  check('空输入或非法输入给出可读错误', () => {
    const res = runStep({ type: 'json-format', config: {} }, '{oops', 0)
    return res.status === 'fail' && res.note.length > 0
  }),
  check('JSON / YAML 步骤双向可用', () => {
    const toYaml = runStep({ type: 'json-yaml', config: { direction: 'json2yaml' } }, '{"a":1}', 0)
    const toJson = runStep({ type: 'json-yaml', config: { direction: 'yaml2json' } }, 'a: 1', 0)
    return toYaml.status === 'ok' && toYaml.output.includes('a: 1') && toJson.status === 'ok' && toJson.output.includes('"a": 1')
  }),
  check('下载步骤只标记文件名不改内容', () => {
    const res = runStep({ type: 'download', config: { filename: 'x.txt' } }, 'hello', 0)
    return res.status === 'ok' && res.output === 'hello' && res.note.includes('x.txt')
  })
]

void check
