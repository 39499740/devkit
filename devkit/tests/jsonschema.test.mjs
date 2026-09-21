import { validateInstance, inferSchema } from '../app/utils/jsonschema.ts'
import { check, eq } from './helpers.mjs'

const designSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    user: {
      type: 'object',
      required: ['name', 'age', 'email'],
      properties: { age: { type: 'integer' }, email: { type: 'string', format: 'email' } }
    },
    orders: {
      type: 'array',
      items: { required: ['amount'], properties: { amount: { type: 'number' } } }
    }
  }
}

const designDoc = {
  user: { id: 'u-2048', name: '张三', age: '28', tags: ['vip', 'new'], createdAt: '2024-03-11T09:20:00Z' },
  orders: [
    { id: 'o-1001', amount: 199.0, status: 'paid', items: [{ sku: 'A-1', qty: 2 }] },
    { id: 'o-1002', amount: null, status: 'pending', items: [] }
  ],
  source: 'app-ios'
}

export const cases = [
  // 设计稿内置示例：必须恰好 3 个错误
  eq('设计稿示例 3 个错误', validateInstance(designDoc, designSchema, { strict: true }).errors.map((e) => e.path), [
    '$.user.email',
    '$.user.age',
    '$.orders[1].amount'
  ]),

  // anyOf：命中一个分支就是合法（回归：曾经把合法数据判错）
  eq('anyOf 命中 number 分支', validateInstance(123, { anyOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true }).valid, true),
  eq('anyOf 命中 string 分支', validateInstance('abc', { anyOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true }).valid, true),
  eq('anyOf 全不命中才失败', validateInstance(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true }).valid, false),
  check('anyOf 失败时给出分支原因', () => {
    const r = validateInstance(true, { anyOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true })
    return r.errors.length >= 2 && r.errors[0].keyword === 'anyOf' && /分支 1 未通过/.test(r.errors[1].message)
  }),

  // oneOf：恰好一个分支
  eq('oneOf 恰好命中', validateInstance(123, { oneOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true }).valid, true),
  eq('oneOf 命中两个时失败', validateInstance(3, { oneOf: [{ type: 'integer' }, { type: 'number' }] }, { strict: true }).valid, false),
  check('oneOf 命中多个提示分支号', () => {
    const r = validateInstance(3, { oneOf: [{ type: 'integer' }, { type: 'number' }] }, { strict: true })
    return r.errors.length === 1 && /实际通过 2 个（分支 1、2）/.test(r.errors[0].message)
  }),

  // 嵌套 anyOf 与属性组合
  eq(
    '属性里的 anyOf 不影响其他字段',
    validateInstance({ a: 1, b: 'x' }, { type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'number' }] }, b: { type: 'string' } } }, { strict: true }).valid,
    true
  ),
  eq(
    '数组元素 anyOf 通过时不报错',
    validateInstance([1, 'a'], { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } }, { strict: true }).valid,
    true
  ),

  // allOf：不通过时上报失败分支的真实错误
  check('allOf 失败上报子分支错误', () => {
    const r = validateInstance({ a: 1 }, { allOf: [{ required: ['b'] }, { required: ['c'] }] }, { strict: true })
    return (
      !r.valid &&
      r.errors.some((e) => e.keyword === 'allOf') &&
      r.errors.filter((e) => e.keyword === 'required').length === 2
    )
  }),
  eq('allOf 全部通过', validateInstance({ a: 1 }, { allOf: [{ required: ['a'] }, { properties: { a: { type: 'number' } } }] }, { strict: true }).valid, true),

  // not / if-then-else
  eq('not 命中排除条件时失败', validateInstance('x', { not: { type: 'string' } }, { strict: true }).valid, false),
  eq('not 不命中时通过', validateInstance(1, { not: { type: 'string' } }, { strict: true }).valid, true),
  eq(
    'if/then 命中 then',
    validateInstance({ kind: 'a', v: 'x' }, { if: { properties: { kind: { const: 'a' } }, required: ['kind'] }, then: { properties: { v: { type: 'string' } } } }, { strict: true }).valid,
    true
  ),
  eq(
    'if/then 命中 then 失败',
    validateInstance({ kind: 'a', v: 1 }, { if: { properties: { kind: { const: 'a' } }, required: ['kind'] }, then: { properties: { v: { type: 'string' } } } }, { strict: true }).valid,
    false
  ),
  eq(
    'if 不命中走 else',
    validateInstance({ kind: 'b', v: 1 }, { if: { properties: { kind: { const: 'a' } }, required: ['kind'] }, then: { properties: { v: { type: 'string' } } }, else: { properties: { v: { type: 'number' } } } }, { strict: true }).valid,
    true
  ),

  // contains 隔离
  eq('contains 命中一个元素', validateInstance([{ a: 1 }, { a: 'x' }], { type: 'array', contains: { properties: { a: { type: 'number' } }, required: ['a'] } }, { strict: true }).valid, true),
  eq('contains 全不命中失败', validateInstance([{ a: 'x' }], { type: 'array', contains: { properties: { a: { type: 'number' } }, required: ['a'] } }, { strict: true }).valid, false),

  // 其他关键字回归
  eq('additionalProperties=false 报未声明字段', validateInstance({ a: 1, b: 2 }, { type: 'object', properties: { a: {} }, additionalProperties: false }, { strict: true }).errors.map((e) => e.path), ['$.b']),
  eq('format 严格模式计错', validateInstance('nope', { type: 'string', format: 'email' }, { strict: true }).valid, false),
  eq('format 非严格模式仅提示', validateInstance('nope', { type: 'string', format: 'email' }, { strict: false }).valid, true),
  check('format 非严格模式产生警告', () => validateInstance('nope', { type: 'string', format: 'email' }, { strict: false }).warnings.length === 1),
  eq('未知 format 跳过并提示', validateInstance('x', { type: 'string', format: 'custom-thing' }, { strict: true }).warnings.length, 1),
  eq(
    '失败分支的 format 提示不泄漏到最终警告',
    validateInstance('abc', { anyOf: [{ type: 'string', format: 'custom-thing', minLength: 10 }, { type: 'number' }] }, { strict: true }).warnings.length,
    0
  ),

  // 推断
  eq('推断 integer/number', inferSchema({ a: 1, b: 1.5 }, { draft: '2020-12', strict: false }).properties.a.type, 'integer'),
  eq('推断 number', inferSchema({ a: 1, b: 1.5 }, { draft: '2020-12', strict: false }).properties.b.type, 'number'),
  eq('严格模式推断加 additionalProperties', inferSchema({ a: 1 }, { draft: '2020-12', strict: true }).additionalProperties, false),
  eq('推断 $schema 2020-12', inferSchema({}, { draft: '2020-12', strict: false }).$schema, 'https://json-schema.org/draft/2020-12/schema')
]

void check
