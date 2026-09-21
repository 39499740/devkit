<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { parseJson, jsonErrorPosition, RawNumber } from '~/utils/json'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const transfer = useTransfer()

const input = ref('')
const className = ref('Order')
const pkg = ref('')
const styleMode = ref<'pojo' | 'record'>('pojo')
const nestMode = ref<'inner' | 'toplevel'>('inner')
const naming = ref<'keep' | 'camel'>('camel')
const useLombok = ref(false)
const useJackson = ref(false)
const decimalType = ref<'double' | 'BigDecimal'>('double')
/** 类型确认覆盖：JSON 路径 -> 类型名 */
const overrides = ref<Record<string, string>>({})

interface FileOut { name: string; code: string }
interface UncertainRow {
  path: string
  jsonKey: string
  reason: string
  options: { value: string; label: string }[]
}

const files = ref<FileOut[]>([])
const selected = ref(0)
const warnings = ref<string[]>([])
const uncertains = ref<UncertainRow[]>([])
const classErr = ref('')
const pkgErr = ref('')
const errDetail = ref('')

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null',
])
const INT_MIN = -2147483648n
const INT_MAX = 2147483647n
const LONG_MIN = -(2n ** 63n)
const LONG_MAX = 2n ** 63n - 1n
const WRAPPERS: Record<string, string> = { int: 'Integer', long: 'Long', double: 'Double', boolean: 'Boolean' }

function isLegalIdent(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) && !JAVA_KEYWORDS.has(s)
}

function validateClassName(name: string): string {
  if (!name.trim()) return '类名不能为空'
  const s = name.trim()
  if (/^[0-9]/.test(s)) return `类名 "${s}" 以数字开头，Java 类名必须以字母 / _ / $ 开头`
  if (JAVA_KEYWORDS.has(s)) return `类名 "${s}" 是 Java 关键字，请换一个名称`
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) {
    const bad = [...s].filter((c) => !/[A-Za-z0-9_$]/.test(c)).join(' ')
    return `类名 "${s}" 含非法字符（${bad}），只允许字母、数字、_ 与 $`
  }
  return ''
}

function validatePackage(p: string): string {
  const s = p.trim()
  if (!s) return ''
  for (const seg of s.split('.')) {
    if (!seg) return `包名 "${s}" 存在空段落（连续点或以点结尾）`
    if (/^[0-9]/.test(seg)) return `包名段落 "${seg}" 以数字开头`
    if (JAVA_KEYWORDS.has(seg)) return `包名段落 "${seg}" 是 Java 关键字`
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) return `包名段落 "${seg}" 含非法字符，只允许字母、数字、_ 与 $`
  }
  return ''
}

/** snake/kebab/含分隔符 -> camelCase；已有 camelCase 保持不变；结果非法（如数字开头）加 field 前缀 */
function toCamel(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!parts.length) return ''
  // 第一个 token：全大写（如 ORDER_ID 的 ORDER）整体小写；否则只小写首字符（保留 orderId）
  const firstRaw = parts[0]!
  const first = firstRaw.length > 1 && firstRaw === firstRaw.toUpperCase() ? firstRaw.toLowerCase() : firstRaw.charAt(0).toLowerCase() + firstRaw.slice(1)
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  let out = [first, ...rest].join('')
  if (!/^[A-Za-z_$]/.test(out)) out = 'field' + out.charAt(0).toUpperCase() + out.slice(1)
  return out
}

function toPascal(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!parts.length) return 'Item'
  let out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  if (!/^[A-Za-z_$]/.test(out)) out = 'Item' + out
  return out
}

interface FieldSpec { jsonKey: string; name: string; type: string; nullable: boolean; path: string }
interface ClassSpec { name: string; fields: FieldSpec[]; children: ClassSpec[] }

interface Ctx {
  warnings: string[]
  uncertains: UncertainRow[]
  usedClassNames: Set<string>
}

