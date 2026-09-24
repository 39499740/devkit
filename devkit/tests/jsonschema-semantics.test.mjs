/**
 * JSON Schema 语义回归（P2-3 / P2-4）：
 * - 数值关键字（minimum / maximum / exclusiveMinimum / exclusiveMaximum / multipleOf）
 *   只在实例类型匹配时生效：仅 number / RawNumber，不作用于 string / boolean / array / object / null；
 * - const / enum / uniqueItems 使用键序无关的深比较，对象 {a,b} 与 {b,a} 视为相等。
 */
import { validateInstance } from '../app/utils/jsonschema.ts'
import { parseJson } from '../app/utils/json.ts'
import { check, eq } from './helpers.mjs'

const v = (inst, schema) => validateInstance(inst, schema, { strict: true })

export const cases = [
  /* ── P2-3：数值关键字不作用于字符串 ── */
  eq('字符串 "3" 不被 minimum 约束', v('3', { type: 'string', minimum: 5 }).valid, true),
  eq('字符串 "3" 对 minimum=5 无错误', v('3', { type: 'string', minimum: 5 }).errors.length, 0),
  eq('字符串 "7" 不被 multipleOf 约束', v('7', { minLength: 1, multipleOf: 2 }).valid, true),
  eq('字符串 "7" 不被 maximum 约束', v('7', { type: 'string', maximum: 3 }).valid, true),
  eq('字符串 "0" 不被 exclusiveMinimum 约束', v('0', { type: 'string', exclusiveMinimum: 5 }).valid, true),
  eq('字符串 "9" 不被 exclusiveMaximum 约束', v('9', { type: 'string', exclusiveMaximum: 5 }).valid, true),

  /* ── P2-3：数值关键字仍作用于 number ── */
  eq('number 5 对 minimum=5 通过', v(5, { minimum: 5 }).valid, true),
  eq('number 3 对 minimum=5 失败', v(3, { minimum: 5 }).valid, false),
  eq('number 3 对 minimum=5 报 minimum', v(3, { minimum: 5 }).errors[0]?.keyword, 'minimum'),
  eq('number 4 对 multipleOf=2 通过', v(4, { multipleOf: 2 }).valid, true),
  eq('number 3 对 multipleOf=2 失败', v(3, { multipleOf: 2 }).valid, false),
  eq('number 5 对 exclusiveMinimum=5 失败', v(5, { exclusiveMinimum: 5 }).valid, false),
  eq('number 6 对 exclusiveMinimum=5 通过', v(6, { exclusiveMinimum: 5 }).valid, true),
  eq('number 5 对 maximum=5 通过', v(5, { maximum: 5 }).valid, true),
  eq('number 6 对 maximum=5 失败', v(6, { maximum: 5 }).valid, false),
  eq('number 5 对 exclusiveMaximum=5 失败', v(5, { exclusiveMaximum: 5 }).valid, false),

  /* ── P2-3：数值关键字仍作用于 RawNumber（解析自 JSON）── */
  eq('RawNumber 3 对 minimum=5 失败', v(parseJson('3').value, { minimum: 5 }).valid, false),
  eq('RawNumber 5 对 minimum=5 通过', v(parseJson('5').value, { minimum: 5 }).valid, true),
  eq('RawNumber 7 对 multipleOf=2 失败', v(parseJson('7').value, { multipleOf: 2 }).valid, false),
  eq('RawNumber 大整数 1e21 对 minimum=5 通过', v(parseJson('1e21').value, { minimum: 5 }).valid, true),

  /* ── P2-3：数值关键字不作用于其它类型 ── */
  eq('boolean 不被 minimum 约束', v(true, { minimum: 5 }).valid, true),
  eq('null 不被 minimum 约束', v(null, { minimum: 5 }).valid, true),
  eq('array 不被 minimum 约束', v([1, 2], { minimum: 5 }).valid, true),
  eq('object 不被 minimum 约束', v({ a: 1 }, { minimum: 5 }).valid, true),

  /* ── 对应类型的计数关键字仍生效（回归）── */
  eq('minLength 仍作用于字符串', v('a', { minLength: 2 }).valid, false),
  eq('maxLength 仍作用于字符串', v('abc', { maxLength: 2 }).valid, false),
  eq('minItems 仍作用于数组', v([1], { minItems: 2 }).valid, false),
  eq('maxItems 仍作用于数组', v([1, 2, 3], { maxItems: 2 }).valid, false),
  eq('minProperties 仍作用于对象', v({ a: 1 }, { minProperties: 2 }).valid, false),
  eq('maxProperties 仍作用于对象', v({ a: 1, b: 2, c: 3 }, { maxProperties: 2 }).valid, false),

  /* ── P2-4：const 键序无关 ── */
  eq('const 对象键序不同仍相等', v({ a: 1, b: 2 }, { const: { b: 2, a: 1 } }).valid, true),
  eq('const 嵌套对象键序不同仍相等', v({ o: { a: 1, b: 2 } }, { const: { o: { b: 2, a: 1 } } }).valid, true),
  eq('const 对象值不同则失败', v({ a: 1, b: 2 }, { const: { b: 2, a: 9 } }).valid, false),
  eq('const 数组顺序敏感（顺序不同失败）', v([1, 2], { const: [2, 1] }).valid, false),
  eq('const 数组顺序相同通过', v([1, 2], { const: [1, 2] }).valid, true),
  eq('const 缺少键失败', v({ a: 1 }, { const: { a: 1, b: 2 } }).valid, false),

  /* ── P2-4：enum 键序无关 ── */
  eq('enum 对象键序不同仍命中', v({ a: 1, b: 2 }, { enum: [{ b: 2, a: 1 }] }).valid, true),
  eq('enum 数组含键序不同对象命中', v({ x: { a: 1, b: 2 } }, { enum: [{ x: { b: 2, a: 1 } }] }).valid, true),
  eq('enum 无匹配则失败', v({ a: 1 }, { enum: [{ b: 1 }] }).valid, false),

  /* ── P2-4：uniqueItems 键序无关 ── */
  eq('uniqueItems 键序不同的重复对象判重复', v([{ a: 1, b: 2 }, { b: 2, a: 1 }], { uniqueItems: true }).valid, false),
  eq(
    'uniqueItems 嵌套键序不同的重复对象判重复',
    v([{ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } }], { uniqueItems: true }).valid,
    false
  ),
  eq('uniqueItems 真正不同的对象不判重复', v([{ a: 1 }, { a: 2 }], { uniqueItems: true }).valid, true),
  eq('uniqueItems 数组元素按序比较（[1,2] 与 [2,1] 不重复）', v([[1, 2], [2, 1]], { uniqueItems: true }).valid, true),
  eq('uniqueItems 数字按数值判重（1 与 1.0）', v([parseJson('1').value, parseJson('1.0').value], { uniqueItems: true }).valid, false),
  eq('uniqueItems 普通重复字符串仍判重复', v(['a', 'a'], { uniqueItems: true }).valid, false),
  eq('uniqueItems 全不同通过', v(['a', 'b'], { uniqueItems: true }).valid, true),

  /* ── 回归：RawNumber 与字符串 const 按原文相等（engine-guards 依赖）── */
  check('RawNumber 与字符串形式 const 仍相等', () => {
    const inst = parseJson('{"id":12345678901234567890}').value
    const r = validateInstance(inst, { type: 'object', properties: { id: { const: '12345678901234567890' } } }, { strict: true })
    return r.valid === true
  }),
  check('RawNumber 与不同数字 const 失败', () => {
    const inst = parseJson('{"id":1}').value
    const r = validateInstance(inst, { type: 'object', properties: { id: { const: 2 } } }, { strict: true })
    return r.valid === false
  }),
  check('数字 1 与 const 字符串 "1" 不相等（类型不同）', () => v(1, { const: '1' }).valid === false)
]

void check
