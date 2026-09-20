<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

/**
 * T20 Cron 解析与执行预览
 * 解析器与未来执行搜索为独立实现，已在 node 中对照验证：
 * - L（月末/最后一个周X）、nW（最近工作日）、n#m（第 m 个周X）
 * - Quartz 1=周日…7=周六；Unix 0/7=周日；Vixie 日/周同时受限取 OR
 * - 未来执行：逐分钟步进 + 月/日/时跳跃剪枝，迭代上限 500 万，horizon（无年字段为起点 +29 年）
 * - 夏令时跳变产生的不存在墙钟时刻不触发（如 NY 2026-03-08 02:30）
 */

const ZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' }
]

const dialect = ref<'unix' | 'quartz'>('unix')
const expr = ref('*/15 * * * *')
const tz = ref('Asia/Shanghai')
const startLocal = ref('')

const clipboard = useClipboard()
const toast = useToast()

const sig = () => JSON.stringify([dialect.value, expr.value, tz.value, startLocal.value])
const run = useToolRun(sig)

// ---------- 字段定义 ----------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const QUARTZ_DOW_NAME: Record<number, string> = { 1: '周日', 2: '周一', 3: '周二', 4: '周三', 5: '周四', 6: '周五', 7: '周六' }
const UNIX_DOW_NAME: Record<number, string> = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

interface FieldDef {
  name: string
  kind: 'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow' | 'year'
  min: number
  max: number
  quartz?: boolean
  nameVal?: (s: string, f: FieldDef) => number
}

const monthNameVal = (s: string): number => {
  const i = MONTHS.indexOf(s)
  if (i < 0) throw new Error(`字段「月」的名称「${s}」无法识别（支持 JAN-DEC）`)
  return i + 1
}

function fieldDefs(quartz: boolean): FieldDef[] {
  if (!quartz) {
    return [
      { name: '分', kind: 'minute', min: 0, max: 59 },
      { name: '时', kind: 'hour', min: 0, max: 23 },
      { name: '日', kind: 'dom', min: 1, max: 31 },
      { name: '月', kind: 'month', min: 1, max: 12, nameVal: monthNameVal },
      {
        name: '周',
        kind: 'dow',
        min: 0,
        max: 7,
        nameVal: (s) => {
          if (/^\d$/.test(s)) return +s
          const i = DOWS.indexOf(s)
          if (i < 0) throw new Error(`字段「周」的名称「${s}」无法识别（支持 SUN-SAT 或 0-7，0/7=周日）`)
          return i
        }
      }
    ]
  }
  return [
    { name: '秒', kind: 'second', min: 0, max: 59 },
    { name: '分', kind: 'minute', min: 0, max: 59 },
    { name: '时', kind: 'hour', min: 0, max: 23 },
    { name: '日', kind: 'dom', min: 1, max: 31, quartz: true },
    { name: '月', kind: 'month', min: 1, max: 12, nameVal: monthNameVal },
    {
      name: '周',
      kind: 'dow',
      min: 1,
      max: 7,
      quartz: true,
      nameVal: (s) => {
        if (/^\d$/.test(s)) return +s
        const i = DOWS.indexOf(s)
        if (i < 0) throw new Error(`字段「周」的名称「${s}」无法识别（支持 SUN-SAT 或 1-7，1=周日）`)
        return i + 1
      }
    }
  ]
}

// ---------- 字段解析 ----------

type FieldMatcher =
  | { type: 'set'; vals: Set<number> }
  | { type: 'any' }
  | { type: 'domL' }
  | { type: 'domLW' }
  | { type: 'domW'; n: number }
  | { type: 'dowNL'; n: number }
  | { type: 'dowNth'; n: number; k: number }

