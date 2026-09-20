<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

/**
 * T19 UUID 生成与解析
 * v4：crypto.getRandomValues，version=4 / variant=10；v7：48 位毫秒时间戳 + 随机，version=7 / variant=10。
 * 解析示例均由 node 生成/验证：
 *   v4 d8aae8a2-5112-45a6-b8de-f85a7a34ee02（node crypto.randomUUID）
 *   v7 01a0bc8d-0e0f-7820-adaf-a5739f94c4d2 → 1789869755919ms → 2026-09-20T02:02:35.919Z
 *   v1 ce332000-b4ea-11f1-9234-aabbccddeeff → 2026-09-20T12:00:00.000Z（1582 纪元换算已验证）
 */

const tab = ref<'gen' | 'parse'>('gen')
const version = ref<'v4' | 'v7'>('v7')
const count = ref('10')
const upper = ref(false)
const hyphens = ref(true)
const generated = ref<string[]>([])
const generatedAt = ref(0)
const genErr = ref('')

const parseInput = ref('')
const parseErr = ref('')

const clipboard = useClipboard()

// 生成参数（版本/数量）变化 → 结果待更新；显示选项（大小写/连字符）仅影响展示，实时生效不触发待更新；
// sig 不含「生成动作本身」会改变的值，避免生成后被误标记为待更新
const sig = () => JSON.stringify([tab.value, version.value, count.value])
const run = useToolRun(sig)

// ---------- 版本 / 变体含义 ----------

const VERSION_MEANING: Record<number, string> = {
  0: '版本 0：非标准（version 位为 0，极少见，请核对来源）',
  1: '版本 1：基于时间戳与节点标识（60 位 100ns 计数，自 1582-10-15 起）',
  2: '版本 2：DCE Security（v1 变体，嵌入 POSIX UID/GID，少见）',
  3: '版本 3：命名空间 + 名字的 MD5 哈希（确定性命名）',
  4: '版本 4：纯随机（122 位随机位，不含时间信息）',
  5: '版本 5：命名空间 + 名字的 SHA-1 哈希（确定性命名）',
  6: '版本 6：有序时间（v1 时间字段重排，提案草案，非 RFC 标准版）',
  7: '版本 7：有序时间（48 位 Unix 毫秒 + 随机，RFC 9562）',
  8: '版本 8：自定义（RFC 9562 预留，语义由生成方定义）'
}

const VARIANT_MEANING: Record<string, string> = {
  rfc4122: 'RFC 4122 / RFC 9562（variant 位 10x，标准 UUID）',
  microsoft: 'Microsoft GUID（variant 位 110，向后兼容）',
  future: '保留（variant 位 111，未来定义）',
  reserved: '保留（variant 位 0xx，NCS 向后兼容，罕见）'
}

// ---------- 生成（真实 crypto） ----------

function bytesToUuid(b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function genV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40 // version 4
  b[8] = (b[8]! & 0x3f) | 0x80 // variant 10x
  return bytesToUuid(b)
}

function genV7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  const ms = Date.now()
  b[0] = Math.floor(ms / 2 ** 40) & 0xff
  b[1] = Math.floor(ms / 2 ** 32) & 0xff
  b[2] = Math.floor(ms / 2 ** 24) & 0xff
  b[3] = Math.floor(ms / 2 ** 16) & 0xff
  b[4] = Math.floor(ms / 2 ** 8) & 0xff
  b[5] = ms & 0xff
  b[6] = (b[6]! & 0x0f) | 0x70 // version 7
  b[8] = (b[8]! & 0x3f) | 0x80 // variant 10x
  return bytesToUuid(b)
}

function generate() {
  const n = Number(count.value.trim())
  if (!/^\d+$/.test(count.value.trim()) || !Number.isInteger(n) || n < 1 || n > 1000) {
    genErr.value = `数量「${count.value.trim() || '（空）'}」无效：应为 1-1000 的整数`
    run.markFail(genErr.value)
    return
  }
  genErr.value = ''
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(version.value === 'v4' ? genV4() : genV7())
  generated.value = out
  generatedAt.value = Date.now()
  run.markOk(`已真实生成 ${n} 个 UUID ${version.value.toUpperCase()}（crypto.getRandomValues）`)
}

