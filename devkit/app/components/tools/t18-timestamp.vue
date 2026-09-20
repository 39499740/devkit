<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

/**
 * T18 时间戳转换
 * 单位显式选择（秒/毫秒，禁止位数猜测）、双向转换、时区、ISO 8601、相对时间、批量。
 * 示例 1727208000（秒）/ 1727208000000（毫秒）已用 node Intl 验证：
 * UTC 2024-09-24 20:00:00，Asia/Shanghai 2024-09-25 04:00:00。
 */

const ZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' }
]

const dir = ref<'ts2time' | 'time2ts'>('ts2time')
const unit = ref<'s' | 'ms'>('ms')
const tz = ref('Asia/Shanghai')
const batch = ref(false)
const tsInput = ref('')
const batchInput = ref('')
const dateInput = ref('')

const clipboard = useClipboard()
const toast = useToast()

const sig = () => JSON.stringify([dir.value, unit.value, tz.value, tsInput.value, batchInput.value, dateInput.value])
const run = useToolRun(sig)

// ---------- 时区工具（全部基于 Intl 真实计算；formatter 复用避免批量场景重复构造） ----------

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function cachedDtf(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let d = dtfCache.get(key)
  if (!d) {
    d = make()
    dtfCache.set(key, d)
  }
  return d
}

function tzOffsetMin(zone: string, date: Date): number {
  const dtf = cachedDtf(`off:${zone}`, () =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  )
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(
    +map.year!,
    +map.month! - 1,
    +map.day!,
    map.hour === '24' ? 0 : +map.hour!,
    +map.minute!,
    +map.second!
  )
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

function readableIn(zone: string, date: Date): string {
  const dtf = cachedDtf(`read:${zone}`, () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  )
  return dtf.format(date).replace(',', '')
}

function shortOffset(zone: string, date: Date): string {
  const dtf = cachedDtf(`sro:${zone}`, () => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }))
  const p = dtf.formatToParts(date).find((x) => x.type === 'timeZoneName')
  return p ? p.value.replace('GMT', 'UTC') : ''
}

/** 该年该时区的标准偏移（分钟）；全年无夏令时返回 null */
function standardOffset(zone: string, year: number): number | null {
  const jan = tzOffsetMin(zone, new Date(Date.UTC(year, 0, 15)))
  const jul = tzOffsetMin(zone, new Date(Date.UTC(year, 6, 15)))
  if (jan === jul) return null
  return Math.min(jan, jul)
}

/** 该时刻在该时区是否处于夏令时：dst=是 / standard=否（标准时间）/ none=该时区全年无夏令时 */
function dstState(zone: string, date: Date): 'dst' | 'standard' | 'none' {
  const dtf = cachedDtf(`yr:${zone}`, () => new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }))
  const year = +(dtf.formatToParts(date).find((p) => p.type === 'year')?.value ?? date.getUTCFullYear())
  const std = standardOffset(zone, year)
  if (std === null) return 'none'
  return tzOffsetMin(zone, date) > std ? 'dst' : 'standard'
}

/** 墙钟时间 → 真实时刻：检测夏令时跳变产生的不存在/歧义时刻 */
function resolveWall(zone: string, wallMs: number): {
  status: 'unique' | 'ambiguous' | 'gap'
  picks: { off: number; inst: number }[]
} {
  const o0 = tzOffsetMin(zone, new Date(wallMs))
  const cand = new Set([o0])
  for (const d of [-60, -30, 30, 60]) cand.add(o0 + d)
  const valid: { off: number; inst: number }[] = []
  for (const c of cand) {
    const inst = wallMs - c * 60000
    if (tzOffsetMin(zone, new Date(inst)) === c) valid.push({ off: c, inst })
  }
  const uniq = [...new Map(valid.map((v) => [v.inst, v])).values()].sort((a, b) => a.inst - b.inst)
  if (uniq.length === 1) return { status: 'unique', picks: uniq }
  if (uniq.length > 1) return { status: 'ambiguous', picks: uniq }
  // 不存在（跳变区间）：取该时刻附近真实存在过的偏移中较小者（即切换前偏移，春季拨快）
  const approx = wallMs - o0 * 60000
  const actual = new Set<number>()
  for (const k of [-12, -6, -1, 1, 6, 12]) actual.add(tzOffsetMin(zone, new Date(approx + k * 3600000)))
  const pre = Math.min(...actual)
  return { status: 'gap', picks: [{ off: pre, inst: wallMs - pre * 60000 }] }
}

