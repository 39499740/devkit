/**
 * P1-1 / P2-2 回归：JSON Schema 原型链敏感的成员判断 + multipleOf 大整数精度。
 *
 * P1-1：required / properties / dependentRequired / $ref 等「成员是否存在」的判断改为 own-property，
 *   constructor / toString / hasOwnProperty / __proto__ 等原型成员不再被误判为已声明；
 * P1-2：inferNode 用 defineProperty 落 "__proto__" 键，推断出的 properties 不丢键、与 required 一致；
 * P2-2：multipleOf 两侧都能精确表示为整数时走 BigInt 精确取模，1e9 量级不再因浮点容差放过余数 1。
 */
import { validateInstance, inferSchema } from '../app/utils/jsonschema.ts'
import { parseJson } from '../app/utils/json.ts'
import { check, eq } from './helpers.mjs'

const v = (inst, schema) => validateInstance(inst, schema, { strict: true })
const PROTO_KEYS = ['constructor', 'toString', 'hasOwnProperty', '__proto__']
const raw = (text) => parseJson(text).value

/** 构造带指定自有键的实例：__proto__ 用对象字面量会改写原型，必须走 defineProperty */
function withKeys(keys) {
  const obj = {}
  for (const k of keys) {
    Object.defineProperty(obj, k, { value: 1, enumerable: true, writable: true, configurable: true })
  }
  return obj
}

export const cases = [
  /* ── required：原型成员不是「已存在」 ── */
  ...PROTO_KEYS.flatMap((key) => [
    eq(`required ['${key}'] 对 {} 判为缺少必填`, v({}, { type: 'object', required: [key] }).errors.map((e) => e.keyword), ['required']),
    eq(`required ['${key}'] 对含该自有键的实例通过`, v(withKeys([key]), { type: 'object', required: [key] }).valid, true)
  ]),

  /* ── properties / additionalProperties：原型键不当作已声明的属性 ── */
  check('{toString:5} + additionalProperties:false 明确失败且不抛内部错误', () => {
    const r = v({ toString: 5 }, { type: 'object', additionalProperties: false })
    return r.valid === false && r.errors.some((e) => e.keyword === 'additionalProperties' && e.path === '$.toString')
  }),
  check('{toString:5} + properties 不抛「Schema 不是对象」', () => {
    const r = v({ toString: 5 }, { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false })
    return r.valid === false && r.errors.every((e) => !/不是对象/.test(e.message))
  }),
  check('{constructor:5} 在 properties 声明后按自有键校验', () => {
    const r = v(withKeys(['constructor']), { type: 'object', properties: { constructor: { type: 'string' } }, additionalProperties: false })
    return r.valid === false && r.errors.some((e) => e.keyword === 'type' && e.path === '$.constructor')
  }),

  /* ── $ref：命中原型成员应报「引用不存在」，不成功也不抛内部错误 ── */
  ...['#/__proto__', '#/constructor'].flatMap((ref) => [
    check(`$ref '${ref}' 报引用不存在（不成功、不内部报错）`, () => {
      let r
      try {
        r = v(1, { $ref: ref })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return /不存在|引用/.test(msg) && !/不是对象/.test(msg)
      }
      return r.valid === false && r.errors.some((e) => /不存在|引用/.test(e.message))
    })
  ]),
  eq('合法 $ref 仍可解析', v(1, { definitions: { pos: { type: 'number' } }, $ref: '#/definitions/pos' }).valid, true),
  eq('合法 $ref 指向非数字仍失败', v('x', { definitions: { pos: { type: 'number' } }, $ref: '#/definitions/pos' }).valid, false),

  /* ── dependentRequired / dependentSchemas：按自有键判断 ── */
  eq('dependentRequired 的原型键对 {} 不触发', v({}, { type: 'object', dependentRequired: { constructor: ['toString'] } }).valid, true),
  check('dependentRequired 自有键触发且依赖键须为自有', () => {
    const r = v(withKeys(['constructor']), { type: 'object', dependentRequired: { constructor: ['toString'] } })
    return r.valid === false && r.errors.some((e) => e.keyword === 'dependentRequired')
  }),
  eq('dependentRequired 依赖键为自有键时通过', v(withKeys(['constructor', 'toString']), { type: 'object', dependentRequired: { constructor: ['toString'] } }).valid, true),
  eq('dependentSchemas 的原型键对 {} 不触发', v({}, { type: 'object', dependentSchemas: { constructor: { required: ['x'] } } }).valid, true),
  eq('dependentSchemas 自有键触发子 schema', v(withKeys(['constructor']), { type: 'object', dependentSchemas: { constructor: { required: ['x'] } } }).valid, false),

  /* ── multipleOf：整数精确取模（P2-2）── */
  eq('multipleOf 3 on 1000000000.0 为 false', v(raw('1000000000.0'), { multipleOf: 3 }).valid, false),
  eq('multipleOf 3 on 1000000001.0 为 false', v(raw('1000000001.0'), { multipleOf: 3 }).valid, false),
  eq('multipleOf 3 on 1000000002.0 为 true', v(raw('1000000002.0'), { multipleOf: 3 }).valid, true),
  eq('multipleOf 3 on number 1000000000 为 false', v(1000000000, { multipleOf: 3 }).valid, false),
  eq('multipleOf 3 on number 1000000002 为 true', v(1000000002, { multipleOf: 3 }).valid, true),
  eq('multipleOf 0.1 on 0.3 仍为 true（小数容差保留）', v(0.3, { multipleOf: 0.1 }).valid, true),
  eq('multipleOf 0.1 on 0.35 为 false', v(0.35, { multipleOf: 0.1 }).valid, false),

  /* ── inferNode：__proto__ 键不丢、required 与 properties 一致 ── */
  check('inferNode 不丢 __proto__ 键', () => {
    const inferred = inferSchema(JSON.parse('{"__proto__":{"x":1}}'), { draft: '2020-12', strict: false })
    return Object.keys(inferred.properties).length === 1 && Object.keys(inferred.properties)[0] === '__proto__'
  }),
  check('inferNode required 与 properties 键一致', () => {
    const inferred = inferSchema(JSON.parse('{"__proto__":{"x":1}}'), { draft: '2020-12', strict: false })
    return JSON.stringify(inferred.required) === JSON.stringify(Object.keys(inferred.properties))
  }),
  check('inferNode __proto__ 子 schema 可访问', () => {
    const inferred = inferSchema(JSON.parse('{"__proto__":{"x":1}}'), { draft: '2020-12', strict: false })
    const sub = inferred.properties['__proto__']
    return !!sub && sub.type === 'object' && sub.properties.x.type === 'integer'
  })
]

void check
