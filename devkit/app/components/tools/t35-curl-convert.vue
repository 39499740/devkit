<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { RawNumber } from '~/utils/json'

defineProps<{ tool: ToolMeta }>()

type Fmt = 'curl' | 'fetch' | 'axios'
type Direction = 'curl-fetch' | 'fetch-curl' | 'curl-axios'
type TargetLang = 'js' | 'ts'

const DIRS: Array<{ value: Direction; label: string }> = [
  { value: 'curl-fetch', label: 'curl → fetch' },
  { value: 'fetch-curl', label: 'fetch → curl' },
  { value: 'curl-axios', label: 'curl → Axios' }
]

const direction = ref<Direction>('curl-fetch')
const sourceFmt = computed<Fmt>(() => direction.value.split('-')[0] as Fmt)
const targetFmt = computed<Fmt>(() => direction.value.split('-')[1] as Fmt)
const targetLang = ref<TargetLang>('js')
const credMode = ref<'placeholder' | 'remove'>('placeholder')
const indent = ref<'2' | '4'>('2')
const indentUnit = computed(() => (indent.value === '4' ? '    ' : '  '))

const src = ref('')
const output = ref('')

interface ReqHeader {
  key: string
  value: string
}
interface Req {
  method: string
  url: string
  /** url 是否为变量/表达式（生成时不加引号） */
  urlIsExpr: boolean
  headers: ReqHeader[]
  body: string | null
  bodyParsed: unknown | null
  params: ReqHeader[] | null
}

interface ConvertResult {
  req: Req | null
  warns: string[]
  notes: string[]
}

const result = ref<ConvertResult | null>(null)
const srcErr = ref('')

const sig = () => JSON.stringify([src.value, direction.value, targetLang.value, credMode.value, indent.value])
const run = useToolRun(sig)

const clipboard = useClipboard()

const SAMPLES: Record<Fmt, string> = {
  curl: `curl 'https://api.example.com/users' \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer test-token' \\
  --data-raw '{"name":"devkit","role":"admin"}'`,
  fetch: `fetch('https://api.example.com/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token'
  },
  body: JSON.stringify({ name: 'devkit', role: 'admin' })
})`,
  axios: `axios({
  url: 'https://api.example.com/users',
  method: 'post',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token'
  },
  data: { name: 'devkit', role: 'admin' }
})`
}

const CRED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'api-key',
  'auth-token',
  'x-csrf-token',
  'x-xsrf-token'
])

function redactValue(v: string): string {
  const m = /^\s*([A-Za-z]+)\s+(\S.*)$/.exec(v)
  if (m && /^(bearer|basic|token|digest|apikey)$/i.test(m[1]!)) return `${m[1]!} <REDACTED>`
  return '<REDACTED>'
}

function processHeaders(r: Req): { req: Req; redacted: number; removed: number } {
  let redacted = 0
  let removed = 0
  const headers: ReqHeader[] = []
  for (const h of r.headers) {
    if (!CRED_HEADERS.has(h.key.toLowerCase())) {
      headers.push(h)
      continue
    }
    if (credMode.value === 'remove') {
      removed++
      continue
    }
    headers.push({ key: h.key, value: redactValue(h.value) })
    redacted++
  }
  return { req: { ...r, headers }, redacted, removed }
}

/* ===================== 通用小工具 ===================== */

