/**
 * 需要真实浏览器环境的流程用例：
 * - XML 步骤依赖 DOMParser / document.evaluate
 * - 正则步骤与 t11 共用 execRegex，且 t11 会把它注入 Blob Worker，这里真的起一个 Worker 验证
 * 入口是 tests/dom.mjs（ego-browser）。
 */
import { buildWorkflowFromPreset, createStep, findPreset, runStep, runWorkflow } from '../app/utils/workflow.ts'
import { execRegex, regexWorkerSource } from '../app/utils/regex.ts'
import { makeCases } from './cases.mjs'

const XML_SAMPLE = '<catalog><book><title>A</title></book><book><title>B</title></book></catalog>'

function runWorker(source, payload) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const w = new Worker(url)
    const timer = setTimeout(() => {
      w.terminate()
      URL.revokeObjectURL(url)
      reject(new Error('t 超时'))
    }, 5000)
    w.onmessage = (ev) => {
      clearTimeout(timer)
      w.terminate()
      URL.revokeObjectURL(url)
      resolve(ev.data)
    }
    w.onerror = (ev) => {
      clearTimeout(timer)
      w.terminate()
      URL.revokeObjectURL(url)
      reject(new Error(ev.message || 'worker error'))
    }
    w.postMessage(payload)
  })
}

export const run = async () => {
  const { cases, ok, eqj } = makeCases()

  // ── XML 步骤 ──
  const fmt = await runStep(createStep('xml', { mode: 'format' }), '<a><b/></a>', 0)
  ok('XML 格式化步骤', fmt.status === 'ok' && fmt.output.split('\n').length === 3 && fmt.output.includes('  <b/>'), fmt.output)
  const min = await runStep(createStep('xml', { mode: 'minify' }), '<a>\n  <b/>\n</a>', 0)
  ok('XML 压缩步骤', min.status === 'ok' && min.output.includes('<a><b/></a>'), min.output)
  const x2j = await runStep(createStep('xml', { mode: 'xml2json' }), '<a id="1"><b>x</b></a>', 0)
  // 与 utils/xml.ts 的既有语义一致：根元素本身不出现，属性写成 @name
  ok('XML → JSON 步骤', x2j.status === 'ok' && JSON.parse(x2j.output)['@id'] === '1' && JSON.parse(x2j.output).b === 'x', x2j.output)
  const j2x = await runStep(createStep('xml', { mode: 'json2xml' }), '{"a":{"b":1}}', 0)
  ok('JSON → XML 步骤', j2x.status === 'ok' && j2x.output.includes('<b>1</b>'), j2x.output)
  const xp = await runStep(createStep('xml', { mode: 'xpath', expr: '//book/title' }), XML_SAMPLE, 0)
  ok('XPath 步骤', xp.status === 'ok' && JSON.parse(xp.output).length === 2, xp.output)
  const xpBad = await runStep(createStep('xml', { mode: 'xpath', expr: '//book/nope' }), XML_SAMPLE, 0)
  ok('XPath 无匹配时明确失败', xpBad.status === 'fail' && xpBad.note.includes('没有匹配'), xpBad.note)
  const xmlBad = await runStep(createStep('xml', { mode: 'format' }), '<a><b></a>', 0)
  ok('XML 语法错误给出可读提示', xmlBad.status === 'fail' && xmlBad.note.length > 0, xmlBad.note)

  const preset = buildWorkflowFromPreset(findPreset('xml-contract'))
  const presetRun = await runWorkflow(preset, XML_SAMPLE, { stopOnError: true })
  ok(
    '预设「XML 接口数据转换」端到端跑通',
    presetRun.status === 'ok' && JSON.parse(presetRun.finalOutput).$schema.includes('2020-12'),
    presetRun.results.map((r) => r.note).join(' | ')
  )

  // ── 正则执行器与 Worker 注入（t11 的实际机制）──
  const fn = new Function('return (' + execRegex.toString() + ')')()
  ok('execRegex 自包含，可作为字符串注入 Worker', typeof fn === 'function')
  const injected = fn('(\\d+)', 'g', 'a1b22', '#$1')
  ok('注入后的执行器行为一致', injected.ok === true && injected.replaced === 'a#1b#22' && injected.matches.length === 2, JSON.stringify(injected))
  const injectedBad = fn('(', 'g', 'x', '')
  ok('注入后的错误路径一致', injectedBad.ok === false && typeof injectedBad.error === 'string')
  eqj('execRegex 在 Worker 外也返回同样结果', execRegex('(\\d+)', 'g', 'a1b22', '#$1').replaced, 'a#1b#22')

  try {
    const data = await runWorker(regexWorkerSource(), { source: '(\\d+)', flags: 'g', text: 'a1b22', replacement: '#$1' })
    ok('Worker 脚本真的能跑通（t11 用的就是这份源码）', data.ok === true && data.replaced === 'a#1b#22' && data.matches.length === 2, JSON.stringify(data))
  } catch (e) {
    ok('Worker 脚本真的能跑通（t11 用的就是这份源码）', false, e && e.message ? e.message : String(e))
  }

  return cases
}
