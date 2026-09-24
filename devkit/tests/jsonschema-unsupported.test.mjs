/**
 * P2-4 回归：validateInstance 对「已识别但未实现」的关键字给出中文告警。
 *
 * 此前 dependencies（draft-07）、minContains / maxContains、unevaluatedProperties /
 * unevaluatedItems、additionalItems（无数组 items 时）等关键字被静默忽略，
 * 结果仍返回 valid:true，违反「校验通过必须是真结论」。
 * 现在这些关键字出现时在 warnings 追加中文说明，且不改变已有 valid / errors 语义；
 * 已实现的关键字（含 dependentRequired / dependentSchemas）不得误报。
 */
import { validateInstance } from '../app/utils/jsonschema.ts'
import { check, eq } from './helpers.mjs'

const v = (inst, schema) => validateInstance(inst, schema, { strict: true })
const warnsUnsupported = (r, kw) =>
  r.warnings.some((w) => w.includes('暂不支持') && w.includes(kw))
const anyUnsupported = (r) => r.warnings.some((w) => w.includes('暂不支持'))

export const cases = [
  /* ── dependencies（draft-07 写法，未实现）── */
  check('dependencies 数组写法：给出中文「暂不支持」告警', () => warnsUnsupported(v({ a: 1 }, { dependencies: { a: ['b'] } }), 'dependencies')),
  check('dependencies schema 写法：同样告警', () =>
    warnsUnsupported(v({ a: 1 }, { dependencies: { a: { required: ['b'] } } }), 'dependencies')
  ),
  check('dependencies 告警为中文并说明未校验/不完整', () => {
    const r = v({ a: 1 }, { dependencies: { a: ['b'] } })
    return r.warnings.some((w) => /[\u4e00-\u9fa5]/.test(w) && w.includes('未校验') && w.includes('不完整'))
  }),
  eq('dependencies 只新增 warning：valid 语义不变', v({ a: 1 }, { dependencies: { a: ['b'] } }).valid, true),
  eq('dependencies 只新增 warning：errors 仍为空', v({ a: 1 }, { dependencies: { a: ['b'] } }).errors.length, 0),

  /* ── minContains / maxContains（未实现）── */
  check('minContains 存在时告警', () =>
    warnsUnsupported(v([1, 2], { contains: { type: 'number' }, minContains: 2 }), 'minContains')
  ),
  check('maxContains 存在时告警', () =>
    warnsUnsupported(v([1, 2], { contains: { type: 'number' }, maxContains: 1 }), 'maxContains')
  ),

  /* ── unevaluatedProperties / unevaluatedItems（未实现）── */
  check('unevaluatedProperties 存在时告警', () =>
    warnsUnsupported(v({ a: 1 }, { unevaluatedProperties: false }), 'unevaluatedProperties')
  ),
  check('unevaluatedItems 存在时告警', () => warnsUnsupported(v([1], { unevaluatedItems: false }), 'unevaluatedItems')),

  /* ── additionalItems 仅在无数组 items（无实现）时告警 ── */
  check('additionalItems + items 对象：告警', () =>
    warnsUnsupported(v([1], { items: { type: 'number' }, additionalItems: false }), 'additionalItems')
  ),
  check('additionalItems 无 items：告警', () => warnsUnsupported(v([1], { additionalItems: false }), 'additionalItems')),
  eq(
    'additionalItems + items 数组（draft-07 元组，已实现）：不告警',
    anyUnsupported(v(['a', 1, true], { items: [{ type: 'string' }], additionalItems: false })),
    false
  ),
  eq(
    'additionalItems + items 数组且元素合法：不告警',
    anyUnsupported(v(['a', 1], { items: [{ type: 'string' }], additionalItems: false })),
    false
  ),

  /* ── 已实现关键字不得误报 ── */
  eq(
    'type/properties/required（已实现）不误报',
    anyUnsupported(v({ a: 1 }, { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] })),
    false
  ),
  eq(
    'dependentRequired（已实现）不误报',
    anyUnsupported(v({ a: 1 }, { dependentRequired: { a: ['b'] } })),
    false
  ),
  eq(
    'dependentSchemas（已实现）不误报',
    anyUnsupported(v({ a: 1 }, { dependentSchemas: { a: { required: ['b'] } } })),
    false
  ),
  eq(
    'prefixItems + items（已实现）不误报',
    anyUnsupported(v(['a', 1], { prefixItems: [{ type: 'string' }], items: { type: 'number' } })),
    false
  ),
  eq('contains（已实现）不误报', anyUnsupported(v([1], { contains: { type: 'number' } })), false),
  eq(
    'minContains/maxContains 未出现时不误报',
    anyUnsupported(v([1], { contains: { type: 'number' } })),
    false
  )
]