function uniqueClassName(base: string, ctx: Ctx): string {
  let name = base
  let i = 2
  while (ctx.usedClassNames.has(name)) name = base + i++
  if (name !== base) ctx.warnings.push(`类名 ${base} 重复，后续类已改名为 ${name}`)
  ctx.usedClassNames.add(name)
  return name
}

function javaFieldName(key: string, sibling: Set<string>, ctx: Ctx): string {
  let name = naming.value === 'keep' ? key : toCamel(key)
  if (!isLegalIdent(name)) {
    const fixed = toCamel(key) || 'field'
    ctx.warnings.push(`字段 "${key}" 不是合法 Java 标识符，已转为 ${fixed}`)
    name = fixed
  }
  if (JAVA_KEYWORDS.has(name)) {
    name = name + 'Value'
    ctx.warnings.push(`字段 "${key}" 是 Java 关键字，已改为 ${name}`)
  }
  let i = 2
  let final = name
  while (sibling.has(final)) final = name + i++
  if (final !== name) ctx.warnings.push(`字段 "${key}" 转换后与其他字段重名，已改为 ${final}`)
  sibling.add(final)
  return final
}

function uncertain(ctx: Ctx, path: string, jsonKey: string, reason: string, options: string[], def: string): string {
  ctx.uncertains.push({ path, jsonKey, reason, options: options.map((v) => ({ value: v, label: v })) })
  const chosen = overrides.value[path] ?? ''
  return options.includes(chosen) ? chosen : def
}

type NumFamily = 'int' | 'long' | 'overflow' | 'decimal'

function numberFamily(raw: string): NumFamily {
  if (/^-?\d+$/.test(raw)) {
    const b = BigInt(raw)
    if (b >= INT_MIN && b <= INT_MAX) return 'int'
    if (b >= LONG_MIN && b <= LONG_MAX) return 'long'
    return 'overflow'
  }
  return 'decimal'
}

/** 标量值的 Java 类型（未包 wrapper） */
function scalarType(v: unknown, ctx: Ctx, path: string, jsonKey: string): { type: string; nullable: boolean } {
  if (v instanceof RawNumber) {
    const fam = numberFamily(v.raw)
    if (fam === 'int') return { type: 'int', nullable: false }
    if (fam === 'long') return { type: 'long', nullable: false }
    if (fam === 'overflow') {
      const type = uncertain(ctx, path, jsonKey, `超出 long 范围（> 2^63-1 或 < -2^63），默认按 String 处理，可改为 BigInteger`, ['String', 'BigInteger', 'Object'], 'String')
      return { type, nullable: true }
    }
    return { type: decimalType.value, nullable: false }
  }
  switch (typeof v) {
    case 'string':
      return { type: 'String', nullable: false }
    case 'boolean':
      return { type: 'boolean', nullable: false }
    case 'number':
      return { type: Number.isInteger(v) ? 'int' : 'double', nullable: false }
    default:
      return { type: 'String', nullable: false }
  }
}

/** null 值的类型确认 */
function nullType(ctx: Ctx, path: string, jsonKey: string, note: string): string {
  return uncertain(ctx, path, jsonKey, `${note}，null 无法凭空确定类型，默认 Object`, ['Object', 'String', 'Long', 'Boolean'], 'Object')
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RawNumber)
}