/** 单引号安全包裹（shell） */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
/** JS 单引号字符串字面量 */
function jsQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}
function unquote(raw: string): { value: string; quoted: boolean; templateVar: boolean } {
  const t = raw.trim()
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t[t.length - 1] === t[0]) {
    const inner = t.slice(1, -1)
    return { value: inner.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n'), quoted: true, templateVar: false }
  }
  if (t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`') {
    return { value: t.slice(1, -1), quoted: true, templateVar: /\$\{/.test(t) }
  }
  return { value: t, quoted: false, templateVar: false }
}
/** 宽松 JS 对象字面量 → JSON（单引号/未加引号的 key、尾逗号）；失败返回 null */
function relaxedParse(text: string): unknown {
  const t = text.trim()
  try {
    return parseJson(t).value
  } catch {}
  const fixed = t
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'(?:[^'\\\r\n]|\\.)*'/g, (m) => JSON.stringify(m.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n')))
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return parseJson(fixed).value
  } catch {
    return null
  }
}
/** 从 startIdx（指向 '('）提取顶层参数列表，处理嵌套与字符串 */
function extractArgs(s: string, openIdx: number): string[] {
  let depth = 0
  let quote: string | null = null
  const args: string[] = []
  let cur = ''
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      cur += c
      if (c === '\\') {
        cur += s[i + 1] ?? ''
        i++
      } else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      cur += c
      continue
    }
    if (c === '(' || c === '{' || c === '[') {
      depth++
      if (depth === 1) {
        cur = ''
        continue
      }
    } else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim())
        return args
      }
    } else if (c === ',' && depth === 1) {
      args.push(cur.trim())
      cur = ''
      continue
    }
    if (depth >= 1) cur += c
  }
  throw new Error('括号不匹配：函数调用未正确闭合')
}
/** 解析对象字面量的顶层属性 → [key, 值原文][]；非对象返回 null */
function parseObjectLiteral(text: string): Array<[string, string]> | null {
  const t = text.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  const inner = t.slice(1, -1).trim()
  if (!inner) return []
  const out: Array<[string, string]> = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  const parts: string[] = []
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (quote) {
      cur += c
      if (c === '\\') {
        cur += inner[i + 1] ?? ''
        i++
      } else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      cur += c
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  for (const p of parts) {
    // 找顶层第一个冒号
    let d = 0
    let q: string | null = null
    let colon = -1
    for (let i = 0; i < p.length; i++) {
      const c = p[i]!
      if (q) {
        if (c === '\\') i++
        else if (c === q) q = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        q = c
        continue
      }
      if (c === '(' || c === '{' || c === '[') d++
      else if (c === ')' || c === '}' || c === ']') d--
      else if (c === ':' && d === 0) {
        colon = i
        break
      }
    }
    if (colon < 0) return null
    const rawKey = p.slice(0, colon).trim()
    const k = unquote(rawKey).value
    out.push([k, p.slice(colon + 1).trim()])
  }
  return out
}
function isExpr(t: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$.[\]]*$/.test(t.trim()) || /\$\{|\$\(/.test(t)
}
/** curl 值检查：命令替换 / Shell 变量（自包含文案，不依赖展示层补充） */
function checkCommonValue(val: string, label: string, idx: number, warns: string[]) {
  if (val.includes('$(')) warns.push(`第 ${idx} 项：${label} 含命令替换 $(...)，请手动处理`)
  else if (/\$\{?[A-Za-z_]/.test(val)) warns.push(`第 ${idx} 项：${label} 含 Shell 变量/插值，请确认赋值`)
}
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/* ===================== curl 解析 ===================== */

function shellTokens(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n/g, ' ')
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let has = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      if (c === '\\' && quote === '"') {
        const n = s[i + 1]
        if (n === '"' || n === '\\' || n === '$') {
          cur += n!
          i++
          continue
        }
        cur += c
        continue
      }
      if (c === quote) {
        quote = null
        continue
      }
      cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (/\s/.test(c)) {
      if (cur || has) {
        out.push(cur)
        cur = ''
        has = false
      }
    } else {
      cur += c
    }
  }
  if (cur || has) out.push(cur)
  return out
}

const DATA_OPTS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'])

function parseCurl(cmd: string): ConvertResult {
  const warns: string[] = []
  const notes: string[] = []
  const tokens = shellTokens(cmd)
  let i = 0
  if (tokens[0] === 'curl') i = 1
  else notes.push('未检测到 curl 命令开头，仍按 curl 参数解析')
  const req: Req = { method: '', url: '', urlIsExpr: false, headers: [], body: null, bodyParsed: null, params: null }
  let methodSet = false
  const dataParts: string[] = []
  let idx = 0
  for (; i < tokens.length; i++) {
    idx = i + 1
    const t = tokens[i]!
    if (t === '--') continue
    if (t.startsWith('-') && t !== '-') {
      const m = /^(--[A-Za-z0-9-]+|-[A-Za-z]+)(?:=(.*))?$/.exec(t)
      if (!m) {
        warns.push(`第 ${idx} 项：无法识别的参数 ${t}，请手动处理`)
        continue
      }
      const opt = m[1]!
      const inline = m[2]
      const takeValue = (): { v: string; missing: boolean } => {
        if (inline !== undefined) return { v: inline, missing: false }
        const n = tokens[i + 1]
        if (n === undefined) return { v: '', missing: true }
        i++
        return { v: n, missing: false }
      }
      if (opt === '-X' || opt === '--request') {
        const { v, missing } = takeValue()
        if (missing || !v) warns.push(`第 ${idx} 项：-X/--request 缺少值，请手动处理`)
        else {
          req.method = v.toUpperCase()
          methodSet = true
        }
      } else if (opt === '-H' || opt === '--header') {
        const { v, missing } = takeValue()
        if (missing || !v) warns.push(`第 ${idx} 项：-H/--header 缺少值，请手动处理`)
        else {
          const hm = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(v)
          if (!hm) warns.push(`第 ${idx} 项：-H 值「${v}」缺少冒号分隔（应为 Key: Value），请手动处理`)
          else {
            checkCommonValue(v, `Header「${hm[1]}」`, idx, warns)
            req.headers.push({ key: hm[1]!, value: hm[2]! })
          }
        }
      } else if (DATA_OPTS.has(opt)) {
        const { v, missing } = takeValue()
        if (missing) warns.push(`第 ${idx} 项：${opt} 缺少值，请手动处理`)
        else if (v.startsWith('@')) warns.push(`第 ${idx} 项：@file 文件引用「${v}」（不会读取本地文件），请手动处理`)
        else {
          checkCommonValue(v, `请求体（${opt}）`, idx, warns)
          dataParts.push(v)
        }
      } else if (opt === '-u' || opt === '--user') {
        const { v, missing } = takeValue()
        if (missing || !v) warns.push(`第 ${idx} 项：-u/--user 缺少值，请手动处理`)
        else {
          try {
            req.headers.push({ key: 'Authorization', value: `Basic ${btoa(v)}` })
            notes.push('-u/--user 已转换为 Authorization: Basic 头（base64(user:pass)）')
          } catch {
            warns.push(`第 ${idx} 项：-u 值含非 Latin-1 字符，无法用 btoa 编码，请手动处理`)
          }
        }
      } else if (opt === '--url') {
        const { v, missing } = takeValue()
        if (missing || !v) warns.push(`第 ${idx} 项：--url 缺少值，请手动处理`)
        else req.url = v
      } else if (opt === '-I' || opt === '--head') {
        req.method = 'HEAD'
        methodSet = true
      } else if (opt === '-F' || opt === '--form') {
        warns.push(`第 ${idx} 项：--form/-F 多部分表单（multipart/form-data）暂不支持转换，请手动处理`)
        takeValue()
      } else if (opt === '--compressed') {
        notes.push('已忽略 --compressed（浏览器自动处理压缩）')
      } else if (opt === '-k' || opt === '--insecure') {
        notes.push('已忽略 -k / --insecure（浏览器始终校验证书）')
      } else if (opt === '-s' || opt === '--silent' || opt === '-L' || opt === '--location' || opt === '-v' || opt === '--verbose' || opt === '-i' || opt === '--include') {
        notes.push(`已忽略 ${opt}（不影响请求语义）`)
      } else {
        warns.push(`第 ${idx} 项：不支持的选项 ${opt}，请手动处理`)
        // 未知短选项可能带独立值：下一 token 不是选项且不像 URL 时按其值跳过（已警告）
        if (inline === undefined && !opt.startsWith('--')) {
          const n = tokens[i + 1]
          if (n !== undefined && !n.startsWith('-') && !/:\/\//.test(n) && !/^(https?:|www\.|\/)/.test(n)) i++
        }
      }
    } else if (!req.url) {
      req.url = t
      checkCommonValue(t, 'URL', idx, warns)
      if (isExpr(t) && !/:\/\//.test(t)) req.urlIsExpr = true
    } else {
      warns.push(`第 ${idx} 项：多余的位置参数「${t}」，请手动处理`)
    }
  }
  if (dataParts.length) {
    req.body = dataParts.join('&')
    if (dataParts.length > 1) notes.push('多个 --data 已按 curl 语义用 & 连接')
    if (!methodSet) req.method = 'POST'
  }
  if (!req.method) req.method = 'GET'
  if (!req.url) {
    throw new Error('未找到 URL：curl 命令中应有一个非选项的位置参数作为 URL（或使用 --url）')
  }
  if (req.body !== null) {
    const parsed = relaxedParse(req.body)
    if (parsed !== null && typeof parsed === 'object') req.bodyParsed = parsed
  }
  return { req, warns, notes }
}

/* ===================== fetch 解析 ===================== */

function parseFetch(code: string): ConvertResult {
  const warns: string[] = []
  const notes: string[] = []
  const m = /\bfetch\s*\(/.exec(code)
  if (!m) throw new Error('未找到 fetch( 调用')
  const args = extractArgs(code, m.index + m[0].length - 1)
  if (!args.length) throw new Error('fetch() 缺少参数')
  const req: Req = { method: '', url: '', urlIsExpr: false, headers: [], body: null, bodyParsed: null, params: null }
  // 第 1 项：url
  const u = unquote(args[0]!)
  if (u.quoted && !u.templateVar) req.url = u.value
  else if (u.quoted && u.templateVar) {
    req.url = args[0]!.trim()
    req.urlIsExpr = true
    warns.push('第 1 项：URL 为含 ${...} 插值的模板字符串，请确认赋值')
  } else {
    req.url = args[0]!.trim()
    req.urlIsExpr = true
    warns.push(`检测到变量 ${req.url}（第 1 项），请确认赋值`)
  }
  // 第 2 项：配置对象
  if (args[1]) {
    const props = parseObjectLiteral(args[1]!)
    if (!props) {
      if (isExpr(args[1]!)) warns.push(`检测到变量 ${args[1]!.trim()}（第 2 项，请求配置），请确认赋值`)
      else throw new Error('fetch 的第二个参数不是可识别的对象字面量')
    }
    for (const [k, v] of props ?? []) {
      if (k === 'method') {
        const mv = unquote(v)
        if (mv.quoted) req.method = mv.value.toUpperCase()
        else {
          req.method = v.trim().toUpperCase()
          warns.push(`第 2 项：method 为变量/表达式「${v.trim()}」，已按字面保留，请确认取值`)
        }
      } else if (k === 'headers') {
        const hv = v.trim()
        const hProps = parseObjectLiteral(hv)
        if (hProps) {
          for (const [hk, hval] of hProps) {
            const val = unquote(hval)
            req.headers.push({ key: hk, value: val.quoted ? val.value : hval.trim() })
            if (!val.quoted) warns.push(`第 2 项：header「${hk}」的值不是字符串字面量（${hval.trim()}），已按原文保留`)
          }
        } else if (isExpr(hv)) {
          warns.push(`检测到变量 ${hv}（headers），请确认赋值`)
        } else if (hv.toLowerCase() === 'new headers()') {
          notes.push('已忽略 new Headers()（空 Header 对象）')
        } else {
          warns.push(`第 2 项：headers 形式「${hv}」暂不支持，请手动处理`)
        }
      } else if (k === 'body') {
        const bv = v.trim()
        const js = /^JSON\s*\.\s*stringify\s*\(/.exec(bv)
        if (js) {
          const innerArgs = extractArgs(bv, bv.indexOf('(', js.index))
          const inner = innerArgs[0] ?? ''
          const parsed = relaxedParse(inner)
          if (parsed !== null && typeof parsed === 'object') {
            req.body = minifyJson(parsed)
            req.bodyParsed = parsed
          } else {
            req.body = inner
            warns.push('第 2 项：JSON.stringify(...) 内不是可安全解析的对象字面量，body 按原文保留')
          }
        } else {
          const sv = unquote(bv)
          if (sv.quoted && !sv.templateVar) req.body = sv.value
          else if (sv.quoted) {
            req.body = sv.value
            warns.push('第 2 项：body 为含插值的模板字符串，请确认赋值')
          } else if (isExpr(bv)) {
            req.body = bv
            warns.push(`检测到变量 ${bv}（body），请确认赋值`)
          } else {
            req.body = bv
            warns.push('第 2 项：body 形式复杂，已按原文保留，请确认')
          }
        }
      } else {
        notes.push(`已忽略 fetch 选项 ${k}（目标格式无对应语义）`)
      }
    }
  }
  if (!req.method) req.method = 'GET'
  if (req.bodyParsed === null && req.body !== null) {
    const parsed = relaxedParse(req.body)
    if (parsed !== null && typeof parsed === 'object') req.bodyParsed = parsed
  }
  return { req, warns, notes }
}

/* ===================== axios 解析 ===================== */

function parseAxios(code: string): ConvertResult {
  const warns: string[] = []
  const notes: string[] = []
  const req: Req = { method: '', url: '', urlIsExpr: false, headers: [], body: null, bodyParsed: null, params: null }
  let configProps: Array<[string, string]> | null = null
  let directData: string | null = null
  const call = /\baxios\s*\(/.exec(code)
  const mc = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options|request)\s*\(/.exec(code)
  if (mc) {
    req.method = mc[1]!.toUpperCase()
    const args = extractArgs(code, code.indexOf('(', mc.index))
    if (!args.length) throw new Error('axios.xxx() 缺少 URL 参数')
    const u = unquote(args[0]!)
    if (u.quoted && !u.templateVar) req.url = u.value
    else {
      req.url = args[0]!.trim()
      req.urlIsExpr = true
      warns.push(`检测到变量 ${req.url}（第 1 项，URL），请确认赋值`)
    }
    if (args[1] && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      directData = args[1]!
    }
    const cfgIdx = directData !== null ? 2 : 1
    if (args[cfgIdx]) {
      configProps = parseObjectLiteral(args[cfgIdx]!)
      if (!configProps) throw new Error('axios 的配置参数不是可识别的对象字面量')
    }
  } else if (call) {
    const args = extractArgs(code, call.index + call[0].length - 1)
    if (!args.length) throw new Error('axios() 缺少配置对象')
    configProps = parseObjectLiteral(args[0]!)
    if (!configProps) throw new Error('axios() 的参数不是可识别的对象字面量')
  } else {
    throw new Error('未找到 axios(...) 或 axios.get/post/...(...) 调用')
  }
  const applyConfig = (props: Array<[string, string]>) => {
    for (const [k, v] of props) {
      if (k === 'url') {
        const u = unquote(v)
        if (u.quoted && !u.templateVar && !req.url) req.url = u.value
        else if (!req.url) {
          req.url = v.trim()
          req.urlIsExpr = true
          warns.push(`检测到变量 ${req.url}（url），请确认赋值`)
        }
      } else if (k === 'method') {
        const mv = unquote(v)
        req.method = (mv.quoted ? mv.value : v.trim()).toUpperCase()
      } else if (k === 'headers') {
        const hProps = parseObjectLiteral(v.trim())
        if (hProps) {
          for (const [hk, hval] of hProps) {
            const val = unquote(hval)
            req.headers.push({ key: hk, value: val.quoted ? val.value : hval.trim() })
          }
        } else warns.push(`headers 形式「${v.trim()}」暂不支持，请手动处理`)
      } else if (k === 'data') {
        directData = v
      } else if (k === 'params') {
        const pProps = parseObjectLiteral(v.trim())
        if (pProps) {
          req.params = pProps.map(([pk, pv]) => {
            const val = unquote(pv)
            return { key: pk, value: val.quoted ? val.value : pv.trim() }
          })
        } else warns.push('params 不是可识别的对象字面量，请手动处理')
      } else if (k === 'baseURL') {
        warns.push('检测到 baseURL 配置：转换结果不会拼接 baseURL，请手动拼接')
      } else {
        notes.push(`已忽略 axios 配置 ${k}（目标格式无对应语义）`)
      }
    }
  }
  if (configProps) applyConfig(configProps)
  if (directData !== null) {
    const dv = directData.trim()
    const sv = unquote(dv)
    if (sv.quoted && !sv.templateVar) req.body = sv.value
    else if (isExpr(dv)) {
      req.body = dv
      warns.push(`检测到变量 ${dv}（data），请确认赋值`)
    } else {
      const parsed = relaxedParse(dv)
      if (parsed !== null && typeof parsed === 'object') {
        req.body = minifyJson(parsed)
        req.bodyParsed = parsed
      } else req.body = dv
    }
  }
  if (!req.method) req.method = 'GET'
  if (!req.url) throw new Error('未找到 URL（axios 配置中的 url 或方法调用的第一个参数）')
  if (req.bodyParsed === null && req.body !== null) {
    const parsed = relaxedParse(req.body)
    if (parsed !== null && typeof parsed === 'object') req.bodyParsed = parsed
  }
  return { req, warns, notes }
}

/* ===================== 生成 ===================== */

function urlWithParams(r: Req, quote: (s: string) => string): string {
  if (!r.params || !r.params.length) return r.urlIsExpr ? r.url : quote(r.url)
  const q = r.params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  const full = r.url + (r.url.includes('?') ? '&' : '?') + q
  return r.urlIsExpr ? full : quote(full)
}

function genFetch(r: Req, notes: string[], unit: string, lang: TargetLang): string {
  if (r.params && r.params.length) notes.push('已将 params 合并进 URL query（fetch/curl 无 params 配置）')
  const url = urlWithParams(r, jsQuote)
  const head = lang === 'ts' ? 'async function request(): Promise<Response> {' : 'async function request() {'
  const decl = lang === 'ts' ? 'const res: Response = ' : 'const res = '
  const body: string[] = []
  if (r.method === 'GET' && !r.body && !r.headers.length) {
    body.push(`${unit}${decl}await fetch(${url})`)
  } else {
    body.push(`${unit}${decl}await fetch(${url}, {`)
    body.push(`${unit}${unit}method: '${r.method}',`)
    if (r.headers.length) {
      body.push(`${unit}${unit}headers: {`)
      for (const h of r.headers) body.push(`${unit}${unit}${unit}${SAFE_KEY.test(h.key) ? h.key : jsQuote(h.key)}: ${jsQuote(h.value)},`)
      body.push(`${unit}${unit}},`)
    }
    if (r.body !== null) {
      if (r.bodyParsed !== null) body.push(`${unit}${unit}body: JSON.stringify(${minifyJson(r.bodyParsed)})`)
      else body.push(`${unit}${unit}body: ${jsQuote(r.body)}`)
    }
    body.push(`${unit}})`)
  }
  body.push(`${unit}return res`)
  return [head, ...body, '}'].join('\n')
}

/** 规整缩进的 JS 字面量打印（保留 RawNumber 原文，避免大整数丢精度） */
function prettyJs(v: unknown, indent: number, depth: number): string {
  if (v instanceof RawNumber) return v.raw
  if (v === null || typeof v !== 'object') return v === undefined ? 'null' : JSON.stringify(v) ?? 'null'
  const pad = ' '.repeat(indent * (depth + 1))
  const padClose = ' '.repeat(indent * depth)
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return '[\n' + v.map((x) => pad + prettyJs(x, indent, depth + 1)).join(',\n') + '\n' + padClose + ']'
  }
  const keys = Object.keys(v)
  if (!keys.length) return '{}'
  return '{\n' + keys.map((k) => `${pad}${JSON.stringify(k)}: ${prettyJs((v as Record<string, unknown>)[k], indent, depth + 1)}`).join(',\n') + '\n' + padClose + '}'
}

function genAxios(r: Req, unit: string, lang: TargetLang): string {
  const url = urlWithParams(r, jsQuote)
  const lines: string[] = [lang === 'ts' ? 'const res: AxiosResponse = await axios({' : 'axios({']
  lines.push(`${unit}url: ${url},`)
  lines.push(`${unit}method: '${r.method.toLowerCase()}',`)
  if (r.headers.length) {
    lines.push(`${unit}headers: {`)
    for (const h of r.headers) lines.push(`${unit}${unit}${SAFE_KEY.test(h.key) ? h.key : jsQuote(h.key)}: ${jsQuote(h.value)},`)
    lines.push(`${unit}},`)
  }
  if (r.params && r.params.length) {
    lines.push(`${unit}params: {`)
    for (const p of r.params) lines.push(`${unit}${unit}${SAFE_KEY.test(p.key) ? p.key : jsQuote(p.key)}: ${jsQuote(p.value)},`)
    lines.push(`${unit}},`)
  }
  if (r.body !== null) {
    if (r.bodyParsed !== null) lines.push(`${unit}data: ${prettyJs(r.bodyParsed, unit.length, 1)}`)
    else lines.push(`${unit}data: ${jsQuote(r.body)}`)
  }
  lines.push('})')
  const code = lines.join('\n')
  return lang === 'ts' ? `import type { AxiosResponse } from 'axios'\n\n${code}` : code
}

function genCurl(r: Req, notes: string[], unit: string): string {
  if (r.params && r.params.length) notes.push('已将 params 合并进 URL query（fetch/curl 无 params 配置）')
  const url = urlWithParams(r, shQuote)
  const lines: string[] = [`curl ${url}`]
  if (r.method !== 'GET' || r.body !== null) lines.push(`${unit}-X ${r.method}`)
  for (const h of r.headers) lines.push(`${unit}-H ${shQuote(`${h.key}: ${h.value}`)}`)
  if (r.body !== null) lines.push(`${unit}--data-raw ${shQuote(r.body)}`)
  return lines.join(' \\\n')
}

/* ===================== 执行 ===================== */

function execute() {
  srcErr.value = ''
  output.value = ''
  result.value = null
  if (!src.value.trim()) {
    run.markIdle()
    return
  }
  try {
    let r: ConvertResult
    if (sourceFmt.value === 'curl') r = parseCurl(src.value)
    else if (sourceFmt.value === 'fetch') r = parseFetch(src.value)
    else r = parseAxios(src.value)
    const notes = [...r.notes]
    const processed = processHeaders(r.req!)
    if (processed.redacted) notes.push(`凭证类 header 已替换为占位符（${processed.redacted} 项），未输出原值`)
    if (processed.removed) notes.push(`凭证类 header 已移除（${processed.removed} 项）`)
    const req = processed.req
    let code: string
    if (targetFmt.value === 'fetch') code = genFetch(req, notes, indentUnit.value, targetLang.value)
    else if (targetFmt.value === 'axios') code = genAxios(req, indentUnit.value, targetLang.value)
    else code = genCurl(req, notes, indentUnit.value)
    output.value = code
    result.value = { req, warns: r.warns, notes }
    const parts = [
      `${req.method} ${req.urlIsExpr ? req.url : ''}`.trim(),
      `Header ${req.headers.length} 项`,
      req.body !== null ? `Body ${byteLength(req.body)} 字节` : '无 Body'
    ]
    const warnNote = r.warns.length ? `；${r.warns.length} 项警告需人工确认` : ''
    run.markOk(`${parts.join(' / ')}${warnNote}。本工具仅转换，不执行任何请求。`)
  } catch (e) {
    result.value = null
    srcErr.value = errMessage(e)
    run.markFail(`${sourceFmt.value} 解析失败：${srcErr.value}（输入已保留，请修正后重新转换）`)
  }
}

function loadSample() {
  src.value = SAMPLES[sourceFmt.value]!
  execute()
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
  <div class="t35">
    <div class="t35__toolbar">
      <span class="t35__tl">方向</span>
      <DkSegmented :model-value="direction" :options="DIRS" @update:model-value="direction = $event as Direction" />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入当前方向的 POST JSON 示例（不含真实凭证）" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!output || run.status.value === 'stale'" @click="clipboard.copy(output, '目标代码')">
        <DkIcon name="copy" :size="12" />
        复制目标代码
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="arrow-right" :size="12" />
        转换
      </DkButton>
      <span class="t35__kbd tertiary">⌘/Ctrl + Enter 转换</span>
    </div>

    <div class="t35__params">
      <div class="t35__opt" :class="{ 't35__opt--off': targetFmt === 'curl' }" :title="targetFmt === 'curl' ? '目标为 curl（bash），无 JavaScript / TypeScript 之分' : 'TypeScript 目标会为结果变量加类型标注并输出类型 import'">
        <span class="t35__opt-label">目标语言</span>
        <DkSegmented
          size="sm"
          :model-value="targetLang"
          :options="[
            { value: 'js', label: 'JavaScript' },
            { value: 'ts', label: 'TypeScript' }
          ]"
          @update:model-value="targetLang = $event as TargetLang"
        />
      </div>
      <div class="t35__opt">
        <span class="t35__opt-label">凭证处理</span>
        <DkSegmented
          size="sm"
          :model-value="credMode"
          :options="[
            { value: 'placeholder', label: '保留占位' },
            { value: 'remove', label: '移除' }
          ]"
          @update:model-value="credMode = $event as 'placeholder' | 'remove'"
        />
      </div>
      <div class="t35__opt">
        <span class="t35__opt-label">缩进</span>
        <DkSegmented
          size="sm"
          :model-value="indent"
          :options="[
            { value: '2', label: '2 空格' },
            { value: '4', label: '4 空格' }
          ]"
          @update:model-value="indent = $event as '2' | '4'"
        />
      </div>
      <span class="grow"></span>
      <span class="tertiary t35__cred-note">凭证类 header 默认替换为占位符，不会输出原值</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[`${sourceFmt} → ${targetFmt}`, targetFmt === 'curl' ? 'bash' : targetLang === 'ts' ? 'TypeScript' : 'JavaScript', `缩进 ${indent} 空格`]"
      :retry="execute"
    />

    <div v-if="result && result.req" class="t35__summary">
      <span class="t35__summary-label">中间预览</span>
      <span class="t35__pill t35__pill--accent">{{ result.req.method }}</span>
      <span class="mono t35__summary-url">{{ result.req.url }}</span>
      <span class="grow"></span>
      <span class="t35__pill">{{ result.req.headers.length }} 个 header</span>
      <span class="t35__pill">{{ result.req.body !== null ? (result.req.bodyParsed !== null ? 'JSON body' : 'body') : '无 body' }}</span>
    </div>

    <div class="t35__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="src"
            :lang="`${sourceFmt} 源码`"
            :error="run.status.value === 'error' ? srcErr : undefined"
            :placeholder="`粘贴 ${sourceFmt} 代码（示例：POST JSON 请求，不含真实凭证）`"
            :height="'calc(46vh - 60px)'"
            :filename="`source-${sourceFmt}.txt`"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="`${targetFmt} 代码`"
            placeholder="目标代码将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(46vh - 60px)'"
            :filename="`converted-${targetFmt}.txt`"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="result && result.req" class="t35__mid">
      <div class="t35__card">
        <div class="t35__card-head">结构化预览（中间表示）</div>
        <div class="t35__kv">
          <div class="t35__kv-row">
            <span class="t35__kv-k">Method</span>
            <span class="t35__kv-v mono">{{ result.req.method }}</span>
          </div>
          <div class="t35__kv-row">
            <span class="t35__kv-k">URL</span>
            <span class="t35__kv-v mono">{{ result.req.url }}<span v-if="result.req.urlIsExpr" class="t35__tag t35__tag--warn">变量/表达式</span></span>
          </div>
          <div class="t35__kv-row">
            <span class="t35__kv-k">Headers（{{ result.req.headers.length }}）</span>
            <span class="t35__kv-v">
              <template v-if="result.req.headers.length">
                <code v-for="h in result.req.headers" :key="h.key + h.value" class="t35__hdr mono">{{ h.key }}: {{ h.value }}</code>
              </template>
              <span v-else class="tertiary">无</span>
            </span>
          </div>
          <div v-if="result.req.params && result.req.params.length" class="t35__kv-row">
            <span class="t35__kv-k">params（{{ result.req.params.length }}）</span>
            <span class="t35__kv-v">
              <code v-for="p in result.req.params" :key="p.key + p.value" class="t35__hdr mono">{{ p.key }}={{ p.value }}</code>
            </span>
          </div>
          <div class="t35__kv-row">
            <span class="t35__kv-k">Body</span>
            <span v-if="result.req.body !== null" class="t35__kv-v mono t35__body">{{ result.req.body }}<span v-if="result.req.bodyParsed !== null" class="t35__tag">JSON 对象</span></span>
            <span v-else class="t35__kv-v tertiary">无</span>
          </div>
        </div>
      </div>

      <div v-if="result.warns.length || result.notes.length" class="t35__card">
        <div class="t35__card-head">
          转换提示
          <span class="tertiary t35__card-note">不支持项全部列出，不静默丢弃</span>
        </div>
        <div class="t35__warns">
          <p v-for="(w, i) in result.warns" :key="'w' + i" class="t35__warn">
            <DkIcon name="alert-triangle" :size="13" />
            {{ w }}
          </p>
          <p v-for="(n, i) in result.notes" :key="'n' + i" class="t35__note">
            <DkIcon name="info" :size="13" />
            {{ n }}
          </p>
        </div>
      </div>
    </div>

    <DkCollapse title="转换能力与限制">
      <h4>选项</h4>
      <ul>
        <li>方向预设固定为 <code>curl → fetch</code>、<code>fetch → curl</code>、<code>curl → Axios</code> 三种。</li>
        <li>凭证处理：<code>Authorization</code>、<code>Cookie</code>、<code>X-Api-Key</code> 等凭证类 header <strong>默认替换为占位符</strong>（<code>&lt;REDACTED&gt;</code>），选择「移除」则从输出中删除；两种模式都不会输出原值。</li>
        <li>目标语言：目标为 fetch / Axios 时可选 JavaScript 或 TypeScript；TypeScript 会加结果类型标注（fetch → <code>Response</code>，Axios → <code>AxiosResponse</code> 及类型 import）；目标为 curl（bash）时该选项不可用。</li>
        <li>缩进：2 / 4 空格，应用于生成代码的层级缩进与 curl 续行。</li>
      </ul>
      <h4>解析与限制</h4>
      <ul>
        <li>curl 解析：先合并 <code>\</code> 续行，再按 shell 规则分词（引号内空格保留）；位置参数即 URL，<code>-X/--request</code>、<code>-H/--header</code>（多个）、<code>-d/--data/--data-raw/--data-binary</code>（有则 method 默认 POST）、<code>-u/--user</code>（转 Authorization: Basic）。</li>
        <li><code>--compressed</code>、<code>-k</code> 等安全忽略并提示；命令替换 <code>$(...)</code>/反引号、<code>@file</code> 文件引用、<code>--form/-F</code> multipart 会进入警告清单，需人工处理。</li>
        <li>fetch 解析：手写扫描提取 URL 首参、<code>method</code>、<code>headers</code> 键值、<code>body</code>（<code>JSON.stringify(...)</code> 字面量展开为对象）；变量原样保留并警告。</li>
        <li>axios 生成/解析支持 <code>axios({...})</code> 与 <code>axios.get/post/put/patch/delete(url, ...)</code> 两种形式；<code>params</code> 在转 fetch/curl 时合并进 URL query。</li>
        <li>仅做静态文本转换，不执行任何请求、不运行 Shell、不读取本地文件；所有生成结果均为合法代码文本（JavaScript 目标可用 <code>node --check</code> 校验）。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t35 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t35__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t35__tl {
  font-size: 12px;
  color: var(--text-secondary);
}
.t35__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t35__params {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.t35__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t35__opt--off {
  opacity: 0.45;
  pointer-events: none;
}
.t35__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t35__cred-note {
  font-size: 11.5px;
}
.t35__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  flex-wrap: wrap;
}
.t35__summary-label {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.t35__summary-url {
  font-size: 11.5px;
  color: var(--text-primary);
  word-break: break-all;
}
.t35__pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
}
.t35__pill--accent {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.t35__panes {
  min-height: 280px;
}
.t35__mid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 900px) {
  .t35__mid {
    grid-template-columns: 1fr;
  }
}
.t35__card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t35__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.t35__card-note {
  font-weight: 400;
  font-size: 11.5px;
}
.t35__kv {
  padding: 6px 12px 10px;
}
.t35__kv-row {
  display: flex;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.t35__kv-row:last-child {
  border-bottom: none;
}
.t35__kv-k {
  width: 110px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
  padding-top: 1px;
}
.t35__kv-v {
  min-width: 0;
  color: var(--text-primary);
  word-break: break-all;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
}
.t35__hdr {
  background: var(--surface-subtle);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
}
.t35__body {
  display: block;
  white-space: pre-wrap;
}
.t35__tag {
  display: inline-block;
  font-size: 11px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-ui);
}
.t35__tag--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.t35__warns {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.t35__warn,
.t35__note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.55;
}
.t35__warn {
  color: var(--warn);
}
.t35__note {
  color: var(--text-secondary);
}
</style>
