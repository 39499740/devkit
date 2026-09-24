/**
 * P2-3 / P2-4 回归：
 * - validateInstance 增加总访问步数上限：嵌套组合关键字（如 {anyOf:[s,s]}）不再指数级递归，
 *   超限时中止并在 warnings 追加中文提示，正常 schema 不受影响、valid/errors 语义不变；
 * - jsonpath 的 `=~` 右值在编译前复用 regexRiskReason：命中灾难性回溯即抛中文错误，
 *   安全正则与非法正则的既有行为保持。
 *
 * 注意：危险正则只用静态判定触发，绝不真正执行（Node 无 Worker，同步执行会卡死）。
 */
import { validateInstance } from '../app/utils/jsonschema.ts'
import { evalJsonPath } from '../app/utils/jsonpath.ts'
import { check, eq, throws } from './helpers.mjs'

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. 总访问步数上限
 * ──────────────────────────────────────────────────────────── */

/** 构造 depth 层嵌套的 { anyOf: [s, s] }，子 schema 固定通过（type:number 对数字实例） */
function nestedAnyOf(depth) {
  let s = { type: 'number' }
  for (let i = 0; i < depth; i += 1) s = { anyOf: [s, s] }
  return s
}

// 1.1 深层嵌套必须在合理时间内返回，不卡死（超限告警或快速结束）
{
  const start = Date.now()
  const r = validateInstance(1, nestedAnyOf(24), { strict: true })
  const elapsed = Date.now() - start
  cases.push(
    check(
      `嵌套 anyOf depth=24 在合理时间内返回（实际 ${elapsed}ms）`,
      () => elapsed < 3000 && r && Array.isArray(r.errors) && Array.isArray(r.warnings),
      `elapsed=${elapsed}ms`
    )
  )
  cases.push(
    check('嵌套 anyOf depth=24 命中上限并给出中文中止告警', () =>
      r.warnings.some((w) => w.includes('超出上限') && w.includes('已中止') && w.includes('不完整'))
    )
  )
  cases.push(check('上限告警为中文', () => r.warnings.some((w) => /[\u4e00-\u9fa5]/.test(w) && w.includes('超出上限'))))
}

// 1.2 步数上限可配置：小额度下小 schema 也能触发
{
  const r = validateInstance(1, nestedAnyOf(3), { strict: true, maxSteps: 8 })
  cases.push(
    check('maxSteps 可配置：低额度触发中文中止告警', () =>
      r.warnings.some((w) => w.includes('超出上限') && w.includes('已中止'))
    )
  )
}

// 1.3 正常 schema 不受影响：无上限告警，valid/errors 语义不变
{
  const schema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, age: { type: 'integer' } }
  }
  const ok = validateInstance({ name: '张三', age: 28 }, schema, { strict: true })
  cases.push(eq('正常 schema 校验通过（valid 语义不变）', ok.valid, true))
  cases.push(eq('正常 schema 无 errors', ok.errors.length, 0))
  cases.push(
    check('正常 schema 无上限告警', () => !ok.warnings.some((w) => w.includes('超出上限')))
  )
  const bad = validateInstance({ name: 1 }, schema, { strict: true })
  cases.push(eq('正常 schema 失败仍报错（errors 语义不变）', bad.valid, false))
  cases.push(check('正常 schema 失败报 type/required', () => bad.errors.some((e) => e.keyword === 'type' || e.keyword === 'required')))
  cases.push(check('正常 schema 失败也无上限告警', () => !bad.warnings.some((w) => w.includes('超出上限'))))
}

// 1.4 正常组合关键字在默认额度内不误报
{
  const r = validateInstance(123, { anyOf: [{ type: 'string' }, { type: 'number' }] }, { strict: true })
  cases.push(eq('普通 anyOf 仍判定通过', r.valid, true))
  cases.push(check('普通 anyOf 不触发上限告警', () => !r.warnings.some((w) => w.includes('超出上限'))))
}

/* ────────────────────────────────────────────────────────────
 * 2. jsonpath `=~` 灾难性回溯守卫
 * ──────────────────────────────────────────────────────────── */

const jpData = { list: [{ name: 'abc123' }, { name: 'xyz' }, { name: 'a1' }] }

// 2.1 不做静态硬门禁：合法复合正则不得被误伤（H1 回归）
cases.push(
  check('jsonpath =~ 不误伤合法复合正则 ^[a-z.]+$', () => {
    const data = { list: [{ name: 'a.b.c' }, { name: 'x' }] }
    const got = evalJsonPath(data, "$.list[?(@.name =~ '^[a-z.]+$')].name").matches.map((m) => m.value)
    return got.length === 2 && got[0] === 'a.b.c' && got[1] === 'x'
  })
)

// 2.2 安全正则不受影响
cases.push(
  eq(
    'jsonpath =~ 安全正则 ^[a-z]+$ 正常匹配',
    evalJsonPath(jpData, "$.list[?(@.name =~ '^[a-z]+$')].name").matches.map((m) => m.value),
    ['xyz']
  )
)
cases.push(
  check('jsonpath =~ 安全复合正则不被误伤', () => {
    const data = { list: [{ name: 'a@b.com' }, { name: 'not-an-email' }] }
    const got = evalJsonPath(data, "$.list[?(@.name =~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')].name").matches.map((m) => m.value)
    return got.length === 1 && got[0] === 'a@b.com'
  })
)

// 2.3 非法正则仍走原中文语法错误分支
cases.push(
  throws('jsonpath =~ 非法正则仍报原中文错误', () => evalJsonPath(jpData, "$.list[?(@.name =~ '(')]"), /不是合法正则/)
)

void check