/** 数组元素合并出的类型（泛型内使用，一律包装类型） */
function resolveElements(elems: unknown[], ctx: Ctx, path: string, jsonKey: string): { type: string; child?: ClassSpec } {
  const nonNull = elems.filter((e) => e !== null)
  if (!nonNull.length) {
    const type = nullType(ctx, `${path}[]`, jsonKey, '数组元素全为 null')
    return { type }
  }
  if (nonNull.every(isObj)) {
    const child = analyzeMerged(nonNull, toPascal(jsonKey), path, ctx)
    return { type: child.name, child }
  }
  if (nonNull.every((e) => Array.isArray(e))) {
    const flat = nonNull.flat()
    if (!flat.length) {
      ctx.warnings.push(`${path}[] 为空数组，无法确定元素类型，按 List<Object> 处理`)
      return { type: 'Object' }
    }
    const inner = resolveElements(flat, ctx, `${path}[]`, jsonKey)
    return { type: `List<${inner.type}>`, child: inner.child }
  }
  const kinds = new Set<string>()
  let hasObj = false
  let hasArr = false
  for (const e of nonNull) {
    if (isObj(e)) hasObj = true
    else if (Array.isArray(e)) hasArr = true
    else if (e instanceof RawNumber) kinds.add(numberFamily(e.raw) === 'decimal' ? 'decimal' : 'int')
    else kinds.add(typeof e)
  }
  if (hasObj || hasArr || kinds.size > 1) {
    const numericOnly = !hasObj && !hasArr && kinds.size === 2 && kinds.has('int') && kinds.has('decimal')
    if (numericOnly) {
      ctx.warnings.push(`${path}[] 同时包含整数与小数，元素统一按 ${decimalType.value === 'BigDecimal' ? 'BigDecimal' : 'Double'} 处理`)
      return { type: decimalType.value === 'BigDecimal' ? 'BigDecimal' : 'Double' }
    }
    const type = uncertain(ctx, `${path}[]`, jsonKey, '混合数组，未找到公共父类，默认 Object', ['Object', 'String', 'Long', 'Double', 'Boolean'], 'Object')
    return { type }
  }
  // 单一基础类型族
  const first = nonNull.find((e) => e !== undefined)!
  if (first instanceof RawNumber) {
    const fams = new Set((nonNull as RawNumber[]).map((e) => numberFamily(e.raw)))
    if (fams.has('overflow')) {
      const type = uncertain(ctx, `${path}[]`, jsonKey, '数组含超出 long 范围的整数，元素默认按 String 处理，可改为 BigInteger', ['String', 'BigInteger', 'Object'], 'String')
      return { type }
    }
    return { type: fams.has('long') ? 'Long' : 'Integer' }
  }
  switch (typeof first) {
    case 'string':
      return { type: 'String' }
    case 'boolean':
      return { type: 'Boolean' }
    case 'number':
      return { type: Number.isInteger(first) ? 'Integer' : 'Double' }
    default:
      return { type: 'Object' }
  }
}

function buildField(cls: ClassSpec, jsonKey: string, r: { type: string; nullable: boolean; child?: ClassSpec }, path: string, sibling: Set<string>, ctx: Ctx, hasNull: boolean) {
  const nullable = r.nullable || hasNull
  let type = r.type
  if (nullable && WRAPPERS[type]) type = WRAPPERS[type]!
  const name = javaFieldName(jsonKey, sibling, ctx)
  cls.fields.push({ jsonKey, name, type, nullable, path })
  if (r.child) cls.children.push(r.child)
}

function analyzeObject(obj: Record<string, unknown>, name: string, path: string, ctx: Ctx, exactName = false): ClassSpec {
  const cls: ClassSpec = { name: exactName ? (ctx.usedClassNames.add(name), name) : uniqueClassName(name, ctx), fields: [], children: [] }
  const sibling = new Set<string>()
  for (const [k, v] of Object.entries(obj)) {
    const fp = `${path}.${k}`
    if (isObj(v)) {
      const child = analyzeObject(v, toPascal(k), fp, ctx)
      buildField(cls, k, { type: child.name, nullable: false, child }, fp, sibling, ctx, false)
    } else if (Array.isArray(v)) {
      if (!v.length) {
        ctx.warnings.push(`${fp} 是空数组，无法确定元素类型，按 List<Object> 处理`)
        buildField(cls, k, { type: 'List<Object>', nullable: false }, fp, sibling, ctx, false)
      } else {
        const el = resolveElements(v, ctx, fp, k)
        buildField(cls, k, { type: `List<${el.type}>`, nullable: false, child: el.child }, fp, sibling, ctx, v.some((e) => e === null))
      }
    } else if (v === null) {
      const type = nullType(ctx, fp, k, `值为 null`)
      buildField(cls, k, { type, nullable: true }, fp, sibling, ctx, true)
    } else {
      buildField(cls, k, scalarType(v, ctx, fp, k), fp, sibling, ctx, false)
    }
  }
  return cls
}

