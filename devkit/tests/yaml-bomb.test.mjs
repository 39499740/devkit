/**
 * 别名放大 / 命名分组 / Java 标识符回归：
 * - P1-2：YAML 别名（anchor/alias）可构造 billion laughs。loadYamlPreservingNumbers
 *   必须在展开成树前用预算拦截（findNonFinite 去重 + 展开规模预算 + 文本长度上限），
 *   浅层别名与 merge 键仍正常；
 * - P2-1：regex-replace 的 match 模式命名分组为 "__proto__" 时不能被原型 setter 吞掉；
 * - P2-4：json2java 字段名需净化（非法首字符 / Java 关键字）并去重。
 */
import { loadYamlPreservingNumbers, toPlainJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

/** 每层 aN: &aN [*a(N-1) × width]，展开成树后节点数随 depth 指数增长 */
function bomb(depth, width) {
  const lines = ['a0: &a0 x']
  for (let i = 1; i <= depth; i++) {
    const refs = Array.from({ length: width }, () => `*a${i - 1}`).join(', ')
    lines.push(`a${i}: &a${i} [${refs}]`)
  }
  return lines.join('\n')
}

function timeIt(fn) {
  const t0 = Date.now()
  let error = null
  let result = null
  try {
    result = fn()
  } catch (e) {
    error = e
  }
  return { ms: Date.now() - t0, error, result }
}

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null'
])