function relTime(target: Date, now: number): string {
  const diff = target.getTime() - now
  const a = Math.abs(diff)
  const sfx = diff < 0 ? '前' : '后'
  if (a < 1000) return '此刻'
  if (a < 60_000) return `${Math.floor(a / 1000)} 秒${sfx}`
  if (a < 3_600_000) return `${Math.floor(a / 60_000)} 分钟${sfx}`
  if (a < 86_400_000) {
    const h = Math.floor(a / 3_600_000)
    const m = Math.round((a % 3_600_000) / 60_000)
    return m ? `${h} 小时 ${m} 分钟${sfx}` : `${h} 小时${sfx}`
  }
  if (a < 30 * 86_400_000) return `${Math.round(a / 86_400_000)} 天${sfx}`
  const months = a / (30.44 * 86_400_000)
  if (months < 12) return `${Math.round(months)} 个月${sfx}`
  const years = Math.floor(a / (365.25 * 86_400_000))
  const remMonths = Math.round((a % (365.25 * 86_400_000)) / (30.44 * 86_400_000))
  return remMonths ? `${years} 年 ${remMonths} 个月${sfx}` : `${years} 年${sfx}`
}

const MAX_MS = 8.64e15

function parseTs(raw: string): { ms: number; error: string } {
  const t = raw.trim()
  if (!t) return { ms: 0, error: '时间戳为空' }
  if (!/^-?\d+$/.test(t)) return { ms: 0, error: `「${t}」不是整数时间戳（仅允许数字，可带负号）` }
  let ms = Number(t)
  if (unit.value === 's') ms *= 1000
  if (!Number.isSafeInteger(ms) || Math.abs(ms) > MAX_MS) {
    return { ms: 0, error: `时间戳 ${t} 超出可表示范围（${unit.value === 's' ? '秒' : '毫秒'} × 1000 后须在 ±8.64e15 内）` }
  }
  return { ms, error: '' }
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function parseWallText(text: string): { wallMs: number; error: string } {
  const t = text.trim().replace('T', ' ')
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return { wallMs: 0, error: '格式应为 YYYY-MM-DD HH:mm:ss（秒可省略），如 2024-09-25 04:00:00' }
  const y = +m[1]!
  const mo = +m[2]!
  const d = +m[3]!
  const h = +m[4]!
  const mi = +m[5]!
  const ss = m[6] ? +m[6]! : 0
  if (mo < 1 || mo > 12) return { wallMs: 0, error: `月份 ${m[2]} 无效，应为 1-12` }
  const dim = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!
  if (d < 1 || d > dim) return { wallMs: 0, error: `${y}-${m[2]}-${m[3]} 不是有效日期：${y} 年 ${mo} 月只有 ${dim} 天` }
  if (h > 23) return { wallMs: 0, error: `小时 ${m[4]} 无效，应为 0-23` }
  if (mi > 59) return { wallMs: 0, error: `分钟 ${m[5]} 无效，应为 0-59` }
  if (ss > 59) return { wallMs: 0, error: `秒 ${m[6]} 无效，应为 0-59` }
  return { wallMs: Date.UTC(y, mo - 1, d, h, mi, ss), error: '' }
}

// ---------- 结果状态 ----------

interface Row {
  input: string
  ok: boolean
  error?: string
  zone?: string
  utc?: string
  iso?: string
  bj?: string
  rel?: string
}

const single = ref<Row | null>(null)
const rows = ref<Row[]>([])
const dateResult = ref<{
  ms: number
  iso: string
  utc: string
  bj: string
  zoneReadable: string
  offset: string
  wallStatus: 'unique' | 'ambiguous' | 'gap'
  wallNote: string
  dstNote: string
  computedAt: number
} | null>(null)
const tsErr = ref('')
const batchErr = ref('')
const dateErr = ref('')
const computedNow = ref(0)

function dstNoteFor(zone: string, date: Date): string {
  const st = dstState(zone, date)
  if (st === 'none') return `${zone} 全年不实行夏令时（固定 ${shortOffset(zone, date)}）`
  if (st === 'dst') {
    const dtf = cachedDtf(`yr:${zone}`, () => new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }))
    const y = +(dtf.formatToParts(date).find((p) => p.type === 'year')?.value ?? date.getUTCFullYear())
    const std = standardOffset(zone, y)!
    const stdH = `UTC${std >= 0 ? '+' : ''}${std / 60}`
    return `该时刻 ${zone} 处于夏令时（${shortOffset(zone, date)}，标准偏移 ${stdH}）`
  }
  return `该时刻 ${zone} 不处于夏令时（标准时间 ${shortOffset(zone, date)}）`
}