/** 数组元素里的多个对象合并成一个类（字段取并集） */
function analyzeMerged(objs: Record<string, unknown>[], name: string, path: string, ctx: Ctx): ClassSpec {
  const cls: ClassSpec = { name: uniqueClassName(name, ctx), fields: [], children: [] }
  const sibling = new Set<string>()
  const keys: string[] = []
  for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
  if (objs.some((o) => Object.keys(o).length !== keys.length)) {
    ctx.warnings.push(`${path}[] 内各对象字段不完全一致，已按字段并集生成 ${cls.name}，请人工核对`)
  }
  for (const k of keys) {
    const fp = `${path}[].${k}`
    const present = objs.filter((o) => k in o).map((o) => o[k])
    const nonNull = present.filter((v) => v !== null)
    const hasNull = present.some((v) => v === null) || present.length < objs.length
    if (!nonNull.length) {
      const type = nullType(ctx, fp, k, `各元素中该字段均为 null 或缺失`)
      buildField(cls, k, { type, nullable: true }, fp, sibling, ctx, true)
      continue
    }
    if (nonNull.every(isObj)) {
      const child = analyzeMerged(nonNull, toPascal(k), fp, ctx)
      buildField(cls, k, { type: child.name, nullable: false, child }, fp, sibling, ctx, hasNull)
      continue
    }
    if (nonNull.some((v) => Array.isArray(v))) {
      const arrs = nonNull.filter((v) => Array.isArray(v)) as unknown[][]
      if (nonNull.length !== arrs.length) {
        ctx.warnings.push(`${fp} 在数组各元素中类型不一致，已按 Object 处理`)
        buildField(cls, k, { type: 'Object', nullable: true }, fp, sibling, ctx, hasNull)
        continue
      }
      const flat = arrs.flat()
      const el = flat.length ? resolveElements(flat, ctx, fp, k) : { type: 'Object' as string }
      if (!flat.length) ctx.warnings.push(`${fp} 为空数组，按 List<Object> 处理`)
      buildField(cls, k, { type: `List<${el.type}>`, nullable: false, child: el.child }, fp, sibling, ctx, hasNull)
      continue
    }
    // 标量合并
    const fams = new Set<string>()
    for (const v of nonNull) {
      if (v instanceof RawNumber) fams.add(numberFamily(v.raw))
      else if (typeof v === 'string') fams.add('string')
      else if (typeof v === 'boolean') fams.add('boolean')
      else fams.add('other')
    }
    const numeric = ['int', 'long', 'decimal', 'overflow']
    const isNum = fams.size > 0 && [...fams].every((f) => numeric.includes(f))
    if (isNum) {
      if (fams.has('decimal')) {
        if (fams.size > 1) ctx.warnings.push(`${fp} 在数组各元素中同时出现整数与小数，已统一按小数（${decimalType.value}）处理`)
        buildField(cls, k, { type: decimalType.value, nullable: false }, fp, sibling, ctx, hasNull)
      } else if (fams.has('overflow')) {
        const type = uncertain(ctx, fp, k, `${fp} 含超出 long 范围的整数，默认按 String 处理，可改为 BigInteger`, ['String', 'BigInteger', 'Object'], 'String')
        buildField(cls, k, { type, nullable: true }, fp, sibling, ctx, true)
      } else {
        buildField(cls, k, { type: fams.has('long') ? 'long' : 'int', nullable: false }, fp, sibling, ctx, hasNull)
      }
      continue
    }
    if (fams.size === 1) {
      const f = [...fams][0]!
      const t = f === 'string' ? 'String' : f === 'boolean' ? 'boolean' : f === 'other' ? 'Object' : 'double'
      buildField(cls, k, { type: t, nullable: false }, fp, sibling, ctx, hasNull)
      continue
    }
    ctx.warnings.push(`${fp} 在数组各元素中类型不一致，已按 Object 处理`)
    buildField(cls, k, { type: 'Object', nullable: true }, fp, sibling, ctx, true)
  }
  return cls
}

