<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

type SourceEnc = 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be' | 'shift_jis' | 'big5'
type TargetEnc = 'utf-8' | 'utf-16le' | 'utf-16be' | 'iso-8859-1'
type NewlineMode = 'keep' | 'lf' | 'crlf' | 'cr'

const SOURCE_ALL: Array<{ value: SourceEnc; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GBK（gb18030）' },
  { value: 'utf-16le', label: 'UTF-16LE' },
  { value: 'utf-16be', label: 'UTF-16BE' },
  { value: 'shift_jis', label: 'Shift_JIS' },
  { value: 'big5', label: 'Big5' }
]

const toast = useToast()

const file = ref<File | null>(null)
const bytes = ref<Uint8Array | null>(null)
const detected = ref<{ label: string; certain: boolean; bom: string }>({ label: '', certain: false, bom: '' })
const sourceEnc = ref<SourceEnc>('utf-8')
const supportedEncs = ref<SourceEnc[]>([])
const text = ref('')
const decodeNote = ref('')

const targetEnc = ref<TargetEnc>('utf-8')
const bomOut = ref(false)
const newline = ref<NewlineMode>('keep')
const busy = ref(false)

const sig = () =>
  JSON.stringify([
    file.value ? [file.value.name, file.value.size, file.value.lastModified] : null,
    sourceEnc.value,
    targetEnc.value,
    bomOut.value,
    newline.value
  ])
const run = useToolRun(sig)

/** 各编码是否被当前浏览器 TextDecoder 支持（仅客户端检测） */
onMounted(() => {
  supportedEncs.value = SOURCE_ALL.filter((o) => {
    try {
      new TextDecoder(o.value)
      return true
    } catch {
      return false
    }
  }).map((o) => o.value)
})

const sourceOptions = computed(() =>
  SOURCE_ALL.filter((o) => supportedEncs.value.length === 0 || supportedEncs.value.includes(o.value))
)
const unsupportedNote = computed(() => {
  if (!supportedEncs.value.length) return ''
  const missing = SOURCE_ALL.filter((o) => !supportedEncs.value.includes(o.value))
  return missing.length ? `当前浏览器不支持：${missing.map((m) => m.label).join('、')}（已禁用）` : ''
})

const targetOptions = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16LE' },
  { value: 'utf-16be', label: 'UTF-16BE' },
  { value: 'iso-8859-1', label: 'ISO-8859-1（Latin-1，仅 0x00–0xFF）' }
]

/* ---------- 读取与检测 ---------- */
async function onFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  busy.value = true
  try {
    const buf = await f.arrayBuffer()
    file.value = f
    bytes.value = new Uint8Array(buf)
    detect()
    await decode()
  } catch (e) {
    run.markFail(`读取文件失败：${errMessage(e)}`)
  } finally {
    busy.value = false
  }
}

/** BOM → 严格 UTF-8 尝试；检测不确定时必须标示 */
function detect() {
  const b = bytes.value
  if (!b) return
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    detected.value = { label: 'UTF-8（BOM 标识）', certain: true, bom: 'utf-8' }
    sourceEnc.value = 'utf-8'
    return
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    detected.value = { label: 'UTF-16LE（BOM 标识）', certain: true, bom: 'utf-16le' }
    sourceEnc.value = 'utf-16le'
    return
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    detected.value = { label: 'UTF-16BE（BOM 标识）', certain: true, bom: 'utf-16be' }
    sourceEnc.value = 'utf-16be'
    return
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b)
    detected.value = { label: 'UTF-8（已验证：严格解码通过）', certain: true, bom: '' }
    sourceEnc.value = 'utf-8'
  } catch {
    // 非 UTF-8：无法确定具体编码，给出猜测并明确标示不确定
    detected.value = { label: '非 UTF-8（猜测可能为 GBK 等，请手动确认）', certain: false, bom: '' }
    sourceEnc.value = 'gb18030'
  }
}

