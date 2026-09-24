/**
 * JSON / YAML 核心修复回归：
 * - schema-validate：数值关键字（minLength / maximum / minItems…）不再被静默跳过，
 *   const / enum 比较不再把 RawNumber 的 {"raw":"1"} 暴露给用户；
 * - json-yaml(yaml2json)：日期保持字符串、.inf/.nan 与非字符串键明确失败、
 *   大整数按原文输出、语法错误给中文提示；
 * - json-format / json-yaml(json2yaml)：重复键给出告警；
 * - detectDuplicateKeys：语义正确且单次扫描（不再 O(n²) 冻结）；
 * - jsonErrorPosition：message 已本地化成中文，不泄漏 V8 英文。
 */
import { detectDuplicateKeys, jsonErrorPosition, loadYamlPreservingNumbers, localizeJsonMessage, toPlainJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq, throws } from './helpers.mjs'

const schemaStep = (schema) => createStep('schema-validate', { schema })

async function buildCases() {
  const cases = []

  /* ── P0-1：schema-validate 数值关键字与 const/enum ── */
  const overMax = await runStep(schemaStep('{"type":"string","minLength":10,"maxLength":3}'), '"abcdef"', 0)
  cases.push(check('minLength/maxLength 生效（"abcdef" 失败）', () => overMax.status === 'fail'))
  cases.push(
    check('minLength/maxLength 失败信息含关键字', () => /minLength|maxLength/.test(overMax.note))
  )

  const constOk = await runStep(schemaStep('{"const":1}'), '1', 0)
  cases.push(eq('const 对相同数字通过', constOk.status, 'ok'))
  cases.push(check('const 通过信息不含 raw', () => !constOk.note.includes('raw')))

  const enumOk = await runStep(schemaStep('{"enum":[1,2,3]}'), '1', 0)
  cases.push(eq('enum 对 1 通过', enumOk.status, 'ok'))
  cases.push(check('enum 通过信息不含 raw', () => !enumOk.note.includes('raw')))

  const enumFail = await runStep(schemaStep('{"enum":[2,3]}'), '1', 0)
  cases.push(eq('enum 对不在集合内的 1 失败', enumFail.status, 'fail'))
  cases.push(check('enum 失败信息不含 {"raw":…}', () => !enumFail.note.includes('raw')))

  const minItemsFail = await runStep(schemaStep('{"type":"array","minItems":2}'), '[]', 0)
  cases.push(eq('minItems 对空数组失败', minItemsFail.status, 'fail'))
  cases.push(check('minItems 失败信息含 minItems', () => minItemsFail.note.includes('minItems')))

  const minimumFail = await runStep(schemaStep('{"type":"number","minimum":10}'), '1', 0)
  cases.push(eq('minimum 对 1 失败', minimumFail.status, 'fail'))
  cases.push(check('minimum 失败信息含 minimum', () => minimumFail.note.includes('minimum')))

  /* ── P0-2：json-yaml(yaml2json) 保真 ── */
  const dateKept = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'date: 2024-01-01', 0)
  cases.push(eq('日期保持字符串时状态 ok', dateKept.status, 'ok'))
  cases.push(check('日期保持字符串而非 ISO/对象', () => dateKept.output.includes('"date": "2024-01-01"') && !dateKept.output.includes('T00:00:00')))

  const infFail = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'x: .inf', 0)
  cases.push(eq('.inf 明确失败', infFail.status, 'fail'))
  cases.push(check('.inf 失败信息为中文', () => /无穷|NaN|无法静默转换/.test(infFail.note)))

  const numKeyFail = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), '80: http', 0)
  cases.push(eq('数字键明确失败', numKeyFail.status, 'fail'))
  cases.push(check('数字键失败信息提示加引号', () => numKeyFail.note.includes('键') && numKeyFail.note.includes('引号')))

  const bigInt = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'big: 12345678901234567890', 0)
  cases.push(eq('大整数状态 ok', bigInt.status, 'ok'))
  cases.push(check('大整数按原文输出（不带引号）', () => /"big": 12345678901234567890/.test(bigInt.output) && !/"12345678901234567890"/.test(bigInt.output)))
  cases.push(check('大整数给出安全范围提示', () => bigInt.note.includes('安全')))

  const yamlSyntax = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'a: [1, 2', 0)
  cases.push(eq('YAML 语法错误状态 fail', yamlSyntax.status, 'fail'))
  cases.push(check('YAML 语法错误为中文前缀', () => yamlSyntax.note.includes('YAML 解析失败')))
  cases.push(check('YAML 语法错误不泄漏英文 unexpected end', () => !/unexpected end/i.test(yamlSyntax.note)))
  cases.push(check('YAML 语法错误含中文原因', () => /[\u4e00-\u9fa5]/.test(yamlSyntax.note)))

  /* ── P2-7：重复键告警 ── */
  const dupFormat = await runStep(createStep('json-format'), '{"a":1,"a":2}', 0)
  cases.push(eq('json-format 重复键仍 ok', dupFormat.status, 'ok'))
  cases.push(check('json-format note 含重复键告警', () => dupFormat.note.includes('重复键')))
  cases.push(check('json-format 重复键输出取后者', () => dupFormat.output.includes('"a": 2')))

  const dupYaml = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), '{"a":1,"a":2}', 0)
  cases.push(eq('json-yaml 重复键仍 ok', dupYaml.status, 'ok'))
  cases.push(check('json-yaml note 含重复键告警', () => dupYaml.note.includes('重复键')))

  const dupMinify = await runStep(createStep('json-minify'), '{"a":1,"a":2}', 0)
  cases.push(check('json-minify 重复键告警保持一致', () => dupMinify.note.includes('重复键') && dupMinify.note.includes('后出现的键覆盖前者')))
  cases.push(check('json-format 重复键文案与 json-minify 同风格', () => dupFormat.note.includes('后出现的键覆盖前者')))

  /* ── detectDuplicateKeys 正确性 ── */
  cases.push(eq('无重复键返回空', detectDuplicateKeys('{"a":1,"b":2}'), []))
  cases.push(eq('顶层重复键', detectDuplicateKeys('{"a":1,"b":2,"a":3}'), ['a']))
  cases.push(eq('字符串值里的冒号不误判', detectDuplicateKeys('{"a":"x:y","b":1}'), []))
  cases.push(eq('数组内对象重复键', detectDuplicateKeys('{"list":[{"k":1,"k":2}]}'), ['{}.[].k']))
  cases.push(eq('转义键与普通键视为同一键', detectDuplicateKeys('{"a":1,"\\u0061":2}'), ['a']))
  cases.push(eq('重复键只报一次（3 次出现报 2 次）', detectDuplicateKeys('{"a":1,"a":2,"a":3}'), ['a', 'a']))

  /* ── detectDuplicateKeys 性能（旧实现 O(n²)，0.5MB 约 37s）── */
  const big = {}
  for (let i = 0; i < 20000; i++) big[`k${i}`] = i
  const bigText = JSON.stringify(big)
  const t0 = Date.now()
  const bigDups = detectDuplicateKeys(bigText)
  const elapsed = Date.now() - t0
  cases.push(check(`2 万键 JSON 无重复（长度 ${bigText.length}）`, () => bigDups.length === 0))
  cases.push(check(`2 万键检测耗时 < 1500ms（实际 ${elapsed}ms）`, () => elapsed < 1500))

  /* ── jsonErrorPosition / localizeJsonMessage 中文化 ── */
  let caught = null
  try {
    JSON.parse('{oops')
  } catch (e) {
    caught = e
  }
  const pos = jsonErrorPosition(caught, '{oops')
  cases.push(check('jsonErrorPosition 命中位置', () => !!pos && pos.line === 1 && pos.column >= 1))
  cases.push(check('jsonErrorPosition.message 为中文', () => !!pos && /[\u4e00-\u9fa5]/.test(pos.message)))
  cases.push(check('jsonErrorPosition.message 不含 V8 英文', () => !!pos && !/at position|Unexpected|Expected|SyntaxError/.test(pos.message)))
  cases.push(check('localizeJsonMessage 未知错误回退中文', () => /[\u4e00-\u9fa5]/.test(localizeJsonMessage('some unknown internal error')) && !/unknown/.test(localizeJsonMessage('some unknown internal error'))))
  cases.push(
    check('localizeJsonMessage 覆盖无位置信息的 V8 文案', () => {
      const m = localizeJsonMessage(`Unexpected token ']', "[1,]" is not valid JSON`)
      return /[\u4e00-\u9fa5]/.test(m) && !/Unexpected/.test(m)
    })
  )

  /* ── loadYamlPreservingNumbers 直接行为 ── */
  const loaded = loadYamlPreservingNumbers('code: 007\nhex: 0x1f\nn: 42')
  cases.push(eq('007 按字符串保留', loaded.value.code, '007'))
  cases.push(eq('0x1f 按字符串保留', loaded.value.hex, '0x1f'))
  cases.push(eq('普通整数仍为 number', toPlainJson(loaded.value).n, 42))
  cases.push(check('保真 notes 描述字符串保留', () => loaded.notes.some((n) => n.includes('字符串') || n.includes('标量'))))
  cases.push(throws('数字键抛中文 Error', () => loadYamlPreservingNumbers('80: http'), /键/))
  cases.push(throws('.inf 抛中文 Error', () => loadYamlPreservingNumbers('x: .inf'), /无穷|NaN/))
  cases.push(throws('语法错误抛中文 Error', () => loadYamlPreservingNumbers('a: [1, 2'), /YAML 解析失败/))

  /* ── YAML 合并键 << (merge) 支持 ── */
  const mergeDoc = 'defaults: &d\n  a: 1\nitem:\n  <<: *d\n  b: 2'
  const mergedPlain = toPlainJson(loadYamlPreservingNumbers(mergeDoc).value)
  cases.push(eq('merge 键合并出 a', mergedPlain.item.a, 1))
  cases.push(eq('merge 键合并出 b', mergedPlain.item.b, 2))
  cases.push(check('merge 后不残留 << 键', () => !Object.prototype.hasOwnProperty.call(mergedPlain.item, '<<')))
  cases.push(eq('merge 来源 defaults 保留', mergedPlain.defaults.a, 1))

  const mergeStep = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), mergeDoc, 0)
  cases.push(eq('merge 端到端 yaml2json 状态 ok', mergeStep.status, 'ok'))
  cases.push(
    check('merge 端到端输出已合并且无 <<', () => {
      const out = JSON.parse(mergeStep.output)
      return out.item.a === 1 && out.item.b === 2 && !('<<' in out.item)
    })
  )

  const mergeSeqPlain = toPlainJson(
    loadYamlPreservingNumbers('a: &a\n  x: 1\nb: &b\n  y: 2\nc:\n  <<: [*a, *b]\n  z: 3').value
  )
  cases.push(
    check(
      'merge 键支持别名序列 <<: [*a, *b]',
      () =>
        mergeSeqPlain.c.x === 1 &&
        mergeSeqPlain.c.y === 2 &&
        mergeSeqPlain.c.z === 3 &&
        !Object.prototype.hasOwnProperty.call(mergeSeqPlain.c, '<<')
    )
  )

  // 普通锚点 / 别名（非 merge）引用仍正常
  const aliasPlain = toPlainJson(loadYamlPreservingNumbers('base: &a\n  x: 1\nref: *a').value)
  cases.push(eq('普通别名引用取到相同值', aliasPlain.ref.x, 1))
  cases.push(check('普通别名引用不引入 <<', () => !Object.prototype.hasOwnProperty.call(aliasPlain.ref, '<<')))

  // 引号包裹的 "<<" 仍是普通键（不触发合并）
  const quotedMergeKey = toPlainJson(loadYamlPreservingNumbers('"<<": 1').value)
  cases.push(eq('引号 "<<" 仍按普通键处理', quotedMergeKey['<<'], 1))

  /* ── 回归：合入 merge 类型后不影响既有保真语义 ── */
  cases.push(eq('回归：日期仍为字符串', toPlainJson(loadYamlPreservingNumbers('date: 2024-01-01').value).date, '2024-01-01'))
  cases.push(throws('回归：.inf 仍抛中文 Error', () => loadYamlPreservingNumbers('x: .inf'), /无穷|NaN/))
  cases.push(throws('回归：数字键仍抛中文 Error', () => loadYamlPreservingNumbers('80: http'), /键/))
  const bigAfterMerge = loadYamlPreservingNumbers('big: 12345678901234567890')
  cases.push(eq('回归：大整数仍保留原文', bigAfterMerge.value.big.raw, '12345678901234567890'))
  cases.push(check('回归：大整数仍给出安全提示', () => bigAfterMerge.notes.some((n) => n.includes('安全'))))

  return cases
}

export const cases = await buildCases()