const displayList = computed(() => generated.value.map((u) => display(u)))

function display(u: string): string {
  let s = hyphens.value ? u : u.replace(/-/g, '')
  if (upper.value) s = s.toUpperCase()
  return s
}

function copyAll() {
  clipboard.copy(displayList.value.join('\n'), `${generated.value.length} 个 UUID`)
}

function downloadAll() {
  downloadText(`uuid-${version.value}.txt`, displayList.value.join('\n') + '\n')
}

// ---------- 解析 ----------

const V1_EPOCH_100NS = 122192928000000000n // 1582-10-15 → 1970-01-01，单位 100ns

interface ParseResult {
  canonical: string
  versionNum: number
  versionText: string
  variantKey: keyof typeof VARIANT_MEANING
  variantText: string
  time: { label: string; ms: number; iso: string; utc: string; bj: string } | null
  note: string
}

const parsed = ref<ParseResult | null>(null)

function readableUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function readableBJ(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .format(new Date(ms))
    .replace(',', '')
}

function executeParse() {
  const raw = parseInput.value.trim()
  if (!raw) {
    parsed.value = null
    parseErr.value = ''
    run.markIdle()
    return
  }
  // 允许 urn:uuid: 前缀与花括号包裹
  let s = raw.replace(/^urn:uuid:/i, '').replace(/^\{/, '').replace(/\}$/, '')
  let hex = ''
  if (s.includes('-')) {
    const groups = s.split('-')
    const expect = [8, 4, 4, 4, 12]
    if (groups.length !== 5) {
      parsed.value = null
      parseErr.value = `分组错误：带连字符的 UUID 应为 5 组（8-4-4-4-12），当前 ${groups.length} 组（${expect.join('-')}）`
      run.markFail(parseErr.value)
      return
    }
    for (let i = 0; i < 5; i++) {
      const g = groups[i]!
      if (g.length !== expect[i]) {
        parsed.value = null
        parseErr.value = `分组错误：第 ${i + 1} 组长度应为 ${expect[i]} 位，实际 ${g.length} 位（8-4-4-4-12）`
        run.markFail(parseErr.value)
        return
      }
      if (!/^[0-9a-fA-F]+$/.test(g)) {
        const bad = [...g].find((c) => !/[0-9a-fA-F]/.test(c))
        parsed.value = null
        parseErr.value = `非法字符：第 ${i + 1} 组含非十六进制字符「${bad}」（只允许 0-9 / a-f / A-F）`
        run.markFail(parseErr.value)
        return
      }
      hex += g
    }
  } else {
    if (s.length !== 32) {
      parsed.value = null
      parseErr.value = `长度错误：无连字符形式应为 32 个十六进制字符，当前 ${s.length} 个（带连字符为 36 位）`
      run.markFail(parseErr.value)
      return
    }
    if (!/^[0-9a-fA-F]+$/.test(s)) {
      const bad = [...s].find((c) => !/[0-9a-fA-F]/.test(c))
      parsed.value = null
      parseErr.value = `非法字符：含非十六进制字符「${bad}」（只允许 0-9 / a-f / A-F）`
      run.markFail(parseErr.value)
      return
    }
    hex = s
  }
  parseErr.value = ''
  const lower = hex.toLowerCase()
  const canonical = `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`
  // 无连字符 32 位十六进制布局：[0..7] time_low、[8..11] time_mid、[12..15] time_hi_and_version、[16..19] clock_seq
  const versionNum = parseInt(lower[12]!, 16)
  const varNib = parseInt(lower[16]!, 16)
  let variantKey: keyof typeof VARIANT_MEANING
  if ((varNib & 0xc) === 0x8) variantKey = 'rfc4122'
  else if ((varNib & 0xe) === 0xc) variantKey = 'microsoft'
  else if ((varNib & 0xe) === 0xe) variantKey = 'future'
  else variantKey = 'reserved'

  let time: ParseResult['time'] = null
  let note = ''
  if (versionNum === 7) {
    const ms = parseInt(lower.slice(0, 12), 16)
    time = { label: 'v7 内嵌时间（48 位 Unix 毫秒）', ms, iso: new Date(ms).toISOString(), utc: readableUTC(ms), bj: readableBJ(ms) }
    note = 'v7 前 48 位即生成时的 Unix 毫秒时间戳，可还原生成时间'
  } else if (versionNum === 4) {
    note = 'v4 为随机生成，不含时间信息，无法得知生成时间（本工具不伪造）'
  } else if (versionNum === 1) {
    const lo = BigInt(`0x${lower.slice(0, 8)}`)
    const mid = BigInt(`0x${lower.slice(8, 12)}`)
    const hi = BigInt(`0x${lower.slice(13, 16)}`)
    const ticks = (hi << 48n) | (mid << 32n) | lo
    const ms = Number((ticks - V1_EPOCH_100NS) / 10000n)
    if (Number.isFinite(ms) && Math.abs(ms) < 8.64e15) {
      time = { label: 'v1 内嵌时间（60 位 100ns，1582-10-15 纪元）', ms, iso: new Date(ms).toISOString(), utc: readableUTC(ms), bj: readableBJ(ms) }
      note = 'v1 时间字段可还原生成时刻（精度 100ns，受节点时钟精度影响）'
    } else {
      note = 'v1 时间字段超出可表示范围，无法换算'
    }
  } else if (versionNum === 3 || versionNum === 5) {
    note = `v${versionNum} 由「命名空间 UUID + 名字」哈希而来，不含时间信息；本工具未拿到原始名字，不做进一步推断`
  } else if (versionNum === 6) {
    note = 'v6 为 v1 时间字段重排的草案版本，本工具按其含义标注，未做时间还原'
  } else if (versionNum === 8) {
    note = 'v8 为自定义版本，语义由生成方定义，本工具不做推断'
  } else {
    note = `版本位为 ${versionNum}，不在已知版本（0-8）内，如实标注`
  }
  parsed.value = {
    canonical,
    versionNum,
    versionText: VERSION_MEANING[versionNum] ?? `未知版本：version 位为 ${versionNum}（十六进制 ${lower[14]}），不属于 0-8 的已知版本`,
    variantKey,
    variantText: VARIANT_MEANING[variantKey] ?? `未知变体：variant 位为 ${variantKey}`,
    time,
    note
  }
  run.markOk(`格式有效 · 版本 ${versionNum} · ${variantKey === 'rfc4122' ? 'RFC 4122 变体' : variantKey}`)
}