async function decode() {
  const b = bytes.value
  if (!b) return
  try {
    const dec = new TextDecoder(sourceEnc.value, { fatal: false })
    text.value = dec.decode(b)
    const repl = countReplacement(text.value)
    decodeNote.value = repl > 0 ? `解码后存在 ${repl} 个替换字符（U+FFFD），原数据在当前编码下有损坏` : ''
  } catch (e) {
    text.value = ''
    run.markFail(`用 ${sourceEnc.value} 解码失败：${errMessage(e)}`)
    return
  }
  convert()
}

function countReplacement(s: string): number {
  let n = 0
  let idx = s.indexOf('\uFFFD')
  while (idx !== -1) {
    n++
    idx = s.indexOf('\uFFFD', idx + 1)
  }
  return n
}

/* ---------- 换行统计 ---------- */
const lineStats = computed(() => {
  const s = text.value
  const crlf = (s.match(/\r\n/g) ?? []).length
  const totalCr = (s.match(/\r/g) ?? []).length
  const totalLf = (s.match(/\n/g) ?? []).length
  return { lf: totalLf - crlf, crlf, cr: totalCr - crlf }
})

function normalizeNewlines(s: string, mode: NewlineMode): string {
  if (mode === 'keep') return s
  const unified = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (mode === 'lf') return unified
  if (mode === 'crlf') return unified.replace(/\n/g, '\r\n')
  return unified.replace(/\n/g, '\r')
}

/* ---------- 输出编码 ---------- */
function encodeUtf16(s: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (littleEndian) {
      out[i * 2] = c & 0xff
      out[i * 2 + 1] = c >> 8
    } else {
      out[i * 2] = c >> 8
      out[i * 2 + 1] = c & 0xff
    }
  }
  return out
}

/** ISO-8859-1 按码元逐个编码；> U+00FF 的码元已在 scanUnrepresentable 阶段被拦下或替换为 ? */
function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c <= 0xff ? c : 0x3f
  }
  return out
}

/** 孤立代理项（lone surrogate）：TextEncoder 会静默替换为 U+FFFD，必须提示 */
function countLoneSurrogates(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const hi = c >= 0xd800 && c <= 0xdbff
    const lo = c >= 0xdc00 && c <= 0xdfff
    if (hi) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (!(next >= 0xdc00 && next <= 0xdfff)) n++
    } else if (lo) {
      n++
    }
  }
  return n
}

const convertedText = computed(() => normalizeNewlines(text.value, newline.value))
const loneSurrogates = computed(() => countLoneSurrogates(convertedText.value))

/* ---------- ISO-8859-1：无法表示的字符定位（真实可达的状态） ---------- */
interface Unrepresentable {
  line: number
  /** 1 起算的列号，按码点计数（emoji 记 1 列） */
  col: number
  char: string
  cp: number
  kind: string
}

function kindOfChar(cp: number): string {
  if ((cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) return 'emoji'
  if (cp >= 0x4e00 && cp <= 0x9fff) return '汉字'
  if (cp >= 0x3000 && cp <= 0x303f) return '中文标点'
  if (cp >= 0xff00 && cp <= 0xffef) return '全角字符'
  if (cp >= 0x0400 && cp <= 0x04ff) return '西里尔字母'
  return '符号 / 字符'
}

/** 逐码点扫描 > U+00FF 的字符并给出真实行列位置（\r\n 与 \r 都算换行） */
function scanUnrepresentable(s: string): Unrepresentable[] {
  const list: Unrepresentable[] = []
  const chars = [...s]
  let line = 1
  let col = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && chars[i + 1] === '\n') i++
      line++
      col = 0
      continue
    }
    col++
    const cp = ch.codePointAt(0)!
    if (cp > 0xff) list.push({ line, col, char: ch, cp, kind: kindOfChar(cp) })
  }
  return list
}

/** 仅在用户显式确认后，把无法表示的码点替换为 ?（不静默执行） */
function replaceUnrepresentable(s: string): string {
  let out = ''
  for (const ch of s) out += ch.codePointAt(0)! <= 0xff ? ch : '?'
  return out
}

const latin1Only = computed(() => targetEnc.value === 'iso-8859-1')
const unrepresentable = computed(() => (latin1Only.value ? scanUnrepresentable(convertedText.value) : []))
const replaceMode = ref(false)
const blocked = computed(() => latin1Only.value && unrepresentable.value.length > 0 && !replaceMode.value)
const outputText = computed(() => (replaceMode.value ? replaceUnrepresentable(convertedText.value) : convertedText.value))

