/**
 * P2-3 回归：2020-12 的 prefixItems + items 语义，以及 draft-07 元组 items + additionalItems。
 *
 * - 2020-12：prefixItems 逐元素校验前 N 项，items 只作用于其后的剩余元素（起点 N）。
 *   既实现曾把 items 应用到全部元素，导致 ['a',1,2] + {prefixItems:[string,number], items:number}
 *   被误判 invalid（错误 type@$[0]）。
 * - draft-07：items 为数组时是元组写法，additionalItems 只作用于越界的额外元素；
 *   additionalItems:false 时越界即错。此前 additionalItems 未实现。
 */
import { validateInstance } from '../app/utils/jsonschema.ts'
import { check, eq } from './helpers.mjs'

const v = (inst, schema) => validateInstance(inst, schema, { strict: true })
const paths = (inst, schema) => v(inst, schema).errors.map((e) => e.path)

/* 2020-12 常见写法：前两项为 string / number，其余为 number */
const tuple2020 = { prefixItems: [{ type: 'string' }, { type: 'number' }], items: { type: 'number' } }
/* draft-07 元组写法（items 为数组） */
const tuple07 = { items: [{ type: 'string' }, { type: 'number' }] }

export const cases = [
  /* ── 两个核心示例：items 不回头校验 prefixItems 覆盖的前缀 ── */
  eq("['a',1,2] 通过（items 只校验 $[2]）", v(['a', 1, 2], tuple2020).valid, true),
  eq("['a',1,2] 不产生 type@$[0] 误报", v(['a', 1, 2], tuple2020).errors.length, 0),
  eq("['a',1,'x'] 失败且仅报 $[2]", paths(['a', 1, 'x'], tuple2020), ['$[2]']),
  eq("['a',1,'x'] 错误 keyword 为 type", v(['a', 1, 'x'], tuple2020).errors[0]?.keyword, 'type'),
  eq("[1,1,2] 由 prefixItems 报 $[0]", paths([1, 1, 2], tuple2020), ['$[0]']),
  eq("['a','b',2] 由 prefixItems 报 $[1]", paths(['a', 'b', 2], tuple2020), ['$[1]']),

  /* ── prefixItems 覆盖的前缀不再被 items 重复校验 ── */
  check('prefixItems 已通过的前缀不因 items 再报错', () => {
    const r = v(['a'], { prefixItems: [{ type: 'string' }], items: { type: 'number' } })
    return r.valid === true
  }),
  eq('prefixItems 通过 + 空余项时 items 无对象可校验', v(['a'], { prefixItems: [{ type: 'string' }], items: { type: 'number' } }).errors.length, 0),

  /* ── prefixItems 无 items：多余元素不受约束 ── */
  eq("prefixItems 无 items，['a',1] 通过", v(['a', 1], { prefixItems: [{ type: 'string' }, { type: 'number' }] }).valid, true),
  eq('prefixItems 无 items，前缀类型不符仍失败', paths([1, 1], { prefixItems: [{ type: 'string' }, { type: 'number' }] }), ['$[0]']),
  eq('prefixItems 无 items，越界元素放行', v(['a', 1, 'x', {}, null], { prefixItems: [{ type: 'string' }, { type: 'number' }] }).valid, true),
  eq('prefixItems 无 items，短数组只校验已存在元素', v(['a'], { prefixItems: [{ type: 'string' }, { type: 'number' }] }).valid, true),

  /* ── items:false 只作用于 prefixItems 之后的剩余元素 ── */
  eq("items:false，['a',1] 恰好等于前缀长度通过", v(['a', 1], { prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }).valid, true),
  eq("items:false，['a',1,2] 越界失败", v(['a', 1, 2], { prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }).valid, false),
  eq("items:false，['a',1,2] 报 $[2]", paths(['a', 1, 2], { prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }), ['$[2]']),
  eq("items:false，['a',1,2,3] 报两个越界元素", paths(['a', 1, 2, 3], { prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }), ['$[2]', '$[3]']),

  /* ── 回归：无 prefixItems 时 items 仍覆盖全部元素 ── */
  eq('items:false 非空数组仍失败', v([1], { type: 'array', items: false }).valid, false),
  eq('items:false 空数组仍通过', v([], { type: 'array', items: false }).valid, true),
  eq('items:false 每个元素都报错', v([1, 2], { type: 'array', items: false }).errors.length, 2),
  eq('items:true 非空数组通过', v([1, 2], { type: 'array', items: true }).valid, true),
  eq('普通 items 对象 schema 仍逐个校验（通过）', v([1, 2], { type: 'array', items: { type: 'number' } }).valid, true),
  eq('普通 items 对象 schema 仍逐个校验（失败）', paths(['a'], { type: 'array', items: { type: 'number' } }), ['$[0]']),

  /* ── draft-07 元组 items:[...] + additionalItems ── */
  eq("draft-07 元组，['a',1] 通过", v(['a', 1], tuple07).valid, true),
  eq('draft-07 元组，元素类型不符失败', paths([1, 1], tuple07), ['$[0]']),
  eq("draft-07 元组，无 additionalItems 时越界放行", v(['a', 1, true], tuple07).valid, true),
  eq('draft-07 元组，additionalItems:true 越界放行', v(['a', 1, true], { ...tuple07, additionalItems: true }).valid, true),
  eq("draft-07 元组，additionalItems:false 越界失败", v(['a', 1, true], { ...tuple07, additionalItems: false }).valid, false),
  eq("draft-07 元组，additionalItems:false 报 $[2]", paths(['a', 1, true], { ...tuple07, additionalItems: false }), ['$[2]']),
  eq("draft-07 元组，additionalItems:false 多个越界逐个报", paths(['a', 1, 2, 3], { ...tuple07, additionalItems: false }), ['$[2]', '$[3]']),
  eq('draft-07 元组，additionalItems schema 校验越界元素（通过）', v(['a', 1, true], { ...tuple07, additionalItems: { type: 'boolean' } }).valid, true),
  eq('draft-07 元组，additionalItems schema 校验越界元素（失败）', paths(['a', 1, 2], { ...tuple07, additionalItems: { type: 'boolean' } }), ['$[2]']),
  eq('draft-07 元组，短数组只校验已存在元素', v(['a'], tuple07).valid, true),

  /* ── additionalItems 仅在 items 为数组时生效 ── */
  eq('items 为对象时 additionalItems 被忽略', v([1, 2, 3], { items: { type: 'number' }, additionalItems: false }).valid, true),
  eq('items:false 时 additionalItems 被忽略', v([], { items: false, additionalItems: false }).valid, true)
]

void check