/* ---------------- 代码生成 ---------------- */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function needJsonProperty(f: FieldSpec): boolean {
  return useJackson.value && f.name !== f.jsonKey
}

function collectImports(cls: ClassSpec, withChildren: boolean): string[] {
  const imports: Set<string> = new Set()
  const walk = (c: ClassSpec) => {
    for (const f of c.fields) {
      if (f.type.includes('List<')) imports.add('java.util.List')
      if (f.type.includes('BigDecimal')) imports.add('java.math.BigDecimal')
      if (f.type.includes('BigInteger')) imports.add('java.math.BigInteger')
      if (needJsonProperty(f)) imports.add('com.fasterxml.jackson.annotation.JsonProperty')
    }
    if (withChildren) c.children.forEach(walk)
  }
  walk(cls)
  if (useLombok.value && styleMode.value === 'pojo') imports.add('lombok.Data')
  return [...imports]
}

function filePrelude(cls: ClassSpec, withChildren: boolean): string {
  let out = ''
  const p = pkg.value.trim()
  if (p) out += `package ${p};\n\n`
  const imports = collectImports(cls, withChildren).sort()
  if (imports.length) out += imports.map((i) => `import ${i};`).join('\n') + '\n\n'
  return out
}

function getterSig(f: FieldSpec): string {
  const prefix = f.type === 'boolean' || f.type === 'Boolean' ? 'is' : 'get'
  return prefix + cap(f.name)
}

function emitPojo(cls: ClassSpec, depth: number, nestChildren: boolean): string {
  const pad = '    '.repeat(depth)
  const inner = '    '.repeat(depth + 1)
  const lines: string[] = []
  if (useLombok.value) lines.push(`${pad}@Data`)
  lines.push(`${pad}public ${depth > 0 ? 'static ' : ''}class ${cls.name} {`)
  for (const f of cls.fields) {
    if (needJsonProperty(f)) lines.push(`${inner}@JsonProperty("${f.jsonKey}")`)
    lines.push(`${inner}private ${f.type} ${f.name};`)
  }
  if (!useLombok.value && cls.fields.length) {
    lines.push('')
    cls.fields.forEach((f, idx) => {
      if (idx > 0) lines.push('')
      lines.push(`${inner}public ${f.type} ${getterSig(f)}() {`)
      lines.push(`${inner}    return ${f.name};`)
      lines.push(`${inner}}`)
      lines.push('')
      lines.push(`${inner}public void set${cap(f.name)}(${f.type} ${f.name}) {`)
      lines.push(`${inner}    this.${f.name} = ${f.name};`)
      lines.push(`${inner}}`)
    })
  }
  if (nestChildren) {
    for (const child of cls.children) {
      lines.push('')
      lines.push(emitPojo(child, depth + 1, true))
    }
  }
  lines.push(`${pad}}`)
  return lines.join('\n')
}

function emitRecord(cls: ClassSpec, depth: number, nestChildren: boolean): string {
  const pad = '    '.repeat(depth)
  const inner = '    '.repeat(depth + 2)
  const lines: string[] = []
  lines.push(`${pad}public record ${cls.name}(`)
  if (!cls.fields.length) {
    lines.push(`${pad}) {`)
  } else {
    cls.fields.forEach((f, i) => {
      if (needJsonProperty(f)) lines.push(`${inner}@JsonProperty("${f.jsonKey}")`)
      lines.push(`${inner}${f.type} ${f.name}${i === cls.fields.length - 1 ? '' : ','}`)
    })
    lines.push(`${pad}) {`)
  }
  if (nestChildren) {
    for (const child of cls.children) {
      lines.push('')
      lines.push(emitRecord(child, depth + 1, true))
    }
  }
  lines.push(`${pad}}`)
  return lines.join('\n')
}

function flatten(cls: ClassSpec): ClassSpec[] {
  return [cls, ...cls.children.flatMap(flatten)]
}