const outBytes = computed<Uint8Array | null>(() => {
  if (!bytes.value) return null
  const s = outputText.value
  if (targetEnc.value === 'utf-8') return new TextEncoder().encode(s)
  if (targetEnc.value === 'iso-8859-1') return encodeLatin1(s)
  return encodeUtf16(s, targetEnc.value === 'utf-16le')
})

const BOM_BYTES: Record<string, Uint8Array> = {
  'utf-8': new Uint8Array([0xef, 0xbb, 0xbf]),
  'utf-16le': new Uint8Array([0xff, 0xfe]),
  'utf-16be': new Uint8Array([0xfe, 0xff])
}

/** ISO-8859-1 没有标准 BOM，该项对其不可用 */
const bomAvailable = computed(() => targetEnc.value !== 'iso-8859-1')

const bomLabel = computed(() => {
  if (targetEnc.value === 'iso-8859-1') return 'ISO-8859-1 无 BOM（该编码没有标准 BOM）'
  return targetEnc.value === 'utf-8' ? '输出 BOM（UTF-8：EF BB BF）' : `输出 BOM（${targetEnc.value === 'utf-16le' ? 'FF FE' : 'FE FF'}）`
})

/** 转换（预览型：参数变化即时生效） */
function convert() {
  if (!bytes.value || !file.value) {
    run.markIdle()
    return
  }
  const notes: string[] = []
  if (decodeNote.value) notes.push(decodeNote.value)
  if (latin1Only.value && unrepresentable.value.length > 0) {
    if (!replaceMode.value) {
      run.markFail(`目标编码 ISO-8859-1 无法表示 ${unrepresentable.value.length} 个字符，已保留原输入并阻止导出；可改用 UTF-8，或显式替换为 ? 后再导出`)
      return
    }
    notes.push(`已将 ${unrepresentable.value.length} 个无法表示的字符替换为 ?（经你确认）`)
  }
  if (loneSurrogates.value > 0 && targetEnc.value === 'utf-8') {
    notes.push(`文本包含 ${loneSurrogates.value} 个孤立代理项，UTF-8 编码时将被替换为替换字符（原文可能已损坏）`)
  }
  if (newline.value !== 'keep') notes.push(`换行已统一为 ${newline.value === 'lf' ? 'LF' : newline.value === 'crlf' ? 'CRLF' : 'CR'}`)
  run.markOk(notes.join('；'))
}

/** 用户显式确认：替换无法表示的字符后允许导出 */
function applyReplace() {
  replaceMode.value = true
  convert()
}

watch([sourceEnc], () => void decode())
watch(targetEnc, (t) => {
  replaceMode.value = false
  if (t === 'iso-8859-1') bomOut.value = false
  convert()
})
watch([bomOut], convert)
watch([newline, file], () => {
  replaceMode.value = false
  convert()
})

function clearFile() {
  file.value = null
  bytes.value = null
  text.value = ''
  detected.value = { label: '', certain: false, bom: '' }
  decodeNote.value = ''
  run.markIdle()
}

function outName(): string {
  const src = file.value?.name ?? 'file.txt'
  const base = src.replace(/\.[^./\\]+$/, '') || src
  return `${base}-converted.txt`
}

function download() {
  if (blocked.value) return
  const body = outBytes.value
  if (!body) return
  const bom = bomOut.value && bomAvailable.value ? (BOM_BYTES[targetEnc.value] ?? null) : null
  const blob = bom ? new Blob([bom as unknown as BlobPart, body as unknown as BlobPart], { type: 'text/plain' }) : new Blob([body as unknown as BlobPart], { type: 'text/plain' })
  downloadBlob(outName(), blob)
}
</script>

