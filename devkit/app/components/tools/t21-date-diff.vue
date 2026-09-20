<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

/**
 * T21 日期时间差计算
 * 实际时长按真实时刻（UTC 毫秒）计算；日历年月日差按两端各自时区的本地日历日期相减。
 * 示例（node Intl 验证）：
 * - 2026-03-01 08:00 → 2026-03-02 09:30（Asia/Shanghai）= 91,800,000 ms = 1天1小时30分（25.5 小时）
 * - 2026-03-07 01:00 → 2026-03-09 01:00（America/New_York）= 47 小时（非 48），
 *   2026-03-08 02:00 拨快至 03:00（EST UTC-5 → EDT UTC-4）
 */

const ZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' }
]

const startLocal = ref('')
const endLocal = ref('')
const startTz = ref('Asia/Shanghai')
const endTz = ref('Asia/Shanghai')

const clipboard = useClipboard()

const sig = () => JSON.stringify([startLocal.value, endLocal.value, startTz.value, endTz.value])
const run = useToolRun(sig)

// ---------- 时区工具（Intl 真实计算） ----------

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function makeDtf(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let d = dtfCache.get(key)
  if (!d) {
    d = make()
    dtfCache.set(key, d)
  }
  return d
}

function tzOffsetMin(zone: string, date: Date): number {
  const dtf = makeDtf(`off:${zone}`, () =>
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
  const asUTC = Date.UTC(+map.year!, +map.month! - 1, +map.day!, map.hour === '24' ? 0 : +map.hour!, +map.minute!, +map.second!)
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

function wallParts(zone: string, date: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const dtf = makeDtf(`off:${zone}`, () =>
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
  return {
    y: +map.year!,
    mo: +map.month!,
    d: +map.day!,
    h: map.hour === '24' ? 0 : +map.hour!,
    mi: +map.minute!,
    s: +map.second!
  }
}

function shortOffset(zone: string, date: Date): string {
  const dtf = makeDtf(`sro:${zone}`, () => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }))
  const p = dtf.formatToParts(date).find((x) => x.type === 'timeZoneName')
  return p ? p.value.replace('GMT', 'UTC') : ''
}

/** 墙钟 → 真实时刻（含夏令时跳变检测：gap 取切换前偏移，ambiguous 取较早一次） */
function resolveWall(zone: string, wallMs: number): { inst: number; off: number; status: 'unique' | 'ambiguous' | 'gap' } {
  const o0 = tzOffsetMin(zone, new Date(wallMs))
  const cand = new Set([o0])
  for (const d of [-60, -30, 30, 60]) cand.add(o0 + d)
  const valid: { off: number; inst: number }[] = []
  for (const c of cand) {
    const inst = wallMs - c * 60000
    if (tzOffsetMin(zone, new Date(inst)) === c) valid.push({ off: c, inst })
  }
  const uniq = [...new Map(valid.map((v) => [v.inst, v])).values()].sort((a, b) => a.inst - b.inst)
  if (uniq.length >= 1) return { inst: uniq[0]!.inst, off: uniq[0]!.off, status: uniq.length > 1 ? 'ambiguous' : 'unique' }
  // 不存在（跳变区间）：取附近真实存在过的偏移中较小者（即切换前偏移，春季拨快）
  const approx = wallMs - o0 * 60000
  const actual = new Set<number>()
  for (const k of [-12, -6, -1, 1, 6, 12]) actual.add(tzOffsetMin(zone, new Date(approx + k * 3600000)))
  const pre = Math.min(...actual)
  return { inst: wallMs - pre * 60000, off: pre, status: 'gap' }
}

function parseLocal(t: string): number | null {
  const m = t.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6]! : 0)
}

const pad = (n: number) => String(n).padStart(2, '0')

// ---------- 日历差 ----------

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate()

function addMonths(y: number, mo: number, d: number, delta: number): { y: number; mo: number; d: number } {
  const total = y * 12 + (mo - 1) + delta
  const ny = Math.floor(total / 12)
  const nmo = ((total % 12) + 12) % 12 + 1
  return { y: ny, mo: nmo, d: Math.min(d, daysInMonth(ny, nmo)) }
}

const dayNumber = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d)

function calendarDiff(ay: number, am: number, ad: number, by: number, bm: number, bd: number): { y: number; m: number; d: number } {
  const endDate = dayNumber(by, bm, bd)
  let months = (by - ay) * 12 + (bm - am)
  let cand = addMonths(ay, am, ad, months)
  while (dayNumber(cand.y, cand.mo, cand.d) > endDate && months > 0) {
    months -= 1
    cand = addMonths(ay, am, ad, months)
  }
  const y = Math.floor(months / 12)
  const m = months - y * 12
  const d = Math.round((endDate - dayNumber(cand.y, cand.mo, cand.d)) / 86_400_000)
  return { y, m, d }
}

