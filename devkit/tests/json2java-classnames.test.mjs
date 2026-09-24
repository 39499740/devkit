/**
 * P2-3 回归：json2java 内部类名唯一化。
 *
 * 此前 javaFromJson 只对字段名去重，未对类名去重：
 * - {"a-b":{"x":1},"a_b":{"y":2}} 会产出两个 `public class AB`；
 * - {"order":{"id":1}} 且 className=Order 时外层与内层都叫 Order。
 * 两种产物都无法编译。现在类名在文件级去重（冲突追加序号），
 * 且字段类型 / getter / setter 与嵌套引用都使用去重后的类名。
 * 同时回归正常输入输出不变（{"a":1} → Order）。
 */
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

const JAVA_BUILTIN = new Set(['long', 'double', 'int', 'boolean', 'String', 'Object', 'List'])

const classesOf = (code) => [...code.matchAll(/public\s+class\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
const fieldTypesOf = (code) =>
  [...code.matchAll(/private\s+([^;]+?)\s+[A-Za-z_$][\w$]*;/g)].map((m) => m[1].trim())
/** 字段类型里引用到的自定义类名（剔除 Java 内置类型） */
const referencedClasses = (code) =>
  fieldTypesOf(code)
    .flatMap((t) => [...t.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))
    .filter((n) => !JAVA_BUILTIN.has(n))

async function buildCases() {
  const cases = []
  const gen = (json, config) => runStep(createStep('json2java', config), json, 0)

  /* ── 1. 同层字段归一化后类名相同：a-b / a_b 都得到 AB ── */
  const dup = await gen('{"a-b":{"x":1},"a_b":{"y":2}}')
  cases.push(check('同层重名：状态 ok', () => dup.status === 'ok'))
  cases.push(eq('同层重名：类名唯一（Order/AB/AB2）', classesOf(dup.output).sort(), ['AB', 'AB2', 'Order']))
  cases.push(
    check('同层重名：字段类型引用去重后的类名', () =>
      dup.output.includes('private AB aB;') && dup.output.includes('private AB2 aB2;')
    )
  )
  cases.push(
    check('同层重名：getter/setter 跟随去重后的类名', () =>
      dup.output.includes('getAB()') && dup.output.includes('setAB(AB aB)') &&
      dup.output.includes('getAB2()') && dup.output.includes('setAB2(AB2 aB2)')
    )
  )
  cases.push(
    check('同层重名：每个引用都有对应类声明', () => {
      const declared = classesOf(dup.output)
      return referencedClasses(dup.output).every((n) => declared.includes(n))
    })
  )
  cases.push(check('同层重名：note 提示类名已改名', () => dup.note.includes('重复')))

  /* ── 2. 内部类与外层类同名（{"order":…} + className=Order）── */
  const outer = await gen('{"order":{"id":1}}', { className: 'Order' })
  cases.push(eq('外层同名：类名唯一（Order/Order2）', classesOf(outer.output).sort(), ['Order', 'Order2']))
  cases.push(check('外层同名：字段引用内部类 Order2', () => outer.output.includes('private Order2 order;')))
  cases.push(check('外层同名：内部类保留 id 字段', () => outer.output.includes('private long id;')))
  cases.push(
    check('外层同名：每个引用都有对应类声明', () => {
      const declared = classesOf(outer.output)
      return referencedClasses(outer.output).every((n) => declared.includes(n))
    })
  )

  /* ── 3. 多层嵌套同名：Order → Order2 → Order3 ── */
  const deep = await gen('{"order":{"order":{"id":1}}}', { className: 'Order' })
  cases.push(eq('多层同名：类名唯一（Order/Order2/Order3）', classesOf(deep.output).sort(), ['Order', 'Order2', 'Order3']))
  cases.push(check('多层同名：外层引用 Order2、内层引用 Order3', () =>
    deep.output.includes('private Order2 order;') && deep.output.includes('private Order3 order;')
  ))

  /* ── 4. 同名键在数组元素类型上也要去重 ── */
  const arr = await gen('{"a-b":[{"x":1}],"a_b":[{"y":2}]}')
  cases.push(eq('数组重名：类名唯一（Order/AB/AB2）', classesOf(arr.output).sort(), ['AB', 'AB2', 'Order']))
  cases.push(
    check('数组重名：泛型引用去重后的类名', () =>
      arr.output.includes('private List<AB> aB;') && arr.output.includes('private List<AB2> aB2;')
    )
  )
  cases.push(
    check('数组重名：每个引用都有对应类声明', () => {
      const declared = classesOf(arr.output)
      return referencedClasses(arr.output).every((n) => declared.includes(n))
    })
  )

  /* ── 5. 综合输入：所有类名两两不同 ── */
  const mixed = await gen('{"order":{"order":{"id":1}},"a-b":{"x":1},"a_b":{"y":2}}', { className: 'Order' })
  cases.push(
    check('综合输入：类名全部唯一', () => {
      const declared = classesOf(mixed.output)
      return declared.length === new Set(declared).size
    })
  )

  /* ── 6. 正常输入输出不变 ── */
  const normal = await gen('{"a":1}')
  cases.push(
    check('正常输入：默认类名 Order 与字段不变', () =>
      normal.status === 'ok' && normal.output.includes('public class Order') && normal.output.includes('private long a;')
    )
  )
  cases.push(eq('正常输入：只有一个类', classesOf(normal.output), ['Order']))
  cases.push(eq('正常输入：无去重告警', normal.note.includes('重复'), false))

  const nested = await gen('{"user":{"name":"x","age":30},"tags":["a","b"]}')
  cases.push(
    check('正常嵌套：类名与字段不变', () =>
      nested.output.includes('public class User') &&
      nested.output.includes('private User user;') &&
      nested.output.includes('private List<String> tags;')
    )
  )
  cases.push(eq('正常嵌套：只有 Order/User 两个类', classesOf(nested.output).sort(), ['Order', 'User']))

  return cases
}

export const cases = await buildCases()