<template>
  <div class="t40">
    <div class="t40__toolbar">
      <span v-if="file" class="t40__file-chip">
        <DkIcon name="file-text" :size="14" />
        <span class="mono t40__file-name">{{ file.name }}</span>
        <span class="tertiary">{{ formatBytes(file.size) }}</span>
        <DkIconButton title="移除文件" @click="clearFile">
          <DkIcon name="trash" :size="14" />
        </DkIconButton>
      </span>
      <span class="grow"></span>
      <DkButton size="sm" variant="primary" :disabled="!outBytes || blocked" :title="blocked ? '目标编码无法表示全部字符，已阻止导出' : '按当前目标编码与换行另存为新文件'" @click="download">
        <DkIcon name="download" :size="12" />
        下载 {{ outName() }}
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? '读取文件…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value || (detected.label ? `检测：${detected.label}` : '')"
      :meta="file ? [sourceEnc, `→ ${targetEnc}${bomOut ? ' + BOM' : ''}`] : []"
      :retry="convert"
    />

    <FileDrop
      accept=".txt,.md,.log,.csv,.json,.xml,.properties,.yml,.yaml,.ini,.html,.css,.js,.ts"
      hint="文本类文件（.txt / .md / .log / .csv / .json 等）；文件只在本地读取"
      @files="onFiles"
      @reject="(reason: string) => toast.warning(reason)"
    />

    <template v-if="file && bytes">
      <div class="t40__detect" :class="{ 't40__detect--uncertain': !detected.certain }">
        <DkIcon :name="detected.certain ? 'check' : 'alert-triangle'" :size="14" />
        <span>编码检测：{{ detected.label || '检测中…' }}</span>
        <span v-if="!detected.certain" class="t40__detect-hint">浏览器无法权威判定原编码，上面的解码结果只是按当前选择展示——请结合内容自行确认后，必要时手动切换下方编码。</span>
      </div>
      <p v-if="decodeNote" class="t40__repl">{{ decodeNote }}</p>

      <div v-if="latin1Only && unrepresentable.length" class="t40__unrep">
        <div class="t40__unrep-head">
          <DkIcon name="alert-triangle" :size="15" />
          <strong>目标编码 ISO-8859-1 无法表示 {{ unrepresentable.length }} 个字符</strong>
          <span class="grow"></span>
          <DkButton size="sm" @click="targetEnc = 'utf-8'">改用 UTF-8</DkButton>
          <DkButton v-if="!replaceMode" size="sm" variant="primary" @click="applyReplace">替换为 ? 后导出</DkButton>
        </div>
        <ul class="t40__unrep-list">
          <li v-for="(u, i) in unrepresentable.slice(0, 12)" :key="i">
            第 {{ u.line }} 行 · 第 {{ u.col }} 列：<span class="mono">{{ u.char }}</span>
            （U+{{ u.cp.toString(16).toUpperCase().padStart(4, '0') }}，{{ u.kind }}）
          </li>
        </ul>
        <p v-if="unrepresentable.length > 12" class="t40__unrep-more tertiary">另有 {{ unrepresentable.length - 12 }} 处未逐条列出。</p>
        <p class="t40__unrep-note">
          {{ replaceMode
            ? '已将上述字符替换为 ?（只影响导出的字节与右侧预览，左侧解码预览仍保留原字符）。'
            : '原输入已完整保留，未做任何静默替换或丢弃；导出已被阻止。' }}
        </p>
      </div>

      <div class="t40__opts">
        <DkField label="源编码（可手动覆盖）" :help="unsupportedNote || '检测不确定时可在此切换，左侧预览即时更新'">
          <DkSelect v-model="sourceEnc" :options="sourceOptions" />
        </DkField>
        <DkField label="目标编码" help="可真实输出：UTF-8（TextEncoder）、UTF-16LE / UTF-16BE（按码元自行编码）、ISO-8859-1（charCode 逐个编码，仅 0x00–0xFF）。浏览器无法可靠编码 GBK / GB18030 / Shift_JIS / Big5，因此不作为目标编码，仅可作源读取。">
          <DkSelect v-model="targetEnc" :options="targetOptions" />
        </DkField>
        <DkField label="换行" help="统一会先归并 LF / CRLF / CR 再替换">
          <DkSelect
            v-model="newline"
            :options="[
              { value: 'keep', label: '保持原样' },
              { value: 'lf', label: '统一为 LF' },
              { value: 'crlf', label: '统一为 CRLF' },
              { value: 'cr', label: '统一为 CR' }
            ]"
          />
        </DkField>
        <div class="t40__opt-check">
          <DkCheckbox v-model="bomOut" :label="bomLabel" :disabled="!bomAvailable" />
        </div>
      </div>

      <div class="t40__stats tertiary">
        <span>换行统计：LF {{ lineStats.lf }} 处 / CRLF {{ lineStats.crlf }} 处 / CR {{ lineStats.cr }} 处</span>
        <span>字符 {{ text.length }} · 解码后 UTF-8 字节 {{ byteLength(text) }} · 输出 {{ blocked ? '已阻止（存在无法表示的字符）' : outBytes ? formatBytes(outBytes.length) : '—' }}{{ bomOut && !blocked ? '（不含 BOM）' : '' }}</span>
      </div>

      <div class="t40__panes">
        <SplitPanes :initial="50" :min="25" :max="75">
          <template #left>
            <DkEditor
              :model-value="text"
              readonly
              lang="解码预览（源编码）"
              placeholder="解码后的内容"
              :height="'calc(45vh - 60px)'"
              filename="decoded.txt"
            />
          </template>
          <template #right>
            <DkEditor
              :model-value="outputText"
              readonly
              lang="转换预览（目标编码 + 换行）"
              placeholder="转换后的内容（按目标编码写盘时以字节为准，预览为对应文本）"
              :height="'calc(45vh - 60px)'"
              :stale="run.status.value === 'stale'"
              :filename="outName()"
            />
          </template>
        </SplitPanes>
      </div>
    </template>
    <p v-else class="t40__empty tertiary">选择文本文件后自动检测编码并解码预览；也可在上方 accept 之外手动输入任意文件名（拖拽不受过滤限制）。</p>

    <DkCollapse title="使用说明">
      <ul>
        <li>检测顺序：BOM（UTF-8 / UTF-16LE / UTF-16BE）→ 严格 UTF-8 验证 → 失败则标示「非 UTF-8，猜测可能为 GBK 等」并默认按 GBK 解码供预览，由你手动确认。</li>
        <li>目标编码可真实输出的有：UTF-8（TextEncoder）、UTF-16LE / UTF-16BE（本工具按码元逐个编码）、ISO-8859-1（Latin-1，本工具按 charCode 逐个编码，只覆盖 U+0000–U+00FF）。GBK / GB18030 / Shift_JIS / Big5 不作为目标编码——浏览器没有可靠的本地编码器，不做假的“支持”；它们仅可作为源编码读取。</li>
        <li>目标编码选 ISO-8859-1 且文本含 U+00FF 以上的字符（中文、emoji 等）时，会逐条给出「第几行第几列、是什么字符、码点与类型」，并阻止导出；原输入保持不变，只有你点「替换为 ? 后导出」才会把无法表示的字符写成 ?（0x3F）。</li>
        <li>输出 BOM 会把对应字节（UTF-8: EF BB BF；UTF-16LE: FF FE；UTF-16BE: FE FF）写到文件最前面；ISO-8859-1 没有标准 BOM，该选项对其不可用。</li>
        <li>出现替换字符（�）说明原数据在当前源编码下无法对上字节，多为编码选错或文件损坏。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t40 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t40__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t40__file-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
}
.t40__file-name {
  overflow-wrap: anywhere;
}
.t40__detect {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--ok);
  border-radius: var(--radius);
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 13px;
}
.t40__detect--uncertain {
  border-color: var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
}
.t40__detect-hint {
  font-size: 12px;
  color: var(--text-secondary);
}
.t40__repl {
  padding: 8px 12px;
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
}
.t40__unrep {
  padding: 10px 12px;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  background: var(--error-soft);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.t40__unrep-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--error);
  font-size: 13px;
  flex-wrap: wrap;
}
.t40__unrep-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12.5px;
  color: var(--text-primary);
}
.t40__unrep-more,
.t40__unrep-note {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}
.t40__opts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  align-items: start;
}
.t40__opt-check {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding-top: 22px;
}
.t40__stats {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
}
.t40__panes {
  min-height: 280px;
}
.t40__empty {
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
</style>
