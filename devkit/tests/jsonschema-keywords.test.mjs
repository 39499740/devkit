/**
 * JSON Schema 关键字语义修复回归（F4 / F5 / F7）：
 * - F4：布尔子 schema（false/true）是合法 schema，不能被真值短路忽略。
 *   覆盖 not / if-then-else / items / contains / propertyNames 等位置；
 * - F5：2020-12 中 $ref 只是普通关键字，解析目标后同级关键字必须继续生效；
 * - F7：minLength / maxLength 按 Unicode 码点计数，而不是 UTF-16 码元。
 */
import { validateInstance } from '../app/utils/jsonschema.ts'
import { eq, check } from './helpers.mjs'

const v = (inst, schema) => validateInstance(inst, schema, { strict: true })
const refSchema = (extra) => ({ $defs: { x: { type: 'string' } }, $ref: '#/$defs/x', ...extra })

export const cases = [
  /* ── F4：not 的布尔子 schema ── */
  eq('not:false 恒不排除（通过）', v(123, { not: false }).valid, true),
  eq('not:false 对字符串也通过', v('x', { not: false }).valid, true),
  eq('not:true 恒排除（失败）', v(123, { not: true }).valid, false),
  eq('not:true 报 not 错误', v(123, { not: true }).errors[0]?.keyword, 'not'),
  eq('not:{type:string} 命中字符串失败（对照）', v('x', { not: { type: 'string' } }).valid, false),
  eq('not:{type:string} 非字符串通过（对照）', v(1, { not: { type: 'string' } }).valid, true),

  /* ── F4：if / then / else 的布尔子 schema ── */
  eq('if:false 走 else（else 失败）', v(123, { if: false, else: { type: 'string' } }).valid, false),
  eq('if:false 走 else（else 通过）', v('abc', { if: false, else: { type: 'string' } }).valid, true),
  eq('if:false 不执行 then', v(123, { if: false, then: { type: 'string' } }).valid, true),
  eq('if:true 执行 then（then:false 失败）', v(123, { if: true, then: false }).valid, false),
  eq('if:true then:true 通过（对照）', v(123, { if: true, then: true }).valid, true),
  eq('if:false else:false 失败', v(123, { if: false, else: false }).valid, false),
  eq('if:true 无 then 时通过', v(123, { if: true }).valid, true),
  eq('if:false 无 else 时通过', v(123, { if: false }).valid, true),

  /* ── F4：items 的布尔子 schema ── */
  eq('items:false 非空数组失败', v([1], { type: 'array', items: false }).valid, false),
  eq('items:false 空数组通过', v([], { type: 'array', items: false }).valid, true),
  eq('items:false 每个元素都报错', v([1, 2], { type: 'array', items: false }).errors.length, 2),
  eq('items:true 非空数组通过（对照）', v([1, 2], { type: 'array', items: true }).valid, true),
  eq('items 对象 schema 仍生效（对照）', v([1], { type: 'array', items: { type: 'string' } }).valid, false),

  /* ── F4：contains 的布尔子 schema ── */
  eq('contains:false 非空数组失败', v([1], { type: 'array', contains: false }).valid, false),
  eq('contains:false 空数组也失败', v([], { type: 'array', contains: false }).valid, false),
  eq('contains:true 非空数组通过', v([1], { type: 'array', contains: true }).valid, true),
  eq('contains:true 空数组失败（无元素可命中）', v([], { type: 'array', contains: true }).valid, false),
  eq('contains 对象 schema 仍生效（对照）', v([1, 'x'], { type: 'array', contains: { type: 'number' } }).valid, true),

  /* ── F4：propertyNames / additionalProperties 的布尔子 schema ── */
  eq('propertyNames:false 有字段则失败', v({ a: 1 }, { type: 'object', propertyNames: false }).valid, false),
  eq('propertyNames:false 空对象通过', v({}, { type: 'object', propertyNames: false }).valid, true),
  eq('propertyNames:true 有字段也通过', v({ a: 1 }, { type: 'object', propertyNames: true }).valid, true),
  eq(
    'propertyNames 对象 schema 仍生效（对照）',
    v({ A: 1 }, { type: 'object', propertyNames: { pattern: '^[a-z]+$' } }).valid,
    false
  ),
  eq('additionalProperties:false 仍有报错（对照）', v({ a: 1, b: 2 }, { type: 'object', properties: { a: {} }, additionalProperties: false }).valid, false),
  eq('additionalProperties:true 对未知字段放行（对照）', v({ a: 1, b: 2 }, { type: 'object', properties: { a: {} }, additionalProperties: true }).valid, true),

  /* ── F5：$ref 同级关键字继续生效 ── */
  eq('$ref 同级 minLength 生效（"abc" 失败）', v('abc', refSchema({ minLength: 5 })).valid, false),
  eq('$ref 同级 minLength 生效（"abcdef" 通过）', v('abcdef', refSchema({ minLength: 5 })).valid, true),
  eq('$ref 同级 minLength 报 minLength', v('abc', refSchema({ minLength: 5 })).errors[0]?.keyword, 'minLength'),
  eq(
    '$ref 同级 maximum 与目标 minimum 同时生效（3 失败）',
    v(3, { $defs: { x: { minimum: 5 } }, $ref: '#/$defs/x', maximum: 10 }).valid,
    false
  ),
  eq(
    '$ref 同级 maximum 与目标 minimum 同时生效（20 失败）',
    v(20, { $defs: { x: { minimum: 5 } }, $ref: '#/$defs/x', maximum: 10 }).valid,
    false
  ),
  eq(
    '$ref 同级 maximum 与目标 minimum 同时生效（7 通过）',
    v(7, { $defs: { x: { minimum: 5 } }, $ref: '#/$defs/x', maximum: 10 }).valid,
    true
  ),
  eq('$ref 无兄弟关键字仍按目标校验（通过）', v('abc', refSchema()).valid, true),
  eq('$ref 无兄弟关键字仍按目标校验（失败）', v(123, refSchema()).valid, false),
  check('$ref 指向不存在时给出中文错误', () => {
    const r = v(1, { $ref: '#/$defs/missing' })
    return r.valid === false && r.errors[0]?.keyword === '$ref' && /不存在/.test(r.errors[0].message)
  }),

  /* ── F7：minLength / maxLength 按 Unicode 码点 ── */
  eq('maxLength:1 对单个 emoji 通过（码点）', v('😀', { maxLength: 1 }).valid, true),
  eq('maxLength:1 对单个 emoji 无错误', v('😀', { maxLength: 1 }).errors.length, 0),
  eq('minLength:1 对单个 emoji 通过（码点）', v('😀', { minLength: 1 }).valid, true),
  eq('minLength:2 对单个 emoji 失败（码点）', v('😀', { minLength: 2 }).valid, false),
  eq('minLength:2 对 "a😀" 通过（2 码点）', v('a😀', { minLength: 2 }).valid, true),
  eq('minLength:3 对 "a😀b" 通过（3 码点）', v('a😀b', { minLength: 3 }).valid, true),
  eq('maxLength:1 对 "ab" 失败（对照）', v('ab', { maxLength: 1 }).valid, false),
  eq('minLength:3 对 "ab" 失败（对照）', v('ab', { minLength: 3 }).valid, false),
  check('maxLength 报错信息按码点计数', () => {
    const r = v('😀😀', { maxLength: 1 })
    return r.valid === false && /当前 2/.test(r.errors[0]?.message ?? '')
  })
]