const SAMPLE = `{
  "orderId": 1234567890123456789,
  "amount": 128.5,
  "paid": true,
  "remark": null,
  "tags": ["urgent", "gift"],
  "items": [
    { "sku_id": 987654321012345678, "name": "机械键盘", "price": 399.0, "quantity": 2 }
  ],
  "customer": { "user_id": 42, "nickname": "陈立", "vip": true }
}`

const sig = () =>
  JSON.stringify([
    input.value,
    className.value,
    pkg.value,
    styleMode.value,
    nestMode.value,
    naming.value,
    useLombok.value,
    useJackson.value,
    decimalType.value,
    Object.keys(overrides.value).sort().map((k) => `${k}=${overrides.value[k]}`),
  ])
const run = useToolRun(sig)

// G01/G09：接收来自其他工具的内存传递
onMounted(() => {
  const p = transfer.peek()
  if (p && p.from !== 'json2java') {
    input.value = p.text
    execute()
  }
})

function execute() {
  classErr.value = ''
  pkgErr.value = ''
  errDetail.value = ''
  if (!input.value.trim()) {
    run.markIdle()
    files.value = []
    warnings.value = []
    uncertains.value = []
    selected.value = 0
    return
  }
  const ce = validateClassName(className.value)
  const pe = validatePackage(pkg.value)
  if (ce || pe) {
    classErr.value = ce
    pkgErr.value = pe
    errDetail.value = ce || pe
    run.markFail(errDetail.value)
    return
  }
  const ctx: Ctx = { warnings: [], uncertains: [], usedClassNames: new Set() }
  let value: unknown
  try {
    const parsed = parseJson(input.value)
    value = parsed.value
    for (const d of parsed.duplicateKeys) ctx.warnings.push(`JSON 中存在重复键：${d}（后者生效）`)
  } catch (e) {
    const pos = jsonErrorPosition(e, input.value)
    errDetail.value = pos ? `JSON 解析失败：第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : `JSON 解析失败：${errMessage(e)}`
    run.markFail(errDetail.value)
    return
  }
  if (!isObj(value)) {
    errDetail.value = '顶层必须是 JSON 对象（{ ... }），当前是其他类型；请把数组或标量包一层对象后再转换'
    run.markFail(errDetail.value)
    return
  }
  ctx.usedClassNames.add(className.value.trim())
  let root: ClassSpec
  try {
    root = analyzeObject(value, className.value.trim(), '$', ctx, true)
  } catch (e) {
    errDetail.value = `生成失败：${errMessage(e)}`
    run.markFail(errDetail.value)
    return
  }
  const emit = styleMode.value === 'record' ? emitRecord : emitPojo
  const outFiles: FileOut[] =
    nestMode.value === 'inner'
      ? [{ name: `${root.name}.java`, code: filePrelude(root, true) + emit(root, 0, true) + '\n' }]
      : flatten(root).map((c) => ({ name: `${c.name}.java`, code: filePrelude(c, false) + emit(c, 0, false) + '\n' }))
  if (styleMode.value === 'record' && useLombok.value) {
    ctx.warnings.push('record 自带构造器与访问器，Lombok @Data 不适用于 record，已忽略该选项')
  }
  files.value = outFiles
  selected.value = 0
  warnings.value = ctx.warnings
  uncertains.value = ctx.uncertains
  const note = ctx.uncertains.length
    ? `有 ${ctx.uncertains.length} 处类型需要确认（见下方「类型确认」），默认值已按保守策略生成`
    : ''
  run.markOk(note)
}

watch(
  [className, pkg, styleMode, nestMode, naming, useLombok, useJackson, decimalType, overrides],
  execute,
  { deep: true },
)

function setOverride(path: string, v: string) {
  overrides.value = { ...overrides.value, [path]: v }
}

/** 该待确认字段当前生效的类型（默认取第一个选项） */
function overrideValue(u: UncertainRow): string {
  const chosen = overrides.value[u.path]
  return u.options.some((o) => o.value === chosen) ? chosen! : u.options[0]!.value
}

function currentFile(): FileOut | null {
  return files.value[selected.value] ?? null
}

function copyFile(f: FileOut) {
  clipboard.copy(f.code, f.name)
}
function downloadFile(f: FileOut) {
  downloadText(f.name, f.code, 'text/x-java-source;charset=utf-8')
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t22">
    <div class="t22__toolbar">
      <div class="t22__field">
        <DkField label="类名" :error="classErr">
          <DkInput v-model="className" mono placeholder="Order" />
        </DkField>
      </div>
      <div class="t22__field">
        <DkField label="包名（可选）" :error="pkgErr">
          <DkInput v-model="pkg" mono placeholder="com.example.order" />
        </DkField>
      </div>
      <div class="t22__opt">
        <span class="t22__opt-label">形式</span>
        <DkSegmented
          :model-value="styleMode"
          size="sm"
          :options="[
            { value: 'pojo', label: 'POJO' },
            { value: 'record', label: 'record' },
          ]"
          @update:model-value="styleMode = $event as any"
        />
      </div>
      <div class="t22__opt">
        <span class="t22__opt-label">嵌套类</span>
        <DkSegmented
          :model-value="nestMode"
          size="sm"
          :options="[
            { value: 'inner', label: '内部静态类' },
            { value: 'toplevel', label: '独立顶级类' },
          ]"
          @update:model-value="nestMode = $event as any"
        />
      </div>
    </div>
    <div class="t22__toolbar">
      <div class="t22__opt">
        <span class="t22__opt-label">字段命名</span>
        <DkSegmented
          :model-value="naming"
          size="sm"
          :options="[
            { value: 'keep', label: '保持原键' },
            { value: 'camel', label: '转 camelCase' },
          ]"
          @update:model-value="naming = $event as any"
        />
      </div>
      <div class="t22__opt">
        <span class="t22__opt-label">小数类型</span>
        <DkSelect
          :model-value="decimalType"
          :options="[
            { value: 'double', label: 'double' },
            { value: 'BigDecimal', label: 'BigDecimal' },
          ]"
          @update:model-value="decimalType = $event as any"
        />
      </div>
      <DkCheckbox v-model="useLombok" label="Lombok @Data" />
      <DkCheckbox v-model="useJackson" label="Jackson 注解" />
      <span class="grow"></span>
      <DkButton
        size="sm"
        variant="ghost"
        title="载入示例 JSON（含 long ID、小数、数组、null 与嵌套对象）"
        @click="input = SAMPLE; execute()"
      >
        载入示例
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        生成 Java
      </DkButton>
      <span class="t22__kbd tertiary">⌘/Ctrl + Enter</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[styleMode === 'pojo' ? 'POJO' : 'record', nestMode === 'inner' ? '内部静态类' : '多文件']"
      :retry="execute"
    />

    <div class="t22__panes">
      <SplitPanes :initial="45" :min="25" :max="65">
        <template #left>
          <DkEditor
            v-model="input"
            lang="JSON 输入"
            placeholder='粘贴 JSON 对象，例如 {"orderId": 1, "user": {"name": "..."}}'
            :height="'calc(52vh - 60px)'"
            filename="input.json"
          />
        </template>
        <template #right>
          <DkEditor
            v-if="files.length <= 1"
            :model-value="files[0]?.code ?? ''"
            readonly
            :lang="files.length ? files[0]!.name : 'Java 输出'"
            placeholder="生成的 Java 代码将显示在这里"
            :stale="run.status.value === 'stale'"
            :error="run.status.value === 'error' ? errDetail : ''"
            :height="'calc(52vh - 60px)'"
            :filename="files[0]?.name ?? 'Out.java'"
          />
          <div v-else class="t22__multi">
            <div class="t22__tree" role="listbox" aria-label="生成文件列表">
              <div class="t22__tree-title tertiary">{{ files.length }} 个文件</div>
              <div
                v-for="(f, i) in files"
                :key="f.name"
                class="t22__file"
                :class="{ 't22__file--on': i === selected }"
                role="option"
                :aria-selected="i === selected"
                @click="selected = i"
              >
                <DkIcon name="file-cog" :size="13" />
                <span class="t22__file-name mono">{{ f.name }}</span>
                <span class="grow"></span>
                <button class="t22__file-act" title="复制该文件" @click.stop="copyFile(f)">
                  <DkIcon name="copy" :size="13" />
                </button>
                <button class="t22__file-act" title="下载该文件" @click.stop="downloadFile(f)">
                  <DkIcon name="download" :size="13" />
                </button>
              </div>
            </div>
            <div class="t22__code">
              <DkEditor
                :model-value="currentFile()?.code ?? ''"
                readonly
                :lang="currentFile()?.name ?? 'Java 输出'"
                placeholder="选择左侧文件查看代码"
                :stale="run.status.value === 'stale'"
                :height="'calc(52vh - 60px)'"
                :filename="currentFile()?.name ?? 'Out.java'"
              />
            </div>
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="uncertains.length && run.status.value === 'ok'" class="t22__confirm">
      <div class="t22__section-title">类型确认（null 无法凭空确定类型 / 超长数字 / 混合数组）</div>
      <div v-for="u in uncertains" :key="u.path" class="t22__confirm-row">
        <span class="mono t22__confirm-path">{{ u.path }}</span>
        <span class="t22__confirm-key">"{{ u.jsonKey }}"</span>
        <span class="t22__confirm-reason tertiary">{{ u.reason }}</span>
        <DkSelect
          :model-value="overrideValue(u)"
          :options="u.options"
          @update:model-value="setOverride(u.path, $event)"
        />
      </div>
    </div>

    <div v-if="warnings.length && (run.status.value === 'ok' || run.status.value === 'stale')" class="t22__warns">
      <div class="t22__section-title">生成提示</div>
      <ul class="t22__warn-list">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <DkCollapse title="用法说明">
      <ul>
        <li>类型推断：整数按 int / long（超出 int 范围自动用 long）；小数默认 double，可切换 BigDecimal；超出 long 范围（&gt; 2^63-1）的数字默认按 String 处理，可在「类型确认」改为 BigInteger。</li>
        <li>null 字段无法凭空确定类型，默认 Object，可在「类型确认」逐个指定；record 形式下可能为 null 的字段使用包装类型（Integer / Long / Boolean / Double）。</li>
        <li>嵌套对象默认生成内部静态类；选择「独立顶级类」时按多文件输出，左侧为文件树，可逐文件复制 / 下载。</li>
        <li>Jackson 注解：仅在字段名与 JSON 键不一致（如 camelCase 转换后）时生成 @JsonProperty；Lombok @Data 仅用于 POJO。</li>
        <li>所有代码在浏览器本地生成，不会上传 JSON 内容。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t22 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t22__toolbar {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t22__field {
  min-width: 180px;
}
.t22__opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 2px;
}
.t22__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t22__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t22__panes {
  min-height: 320px;
}
.t22__multi {
  display: flex;
  gap: 10px;
  height: 100%;
  min-width: 0;
}
.t22__tree {
  width: 220px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: auto;
  padding: 6px;
}
.t22__tree-title {
  font-size: 11px;
  padding: 4px 8px 6px;
}
.t22__file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  color: var(--text-secondary);
}
.t22__file:hover {
  background: var(--surface-hover);
}
.t22__file--on {
  background: var(--accent-soft);
  color: var(--text-primary);
}
.t22__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t22__file-act {
  display: inline-flex;
  padding: 3px;
  border-radius: 4px;
  color: var(--text-tertiary);
}
.t22__file-act:hover {
  color: var(--text-primary);
  background: var(--surface-subtle);
}
.t22__code {
  flex: 1;
  min-width: 0;
}
.t22__confirm,
.t22__warns {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t22__confirm {
  border-color: var(--warn, #d4a72c);
}
.t22__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.t22__confirm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
}
.t22__confirm-path {
  color: var(--accent);
  font-size: 12px;
}
.t22__confirm-key {
  font-weight: 500;
}
.t22__confirm-reason {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
}
.t22__warn-list {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