watch([tab], () => {
  if (tab.value === 'parse') executeParse()
})
watch(parseInput, executeParse)

// ---------- 示例（node 生成并验证） ----------

const SAMPLE_V7 = '01a0bc8d-0e0f-7820-adaf-a5739f94c4d2' // → 1789869755919ms → 2026-09-20T02:02:35.919Z（北京 10:02:35）
const SAMPLE_V4 = 'd8aae8a2-5112-45a6-b8de-f85a7a34ee02'
const SAMPLE_V1 = 'ce332000-b4ea-11f1-9234-aabbccddeeff' // → 2026-09-20T12:00:00.000Z（北京 20:00:00）

function loadParseSample(u: string) {
  tab.value = 'parse'
  parseInput.value = u
  executeParse()
}

const SAMPLE_V7_NOTE = '示例 v7 = 1789869755919ms = 2026-09-20T02:02:35.919Z = 北京 2026-09-20 10:02:35（node 生成并用同公式回验）'
</script>

<template>
  <div class="t19">
    <div class="t19__toolbar">
      <DkSegmented
        :model-value="tab"
        :options="[
          { value: 'gen', label: '生成' },
          { value: 'parse', label: '解析' }
        ]"
        @update:model-value="tab = $event as any"
      />
      <template v-if="tab === 'gen'">
        <DkSegmented
          size="sm"
          :model-value="version"
          :options="[
            { value: 'v4', label: 'v4 随机', title: '122 位随机数，version=4 / variant=10x' },
            { value: 'v7', label: 'v7 有序时间', title: '48 位 Unix 毫秒 + 随机，version=7 / variant=10x（RFC 9562）' }
          ]"
          @update:model-value="version = $event as any"
        />
        <div class="t19__count">
          <span class="t19__opt-label">数量</span>
          <DkInput v-model="count" mono :error="!!genErr" placeholder="1-1000" />
        </div>
        <DkCheckbox v-model="upper" label="大写" />
        <DkCheckbox v-model="hyphens" label="连字符" />
      </template>
      <span class="grow"></span>
      <template v-if="tab === 'gen'">
        <DkButton size="sm" variant="primary" @click="generate">
          <DkIcon name="zap" :size="12" />
          生成
        </DkButton>
      </template>
      <template v-else>
        <DkButton size="sm" variant="ghost" @click="loadParseSample(SAMPLE_V7)">v7 示例</DkButton>
        <DkButton size="sm" variant="ghost" @click="loadParseSample(SAMPLE_V4)">v4 示例</DkButton>
        <DkButton size="sm" variant="ghost" @click="loadParseSample(SAMPLE_V1)">v1 示例</DkButton>
      </template>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? (tab === 'gen' ? genErr : parseErr) || run.errorMsg.value : run.staleNote.value"
      :meta="tab === 'gen' ? [version.toUpperCase(), generated.length ? `${generated.length} 个` : ''] : []"
    />

    <!-- 生成 -->
    <template v-if="tab === 'gen'">
      <div class="t19__help tertiary">
        点击「生成」即用浏览器 crypto.getRandomValues 真实生成；v7 会内嵌生成时刻的 48 位 Unix 毫秒时间戳。
        大写 / 连字符为显示选项，实时作用于列表、复制与下载，不改变已生成的值。
      </div>
      <div v-if="generated.length" class="t19__result">
        <div class="t19__result-head">
          <span>生成结果（{{ generated.length }} 个 · {{ version.toUpperCase() }}{{ version === 'v7' ? ` · 批次生成于 ${new Date(generatedAt).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '' }}）</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" :disabled="run.status.value === 'stale'" @click="copyAll">
            <DkIcon name="copy" :size="12" />全部复制
          </DkButton>
          <DkButton size="sm" variant="ghost" :disabled="run.status.value === 'stale'" @click="downloadAll">
            <DkIcon name="download" :size="12" />下载 txt
          </DkButton>
        </div>
        <ol class="t19__list mono">
          <li v-for="(u, i) in displayList" :key="i">
            <span>{{ u }}</span>
            <DkIconButton title="复制" :disabled="run.status.value === 'stale'" @click="clipboard.copy(u, 'UUID')">
              <DkIcon name="copy" :size="13" />
            </DkIconButton>
          </li>
        </ol>
      </div>
      <p v-else class="t19__empty tertiary">尚未生成。选择版本与数量后点击「生成」。</p>
    </template>

    <!-- 解析 -->
    <template v-else>
      <div class="t19__parse-input">
        <DkField
          label="UUID"
          :error="parseErr || undefined"
          help="支持带/不带连字符、大写、urn:uuid: 前缀与花括号；非法字符、长度、分组错误分别提示"
        >
          <DkInput v-model="parseInput" mono :error="!!parseErr" placeholder="如 01a0bc8d-0e0f-7820-adaf-a5739f94c4d2" />
        </DkField>
      </div>

      <div v-if="parsed" class="t19__result">
        <div class="t19__result-head">
          <span>解析结果</span>
          <span class="grow"></span>
          <DkIconButton title="复制规范形式" :disabled="run.status.value === 'stale'" @click="clipboard.copy(parsed.canonical, '规范 UUID')">
            <DkIcon name="copy" :size="14" />
          </DkIconButton>
        </div>
        <dl class="t19__kv">
          <dt>规范形式</dt>
          <dd class="mono">{{ parsed.canonical }}</dd>
          <dt>版本（version 位）</dt>
          <dd>
            <span class="t19__badge">v{{ parsed.versionNum }}</span>
            {{ parsed.versionText }}
          </dd>
          <dt>变体（variant 位）</dt>
          <dd>{{ parsed.variantText }}</dd>
          <template v-if="parsed.time">
            <dt>{{ parsed.time.label }}</dt>
            <dd class="mono">
              {{ parsed.time.ms }} ms · {{ parsed.time.iso }}（UTC）· {{ parsed.time.bj }}（Asia/Shanghai）
            </dd>
          </template>
          <dt>说明</dt>
          <dd :class="{ 't19__note-v4': parsed.versionNum === 4 }">{{ parsed.note }}</dd>
        </dl>
      </div>
      <p v-else-if="!parseErr" class="t19__empty tertiary">输入 UUID 后即时解析。</p>
    </template>

    <DkCollapse title="版本含义表与示例（示例值已用 node 验证）">
      <ul class="t19__versions">
        <li><code>v1</code> 时间：60 位 100ns 计数（1582 纪元）+ 节点标识，可还原生成时间</li>
        <li><code>v3</code> MD5 命名：命名空间 UUID + 名字的 MD5，确定性</li>
        <li><code>v4</code> 随机：122 位随机数，<b>不含时间信息，无法得知生成时间</b></li>
        <li><code>v5</code> SHA-1 命名：命名空间 UUID + 名字的 SHA-1，确定性</li>
        <li><code>v6</code> 有序时间：v1 时间字段重排（草案，非 RFC 标准版）</li>
        <li><code>v7</code> 有序时间：48 位 Unix 毫秒 + 随机（RFC 9562），可还原生成时间</li>
        <li><code>v8</code> 自定义（RFC 9562 预留）</li>
        <li>其他 version 位：如实标注为未知版本</li>
      </ul>
      <p>{{ SAMPLE_V7_NOTE }}</p>
      <p>变体由第 9 个十六进制位的高 3 位决定：10x=RFC 4122 / 110=Microsoft GUID / 111=保留 / 0xx=NCS 保留。</p>
      <p>生成完全真实：每次点击「生成」都现场调用 crypto.getRandomValues，结果列表即生成结果本身。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t19 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t19__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t19__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t19__count {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t19__count :deep(.dk-input) {
  width: 90px;
}
.t19__help {
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}
.t19__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t19__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.t19__list {
  margin: 0;
  padding: 6px 0;
  max-height: 380px;
  overflow: auto;
  list-style: none;
  counter-reset: idx;
  font-size: var(--code-font-size);
}
.t19__list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;
  counter-increment: idx;
}
.t19__list li::before {
  content: counter(idx);
  width: 36px;
  flex-shrink: 0;
  text-align: right;
  color: var(--text-tertiary);
  font-size: 11px;
}
.t19__list li span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.t19__empty {
  padding: 14px;
  font-size: 13px;
  margin: 0;
}
.t19__parse-input {
  max-width: 560px;
}
.t19__kv {
  display: grid;
  grid-template-columns: 190px 1fr;
  margin: 0;
  padding: 6px 0;
}
.t19__kv dt {
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border);
}
.t19__kv dt:first-of-type {
  border-top: none;
}
.t19__kv dd {
  padding: 7px 12px 7px 0;
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  border-top: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.t19__kv dd:first-of-type {
  border-top: none;
}
.t19__badge {
  display: inline-block;
  min-width: 30px;
  text-align: center;
  padding: 1px 8px;
  margin-right: 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
}
.t19__note-v4 {
  color: var(--warn);
}
.t19__versions {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.8;
}
</style>
