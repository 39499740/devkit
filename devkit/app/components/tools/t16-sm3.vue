<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { bytesToBase64, formatBytes, hexToBytes, textToBytes } from '~/utils/bytes'
import { computeSm3 } from '~/utils/crypto/sm3'

defineProps<{ tool: ToolMeta }>()

const mode = ref<'text' | 'file'>('text')
const inputType = ref<'utf8' | 'hex'>('utf8')
const outEnc = ref<'hex' | 'base64'>('hex')
const text = ref('')
const expected = ref('')

const file = ref<File | null>(null)
const fileBytes = ref<Uint8Array | null>(null)
const busy = ref(false)
const busyMsg = ref('')

const result = ref<{ hex: string; b64: string; bytes: number } | null>(null)

const fileSig = () => (file.value ? [file.value.name, file.value.size, file.value.lastModified].join('|') : '')
const sig = () => JSON.stringify([mode.value, inputType.value, outEnc.value, text.value, expected.value, fileSig()])
const run = useToolRun(sig)

const toast = useToast()
const clipboard = useClipboard()

/** GB/T 32905-2016 标准向量，node + sm-crypto 复核一致 */
const SM3_ABC = '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0'

/** 输入类型为 Hex 时的实时校验与字节数提示（空输入不报错） */
const hexInput = computed(() => {
  if (mode.value !== 'text' || inputType.value !== 'hex' || !text.value.trim()) return { bytes: new Uint8Array(0), error: '' }
  const r = hexToBytes(text.value)
  return { bytes: r.bytes, error: r.error ? `输入 Hex 非法：${r.error}（输入类型当前为 Hex，可切换为「UTF-8 文本」）` : '' }
})

const expectedNorm = computed(() => expected.value.replace(/\s+/g, '').toLowerCase())

const matchState = computed<'match' | 'mismatch' | null>(() => {
  if (!result.value || !expectedNorm.value) return null
  return result.value.hex === expectedNorm.value ? 'match' : 'mismatch'
})

/** 真实计算：走共享实现 ~/utils/crypto/sm3（sm-crypto 纯 JS，本地执行，无密钥） */
function execute() {
  if (busy.value) return
  let bytes: Uint8Array
  if (mode.value === 'text') {
    if (!text.value) {
      result.value = null
      run.markIdle()
      return
    }
    if (inputType.value === 'hex') {
      if (hexInput.value.error) {
        result.value = null
        run.markFail(hexInput.value.error)
        return
      }
      bytes = hexInput.value.bytes
    } else {
      bytes = textToBytes(text.value)
    }
  } else {
    if (!fileBytes.value) {
      result.value = null
      run.markIdle()
      return
    }
    bytes = fileBytes.value
  }
  try {
    const hex = computeSm3(bytes)
    result.value = { hex, b64: bytesToBase64(hexToBytes(hex).bytes), bytes: bytes.length }
    run.markOk(
      (matchState.value === 'match'
        ? 'SM3 摘要计算成功；期望值对照：一致'
        : matchState.value === 'mismatch'
          ? 'SM3 摘要计算成功；期望值对照：不一致（见下方红色标识）'
          : `SM3 摘要计算成功${mode.value === 'file' ? `（对文件全部 ${formatBytes(bytes.length)} 字节计算）` : ''}`) +
        (mode.value === 'text' && inputType.value === 'hex' ? `；Hex 输入：对解码后的 ${bytes.length} 字节计算` : '')
    )
  } catch (e) {
    result.value = null
    run.markFail(`SM3 计算失败：${errMessage(e)}`)
  }
}

async function onFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  file.value = f
  fileBytes.value = null
  busy.value = true
  busyMsg.value = `读取文件「${f.name}」（${formatBytes(f.size)}）…`
  try {
    const buf = await f.arrayBuffer()
    fileBytes.value = new Uint8Array(buf)
    busy.value = false
    execute()
  } catch (e) {
    busy.value = false
    run.markFail(`读取文件失败：${errMessage(e)}`)
  }
}

function clearFile() {
  file.value = null
  fileBytes.value = null
  result.value = null
  run.markIdle()
}

/** 示例：只填入 abc 并现场计算（不预填结果），可与国标向量对照 */
function loadSample() {
  mode.value = 'text'
  inputType.value = 'utf8'
  text.value = 'abc'
  expected.value = ''
  execute()
}

const display = computed(() => (result.value ? (outEnc.value === 'hex' ? result.value.hex : result.value.b64) : ''))
</script>

