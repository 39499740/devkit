/**
 * XML / CSV 原型链穿透与 `__proto__` 保真回归。
 *
 * 背景（已实证）：
 * - xml.ts 的 elementToJson 用 `obj[key] = …` 落键，键为 `__proto__` 时触发原型 setter，
 *   该键被静默丢弃且结果对象原型被改写；「同名兄弟节点」判定用 `obj[key]` 会读到原型成员
 *   （constructor / toString / valueOf），把普通元素名误判成「已有同名兄弟」。
 * - csv.ts 的 csvToJson 用 `obj[k] = …` 落键，表头含 `__proto__` 时该列被静默丢弃；
 *   getByPath 按路径取值会读到原型链（constructor / __proto__）。
 *
 * Node 没有 DOMParser，xmlToJson 无法在 Node 里跑完整解析。这里用「等价假 DOM 节点」
 * 直接调用导出的 elementToJson（只依赖 tagName / attributes / children / childNodes 四个成员），
 * 对落键与同名兄弟判定做单元级验证；完整 XML 解析仍由 tests/xml.browser.mjs 在浏览器覆盖。
 */
import { check, eq } from './helpers.mjs'
import { csvToJson, getByPath, jsonToCsv, setOwnKey } from '../app/utils/csv.ts'
import { assignChildValue, elementToJson } from '../app/utils/xml.ts'

/** 假 DOM 文本节点 */
const text = (value) => ({ nodeType: 3, nodeValue: value })
/** 假 DOM 元素节点（只实现 elementToJson 用到的四个成员） */
const el = (tagName, opts = {}) => ({
  tagName,
  attributes: opts.attributes ?? [],
  children: opts.children ?? [],
  childNodes: opts.childNodes ?? []
})

export const cases = []

/* ───────────────────────── CSV ───────────────────────── */

// CSV → JSON：表头为 __proto__ 时必须保留为普通自有键，且不污染结果对象原型
const protoCsv = csvToJson('__proto__,b\nx,1\n', { separator: ',', header: true, infer: false })
const protoRows = JSON.parse(protoCsv.json)
cases.push(
  check('csvToJson 表头 __proto__：JSON 输出保留该键（未被静默丢弃）', () =>
    protoCsv.json.includes('"__proto__"')
  )
)
cases.push(
  check('csvToJson 表头 __proto__：结果为自有键', () =>
    Object.prototype.hasOwnProperty.call(protoRows[0], '__proto__')
  )
)
cases.push(check('csvToJson 表头 __proto__：该列取值正确', () => protoRows[0]['__proto__'] === 'x'))
cases.push(check('csvToJson 表头 __proto__：同表其它列 b 正常', () => protoRows[0].b === '1'))
cases.push(
  check('csvToJson 表头 __proto__：结果对象原型仍为 Object.prototype', () =>
    Object.getPrototypeOf(protoRows[0]) === Object.prototype
  )
)

// 落键原语：直接验证不污染原型（JSON.parse 的往返会掩盖内部对象是否被污染）
const rawRow = {}
setOwnKey(rawRow, '__proto__', 'x')
cases.push(
  check('csv.setOwnKey 保留 __proto__ 为自有可枚举键', () =>
    Object.prototype.hasOwnProperty.call(rawRow, '__proto__') && rawRow['__proto__'] === 'x'
  )
)
cases.push(check('csv.setOwnKey 不改变结果对象原型', () => Object.getPrototypeOf(rawRow) === Object.prototype))

// getByPath：只认自有属性，命中原型成员视为不存在
cases.push(
  check('getByPath 原型成员 constructor → undefined', () => getByPath({ a: 1 }, 'constructor') === undefined)
)
cases.push(check('getByPath 原型成员 toString → undefined', () => getByPath({ a: 1 }, 'toString') === undefined))
cases.push(check('getByPath 原型成员 valueOf → undefined', () => getByPath({ a: 1 }, 'valueOf') === undefined))
cases.push(check('getByPath 原型成员 __proto__ → undefined', () => getByPath({ a: 1 }, '__proto__') === undefined))
cases.push(eq('getByPath 普通自有键 a → 1', getByPath({ a: 1 }, 'a'), 1))
cases.push(eq('getByPath 嵌套自有路径 a.b → 2', getByPath({ a: { b: 2 } }, 'a.b'), 2))
const ownProtoObj = {}
setOwnKey(ownProtoObj, '__proto__', { secret: 'ok' })
cases.push(eq('getByPath 命中自有 __proto__ 键下的值', getByPath(ownProtoObj, '__proto__.secret'), 'ok'))

