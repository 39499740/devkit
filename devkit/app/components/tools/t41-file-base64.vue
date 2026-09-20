<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

const WARN_SIZE = 10 * 1024 * 1024
const MAX_SIZE = 50 * 1024 * 1024

const toast = useToast()

const mode = ref<'file2b64' | 'b642file'>('file2b64')

/* ---------- 文件 → Base64 ---------- */
const file = ref<File | null>(null)
const b64 = ref('')
const outForm = ref<'raw' | 'dataurl'>('raw')
const thumbUrl = ref('')
const bigWarn = ref('')

const sigF = () =>
  JSON.stringify([file.value ? [file.value.name, file.value.size, file.value.lastModified] : null, outForm.value])
const runF = useToolRun(sigF)

onUnmounted(() => {
  if (thumbUrl.value) URL.revokeObjectURL(thumbUrl.value)
})

async function onFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  if (f.size > MAX_SIZE) {
    toast.warning(`文件「${f.name}」超出当前限制（${formatBytes(MAX_SIZE)}），已拒绝`)
    return
  }
  file.value = f
  b64.value = ''
  bigWarn.value = f.size > WARN_SIZE ? '生成文本较大，编辑器可能卡顿' : ''
  if (thumbUrl.value) {
    URL.revokeObjectURL(thumbUrl.value)
    thumbUrl.value = ''
  }
  try {
    const buf = await f.arrayBuffer()
    const raw = bytesToBase64(new Uint8Array(buf))
    b64.value = outForm.value === 'dataurl' ? `data:${f.type || 'application/octet-stream'};base64,${raw}` : raw
    if (f.type.startsWith('image/')) thumbUrl.value = URL.createObjectURL(f)
    runF.markOk(
      `已编码 ${formatBytes(f.size)} → ${b64.value.length} 个字符${f.type.startsWith('image/') ? '（Data URL 形式可直接用作 <img> src）' : ''}`
    )
  } catch (e) {
    runF.markFail(`读取文件失败：${errMessage(e)}`)
  }
}

watch(outForm, () => {
  // 已有结果时切换输出形式：从已算出的裸串重新拼前缀，不重复读文件
  if (!file.value || !b64.value) return
  if (outForm.value === 'dataurl') {
    if (!b64.value.startsWith('data:')) {
      b64.value = `data:${file.value.type || 'application/octet-stream'};base64,${b64.value}`
    }
  } else if (b64.value.startsWith('data:')) {
    b64.value = b64.value.slice(b64.value.indexOf(',', 5) + 1)
  }
})

function clearFile() {
  file.value = null
  b64.value = ''
  bigWarn.value = ''
  if (thumbUrl.value) {
    URL.revokeObjectURL(thumbUrl.value)
    thumbUrl.value = ''
  }
  runF.markIdle()
}

/* ---------- Base64 → 文件 ---------- */
const input = ref('')
const decodeResult = ref<{ bytes: Uint8Array; declaredMime: string; magicType: string; mismatch: boolean } | null>(null)
const decodeErr = ref('')
const fileName = ref('decoded.bin')
/** 用户手动改过文件名后，不再用声明 MIME 的建议覆盖 */
let nameTouched = false
let autoName = 'decoded.bin'

watch(fileName, (v) => {
  if (v !== autoName) nameTouched = true
})

const sigD = () => JSON.stringify([input.value])
const runD = useToolRun(sigD)

const MAGIC: Array<{ label: string; mime: string; head: number[] }> = [
  { label: 'PNG', mime: 'image/png', head: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'JPEG', mime: 'image/jpeg', head: [0xff, 0xd8, 0xff] },
  { label: 'GIF', mime: 'image/gif', head: [0x47, 0x49, 0x46, 0x38] },
  { label: 'PDF', mime: 'application/pdf', head: [0x25, 0x50, 0x44, 0x46] },
  { label: 'ZIP', mime: 'application/zip', head: [0x50, 0x4b] }
]

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/zip': 'zip'
}