// ---------- 结果 ----------

interface Side {
  wall: string
  inst: number
  offset: string
  tz: string
  status: 'unique' | 'ambiguous' | 'gap'
  wallNote: string
}

interface Result {
  start: Side
  end: Side
  diffMs: number
  negative: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
  totalHours: string
  calY: number
  calM: number
  calD: number
  calNegative: boolean
  dstChanges: { zone: string; date: string; from: string; to: string }[]
}

const result = ref<Result | null>(null)
const inputErr = ref('')

function sideOf(t: string, zone: string, label: string): { side: Side; inst: number } | { error: string } {
  const wallMs = parseLocal(t)
  if (wallMs === null) return { error: `${label}时间格式无效：应为 datetime-local 格式（YYYY-MM-DDTHH:mm:ss），当前「${t || '（空）'}」` }
  const r = resolveWall(zone, wallMs)
  const p = wallParts(zone, new Date(r.inst))
  let wallNote = ''
  if (r.status === 'gap') {
    wallNote = `${label}墙钟时刻在 ${zone} 不存在（夏令时拨快跳过），已按切换前偏移 ${shortOffset(zone, new Date(r.inst))} 解释为 ${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`
  } else if (r.status === 'ambiguous') {
    wallNote = `${label}墙钟时刻在 ${zone} 出现两次（夏令时回拨），已取较早的一次（${shortOffset(zone, new Date(r.inst))}）`
  }
  return {
    side: {
      wall: `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`,
      inst: r.inst,
      offset: shortOffset(zone, new Date(r.inst)),
      tz: zone,
      status: r.status,
      wallNote
    },
    inst: r.inst
  }
}

/** 按天采样检测区间内任一时区的偏移变化（含跨时区两端各自时区） */
function detectDstChanges(from: number, to: number, zones: string[]): Result['dstChanges'] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const span = hi - lo
  const samples = Math.min(4000, Math.max(1, Math.ceil(span / 86_400_000)))
  const zoneList = [...new Set(zones)]
  const changes: Result['dstChanges'] = []
  for (const zone of zoneList) {
    let prev = tzOffsetMin(zone, new Date(lo))
    for (let i = 1; i <= samples; i++) {
      const t = i === samples ? hi : lo + Math.round((i * span) / samples)
      const cur = tzOffsetMin(zone, new Date(t))
      if (cur !== prev) {
        const off = (m: number) => `UTC${m >= 0 ? '+' : ''}${m / 60}`
        const p = wallParts(zone, new Date(t))
        changes.push({ zone, date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, from: off(prev), to: off(cur) })
        prev = cur
      }
    }
  }
  return changes
}