function buildRow(input: string): Row {
  const { ms, error } = parseTs(input)
  if (error) return { input: input.trim(), ok: false, error }
  const d = new Date(ms)
  return {
    input: input.trim(),
    ok: true,
    zone: readableIn(tz.value, d),
    utc: readableIn('UTC', d),
    iso: d.toISOString(),
    bj: readableIn('Asia/Shanghai', d),
    rel: relTime(d, computedNow.value)
  }
}

function execute() {
  computedNow.value = Date.now()
  if (dir.value === 'ts2time') {
    dateResult.value = null
    dateErr.value = ''
    if (batch.value) {
      single.value = null
      tsErr.value = ''
      const lines = batchInput.value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
      if (!lines.length) {
        rows.value = []
        batchErr.value = ''
        run.markIdle()
        return
      }
      if (lines.length > 500) {
        batchErr.value = `批量输入共 ${lines.length} 行，超过上限 500 行，请分批转换`
        run.markFail(batchErr.value)
        return
      }
      batchErr.value = ''
      rows.value = lines.map(buildRow)
      const bad = rows.value.filter((r) => !r.ok).length
      if (bad) {
        batchErr.value = `第 ${rows.value.map((r, i) => (!r.ok ? i + 1 : 0)).filter((i) => i).join('、')} 行无效（详见表格红色标注）`
        run.markFail(`${bad}/${lines.length} 行无效，有效行已转换`)
      } else {
        run.markOk(`批量转换成功：${lines.length} 行 · 单位 ${unit.value === 's' ? '秒' : '毫秒'} · 时区 ${tz.value}`)
      }
    } else {
      rows.value = []
      batchErr.value = ''
      const t = tsInput.value.trim()
      if (!t) {
        single.value = null
        tsErr.value = ''
        run.markIdle()
        return
      }
      const r = buildRow(t)
      if (!r.ok) {
        single.value = null
        tsErr.value = r.error!
        run.markFail(r.error!)
        return
      }
      tsErr.value = ''
      single.value = r
      run.markOk(
        `单位 ${unit.value === 's' ? '秒' : '毫秒'} · 时区 ${tz.value} · 相对时间以 ${new Date(computedNow.value).toISOString().slice(0, 19).replace('T', ' ')} UTC 为基准`
      )
    }
  } else {
    single.value = null
    rows.value = []
    tsErr.value = ''
    batchErr.value = ''
    const t = dateInput.value.trim()
    if (!t) {
      dateResult.value = null
      dateErr.value = ''
      run.markIdle()
      return
    }
    const { wallMs, error } = parseWallText(t)
    if (error) {
      dateResult.value = null
      dateErr.value = error
      run.markFail(error)
      return
    }
    dateErr.value = ''
    const res = resolveWall(tz.value, wallMs)
    const pick = res.picks[0]!
    const d = new Date(pick.inst)
    let wallNote = ''
    if (res.status === 'ambiguous') {
      const a = res.picks[0]!
      const b = res.picks[1]!
      wallNote = `该时刻出现两次（夏令时回拨）：${shortOffset(tz.value, new Date(a.inst))} 与 ${shortOffset(tz.value, new Date(b.inst))} 各对应一次；已取较早的 ${shortOffset(tz.value, d)} 一次`
    } else if (res.status === 'gap') {
      wallNote = `该墙钟时刻在 ${tz.value} 不存在（夏令时拨快跳过），已按切换前偏移 ${shortOffset(tz.value, d)} 解释，实际对应 ${readableIn(tz.value, d)}`
    }
    dateResult.value = {
      ms: pick.inst,
      iso: d.toISOString(),
      utc: readableIn('UTC', d),
      bj: readableIn('Asia/Shanghai', d),
      zoneReadable: readableIn(tz.value, d),
      offset: shortOffset(tz.value, d),
      wallStatus: res.status,
      wallNote,
      dstNote: dstNoteFor(tz.value, d),
      computedAt: computedNow.value
    }
    run.markOk(`按 ${tz.value} 墙钟解释${res.status === 'unique' ? '' : '（含跳变说明）'}`)
  }
}

