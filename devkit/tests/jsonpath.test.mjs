import { evalJsonPath, formatPath, parseJsonPath } from '../app/utils/jsonpath.ts'
import { evalJmesPath } from '../app/utils/jmespath.ts'
import { parseJson, toPlainJson } from '../app/utils/json.ts'
import { check, eq, throws } from './helpers.mjs'

const store = {
  store: {
    name: '城南书店',
    book: [
      { title: '深入理解 Java 虚拟机', price: 99, category: 'tech' },
      { title: '设计中的设计', price: 68, category: 'design' },
      { title: 'Vue.js 设计与实现', price: 119, category: 'tech' },
      { title: '代码整洁之道', price: 59, category: 'tech' }
    ],
    bicycle: { color: 'red', price: 399 }
  }
}

const jp = (expr, data = store) => evalJsonPath(data, expr)
const jm = (expr, data = store) => evalJmesPath(data, expr)

export const cases = [
  // JSONPath 设计稿示例：价格 < 100 的 3 本书
  eq('设计稿 JSONPath 命中 3 项', jp('$.store.book[?(@.price < 100)].title').matches.map((m) => m.value), [
    '深入理解 Java 虚拟机',
    '设计中的设计',
    '代码整洁之道'
  ]),
  eq('匹配路径带下标', jp('$.store.book[?(@.price < 100)].title').matches.map((m) => m.path), [
    '$.store.book[0].title',
    '$.store.book[1].title',
    '$.store.book[3].title'
  ]),
  eq('通配 + 字段', jp('$.store.book[*].title').matches.length, 4),
  eq('递归下降', jp('$..price').matches.length, 5),
  eq('切片', jp('$.store.book[0:2].title').matches.map((m) => m.value), ['深入理解 Java 虚拟机', '设计中的设计']),
  eq('负下标', jp('$.store.book[-1].title').matches[0].value, '代码整洁之道'),
  eq('联合', jp("$.store.book[0,2].title").matches.length, 2),
  eq('属性存在性过滤', jp('$.store.book[?(@.category)].title').matches.length, 4),
  eq('逻辑与过滤', jp('$.store.book[?(@.category == "tech" && @.price > 60)].title').matches.length, 2),
  eq('无匹配返回空', jp('$.store.missing').matches.length, 0),
  eq('formatPath 引用符', formatPath(['a', 'b-c']), "$.a['b-c']"),
  throws('缺少 $ 前缀报错', () => jp('store.book'), /必须以 \$ 开头/),
  throws('未闭合方括号报错', () => jp('$.store['), /没有对应的 \]/),
  throws('非法过滤字符报错', () => jp('$.store.book[?(@.price @ 1)]'), /./),

  // RawNumber 集成：带大整数/小数的 JSON 经 toPlainJson 后过滤才正确（回归：T44 曾经 0 命中）
  check('RawNumber 还原后过滤生效', () => {
    const raw = parseJson('{"list":[{"price":99},{"price":199}]}').value
    const plain = toPlainJson(raw)
    return evalJsonPath(plain, '$.list[?(@.price < 100)]').matches.length === 1
  }),
  check('超范围大整数保留为字符串', () => {
    const raw = parseJson('{"id":12345678901234567890}').value
    return typeof toPlainJson(raw).id === 'string'
  }),
  check('安全范围内数字还原为 number', () => {
    const raw = parseJson('{"price":199.0}').value
    return toPlainJson(raw).price === 199
  }),

  // JMESPath
  eq('JMESPath 通配投影', jm('store.book[*].title').matches.length, 4),
  eq('JMESPath 过滤（反引号字面量）', jm('store.book[?price < `100`].title').matches.length, 3),
  eq('JMESPath 函数 length', jm('length(store.book)').matches[0].value, 4),
  eq('JMESPath sort_by + 投影', jm('sort_by(store.book, &price)[*].title').matches[0].value, '代码整洁之道'),
  eq('JMESPath 多选对象', jm('store.book[?price < `100`].{t: title, p: price}').matches.length, 3),
  eq('JMESPath 管道', jm('store.book[*].price | max(@)').matches[0].value, 119),
  eq('JMESPath 根节点管道', jm('store.bicycle.price | to_string(@)').matches[0].value, '399'),
  check('JMESPath 不支持的函数明确报错', () => {
    try {
      jm('unknown_fn(store.book)')
      return false
    } catch (e) {
      return /暂不支持函数 unknown_fn/.test(e.message)
    }
  }),
  check('JMESPath 语法错误明确报错', () => {
    try {
      jm('store.book[?price <]')
      return false
    } catch (e) {
      return /语法错误|无法解析|不完整/.test(e.message)
    }
  }),

  // 解析结构
  eq('parseJsonPath 段数', parseJsonPath('$.store.book[*].title').length, 4),
  throws('parseJsonPath 非法字符', () => parseJsonPath('$ store'), /./)
]
void check