async function buildCases() {
  const cases = []

  /* ── P1-2：浅层别名正常 ── */
  const shallow = timeIt(() => toPlainJson(loadYamlPreservingNumbers(bomb(2, 3)).value))
  cases.push(check('浅层别名正常加载', () => shallow.error === null && JSON.stringify(shallow.result.a2) === JSON.stringify([['x', 'x', 'x'], ['x', 'x', 'x'], ['x', 'x', 'x']])))
  cases.push(check(`浅层别名耗时 < 500ms（实际 ${shallow.ms}ms）`, () => shallow.ms < 500))

  /* ── P1-2：展开规模仍在上限内的别名可用（10^0+…+10^5 ≈ 12.3 万节点 < 20 万）── */
  const moderate = timeIt(() => loadYamlPreservingNumbers(bomb(5, 10)))
  cases.push(check('展开规模在上限内的别名仍可加载', () => moderate.error === null && moderate.result.value.a5.length === 10))
  cases.push(check(`上限内别名耗时 < 1000ms（实际 ${moderate.ms}ms）`, () => moderate.ms < 1000))

  /* ── P1-2：bomb(8,9) 展开约 4800 万节点，必须快速中文报错，不 OOM / 不卡死 ── */
  const big = timeIt(() => loadYamlPreservingNumbers(bomb(8, 9)))
  cases.push(check('bomb(8,9) 抛出错误', () => big.error !== null))
  cases.push(check('bomb(8,9) 错误为中文', () => big.error !== null && /[\u4e00-\u9fa5]/.test(big.error.message)))
  cases.push(check('bomb(8,9) 错误含「别名」字样', () => big.error !== null && /别名/.test(big.error.message)))
  cases.push(check(`bomb(8,9) 在 3000ms 内返回（实际 ${big.ms}ms）`, () => big.ms < 3000))

  /* ── P1-2：文本长度上限（宽松，2_000_000 字符）── */
  const hugeText = 'a: ' + 'x'.repeat(2_000_000)
  const huge = timeIt(() => loadYamlPreservingNumbers(hugeText))
  cases.push(check('超长 YAML 文本被拒绝', () => huge.error !== null && /文本过长/.test(huge.error.message)))
  cases.push(check('超长 YAML 文本错误为中文', () => huge.error !== null && /[\u4e00-\u9fa5]/.test(huge.error.message)))
  cases.push(check(`超长文本快速拒绝 < 500ms（实际 ${huge.ms}ms）`, () => huge.ms < 500))

  /* ── P1-2：普通 anchor/alias 与 merge 键不受影响 ── */
  const aliasPlain = toPlainJson(loadYamlPreservingNumbers('base: &a\n  x: 1\nref: *a').value)
  cases.push(eq('普通别名引用取到相同值', aliasPlain.ref.x, 1))
  cases.push(check('普通别名引用不引入 <<', () => !Object.prototype.hasOwnProperty.call(aliasPlain.ref, '<<')))

  const mergePlain = toPlainJson(loadYamlPreservingNumbers('defaults: &d\n  a: 1\nitem:\n  <<: *d\n  b: 2').value)
  cases.push(eq('merge 键合并出 a', mergePlain.item.a, 1))
  cases.push(eq('merge 键合并出 b', mergePlain.item.b, 2))
  cases.push(check('merge 后不残留 << 键', () => !Object.prototype.hasOwnProperty.call(mergePlain.item, '<<')))

  const mergeSeq = toPlainJson(loadYamlPreservingNumbers('a: &a\n  x: 1\nb: &b\n  y: 2\nc:\n  <<: [*a, *b]\n  z: 3').value)
  cases.push(check('merge 键支持别名序列 <<: [*a, *b]', () => mergeSeq.c.x === 1 && mergeSeq.c.y === 2 && mergeSeq.c.z === 3))

  // 端到端：yaml2json 步骤同样受保护且正常输入可用
  const yamlOk = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'base: &a\n  x: 1\nref: *a', 0)
  cases.push(check('yaml2json 普通别名端到端 ok', () => yamlOk.status === 'ok' && JSON.parse(yamlOk.output).ref.x === 1))
  const yamlBomb = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), bomb(8, 9), 0)
  cases.push(check('yaml2json 对别名炸弹明确失败', () => yamlBomb.status === 'fail' && /别名/.test(yamlBomb.note)))

  /* ── P2-1：regex match 命名分组 "__proto__" 不被吞 ── */
  const protoMatch = await runStep(
    createStep('regex-replace', { mode: 'match', pattern: '(?<__proto__>\\d+)', flags: 'g' }),
    'a1b22',
    0
  )
  cases.push(check('命名分组 __proto__ 提取状态 ok', () => protoMatch.status === 'ok'))
  cases.push(
    check('命名分组 __proto__ 出现在输出中（未被吞）', () => {
      const parsed = JSON.parse(protoMatch.output)
      return (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        Object.prototype.hasOwnProperty.call(parsed[0], '__proto__') &&
        Object.getOwnPropertyDescriptor(parsed[0], '__proto__').value === '1' &&
        Object.getOwnPropertyDescriptor(parsed[1], '__proto__').value === '22'
      )
    })
  )
  cases.push(
    check('命名分组 __proto__ 不污染原型', () => {
      const parsed = JSON.parse(protoMatch.output)
      return Object.getPrototypeOf(parsed[0]) === Object.prototype && Object.getPrototypeOf(parsed[1]) === Object.prototype
    })
  )
  // 普通命名分组回归
  const normalMatch = await runStep(
    createStep('regex-replace', { mode: 'match', pattern: '(?<y>\\d{4})-(?<m>\\d{2})', flags: 'g' }),
    '2024-03 与 2025-11',
    0
  )
  cases.push(eq('普通命名分组仍正常', JSON.parse(normalMatch.output), [{ y: '2024', m: '03' }, { y: '2025', m: '11' }]))

  /* ── P2-4：json2java 标识符净化与去重 ── */
  const java = await runStep(createStep('json2java'), '{"class":1,"a-b":2,"a_b":3,"1x":4}', 0)
  cases.push(check('json2java 关键字/非法名输入状态 ok', () => java.status === 'ok'))
  const fieldNames = [...java.output.matchAll(/private\s+([A-Za-z_$][\w$]*(?:<[^>]*>)?)\s+([A-Za-z_$][\w$]*);/g)].map((m) => m[2])
  cases.push(check('json2java 生成 4 个字段', () => fieldNames.length === 4))
  cases.push(eq('json2java 字段名净化与去重结果', fieldNames.slice().sort(), ['aB', 'aB2', 'class_', 'field1x']))
  cases.push(check('json2java 无 Java 关键字字段名', () => fieldNames.every((n) => !JAVA_KEYWORDS.has(n))))
  cases.push(check('json2java 无非法标识符字段名', () => fieldNames.every((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n))))
  cases.push(check('json2java 无重名字段名', () => new Set(fieldNames).size === fieldNames.length))
  cases.push(check('json2java 不再出现 private long class;', () => !/\bprivate\s+long\s+class\s*;/.test(java.output)))
  cases.push(check('json2java 不再出现 private long 1x;', () => !/\bprivate\s+long\s+1x\s*;/.test(java.output)))
  cases.push(check('json2java note 正常', () => typeof java.note === 'string' && java.note.length > 0 && !/失败|错误/.test(java.note)))

  // getter/setter 跟随去重后的字段名，避免重复方法
  cases.push(
    check('json2java getter/setter 与去重字段一致', () => {
      return (
        java.output.includes('getAB()') &&
        java.output.includes('getAB2()') &&
        java.output.includes('getClass_()') &&
        java.output.includes('getField1x()')
      )
    })
  )

  // 正常输入输出不变
  const javaNormal = await runStep(createStep('json2java'), '{"user":{"name":"陈立","age":30},"tags":["a","b"]}', 0)
  cases.push(
    check('json2java 正常输入输出不变', () =>
      javaNormal.status === 'ok' &&
      javaNormal.output.includes('private User user;') &&
      javaNormal.output.includes('private List<String> tags;') &&
      javaNormal.output.includes('private long age;')
    )
  )

  return cases
}

export const cases = await buildCases()