function execute() {
  if (!startLocal.value.trim() || !endLocal.value.trim()) {
    result.value = null
    inputErr.value = ''
    run.markIdle()
    return
  }
  const s = sideOf(startLocal.value, startTz.value, '开始')
  if ('error' in s) {
    inputErr.value = s.error
    result.value = null
    run.markFail(s.error)
    return
  }
  const e = sideOf(endLocal.value, endTz.value, '结束')
  if ('error' in e) {
    inputErr.value = e.error
    result.value = null
    run.markFail(e.error)
    return
  }
  inputErr.value = ''
  const diffMs = e.inst - s.inst
  const abs = Math.abs(diffMs)
  const days = Math.floor(abs / 86_400_000)
  const hours = Math.floor((abs % 86_400_000) / 3_600_000)
  const minutes = Math.floor((abs % 3_600_000) / 60_000)
  const seconds = Math.floor((abs % 60_000) / 1000)
  const sp = wallParts(startTz.value, new Date(s.inst))
  const ep = wallParts(endTz.value, new Date(e.inst))
  // 日历差按墙钟日期比较符号（与真实时刻符号可能不同：两端时区不同时，墙钟先后 ≠ 时刻先后）
  const endDateLess = ep.y * 10000 + ep.mo * 100 + ep.d < sp.y * 10000 + sp.mo * 100 + sp.d
  const cal = endDateLess
    ? calendarDiff(ep.y, ep.mo, ep.d, sp.y, sp.mo, sp.d)
    : calendarDiff(sp.y, sp.mo, sp.d, ep.y, ep.mo, ep.d)
  const calNegative = endDateLess
  const dst = detectDstChanges(s.inst, e.inst, [startTz.value, endTz.value])
  result.value = {
    start: s.side,
    end: e.side,
    diffMs,
    negative: diffMs < 0,
    days,
    hours,
    minutes,
    seconds,
    totalHours: (abs / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    calY: cal.y,
    calM: cal.m,
    calD: cal.d,
    calNegative,
    dstChanges: dst
  }
  const notes: string[] = []
  if (s.side.status !== 'unique') notes.push('开始时刻含夏令时跳变说明')
  if (e.side.status !== 'unique') notes.push('结束时刻含夏令时跳变说明')
  if (diffMs < 0) notes.push('结束时间早于开始时间，已按负差显示')
  run.markOk(`按真实时刻计算：${diffMs.toLocaleString('en-US')} ms${notes.length ? ' · ' + notes.join('；') : ''}`)
}

watch([startLocal, endLocal, startTz, endTz], execute)

function swap() {
  const sl = startLocal.value
  const st = startTz.value
  startLocal.value = endLocal.value
  startTz.value = endTz.value
  endLocal.value = sl
  endTz.value = st
}

function loadNormalSample() {
  startTz.value = 'Asia/Shanghai'
  endTz.value = 'Asia/Shanghai'
  startLocal.value = '2026-03-01T08:00'
  endLocal.value = '2026-03-02T09:30'
}

function loadDstSample() {
  startTz.value = 'America/New_York'
  endTz.value = 'America/New_York'
  startLocal.value = '2026-03-07T01:00'
  endLocal.value = '2026-03-09T01:00'
}
</script>

<template>
  <div class="t21">
    <div class="t21__toolbar">
      <DkButton size="sm" variant="ghost" @click="loadNormalSample">示例：普通跨日</DkButton>
      <DkButton size="sm" variant="ghost" @click="loadDstSample">示例：跨夏令时（纽约 3 月拨快）</DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? inputErr || run.errorMsg.value : run.staleNote.value"
      :meta="[startTz, endTz]"
    />

    <div class="t21__inputs" :class="{ 't21__inputs--err': !!inputErr }">
      <div class="t21__side">
        <DkField label="开始时间" help="按下方所选时区的墙钟解释">
          <DkInput v-model="startLocal" type="datetime-local" step="1" :error="!!inputErr" />
        </DkField>
        <div class="t21__tz">
          <span class="t21__tz-label">时区</span>
          <DkSelect v-model="startTz" :options="ZONES" />
        </div>
      </div>
      <DkIconButton title="交换开始与结束（含时区）" class="t21__swap" @click="swap">
        <DkIcon name="swap" :size="16" />
      </DkIconButton>
      <div class="t21__side">
        <DkField label="结束时间" help="按下方所选时区的墙钟解释">
          <DkInput v-model="endLocal" type="datetime-local" step="1" :error="!!inputErr" />
        </DkField>
        <div class="t21__tz">
          <span class="t21__tz-label">时区</span>
          <DkSelect v-model="endTz" :options="ZONES" />
        </div>
      </div>
    </div>

    <template v-if="result">
      <p v-if="inputErr" class="t21__err">{{ inputErr }}</p>

      <div class="t21__sides">
        <div class="t21__side-line">
          <span class="t21__side-tag">开始</span>
          <span class="mono">{{ result.start.wall }}</span>
          <span class="t21__side-tz">（{{ result.start.tz }}，{{ result.start.offset }}）</span>
        </div>
        <div class="t21__side-line">
          <span class="t21__side-tag t21__side-tag--end">结束</span>
          <span class="mono">{{ result.end.wall }}</span>
          <span class="t21__side-tz">（{{ result.end.tz }}，{{ result.end.offset }}）</span>
        </div>
      </div>

      <p v-if="result.start.wallNote || result.end.wallNote" class="t21__warn">{{ [result.start.wallNote, result.end.wallNote].filter(Boolean).join('；') }}</p>

      <p v-if="result.negative" class="t21__neg">结束时间早于开始时间：以下时长为负差（绝对值 {{ Math.abs(result.diffMs).toLocaleString('en-US') }} ms）。</p>

      <div class="t21__grid">
        <div class="t21__panel">
          <div class="t21__panel-head">
            <span>① 实际经过时长（按真实时刻）</span>
          </div>
          <dl class="t21__kv">
            <dt>总毫秒</dt>
            <dd class="mono">{{ result.diffMs.toLocaleString('en-US') }} ms</dd>
            <dt>时长</dt>
            <dd class="mono">{{ result.negative ? '−' : '' }}{{ result.days }} 天 {{ result.hours }} 小时 {{ result.minutes }} 分 {{ result.seconds }} 秒</dd>
            <dt>总小时数</dt>
            <dd class="mono">{{ result.negative ? '−' : '' }}{{ result.totalHours }} 小时</dd>
          </dl>
          <p class="t21__note">按真实时刻（UTC 毫秒）计算，跨夏令时的自然日不是恒定 24 小时。</p>
        </div>

        <div class="t21__panel">
          <div class="t21__panel-head">
            <span>② 日历年月日差（按日历日期）</span>
          </div>
          <dl class="t21__kv">
            <dt>年月日差</dt>
            <dd class="mono">{{ result.calNegative ? '−' : '' }}{{ result.calY }} 年 {{ result.calM }} 月 {{ result.calD }} 日</dd>
            <dt>计算口径</dt>
            <dd>开始一侧本地日期 → 结束一侧本地日期（各按自己时区），不含时分秒</dd>
          </dl>
          <p class="t21__note">按日历日期相减，与实际时长含义不同（例如跨夏令时的 2 个自然日实际只有 47 小时）。</p>
        </div>
      </div>

      <p v-if="result.dstChanges.length" class="t21__warn t21__warn--dst">
        区间内时区发生夏令时切换，实际时长已按真实时刻计算：
        <template v-for="(c, i) in result.dstChanges" :key="i">
          {{ c.zone }} 于 {{ c.date }} 由 {{ c.from }} 切换为 {{ c.to }}{{ i < result.dstChanges.length - 1 ? '；' : '' }}
        </template>
      </p>
      <p v-else class="t21__note-plain tertiary">区间内两端时区未发生 UTC 偏移变化（按天采样检测）。</p>

      <div class="t21__copy">
        <DkIconButton
          title="复制结果摘要"
          :disabled="run.status.value === 'stale'"
          @click="
            clipboard.copy(
              `开始 ${result.start.wall}（${result.start.tz}，${result.start.offset}）\n结束 ${result.end.wall}（${result.end.tz}，${result.end.offset}）\n实际时长：${result.negative ? '-' : ''}${result.days}天${result.hours}小时${result.minutes}分${result.seconds}秒（${result.diffMs} ms）\n日历差：${result.calNegative ? '-' : ''}${result.calY}年${result.calM}月${result.calD}日`,
              '结果摘要'
            )
          "
        >
          <DkIcon name="copy" :size="14" />
        </DkIconButton>
      </div>
    </template>
    <p v-else class="t21__empty tertiary">选择开始与结束时间后即时计算（可载入示例对照）。</p>

    <DkCollapse title="口径说明与已验证示例（node Intl 计算）">
      <ul>
        <li><b>实际经过时长</b>：两端先换算为真实时刻（UTC 毫秒）再相减，与时区无关；跨夏令时的自然日不是恒定 24 小时。</li>
        <li><b>日历年月日差</b>：按两端各自时区的本地日历日期相减（不含时分秒），是日历口径，与实际时长含义不同。</li>
        <li><b>普通跨日示例</b>：<code>2026-03-01 08:00 → 2026-03-02 09:30</code>（Asia/Shanghai）= <code>91,800,000 ms</code> = 1 天 1 小时 30 分（25.5 小时）；日历差 0 年 0 月 1 日。</li>
        <li><b>跨夏令时示例</b>：<code>2026-03-07 01:00 → 2026-03-09 01:00</code>（America/New_York）= <b>47 小时</b>（不是 48）：2026-03-08 02:00 拨快至 03:00，UTC 偏移由 −5 变为 −4；日历差 0 年 0 月 2 日。</li>
        <li><b>跳变时刻</b>：若某端墙钟落在夏令时跳变区间（不存在）或回拨区间（出现两次），会给出说明并注明采用的解释。</li>
        <li><b>结束早于开始</b>：显示负差并明确标注，不取绝对值冒充正数。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t21 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t21__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t21__inputs {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.t21__side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 240px;
  flex: 1;
}
.t21__side :deep(.dk-input) {
  width: 220px;
}
.t21__swap {
  margin-bottom: 4px;
}
.t21__tz {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t21__tz-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t21__err {
  margin: 0;
  font-size: 13px;
  color: var(--error);
}
.t21__sides {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.t21__side-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.t21__side-tag {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}
.t21__side-tag--end {
  background: var(--ok-soft);
  color: var(--ok);
}
.t21__side-tz {
  color: var(--text-tertiary);
  font-size: 12px;
}
.t21__warn {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
  line-height: 1.7;
}
.t21__neg {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--error-soft);
  color: var(--error);
  font-size: 12px;
}
.t21__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 860px) {
  .t21__grid {
    grid-template-columns: 1fr;
  }
}
.t21__panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t21__panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t21__kv {
  display: grid;
  grid-template-columns: 90px 1fr;
  margin: 0;
  padding: 6px 0;
}
.t21__kv dt {
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border);
}
.t21__kv dt:first-of-type {
  border-top: none;
}
.t21__kv dd {
  padding: 7px 12px 7px 0;
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  border-top: 1px solid var(--border);
}
.t21__kv dd:first-of-type {
  border-top: none;
}
.t21__note {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  line-height: 1.6;
}
.t21__note-plain {
  margin: 0;
  font-size: 12px;
}
.t21__copy {
  display: flex;
  justify-content: flex-end;
}
.t21__empty {
  padding: 14px;
  font-size: 13px;
  margin: 0;
}
</style>