<template>
  <div class="t16">
    <div class="t16__toolbar">
      <DkSegmented
        :model-value="mode"
        :options="[
          { value: 'text', label: '文本' },
          { value: 'file', label: '文件' }
        ]"
        @update:model-value="mode = $event as any"
      />
      <DkSegmented
        v-if="mode === 'text'"
        size="sm"
        :model-value="inputType"
        :options="[
          { value: 'utf8', label: 'UTF-8 文本', title: '按 UTF-8 编码为字节后计算' },
          { value: 'hex', label: 'Hex', title: '输入按 Hex 解码为原始字节后计算' }
        ]"
        @update:model-value="inputType = $event as any"
      />
      <span class="t16__tl">输出编码</span>
      <DkSegmented
        size="sm"
        :model-value="outEnc"
        :options="[
          { value: 'hex', label: 'Hex' },
          { value: 'base64', label: 'Base64' }
        ]"
        @update:model-value="outEnc = $event as any"
      />
      <span class="grow"></span>
      <DkButton v-if="mode === 'text'" size="sm" variant="ghost" title="填入国标向量 abc 并真实计算" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="fingerprint" :size="12" />
        计算 SM3
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? busyMsg : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[
        mode === 'file' ? '文件模式（对全部字节计算）' : inputType === 'hex' ? `Hex 输入（${hexInput.error ? '?' : hexInput.bytes.length} 字节）` : 'UTF-8 输入',
        'SM3 · 256 位摘要'
      ]"
      :retry="execute"
    />

    <template v-if="mode === 'text'">
      <DkEditor
        v-model="text"
        :lang="inputType === 'hex' ? '输入（Hex 字节）' : '输入文本（UTF-8）'"
        :placeholder="inputType === 'hex' ? '十六进制字节串（如 616263 即 abc），忽略空白；对解码后的原始字节计算' : '输入或粘贴文本，然后点击「计算 SM3」'"
        :height="'calc(30vh - 60px)'"
        :error="hexInput.error || undefined"
        filename="sm3-input.txt"
      />
      <p v-if="inputType === 'hex' && text.trim() && !hexInput.error" class="t16__hexnote tertiary">
        Hex 输入：对解码后的 {{ hexInput.bytes.length }} 字节计算原始字节摘要（不是对 Hex 字符串本身摘要）。
      </p>
    </template>
    <template v-else>
      <div class="t16__file">
        <FileDrop
          :multiple="false"
          :max-size="256 * 1024 * 1024"
          hint="文件在本地读取并计算，不会上传；对文件全部字节做 SM3 摘要"
          @files="onFiles"
          @reject="(reason: string) => toast.warning(reason)"
        />
        <div v-if="file" class="t16__file-info">
          <DkIcon name="binary" :size="14" />
          <span class="t16__file-name mono">{{ file.name }}</span>
          <span class="tertiary">{{ formatBytes(file.size) }}</span>
          <span v-if="!fileBytes" class="tertiary">读取中…</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" @click="clearFile">移除文件</DkButton>
        </div>
      </div>
    </template>

    <DkField
      label="期望摘要（可选，用于对照）"
      help="按 Hex 对照，忽略大小写与空白；填写后显示「一致 / 不一致」"
    >
      <DkInput v-model="expected" mono :placeholder="`期望摘要 Hex，如 ${SM3_ABC.slice(0, 16)}…`" />
    </DkField>

    <div class="t16__result">
      <div class="t16__result-head">
        <span>SM3 摘要（本工具是 SM3 摘要，不是 HMAC-SM3——无密钥参与运算）</span>
        <span class="grow"></span>
        <span v-if="result" class="tertiary">{{ outEnc === 'hex' ? 'Hex（小写，64 字符）' : 'Base64' }}</span>
      </div>
      <p v-if="!result" class="t16__empty tertiary">
        {{ mode === 'file' ? '选择文件后会自动读取并计算摘要。' : '输入内容并点击「计算 SM3」。' }}
        SM3 输出固定 32 字节（256 位），与输入长度无关。
      </p>
      <div v-else class="t16__row">
        <span class="t16__row-val mono">{{ display }}</span>
        <DkIconButton title="复制摘要" :disabled="run.status.value === 'stale'" @click="clipboard.copy(display, 'SM3 摘要')">
          <DkIcon name="copy" :size="14" />
        </DkIconButton>
        <span
          v-if="matchState"
          class="t16__row-badge"
          :class="matchState === 'match' ? 't16__row-badge--ok' : 't16__row-badge--bad'"
        >{{ matchState === 'match' ? '与期望一致' : '与期望不一致' }}</span>
      </div>
    </div>

    <DkCollapse title="国标测试向量与说明（node + sm-crypto 复核）">
      <h4>GB/T 32905-2016 标准向量</h4>
      <ul>
        <li>SM3("abc") = <code>{{ SM3_ABC }}</code></li>
        <li>对应的 Base64 = <code>Zsfw9GLu7dnR8tRr3BDk4kFnxIdc8veiKX2gK49LqOA=</code></li>
      </ul>
      <p>点击「载入示例」填入 abc 并现场计算，结果应与上值一致；也可把上值粘贴到「期望摘要」自动对照。</p>
      <p>Hex 输入示例：<code>616263</code> 解码后是 abc 三个字节，其摘要与直接输入 abc 完全相同（对解码后的原始字节计算）。</p>
      <p>SM3 是国密摘要算法（输出 256 位），单向不可逆，本工具没有也不可能有「解密」功能；带密钥的 SM3 认证请使用 HMAC 类工具，与本工具不是同一操作。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t16 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t16__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t16__tl {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t16__hexnote {
  font-size: 12px;
  line-height: 1.6;
}
.t16__file {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t16__file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-primary);
}
.t16__file-name {
  overflow-wrap: anywhere;
}
.t16__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t16__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t16__empty {
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
}
.t16__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.t16__row-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t16__row-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t16__row-badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t16__row-badge--bad {
  color: var(--error);
  background: var(--error-soft);
}
</style>