function detectMagic(bytes: Uint8Array): string {
  if (bytes.length >= 4 && MAGIC[0]!.head.every((v, i) => bytes[i] === v)) return 'PNG'
  if (bytes.length >= 3 && MAGIC[1]!.head.every((v, i) => bytes[i] === v)) return 'JPEG'
  if (bytes.length >= 4 && MAGIC[2]!.head.every((v, i) => bytes[i] === v)) return 'GIF'
  if (bytes.length >= 4 && MAGIC[3]!.head.every((v, i) => bytes[i] === v)) return 'PDF'
  // ZIP：PK\x03\x04 / PK\x05\x06 / PK\x07\x08
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'ZIP'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x05 || bytes[2] === 0x07)) return 'ZIP'
  return ''
}

function mimeToLabel(mime: string): string {
  const hit = MAGIC.find((m) => m.mime === mime)
  return hit ? hit.label : mime || '未声明'
}

function decode() {
  const raw = input.value.trim()
  if (!raw) {
    decodeResult.value = null
    decodeErr.value = ''
    nameTouched = false
    fileName.value = autoName = 'decoded.bin'
    runD.markIdle()
    return
  }
  let declaredMime = ''
  let b64part = raw
  const m = /^data:([^;,]*)(;[^;,]*)*;base64,(.*)$/s.exec(raw)
  if (m) {
    declaredMime = m[1] ?? ''
    b64part = m[3] ?? ''
  }
  const r = base64ToBytes(b64part)
  if (r.error) {
    decodeResult.value = null
    decodeErr.value = `${r.error}${declaredMime ? '（请检查 Data URL 中 base64 部分是否完整）' : '（支持标准与 URL-safe 字母表，允许空白）'}`
    runD.markFail(decodeErr.value)
    return
  }
  const magicType = detectMagic(r.bytes)
  const mismatch =
    !!declaredMime &&
    !!magicType &&
    !MAGIC.some((mm) => mm.label === magicType && mm.mime === declaredMime)
  decodeResult.value = { bytes: r.bytes, declaredMime, magicType, mismatch }
  decodeErr.value = ''

  // 文件名默认值：声明的 MIME 给常见扩展名建议（仅参考；不覆盖用户手动输入）
  if (!nameTouched) {
    const suggestedExt = declaredMime ? EXT_BY_MIME[declaredMime] : undefined
    fileName.value = autoName = suggestedExt ? `decoded.${suggestedExt}` : 'decoded.bin'
  }

  const notes: string[] = []
  if (mismatch) notes.push('声明的类型与文件头不符')
  if (declaredMime && !magicType) notes.push('未识别出已知文件头，文件头检测仅覆盖 PNG / JPEG / GIF / PDF / ZIP')
  if (!declaredMime && magicType) notes.push(`未声明 MIME，文件头检测为 ${magicType}`)
  runD.markOk(`解码成功：${formatBytes(r.bytes.length)}${notes.length ? '；' + notes.join('；') : ''}`)
}

let decTimer: ReturnType<typeof setTimeout> | undefined
watch(input, () => {
  if (mode.value !== 'b642file') return
  if (decTimer) clearTimeout(decTimer)
  decTimer = setTimeout(decode, 200)
})
onUnmounted(() => {
  if (decTimer) clearTimeout(decTimer)
})

const previewText = computed(() => {
  const r = decodeResult.value
  if (!r) return ''
  if (r.bytes.length === 0) return ''
  if (looksLikeText(r.bytes)) {
    const t = bytesToText(r.bytes)
    if (!t.error) return t.text.length > 20000 ? `${t.text.slice(0, 20000)}\n…（文本过长，预览截断至 2 万字符）` : t.text
  }
  return ''
})

const previewHeadHex = computed(() => {
  const r = decodeResult.value
  if (!r || r.bytes.length === 0) return ''
  return bytesToHex(r.bytes.subarray(0, Math.min(32, r.bytes.length)))
})

function extSuggestionNote(): string {
  const r = decodeResult.value
  if (!r || !r.declaredMime) return ''
  const ext = EXT_BY_MIME[r.declaredMime]
  return ext
    ? `扩展名建议 .${ext} 来自 Data URL 声明的 MIME（${r.declaredMime}），声明值不可信，仅作参考`
    : '声明的 MIME 不在常见扩展名映射内（jpg / png / gif / pdf / txt / zip），文件名保持手动输入值'
}

