/**
 * JSON 深度一致性回归（盲测 P3-1）：
 * - JSON_MAX_NESTING_DEPTH = 2500：parseJson 接受 ≤2500 层的合法 JSON；
 * - 旧 stringifyJson 为递归实现，约 2000~2400 层即抛
 *   `RangeError: Maximum call stack size exceeded`，被调用方兜底成误导性的「JSON 语法错误」；
 * - 现 stringifyJson / minifyJson 改为显式栈迭代，可承受与 parseJson 相同的深度；
 * - 本文件断言：接近上限的深嵌套 JSON 能 parse 且 stringify / minify 往返一致（含 RawNumber 原文保真），
 *   DEPTH+1 层统一给出中文「嵌套层级过深」而非英文 RangeError；并回归浅层逐字节输出。
 */
import { JSON_MAX_NESTING_DEPTH, minifyJson, parseJson, stringifyJson } from '../app/utils/json.ts'
import { check, eq, throws } from './helpers.mjs'

const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)
const DEPTH = JSON_MAX_NESTING_DEPTH

/** 接近上限的深嵌套输入（均为已压缩文本，便于与 minify 输出逐字节比对） */
const deepArr = '['.repeat(DEPTH) + ']'.repeat(DEPTH)
const deepObjBig = '{"a":'.repeat(DEPTH) + '12345678901234567890' + '}'.repeat(DEPTH)
const deepObj = '{"a":'.repeat(DEPTH) + '1' + '}'.repeat(DEPTH)

export const cases = []

/* ── 核心：parseJson 接受的深度，stringifyJson / minifyJson 也能处理 ── */
cases.push(eq(`${DEPTH} 层数组 minify 往返逐字节一致`, minifyJson(parseJson(deepArr).value), deepArr))
cases.push(
  check(`${DEPTH} 层数组 stringify 不再栈溢出`, () => {
    const out = stringifyJson(parseJson(deepArr).value, 2)
    return typeof out === 'string' && out.startsWith('[\n') && out.endsWith('\n]')
  })
)
cases.push(
  check(`${DEPTH} 层对象 stringify 成功且重新解析后 minify 与原文一致`, () => {
    const out = stringifyJson(parseJson(deepObj).value, 2)
    return minifyJson(parseJson(out).value) === deepObj
  })
)
cases.push(eq(`${DEPTH} 层对象（含大整数）minify 往返逐字节一致`, minifyJson(parseJson(deepObjBig).value), deepObjBig))
cases.push(
  check(`${DEPTH} 层对象 stringify 保留大整数原文（不带引号）`, () => {
    const out = stringifyJson(parseJson(deepObjBig).value, 2)
    return out.includes('12345678901234567890') && !out.includes('"12345678901234567890"')
  })
)
cases.push(
  check(`${DEPTH} 层对象 tab 缩进 stringify 成功`, () => {
    const out = stringifyJson(parseJson(deepObj).value, '\t')
    return out.startsWith('{\n\t"a": ') && out.endsWith('\n}')
  })
)

/* ── 边界：DEPTH-1 可解析，DEPTH+1 统一中文「嵌套层级过深」 ── */
cases.push(
  check(`${DEPTH - 1} 层仍可 parse + stringify + minify`, () => {
    const s = '['.repeat(DEPTH - 1) + ']'.repeat(DEPTH - 1)
    const value = parseJson(s).value
    return minifyJson(value) === s && stringifyJson(value, 2).length > 0
  })
)
const over = '['.repeat(DEPTH + 1) + ']'.repeat(DEPTH + 1)
cases.push(throws(`parseJson ${DEPTH + 1} 层抛中文错误`, () => parseJson(over), /嵌套层级过深/))
cases.push(
  check(`parseJson ${DEPTH + 1} 层错误为中文而非英文 RangeError / 「JSON 语法错误」`, () => {
    try {
      parseJson(over)
      return false
    } catch (e) {
      return hasChinese(e.message) && !/Maximum call stack/i.test(e.message) && !e.message.includes('JSON 语法错误')
    }
  })
)

/* ── stringify / minify 本身不再有递归深度限制（迭代实现，> 上限也可序列化） ── */
cases.push(
  check('超过解析上限的深结构仍可 stringify / minify（显式栈迭代）', () => {
    const extra = 500
    let v = 1
    for (let i = 0; i < DEPTH + extra; i++) v = [v]
    const mini = minifyJson(v)
    const pretty = stringifyJson(v, 2)
    return mini.length === (DEPTH + extra) * 2 + 1 && mini.startsWith('[') && pretty.length > mini.length
  })
)

/* ── 浅层逐字节保真回归（迭代实现需与旧递归实现输出完全一致） ── */
cases.push(
  eq(
    '浅层对象 stringify 缩进 2 精确输出',
    stringifyJson(parseJson('{"a":1,"b":[1,2],"c":{}}').value, 2),
    '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {}\n}'
  )
)
cases.push(eq('浅层对象 minify 精确输出', minifyJson(parseJson('{"a":1,"b":[1,2],"c":{}}').value), '{"a":1,"b":[1,2],"c":{}}'))
cases.push(eq('indent 0 仍换行（与旧行为一致）', stringifyJson(parseJson('{"a":[1]}').value, 0), '{\n"a": [\n1\n]\n}'))
cases.push(eq('tab 缩进精确输出', stringifyJson(parseJson('{"a":1}').value, '\t'), '{\n\t"a": 1\n}'))
cases.push(eq('空容器', minifyJson(parseJson('[[],{}]').value), '[[],{}]'))
cases.push(eq('null / 布尔 / 数字 / 空字符串混合', minifyJson(parseJson('[null,true,false,0,-1.5,"",[]]').value), '[null,true,false,0,-1.5,"",[]]'))

// Unicode / 控制字符 / 转义：输入本身即压缩文本，minify 应逐字节还原
const escaped = '{"s":"中文\\t\\"q\\"\\\\","n":"\\u0000","nl":"a\\nb"}'
cases.push(eq('Unicode 与转义逐字节保真', minifyJson(parseJson(escaped).value), escaped))

// RawNumber 原文保真
cases.push(eq('RawNumber 原文保留（minify）', minifyJson(parseJson('{"id":12345678901234567890,"n":1}').value), '{"id":12345678901234567890,"n":1}'))
cases.push(eq('RawNumber 原文保留（stringify，不带引号）', stringifyJson(parseJson('{"id":12345678901234567890}').value, 2), '{\n  "id": 12345678901234567890\n}'))

// 字面量 "__proto__" 键必须保留为普通自有键
cases.push(eq('字面量 "__proto__" 键保留', minifyJson(parseJson('{"__proto__":1,"a":2}').value), '{"__proto__":1,"a":2}'))

// 直接传入的非常规值：与旧实现的 default 分支一致
cases.push(eq('非有限数字序列化为 null', minifyJson([NaN, Infinity, -Infinity]), '[null,null,null]'))
cases.push(eq('undefined 序列化为 null', minifyJson([undefined]), '[null]'))