watch([dir, unit, tz, tsInput, batchInput, dateInput, batch], execute)

// ---------- 工具栏动作 ----------

function fillNow() {
  const now = new Date()
  if (dir.value === 'ts2time') {
    if (batch.value) {
      toast.warning('批量模式下不填充当前时间，请切换回单条输入')
      return
    }
    tsInput.value = unit.value === 's' ? String(Math.floor(now.getTime() / 1000)) : String(now.getTime())
  } else {
    dateInput.value = readableIn(tz.value, now)
  }
  execute()
}

function loadSample() {
  dir.value = 'ts2time'
  batch.value = false
  // 已验证：1727208000 秒 = 1727208000000 毫秒 = UTC 2024-09-24 20:00:00 = 北京 2024-09-25 04:00:00
  tsInput.value = unit.value === 's' ? '1727208000' : '1727208000000'
  execute()
}

function loadDateSample() {
  dir.value = 'time2ts'
  tz.value = 'Asia/Shanghai'
  dateInput.value = '2024-09-25 04:00:00'
  execute()
}

function fillBatchSample() {
  dir.value = 'ts2time'
  batch.value = true
  batchInput.value = ['1727208000', '1761970117', '1793506117', 'abc', '1727208000000'].join('\n')
  execute()
}

function copyRows() {
  const head = '输入\t所选时区\tUTC\tISO 8601\tAsia/Shanghai\t相对时间'
  const body = rows.value
    .map((r) => (r.ok ? [r.input, r.zone, r.utc, r.iso, r.bj, r.rel].join('\t') : [r.input, `错误：${r.error}`].join('\t')))
    .join('\n')
  clipboard.copy(`${head}\n${body}`, '批量结果（TSV）')
}
</script>