// 回归：正常 CSV ⇄ JSON 行为不变
cases.push(
  eq(
    '回归 csvToJson 普通表头仍正确',
    JSON.parse(csvToJson('a,b\n1,2', { separator: ',', header: true, infer: false }).json),
    [{ a: '1', b: '2' }]
  )
)
cases.push(
  eq(
    '回归 jsonToCsv 普通嵌套字段仍正确取值',
    jsonToCsv('[{"user":{"name":"Ada"},"age":36}]', { separator: ',', header: true }).csv,
    'user.name,age\nAda,36'
  )
)
cases.push(eq('回归 getByPath 穿过数组视为不存在', getByPath({ a: [1] }, 'a.0'), undefined))

/* ───────────────────────── XML（等价假 DOM） ───────────────────────── */

// P2-1：__proto__ 作为元素名必须保留为自有键，且不污染结果对象原型
const protoXml = elementToJson(
  el('root', {
    children: [
      el('__proto__', { children: [el('x', { childNodes: [text('1')] })] }),
      el('a', { childNodes: [text('2')] })
    ]
  })
)
cases.push(
  check('elementToJson __proto__ 元素保留为自有键', () =>
    Object.prototype.hasOwnProperty.call(protoXml, '__proto__')
  )
)
cases.push(
  check('elementToJson 结果原型未被 __proto__ 改写', () => Object.getPrototypeOf(protoXml) === Object.prototype)
)
cases.push(
  check('elementToJson __proto__ 子结构正确', () => {
    const p = protoXml['__proto__']
    return !!p && p.x === '1'
  })
)
cases.push(check('elementToJson __proto__ 的兄弟元素 a 正常', () => protoXml.a === '2'))

const protoTwice = elementToJson(
  el('root', {
    children: [
      el('__proto__', { childNodes: [text('1')] }),
      el('__proto__', { childNodes: [text('2')] })
    ]
  })
)
cases.push(eq('elementToJson 同名 __proto__ 元素合并为数组', protoTwice['__proto__'], ['1', '2']))

// P2-3：constructor / toString / valueOf 作为元素名不得被误判成「已有同名兄弟」
const ctor = elementToJson(el('r', { children: [el('constructor', { childNodes: [text('a')] })] }))
cases.push(check('elementToJson constructor 元素产出标量而非 [原型, 值]', () => ctor.constructor === 'a'))
cases.push(eq('elementToJson constructor 结果是唯一自有键', Object.keys(ctor), ['constructor']))

const ctorTwice = elementToJson(
  el('r', {
    children: [el('constructor', { childNodes: [text('a')] }), el('constructor', { childNodes: [text('b')] })]
  })
)
cases.push(eq('elementToJson 同名 constructor 元素合并为数组', ctorTwice.constructor, ['a', 'b']))

const legacy = elementToJson(
  el('r', {
    children: [el('toString', { childNodes: [text('t')] }), el('valueOf', { childNodes: [text('v')] })]
  })
)
cases.push(check('elementToJson toString 元素产出标量', () => legacy.toString === 't'))
cases.push(check('elementToJson valueOf 元素产出标量', () => legacy.valueOf === 'v'))

// 落键原语：assignChildValue 对原型同名键的处理
const acc = {}
assignChildValue(acc, 'constructor', 'a')
cases.push(
  check('assignChildValue constructor 首次写自有标量', () => acc.constructor === 'a' && Object.keys(acc).length === 1)
)
assignChildValue(acc, 'constructor', 'b')
cases.push(eq('assignChildValue constructor 第二次合并为数组', acc.constructor, ['a', 'b']))

// 属性名 __proto__ 落为 @__proto__ 自有键
const attr = elementToJson(el('a', { attributes: [{ name: '__proto__', value: '1' }] }))
cases.push(
  check('elementToJson 属性 __proto__ 落为 @__proto__ 自有键', () =>
    Object.prototype.hasOwnProperty.call(attr, '@__proto__') && attr['@__proto__'] === '1'
  )
)

// 回归：既有正常 XML → JSON 语义不变
cases.push(
  eq(
    '回归 elementToJson 同名兄弟合并',
    elementToJson(
      el('r', { children: [el('b', { childNodes: [text('1')] }), el('b', { childNodes: [text('2')] })] })
    ).b,
    ['1', '2']
  )
)
cases.push(eq('回归 elementToJson 纯文本直接给字符串', elementToJson(el('a', { childNodes: [text('hi')] })), 'hi'))
cases.push(
  eq(
    '回归 elementToJson 带属性时文本写 #text',
    elementToJson(el('a', { attributes: [{ name: 'x', value: '1' }], childNodes: [text('hi')] })),
    { '@x': '1', '#text': 'hi' }
  )
)
cases.push(
  eq(
    '回归 elementToJson 混合内容保留词语间空格',
    elementToJson(
      el('p', { children: [el('b', { childNodes: [text('w')] })], childNodes: [text('Hello '), text('!')] })
    ),
    { b: 'w', '#text': 'Hello !' }
  )
)