function parseField(raw: string, f: FieldDef): FieldMatcher {
  const t = raw.trim().toUpperCase()
  if (!t) throw new Error(`字段「${f.name}」为空`)
  const sp = t.replace(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT/g, '').match(/[LW#?]/g)
  if (sp) {
    const ch = sp[0]!
    if (ch === '?') {
      if (!f.quartz) throw new Error('Unix 五字段方言不支持 ?，请使用 *')
      if (f.kind !== 'dom' && f.kind !== 'dow') throw new Error(`? 只能用于「日」或「周」字段，不能用于「${f.name}」`)
      return { type: 'any' }
    }
    if (!f.quartz) {
      if (f.kind === 'dom' || f.kind === 'dow') throw new Error(`Unix 五字段方言不支持 ${ch}（L/W/# 为 Quartz 扩展）`)
      throw new Error(`字段「${f.name}」不支持 ${ch}（L/W/# 仅适用于「日」「周」字段）`)
    }
    if (f.kind === 'dom') {
      if (t === 'L') return { type: 'domL' }
      if (t === 'LW') return { type: 'domLW' }
      const mw = t.match(/^(\d{1,2})W$/)
      if (mw) {
        const n = +mw[1]!
        if (n < 1 || n > 31) throw new Error(`字段「日」的值 ${n} 超出范围 1-31`)
        return { type: 'domW', n }
      }
      throw new Error(`字段「日」的 L/W 语法「${raw}」无法识别（支持 L、LW、nW）`)
    }
    if (f.kind === 'dow') {
      if (t === 'L') return { type: 'set', vals: new Set([7]) } // Quartz：周字段 L = 7 = 周六
      const dl = t.match(/^(\d)L$/)
      if (dl) {
        const n = +dl[1]!
        if (n < 1 || n > 7) throw new Error(`字段「周」的值 ${n} 超出范围 1-7`)
        return { type: 'dowNL', n }
      }
      const sh = t.match(/^(\d)#(\d)$/)
      if (sh) {
        const n = +sh[1]!
        const k = +sh[2]!
        if (n < 1 || n > 7) throw new Error(`字段「周」的值 ${n} 超出范围 1-7`)
        if (k < 1 || k > 5) throw new Error(`# 序号 ${k} 超出范围 1-5（每月最多第 5 个周X）`)
        return { type: 'dowNth', n, k }
      }
      throw new Error(`字段「周」的 L/# 语法「${raw}」无法识别（支持 L、nL、n#m）`)
    }
    throw new Error(`字段「${f.name}」不支持 ${ch}`)
  }
  const vals = new Set<number>()
  for (const part of t.split(',')) {
    const p = part.trim()
    if (!p) throw new Error(`字段「${f.name}」存在空列表项（检查多余逗号）`)
    let step = 1
    let range = p
    const si = p.indexOf('/')
    if (si >= 0) {
      range = p.slice(0, si)
      const sv = p.slice(si + 1)
      if (!/^\d+$/.test(sv) || +sv < 1) throw new Error(`字段「${f.name}」的步进「${sv}」非法（应为正整数）`)
      step = +sv
    }
    let lo: number, hi: number
    if (range === '*') {
      lo = f.min
      hi = f.max
    } else if (/^\d+$/.test(range)) {
      lo = +range
      hi = si >= 0 ? f.max : lo
    } else if (/^[A-Z]+$/.test(range)) {
      if (!f.nameVal) throw new Error(`字段「${f.name}」不支持名称「${range}」`)
      lo = hi = f.nameVal(range, f)
    } else {
      const rm = range.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/)
      if (!rm) throw new Error(`字段「${f.name}」的取值「${part}」无法识别（支持 *、数字、a-b、a,b,c、x/n、名称）`)
      if (!f.nameVal && (isNaN(+rm[1]!) || isNaN(+rm[2]!))) throw new Error(`字段「${f.name}」的取值「${part}」无法识别`)
      lo = f.nameVal ? f.nameVal(rm[1]!, f) : +rm[1]!
      hi = f.nameVal ? f.nameVal(rm[2]!, f) : +rm[2]!
      if (lo > hi) throw new Error(`字段「${f.name}」的区间 ${rm[1]}-${rm[2]} 起点大于终点`)
    }
    if (lo < f.min || lo > f.max || hi < f.min || hi > f.max) {
      throw new Error(`字段「${f.name}」的取值「${part}」超出范围 ${f.min}-${f.max}`)
    }
    for (let v = lo; v <= hi; v += step) vals.add(v)
  }
  if (!vals.size) throw new Error(`字段「${f.name}」未匹配任何值`)
  return { type: 'set', vals }
}

interface ParsedField {
  def: FieldDef
  raw: string
  m: FieldMatcher
}

interface Cron {
  quartz: boolean
  fields: ParsedField[]
}

function parseCron(expression: string, quartz: boolean): Cron {
  const fs = expression.trim().split(/\s+/)
  let defs = fieldDefs(quartz)
  if (!quartz) {
    if (fs.length !== 5) throw new Error(`Unix 五字段方言需要 5 个字段（分 时 日 月 周），当前 ${fs.length} 个`)
  } else {
    if (fs.length !== 6 && fs.length !== 7) throw new Error(`Quartz 方言需要 6 或 7 个字段（秒 分 时 日 月 周 [年]），当前 ${fs.length} 个`)
    if (fs.length === 7) defs = [...defs, { name: '年', kind: 'year', min: 1970, max: 2199 }]
  }
  const fields = defs.map((d, i) => ({ def: d, raw: fs[i]!, m: parseField(fs[i]!, d) }))
  const dom = fields.find((p) => p.def.kind === 'dom')!
  const dow = fields.find((p) => p.def.kind === 'dow')!
  if (quartz) {
    const domAny = dom.m.type === 'any'
    const dowAny = dow.m.type === 'any'
    if (!domAny && !dowAny) throw new Error('Quartz 方言要求「日」与「周」必须有一个为 ?（当前二者都指定了值）')
    if (domAny && dowAny) throw new Error('Quartz 方言的「日」与「周」不能同时为 ?，至少指定一个')
  }
  return { quartz, fields }
}

// ---------- 日期/周匹配 ----------

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

function dayMatch(cron: Cron, y: number, m0: number, d: number): boolean {
  const dom = cron.fields.find((p) => p.def.kind === 'dom')!
  const dow = cron.fields.find((p) => p.def.kind === 'dow')!
  const last = daysInMonth(y, m0)
  const js = new Date(Date.UTC(y, m0, d)).getUTCDay()
  const qz = js + 1
  const domHit = () => {
    const t = dom.m.type
    if (t === 'set') return dom.m.vals.has(d)
    if (t === 'domL') return d === last
    if (t === 'domLW') {
      let x = last
      const wd = new Date(Date.UTC(y, m0, x)).getUTCDay()
      if (wd === 6) x -= 1
      else if (wd === 0) x -= 2
      return d === x
    }
    if (t === 'domW') {
      const n = dom.m.n
      let x = n
      const wd = new Date(Date.UTC(y, m0, n)).getUTCDay()
      if (wd === 6) x = n - 1 >= 1 ? n - 1 : n + 2
      else if (wd === 0) x = n + 1 <= last ? n + 1 : n - 2
      return d === x
    }
    return false
  }
  const dowHit = () => {
    const t = dow.m.type
    if (t === 'set') {
      if (cron.quartz) return dow.m.vals.has(qz)
      return dow.m.vals.has(js) || (js === 0 && dow.m.vals.has(7))
    }
    if (t === 'dowNL') return qz === dow.m.n && d + 7 > last
    if (t === 'dowNth') return qz === dow.m.n && Math.ceil(d / 7) === dow.m.k
    return false
  }
  if (cron.quartz) return dom.m.type === 'any' ? dowHit() : domHit()
  // Unix（Vixie）：日与周同时受限时为 OR，否则 AND
  const full = (p: ParsedField) => {
    if (p.m.type !== 'set') return false
    for (let v = p.def.min; v <= p.def.max; v++) if (!p.m.vals.has(v)) return false
    return true
  }
  const ds = full(dom)
  const ws = full(dow)
  if (!ds && !ws) return domHit() || dowHit()
  return domHit() && dowHit()
}

// ---------- 时区工具 ----------

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function tzOffsetMin(zone: string, date: Date): number {
  let dtf = dtfCache.get(zone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
    dtfCache.set(zone, dtf)
  }
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(+map.year!, +map.month! - 1, +map.day!, map.hour === '24' ? 0 : +map.hour!, +map.minute!, +map.second!)
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

// ---------- 未来执行搜索 ----------

const MAX_ITER = 5_000_000

interface Fire {
  wall: number
  utc: number
}

function nextRuns(cron: Cron, zone: string, startWall: number, count: number): { fires: Fire[]; notFound?: string } {
  const get = (k: string) => cron.fields.find((p) => p.def.kind === k)!
  const secSet = cron.quartz ? [...(get('second').m as { vals: Set<number> }).vals].sort((a, b) => a - b) : [0]
  const minSet = [...(get('minute').m as { vals: Set<number> }).vals].sort((a, b) => a - b)
  const hourSet = [...(get('hour').m as { vals: Set<number> }).vals].sort((a, b) => a - b)
  const monSet = [...(get('month').m as { vals: Set<number> }).vals]
  const yearM = get('year')?.m as { type: string; vals: Set<number> } | undefined
  const fires: Fire[] = []
  let wall = startWall
  let off: number
  {
    const o0 = tzOffsetMin(zone, new Date(wall))
    off = tzOffsetMin(zone, new Date(wall - o0 * 60000))
  }
  const y0 = new Date(startWall).getUTCFullYear()
  const horizon = yearM && yearM.type === 'set' ? Math.max(...yearM.vals) : y0 + 29
  let iter = 0
  const sync = (target: number) => {
    let o = tzOffsetMin(zone, new Date(target - off * 60000))
    let utc = target - o * 60000
    const o2 = tzOffsetMin(zone, new Date(utc))
    if (o2 !== o) {
      o = o2
      utc = target - o * 60000
    }
    off = o
    return utc + o * 60000
  }
  while (fires.length < count && iter < MAX_ITER) {
    iter++
    const wd = new Date(wall)
    const y = wd.getUTCFullYear()
    if (y > horizon) return { fires, notFound: `已搜索至 ${horizon} 年（${yearM ? '年字段上限' : '起点 +29 年（覆盖星期/日期对齐周期）'}）未找到执行时间` }
    const m0 = wd.getUTCMonth()
    const d = wd.getUTCDate()
    const h = wd.getUTCHours()
    if (yearM && yearM.type === 'set' && !yearM.vals.has(y)) {
      wall = sync(Date.UTC(y + 1, 0, 1))
      continue
    }
    if (!monSet.includes(m0 + 1)) {
      wall = sync(Date.UTC(y, m0 + 1, 1))
      continue
    }
    if (!dayMatch(cron, y, m0, d)) {
      wall = sync(Date.UTC(y, m0, d + 1))
      continue
    }
    const nh = hourSet.find((v) => v >= h)
    if (nh === undefined || nh > h) {
      wall = nh === undefined ? sync(Date.UTC(y, m0, d + 1)) : sync(Date.UTC(y, m0, d, nh))
      continue
    }
    for (const m of minSet) {
      for (const s of secSet) {
        const t = Date.UTC(y, m0, d, h, m, s)
        if (t <= startWall) continue
        const inst = t - off * 60000
        if (tzOffsetMin(zone, new Date(inst)) !== off) continue // 墙钟时刻不存在（夏令时跳变区间）
        fires.push({ wall: t, utc: inst })
        if (fires.length >= count) return { fires }
      }
    }
    const nh2 = hourSet.find((v) => v > h)
    wall = nh2 === undefined ? sync(Date.UTC(y, m0, d + 1)) : sync(Date.UTC(y, m0, d, nh2))
  }
  return { fires, notFound: fires.length < count ? '已达 500 万次迭代上限仍未找齐执行时间，表达式可能永不触发' : undefined }
}

// ---------- 分字段中文解释 ----------

const UNIT_WORD: Record<string, string> = {
  second: '秒',
  minute: '分钟',
  hour: '小时',
  dom: '日',
  month: '月',
  dow: '星期',
  year: '年'
}

function describeField(pf: ParsedField, quartz: boolean): string {
  const f = pf.def
  const m = pf.m
  if (m.type === 'any') return '不指定（该字段交由另一字段决定，Quartz 专用 ?）'
  if (m.type === 'domL') return '每月最后一天'
  if (m.type === 'domLW') return '每月最后一个工作日（周一至周五）'
  if (m.type === 'domW') return `离 ${m.n} 号最近的工作日（周六→前移周五、周日→后移周一，不跨月）`
  if (m.type === 'dowNL') return `每月最后一个${QUARTZ_DOW_NAME[m.n]}`
  if (m.type === 'dowNth') return `每月第 ${m.k} 个${QUARTZ_DOW_NAME[m.n]}`
  const vals = [...m.vals].sort((a, b) => a - b)
  const unit = UNIT_WORD[f.kind]!
  if (f.kind === 'dow') {
    const names = (v: number) => cronDowNameFor(quartz, v)
    if (vals.length === f.max - f.min + 1) return `每一${unit}（${quartz ? '1=周日…7=周六' : '0/7=周日'}）`
    if (vals.length === 1) return `仅${names(vals[0]!)}`
    return `在 ${vals.map((v) => names(v)).join('、')}`
  }
  if (vals.length === f.max - f.min + 1) return `任意值（每一${unit}）`
  if (vals.length === 1) return f.kind === 'dom' ? `仅每月 ${vals[0]} 号` : `仅 ${vals[0]}（${unit}）`
  // 步进识别：等差
  const step = vals.length > 1 ? vals[1]! - vals[0]! : 0
  const arithmetic = step > 1 && vals.every((v, i) => i === 0 || v - vals[i - 1]! === step)
  if (arithmetic && vals[0] === f.min && vals[vals.length - 1]! > f.max - step) {
    return `每 ${step} ${unit}（从 ${vals[0]} 开始：${vals.slice(0, 6).join('、')}${vals.length > 6 ? '…' : ''}）`
  }
  if (arithmetic) {
    return `从 ${vals[0]} 开始每 ${step} ${unit}，到 ${vals[vals.length - 1]} 为止`
  }
  // 连续区间
  const contiguous = vals.every((v, i) => i === 0 || v - vals[i - 1]! === 1)
  if (contiguous) return `${vals[0]} 到 ${vals[vals.length - 1]}（含两端，${unit}）`
  const shown = vals.slice(0, 10).map((v) => v).join('、')
  return `在 ${shown}${vals.length > 10 ? ` …（共 ${vals.length} 个值）` : `（${unit}）`}`
}

const cronDowNameFor = (quartz: boolean, v: number) => (quartz ? QUARTZ_DOW_NAME : UNIX_DOW_NAME)[v] ?? String(v)

// ---------- 结果状态 ----------

interface FieldRow {
  name: string
  range: string
  raw: string
  desc: string
}

const fieldRows = ref<FieldRow[]>([])
const fireList = ref<{ local: string; utc: string; rel: string }[]>([])
const notFoundNote = ref('')
const exprErr = ref('')
const dialectNote = ref('')
const computedNow = ref(0)

function parseStartWall(): number | null {
  const t = startLocal.value.trim()
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6]! : 0)
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function wallString(wallMs: number): string {
  const d = new Date(wallMs)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function relFromNow(ms: number): string {
  const a = ms - computedNow.value
  const abs = Math.abs(a)
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟后`
  if (abs < 86_400_000) return `${(abs / 3_600_000).toFixed(1)} 小时后`
  return `${Math.round(abs / 86_400_000)} 天后`
}

function execute() {
  computedNow.value = Date.now()
  fieldRows.value = []
  fireList.value = []
  notFoundNote.value = ''
  dialectNote.value = ''
  const e = expr.value.trim()
  if (!e) {
    exprErr.value = ''
    run.markIdle()
    return
  }
  const quartz = dialect.value === 'quartz'
  let cronParsed: Cron
  try {
    cronParsed = parseCron(e, quartz)
  } catch (err) {
    exprErr.value = errMessage(err)
    run.markFail(exprErr.value)
    return
  }
  exprErr.value = ''
  fieldRows.value = cronParsed.fields.map((pf) => ({
    name: pf.def.name,
    range: `${pf.def.min}-${pf.def.max}`,
    raw: pf.raw,
    desc: describeField(pf, quartz)
  }))
  if (quartz) {
    dialectNote.value = 'Quartz 方言：周字段 1=周日…7=周六；「日」与「周」必须有一个为 ?；支持 L / W / # 扩展'
  } else {
    const dom = cronParsed.fields.find((p) => p.def.kind === 'dom')!
    const dow = cronParsed.fields.find((p) => p.def.kind === 'dow')!
    const restricted = (pf: ParsedField) => {
      if (pf.m.type !== 'set') return true
      for (let v = pf.def.min; v <= pf.def.max; v++) if (!pf.m.vals.has(v)) return true
      return false
    }
    dialectNote.value =
      restricted(dom) && restricted(dow)
        ? 'Unix 五字段方言：周字段 0/7=周日；「日」与「周」同时受限时按 Vixie 语义取并集（OR，任一匹配即触发）'
        : 'Unix 五字段方言：周字段 0/7=周日；不支持 ?、L、W、#（Quartz 扩展）'
  }
  const startWall = parseStartWall()
  if (startWall === null) {
    run.markFail('预览起始时间无效：请填写 datetime-local 格式（YYYY-MM-DDTHH:mm:ss）')
    return
  }
  const { fires, notFound } = nextRuns(cronParsed, tz.value, startWall, 10)
  fireList.value = fires.map((f) => ({
    local: wallString(f.wall),
    utc: new Date(f.utc).toISOString().slice(0, 19).replace('T', ' '),
    rel: relFromNow(f.utc)
  }))
  if (notFound) {
    notFoundNote.value = `未在可搜索范围内找到${fires.length < 10 ? '更多' : ''}执行时间，表达式可能永不触发：${notFound}`
    if (!fires.length) {
      run.markFail(notFoundNote.value)
      return
    }
    run.markOk(`已找到 ${fires.length} 次执行（${notFoundNote.value}）`)
  } else {
    run.markOk(`表达式有效 · 未来 10 次执行已按 ${tz.value} 计算`)
  }
}

watch([expr, dialect, tz, startLocal], execute)

onMounted(() => {
  fillNow()
  execute()
})

// ---------- 工具栏 ----------

function fillNow() {
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz.value,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(now)) map[p.type] = p.value
  startLocal.value = `${map.year}-${map.month}-${map.day}T${map.hour === '24' ? '00' : map.hour}:${map.minute}:${map.second}`
}

function loadSample() {
  expr.value = dialect.value === 'quartz' ? '0 */15 * * * ?' : '*/15 * * * *'
  execute()
}

function loadSampleEom() {
  dialect.value = 'quartz'
  expr.value = '0 0 12 L * ?'
  execute()
}

function loadSampleWeekday() {
  dialect.value = 'unix'
  expr.value = '0 9 * * 1-5'
  execute()
}

function copyFires() {
  clipboard.copy(fireList.value.map((f) => `${f.local}（${tz.value}） / ${f.utc} UTC`).join('\n'), '未来执行列表')
}
</script>

<template>
  <div class="t20">
    <div class="t20__toolbar">
      <DkSegmented
        :model-value="dialect"
        :options="[
          { value: 'unix', label: 'Unix 五字段', title: '分 时 日 月 周' },
          { value: 'quartz', label: 'Quartz 六字段', title: '秒 分 时 日 月 周（可选第 7 位年）' }
        ]"
        @update:model-value="dialect = $event as any"
      />
      <div class="t20__opt">
        <span class="t20__opt-label">时区</span>
        <DkSelect v-model="tz" :options="ZONES" />
      </div>
      <div class="t20__opt">
        <span class="t20__opt-label">预览起始（{{ tz }} 墙钟）</span>
        <DkInput v-model="startLocal" type="datetime-local" step="1" />
      </div>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="fillNow(); execute()">填入当前时间</DkButton>
      <DkButton size="sm" variant="ghost" title="每 15 分钟（当前方言示例）" @click="loadSample">载入示例</DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? exprErr || run.errorMsg.value : run.staleNote.value"
      :meta="[dialect === 'quartz' ? 'Quartz' : 'Unix', tz]"
    />

    <div class="t20__expr">
      <DkField
        :label="dialect === 'quartz' ? '表达式（秒 分 时 日 月 周 [年]）' : '表达式（分 时 日 月 周）'"
        :error="exprErr || undefined"
        :help="dialect === 'quartz' ? '如 0 */15 * * * ?（每 15 分钟）；支持 ?、L、W、#；日与周必须一个为 ?' : '如 */15 * * * *（每 15 分钟）；0/7=周日；不支持 ?、L、W、#'"
      >
        <DkInput v-model="expr" mono :error="!!exprErr" placeholder="*/15 * * * *" />
      </DkField>
    </div>

    <div v-if="fieldRows.length" class="t20__grid">
      <div class="t20__panel">
        <div class="t20__panel-head">
          <span>分字段解释（{{ dialect === 'quartz' ? 'Quartz' : 'Unix' }}）</span>
        </div>
        <div class="t20__scroll">
          <table class="t20__table">
          <thead>
            <tr>
              <th>字段</th>
              <th>取值</th>
              <th>范围</th>
              <th>含义</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in fieldRows" :key="r.name">
              <td>{{ r.name }}</td>
              <td class="mono">{{ r.raw }}</td>
              <td class="mono">{{ r.range }}</td>
              <td>{{ r.desc }}</td>
            </tr>
          </tbody>
          </table>
        </div>
        <p class="t20__note">{{ dialectNote }}</p>
      </div>

      <div class="t20__panel">
        <div class="t20__panel-head">
          <span>未来执行（未来 10 次 · {{ tz }}）</span>
          <span class="grow"></span>
          <DkIconButton title="复制执行列表" :disabled="run.status.value === 'stale' || !fireList.length" @click="copyFires">
            <DkIcon name="copy" :size="14" />
          </DkIconButton>
        </div>
        <div v-if="fireList.length" class="t20__scroll">
          <table class="t20__table">
          <thead>
            <tr>
              <th>#</th>
              <th>{{ tz }}</th>
              <th>UTC</th>
              <th>距现在</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in fireList" :key="i">
              <td class="t20__idx">{{ i + 1 }}</td>
              <td class="mono">{{ f.local }}</td>
              <td class="mono">{{ f.utc }}</td>
              <td>{{ f.rel }}</td>
            </tr>
          </tbody>
          </table>
        </div>
        <p v-if="!fireList.length" class="t20__empty tertiary">未找到执行时间。</p>
        <p v-if="notFoundNote" class="t20__note t20__note--warn">{{ notFoundNote }}</p>
      </div>
    </div>

    <DkCollapse title="方言差异与验证说明（引擎已用 node 对照验证）">
      <ul>
        <li><b>Unix 五字段</b>：<code>分 时 日 月 周</code>，周字段 0/7 均为周日；支持 <code>*</code>、数字、<code>a-b</code>、<code>a,b,c</code>、<code>x/n</code>、<code>SUN-SAT</code>/<code>JAN-DEC</code> 名称；不支持 <code>?</code>、<code>L</code>、<code>W</code>、<code>#</code>（会明确报错）。</li>
        <li><b>Quartz 六/七字段</b>：<code>秒 分 时 日 月 周 [年]</code>，周字段 1=周日…7=周六；<code>日</code>与<code>周</code>必须有一个为 <code>?</code>；支持 <code>L</code>（月末/最后一个周X）、<code>nW</code>（最近工作日）、<code>n#m</code>（第 m 个周X）。</li>
        <li><b>Vixie 语义</b>：Unix 方言下「日」与「周」同时受限时取并集（OR），如 <code>30 4 1,15 * 5</code> 表示每月 1/15 号与每周五都触发。</li>
        <li><b>示例（node 验证）</b>：<code>*/15 * * * *</code>（Unix）与 <code>0 */15 * * * ?</code>（Quartz）均为每 15 分钟；<code>0 0 12 L * ?</code> 自 2026-01-15 起为 01-31、02-28、03-31、04-30 12:00:00；<code>0 30 2 * * ?</code> 在 America/New_York 会跳过 2026-03-08 02:30（该墙钟时刻因夏令时拨快不存在）。</li>
        <li><b>搜索方式</b>：按所选时区逐分钟步进，配合月/日/时跳跃剪枝；迭代上限 500 万次，无年字段时搜索范围为起点后 29 年（覆盖星期-日期对齐周期），超出仍未命中则提示「表达式可能永不触发」。</li>
      </ul>
      <div class="t20__samples">
        <DkButton size="sm" variant="ghost" @click="loadSampleEom">载入 Quartz 月末示例（0 0 12 L * ?）</DkButton>
        <DkButton size="sm" variant="ghost" @click="loadSampleWeekday">载入 Unix 工作日示例（0 9 * * 1-5）</DkButton>
      </div>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t20 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t20__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t20__opt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.t20__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t20__opt :deep(.dk-input) {
  width: 210px;
  max-width: 100%;
  min-width: 0;
}
.t20__expr {
  max-width: 620px;
}
.t20__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 980px) {
  .t20__grid {
    grid-template-columns: 1fr;
  }
}
.t20__panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t20__panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t20__scroll {
  overflow-x: auto;
}
.t20__table {
  width: 100%;
  min-width: 360px;
  border-collapse: collapse;
  font-size: 12px;
}
.t20__table th {
  text-align: left;
  padding: 6px 10px;
  color: var(--text-tertiary);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  background: var(--surface-subtle);
}
.t20__table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  vertical-align: top;
}
.t20__table td:nth-child(4) {
  white-space: normal;
  min-width: 180px;
}
.t20__table tbody tr:last-child td {
  border-bottom: none;
}
.t20__idx {
  color: var(--text-tertiary);
}
.t20__note {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  line-height: 1.6;
}
.t20__note--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.t20__empty {
  padding: 12px;
  font-size: 13px;
  margin: 0;
}
.t20__samples {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
</style>