function downloadDecoded() {
  const r = decodeResult.value
  if (!r) return
  const mime = r.declaredMime || 'application/octet-stream'
  downloadBlob(fileName.value || 'decoded.bin', new Blob([r.bytes as unknown as BlobPart], { type: mime }))
}

function loadSampleB64() {
  // "Hello, DevKit!\n" 的 UTF-8 Base64，可用本工具反向验证
  input.value = 'SGVsbG8sIERldktpdCEK'
  mode.value = 'b642file'
}
</script>

<template>
  <div class="t41">
    <div class="t41__toolbar">
      <DkSegmented
        :model-value="mode"
        :options="[
          { value: 'file2b64', label: '文件 → Base64' },
          { value: 'b642file', label: 'Base64 → 文件' }
        ]"
        @update:model-value="mode = $event as 'file2b64' | 'b642file'"
      />
    </div>

    <!-- 文件 → Base64 -->
    <template v-if="mode === 'file2b64'">
      <DkStatusBar
        :status="runF.status.value"
        :message="runF.status.value === 'error' ? runF.errorMsg.value : runF.staleNote.value || (file ? '' : '选择文件后自动编码，全部在本地完成')"
        :meta="file ? [file.type || 'MIME 未知', formatBytes(file.size)] : []"
      />
      <p v-if="bigWarn" class="t41__warn">{{ bigWarn }}</p>
      <FileDrop
        :max-size="MAX_SIZE"
        hint="任意类型文件（超过 50MB 拒绝，超过 10MB 提示卡顿风险）；文件只在本地读取"
        @files="onFiles"
        @reject="(reason: string) => toast.warning(reason)"
      />
      <template v-if="file">
        <div class="t41__file-info">
          <DkIcon name="file-binary" :size="14" />
          <span class="mono t41__file-name">{{ file.name }}</span>
          <span class="tertiary">{{ formatBytes(file.size) }}</span>
          <span class="tertiary">MIME {{ file.type || '未知（浏览器未识别）' }}</span>
          <span class="grow"></span>
          <DkSegmented
            size="sm"
            :model-value="outForm"
            :options="[
              { value: 'raw', label: 'Base64 裸串' },
              { value: 'dataurl', label: 'Data URL' }
            ]"
            @update:model-value="outForm = $event as 'raw' | 'dataurl'"
          />
          <DkButton size="sm" variant="ghost" @click="clearFile">移除</DkButton>
        </div>
        <img v-if="thumbUrl && outForm === 'dataurl'" class="t41__thumb" :src="thumbUrl" alt="图片缩略图预览" />
        <DkEditor
          :model-value="b64"
          readonly
          :lang="outForm === 'dataurl' ? 'Data URL' : 'Base64'"
          placeholder="编码结果"
          :height="'calc(40vh - 60px)'"
          :filename="outForm === 'dataurl' ? 'data-url.txt' : 'base64.txt'"
        />
      </template>
    </template>

    <!-- Base64 → 文件 -->
    <template v-else>
      <DkStatusBar
        :status="runD.status.value"
        :message="runD.status.value === 'error' ? decodeErr : runD.staleNote.value || '粘贴 Base64 或 Data URL，自动解码'"
        :meta="decodeResult ? [`${formatBytes(decodeResult.bytes.length)}`, decodeResult.declaredMime ? `声明 ${mimeToLabel(decodeResult.declaredMime)}` : '未声明 MIME'] : []"
      />
      <DkEditor
        v-model="input"
        lang="Base64 / Data URL 输入"
        placeholder="粘贴 Base64 裸串，或完整的 Data URL（data:image/png;base64,….）"
        :height="'calc(30vh - 60px)'"
        :wrap="true"
        filename="input-base64.txt"
      />
      <template v-if="decodeResult">
        <div class="t41__decoded">
          <div class="t41__decoded-row">
            <span class="t41__decoded-label">解码大小</span>
            <span class="mono">{{ formatBytes(decodeResult.bytes.length) }}（{{ decodeResult.bytes.length }} 字节）</span>
          </div>
          <div class="t41__decoded-row">
            <span class="t41__decoded-label">声明的 MIME</span>
            <span class="mono">{{ decodeResult.declaredMime || '—（非 Data URL 输入，无声明）' }}</span>
            <span class="t41__note-warn">Data URL 声明的 MIME 不可信，仅作参考</span>
          </div>
          <div class="t41__decoded-row">
            <span class="t41__decoded-label">文件头检测</span>
            <span class="mono">{{ decodeResult.magicType || '未识别出已知文件头（覆盖 PNG / JPEG / GIF / PDF / ZIP）' }}</span>
            <span v-if="decodeResult.magicType" class="t41__note-ok">头部 {{ previewHeadHex.slice(0, 8).toUpperCase() }}…</span>
          </div>
          <p v-if="decodeResult.mismatch" class="t41__mismatch">声明的类型与文件头不符（文件头检测：{{ decodeResult.magicType }}，声明：{{ mimeToLabel(decodeResult.declaredMime) }}）——下载时请自行确认该按哪个类型保存。</p>
          <div class="t41__decoded-row">
            <span class="t41__decoded-label">文件名</span>
            <DkInput v-model="fileName" mono />
          </div>
          <p class="t41__ext-note tertiary">{{ extSuggestionNote() }}</p>
          <div class="t41__decoded-actions">
            <DkButton size="sm" variant="primary" @click="downloadDecoded">
              <DkIcon name="download" :size="12" />
              下载文件
            </DkButton>
          </div>
          <DkEditor
            v-if="previewText"
            :model-value="previewText"
            readonly
            lang="文本预览（按 UTF-8 解码）"
            :height="'180px'"
            filename="preview.txt"
          />
          <p v-else-if="decodeResult.bytes.length" class="t41__binary tertiary">内容不是可显示文本（或不是有效 UTF-8），按二进制文件处理；头部字节：<span class="mono">{{ previewHeadHex }}</span></p>
        </div>
      </template>
      <p v-else-if="decodeErr" class="t41__err">{{ decodeErr }}</p>
      <div class="t41__sample">
        <DkButton size="sm" variant="ghost" title="填入 Hello, DevKit! 的 Base64 并真实解码" @click="loadSampleB64">载入示例</DkButton>
      </div>
    </template>

    <DkCollapse title="使用说明">
      <ul>
        <li>文件 → Base64：输出裸串或 Data URL（前缀 data:MIME;base64,）；图片文件在 Data URL 形式下附带缩略图预览。</li>
        <li>Base64 → 文件：支持标准与 URL-safe 字母表、允许空白；Data URL 中声明的 MIME 与由它建议的扩展名都不可信，仅作参考。</li>
        <li>文件头（魔数）检测覆盖 PNG（89504E47）、JPEG（FFD8FF）、GIF（47494638）、PDF（25504446）、ZIP（504B03/04 等）；声明类型与文件头不符时会给出提示。</li>
        <li>当前单文件上限 {{ formatBytes(MAX_SIZE) }}（超过即拒绝）；超过 {{ formatBytes(WARN_SIZE) }} 的文件编码结果较长，编辑器可能卡顿。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t41 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t41__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t41__warn {
  padding: 8px 12px;
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
}
.t41__file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  flex-wrap: wrap;
}
.t41__file-name {
  overflow-wrap: anywhere;
}
.t41__thumb {
  max-width: 100%;
  max-height: 180px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  align-self: flex-start;
}
.t41__decoded {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t41__decoded-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.t41__decoded-label {
  flex-shrink: 0;
  min-width: 88px;
  font-size: 12px;
  color: var(--text-secondary);
}
.t41__decoded-row .dk-input {
  flex: 1;
  min-width: 200px;
}
.t41__note-warn {
  font-size: 12px;
  color: var(--warn);
}
.t41__note-ok {
  font-size: 12px;
  color: var(--text-secondary);
}
.t41__mismatch {
  padding: 8px 12px;
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 13px;
}
.t41__ext-note {
  font-size: 12px;
}
.t41__decoded-actions {
  display: flex;
  gap: 8px;
}
.t41__binary {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.t41__err {
  padding: 12px 14px;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  background: var(--error-soft);
  color: var(--error);
  font-size: 13px;
}
.t41__sample {
  display: flex;
  justify-content: flex-end;
}
</style>