<template>
  <div class="t18">
    <div class="t18__toolbar">
      <DkSegmented
        :model-value="dir"
        :options="[
          { value: 'ts2time', label: '时间戳 → 时间' },
          { value: 'time2ts', label: '时间 → 时间戳' }
        ]"
        @update:model-value="dir = $event as any"
      />
      <div class="t18__opt">
        <span class="t18__opt-label">{{ dir === 'ts2time' ? '输入单位' : '输出单位' }}（不按位数猜测）</span>
        <DkSegmented
          size="sm"
          :model-value="unit"
          :options="[
            { value: 's', label: '秒' },
            { value: 'ms', label: '毫秒' }
          ]"
          @update:model-value="unit = $event as any"
        />
      </div>
      <div class="t18__opt">
        <span class="t18__opt-label">时区</span>
        <DkSelect v-model="tz" :options="ZONES" />
      </div>
      <span class="grow"></span>
      <DkCheckbox v-if="dir === 'ts2time'" v-model="batch" label="批量（每行一个）" />
      <DkButton size="sm" variant="ghost" @click="fillNow">填入当前时间</DkButton>
      <DkButton size="sm" variant="ghost" @click="dir === 'ts2time' ? (batch ? fillBatchSample() : loadSample()) : loadDateSample()">
        载入示例
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[dir === 'ts2time' ? `单位：${unit === 's' ? '秒' : '毫秒'}` : `时区：${tz}`]"
    />

    <!-- 时间戳 → 可读时间 -->
    <template v-if="dir === 'ts2time'">
      <div v-if="!batch" class="t18__input">
        <DkField label="时间戳" :error="tsErr || undefined" :help="`按所选单位（${unit === 's' ? '秒' : '毫秒'}）解释，结果同时给出秒/毫秒对照`">
          <DkInput v-model="tsInput" mono :error="!!tsErr" placeholder="如 1727208000000（毫秒）或 1727208000（秒）" />
        </DkField>
      </div>
      <div v-else class="t18__batchin">
        <DkEditor
          v-model="batchInput"
          lang="时间戳（每行一个）"
          placeholder="每行一个时间戳，最多 500 行，如：&#10;1727208000&#10;1727208000000"
          :error="batchErr"
          :wrap="true"
          :height="'160px'"
          filename="timestamps.txt"
        />
      </div>

      <div v-if="single" class="t18__result">
        <div class="t18__result-head">
          <span>转换结果</span>
          <span class="grow"></span>
          <DkIconButton title="复制 ISO 8601" :disabled="run.status.value === 'stale'" @click="clipboard.copy(single.iso!, 'ISO 8601')">
            <DkIcon name="copy" :size="14" />
          </DkIconButton>
        </div>
        <dl class="t18__kv">
          <dt>{{ tz }} 时间</dt>
          <dd class="mono">{{ single.zone }} <span class="t18__off">（{{ shortOffset(tz, new Date(single.iso!)) }}）</span></dd>
          <dt>ISO 8601（UTC）</dt>
          <dd class="mono">{{ single.iso }}</dd>
          <dt>UTC 可读时间</dt>
          <dd class="mono">{{ single.utc }}</dd>
          <dt>Asia/Shanghai 对照</dt>
          <dd class="mono">{{ single.bj }}</dd>
          <dt>秒 / 毫秒对照</dt>
          <dd class="mono">
            {{ Math.floor(new Date(single.iso!).getTime() / 1000) }}（秒） ·
            {{ new Date(single.iso!).getTime() }}（毫秒）
          </dd>
          <dt>相对时间</dt>
          <dd>{{ single.rel }}</dd>
        </dl>
        <p class="t18__note" :class="{ 't18__note--warn': dstState(tz, new Date(single.iso!)) === 'dst' }">
          {{ dstNoteFor(tz, new Date(single.iso!)) }}
        </p>
      </div>

      <div v-if="batch && rows.length" class="t18__result">
        <div class="t18__result-head">
          <span>批量结果（{{ rows.length }} 行）</span>
          <span class="grow"></span>
          <DkIconButton title="复制全部（TSV）" :disabled="run.status.value === 'stale'" @click="copyRows">
            <DkIcon name="copy" :size="14" />
          </DkIconButton>
        </div>
        <div class="t18__table-wrap">
          <table class="t18__table">
            <thead>
              <tr>
                <th>输入</th>
                <th>{{ tz }}</th>
                <th>UTC</th>
                <th>ISO 8601</th>
                <th>Asia/Shanghai</th>
                <th>相对时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i" :class="{ 't18__row-bad': !r.ok }">
                <td class="mono">{{ r.input }}</td>
                <td v-if="r.ok" class="mono">{{ r.zone }}</td>
                <td v-if="r.ok" class="mono">{{ r.utc }}</td>
                <td v-if="r.ok" class="mono">{{ r.iso }}</td>
                <td v-if="r.ok" class="mono">{{ r.bj }}</td>
                <td v-if="r.ok">{{ r.rel }}</td>
                <td v-if="!r.ok" colspan="5" class="t18__row-err">{{ r.error }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="batchErr" class="t18__note t18__note--warn">{{ batchErr }}</p>
      </div>
    </template>

    <!-- 可读时间 → 时间戳 -->
    <template v-else>
      <div class="t18__input">
        <DkField
          label="日期时间（按所选时区的墙钟解释）"
          :error="dateErr || undefined"
          :help="`格式 YYYY-MM-DD HH:mm:ss；将按 ${tz} 解释，夏令时跳变会给出提示`"
        >
          <DkInput v-model="dateInput" mono :error="!!dateErr" placeholder="如 2024-09-25 04:00:00" />
        </DkField>
      </div>

      <div v-if="dateResult" class="t18__result">
        <div class="t18__result-head">
          <span>转换结果</span>
          <span class="grow"></span>
          <DkIconButton
            title="复制毫秒时间戳"
            :disabled="run.status.value === 'stale'"
            @click="clipboard.copy(String(dateResult.ms), '毫秒时间戳')"
          >
            <DkIcon name="copy" :size="14" />
          </DkIconButton>
        </div>
        <dl class="t18__kv">
          <dt>秒时间戳</dt>
          <dd class="mono">{{ Math.floor(dateResult.ms / 1000) }}</dd>
          <dt>毫秒时间戳</dt>
          <dd class="mono">{{ dateResult.ms }}</dd>
          <dt>ISO 8601（UTC）</dt>
          <dd class="mono">{{ dateResult.iso }}</dd>
          <dt>{{ tz }} 本地</dt>
          <dd class="mono">{{ dateResult.zoneReadable }} <span class="t18__off">（{{ dateResult.offset }}）</span></dd>
          <dt>UTC 可读时间</dt>
          <dd class="mono">{{ dateResult.utc }}</dd>
          <dt>Asia/Shanghai 对照</dt>
          <dd class="mono">{{ dateResult.bj }}</dd>
        </dl>
        <p v-if="dateResult.wallNote" class="t18__note t18__note--warn">{{ dateResult.wallNote }}</p>
        <p class="t18__note" :class="{ 't18__note--warn': dstState(tz, new Date(dateResult.iso)) === 'dst' }">{{ dateResult.dstNote }}</p>
      </div>
    </template>

    <DkCollapse title="示例与说明（示例值已用 node Intl 验证）">
      <ul>
        <li>同一时刻：<code>1727208000</code>（秒）= <code>1727208000000</code>（毫秒）= <code>2024-09-24T20:00:00.000Z</code>（ISO 8601），对应北京时间 <code>2024-09-25 04:00:00</code>。</li>
        <li>单位由「秒 / 毫秒」开关显式决定，本工具不按位数猜测单位。</li>
        <li>「时间 → 时间戳」按所选时区的墙钟解释，并检测夏令时跳变：
          <code>America/New_York 2026-03-08 02:30</code> 不存在（02:00 直接拨到 03:00），工具会明确提示并说明采用的解释方式；
          <code>2026-11-01 01:30</code> 出现两次，工具列出两次并取较早的一次。</li>
        <li>Asia/Shanghai、UTC 全年无夏令时；America/New_York、Europe/London、Australia/Sydney 有夏令时，结果区会注明该时刻是否处于夏令时及标准偏移。</li>
        <li>相对时间按「填入/执行时刻」计算，仅作参考。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t18 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t18__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t18__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t18__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t18__input {
  max-width: 560px;
}
.t18__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t18__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t18__kv {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 0;
  margin: 0;
  padding: 6px 0;
}
.t18__kv dt {
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border);
}
.t18__kv dt:first-of-type {
  border-top: none;
}
.t18__kv dd {
  padding: 7px 12px 7px 0;
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  border-top: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.t18__kv dd:first-of-type {
  border-top: none;
}
.t18__off {
  color: var(--text-tertiary);
  font-size: 12px;
}
.t18__note {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  margin: 0;
}
.t18__note--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.t18__table-wrap {
  overflow-x: auto;
}
.t18__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.t18__table th {
  text-align: left;
  padding: 6px 10px;
  color: var(--text-tertiary);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  background: var(--surface-subtle);
}
.t18__table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  color: var(--text-primary);
}
.t18__row-bad td {
  background: var(--error-soft);
}
.t18__row-err {
  color: var(--error) !important;
}
</style>
