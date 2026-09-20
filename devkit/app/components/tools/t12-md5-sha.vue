<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import SparkMD5 from 'spark-md5'

defineProps<{ tool: ToolMeta }>()

const mode = ref<'text' | 'file'>('text')
const algoMd5 = ref(true)
const algo256 = ref(true)
const algo512 = ref(false)
const inputType = ref<'utf8' | 'hex'>('utf8')
const outEnc = ref<'hex' | 'base64'>('hex')
const text = ref('')
const expected = ref('')

const file = ref<File | null>(null)
const fileBytes = ref<Uint8Array | null>(null)
const busy = ref(false)
const busyMsg = ref('')

interface DigestRow {
  algo: string
  hex: string
  b64: string
}
const results = ref<DigestRow[]>([])

const fileSig = () => (file.value ? [file.value.name, file.value.size, file.value.lastModified].join('|') : '')
const sig = () =>
  JSON.stringify([mode.value, text.value, inputType.value, outEnc.value, algoMd5.value, algo256.value, algo512.value, expected.value, fileSig()])
const run = useToolRun(sig)

const toast = useToast()
const clipboard = useClipboard()

const selectedAlgos = computed(() => {
  const list: string[] = []
  if (algoMd5.value) list.push('MD5')
  if (algo256.value) list.push('SHA-256')
  if (algo512.value) list.push('SHA-512')
  return list
})

/** 输入类型为 Hex 时的实时校验（空输入不报错） */
const hexInputErr = computed(() => {
  if (mode.value !== 'text' || inputType.value !== 'hex' || !text.value.trim()) return ''
  return hexToBytes(text.value).error ? `输入 Hex 非法：${hexToBytes(text.value).error}（输入类型当前为 Hex）` : ''
})

const expectedNorm = computed(() => expected.value.replace(/\s+/g, '').toLowerCase())

function matchOf(r: DigestRow): boolean | null {
  if (!expectedNorm.value) return null
  return r.hex === expectedNorm.value
}

/** 真实计算（浏览器本地）：MD5 用 spark-md5，SHA 用 WebCrypto crypto.subtle.digest */
async function execute() {
  if (busy.value) return
  if (!selectedAlgos.value.length) {
    results.value = []
    run.markFail('请至少选择一种算法（MD5 / SHA-256 / SHA-512）')
    return
  }
  let bytes: Uint8Array
  if (mode.value === 'text') {
    if (!text.value) {
      results.value = []
      run.markIdle()
      return
    }
    if (inputType.value === 'hex') {
      const r = hexToBytes(text.value)
      if (r.error) {
        results.value = []
        run.markFail(`输入 Hex 非法：${r.error}（输入类型当前为 Hex，可切换为「UTF-8 文本」）`)
        return
      }
      bytes = r.bytes
    } else {
      bytes = textToBytes(text.value)
    }
  } else {
    if (!fileBytes.value) {
      results.value = []
      run.markIdle()
      return
    }
    bytes = fileBytes.value
  }

  busy.value = true
  busyMsg.value = '计算摘要…'
  try {
    const out: DigestRow[] = []
    for (const algo of selectedAlgos.value) {
      if (algo === 'MD5') {
        const spark = new SparkMD5.ArrayBuffer()
        spark.append(bytes as unknown as ArrayBuffer)
        const hex = spark.end(false) // end() 会重置状态，只能调用一次
        out.push({ algo, hex, b64: bytesToBase64(hexToBytes(hex).bytes) })
      } else {
        const buf = await crypto.subtle.digest(algo, bytes as unknown as BufferSource)
        const d = new Uint8Array(buf)
        out.push({ algo, hex: bytesToHex(d), b64: bytesToBase64(d) })
      }
    }
    results.value = out
    const matched = out.filter((r) => matchOf(r) === true).length
    run.markOk(
      expectedNorm.value
        ? `摘要计算成功；期望值对照：${matched}/${out.length} 一致（各行右侧显示对照结果）`
        : `摘要计算成功${mode.value === 'file' ? `（${formatBytes(bytes.length)} 文件）` : ''}`
    )
  } catch (e) {
    run.markFail(`摘要计算失败：${errMessage(e)}`)
  } finally {
    busy.value = false
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
    await execute()
  } catch (e) {
    busy.value = false
    run.markFail(`读取文件失败：${errMessage(e)}`)
  }
}

function clearFile() {
  file.value = null
  fileBytes.value = null
  results.value = []
  run.markIdle()
}

/** 示例：只填入 abc 并真实计算，不预填任何结果 */
function loadSample() {
  mode.value = 'text'
  inputType.value = 'utf8'
  text.value = 'abc'
  expected.value = ''
  execute()
}

function display(r: DigestRow): string {
  return outEnc.value === 'hex' ? r.hex : r.b64
}

async function copyRow(r: DigestRow) {
  await clipboard.copy(display(r), `${r.algo} ${outEnc.value === 'hex' ? 'Hex' : 'Base64'}`)
}
</script>

<template>
  <div class="t12">
    <div class="t12__toolbar">
      <DkSegmented
        :model-value="mode"
        :options="[
          { value: 'text', label: '文本' },
          { value: 'file', label: '文件' }
        ]"
        @update:model-value="mode = $event as any"
      />
      <span class="t12__algos" title="可同时勾选多种算法，每种算法一行结果">
        <DkCheckbox v-model="algoMd5" label="MD5" />
        <DkCheckbox v-model="algo256" label="SHA-256" />
        <DkCheckbox v-model="algo512" label="SHA-512" />
      </span>
      <DkSegmented
        v-if="mode === 'text'"
        size="sm"
        :model-value="inputType"
        :options="[
          { value: 'utf8', label: 'UTF-8 文本', title: '按 UTF-8 编码后计算' },
          { value: 'hex', label: 'Hex', title: '输入按 Hex 解码为字节后计算' }
        ]"
        @update:model-value="inputType = $event as any"
      />
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
      <DkButton v-if="mode === 'text'" size="sm" variant="ghost" title="填入 abc 并真实计算（结果不预填）" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="hash" :size="12" />
        计算摘要
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? busyMsg : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="selectedAlgos.length ? [mode === 'file' ? '文件模式' : inputType === 'hex' ? 'Hex 输入' : 'UTF-8 输入', ...selectedAlgos] : []"
      :retry="execute"
    />

    <template v-if="mode === 'text'">
      <DkEditor
        v-model="text"
        :lang="inputType === 'hex' ? '输入（Hex）' : '输入文本（UTF-8）'"
        :placeholder="inputType === 'hex' ? '输入十六进制字节串（如 616263 即 abc），忽略空白' : '输入或粘贴文本，然后点击「计算摘要」'"
        :height="'calc(30vh - 60px)'"
        :error="hexInputErr || undefined"
        filename="digest-input.txt"
      />
    </template>
    <template v-else>
      <div class="t12__file">
        <FileDrop
          :multiple="false"
          :max-size="256 * 1024 * 1024"
          hint="文件在本地读取并计算，不会上传"
          @files="onFiles"
          @reject="(reason: string) => toast.warning(reason)"
        />
        <div v-if="file" class="t12__file-info">
          <DkIcon name="file-code" :size="14" />
          <span class="t12__file-name mono">{{ file.name }}</span>
          <span class="tertiary">{{ formatBytes(file.size) }}</span>
          <span v-if="!fileBytes" class="tertiary">读取中…</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" @click="clearFile">移除文件</DkButton>
        </div>
      </div>
    </template>

    <DkField
      label="期望摘要（可选，用于对照）"
      help="按 Hex 对照，忽略大小写与空白；填写后每个算法行会独立显示「一致 / 不一致」"
    >
      <DkInput v-model="expected" mono placeholder="期望摘要 Hex，如 900150983cd24fb0d6963f7d28e17f72" />
    </DkField>

    <div class="t12__results">
      <div class="t12__results-head">
        <span>摘要结果（单向散列，不可逆推原文——本工具没有也不可能有「解密」功能）</span>
        <span class="grow"></span>
        <span v-if="results.length" class="tertiary">输出：{{ outEnc === 'hex' ? 'Hex（小写）' : 'Base64' }}</span>
      </div>
      <p v-if="!results.length" class="t12__empty tertiary">
        {{ mode === 'file' ? '选择文件后会自动读取并计算摘要。' : '输入内容并点击「计算摘要」，每种算法一行结果。' }}
      </p>
      <div v-for="r in results" :key="r.algo" class="t12__row">
        <span class="t12__row-algo">{{ r.algo }}</span>
        <span class="t12__row-val mono">{{ display(r) }}</span>
        <DkIconButton title="复制该摘要" :disabled="run.status.value === 'stale'" @click="copyRow(r)">
          <DkIcon name="copy" :size="14" />
        </DkIconButton>
        <span
          v-if="matchOf(r) !== null"
          class="t12__row-badge"
          :class="matchOf(r) ? 't12__row-badge--ok' : 't12__row-badge--bad'"
        >{{ matchOf(r) ? '与期望一致' : '与期望不一致' }}</span>
      </div>
    </div>

    <DkCollapse title="公认测试向量（已用 node crypto 复核）">
      <ul>
        <li>MD5("abc") = <code>900150983cd24fb0d6963f7d28e17f72</code></li>
        <li>SHA-256("abc") = <code>ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad</code></li>
        <li>SHA-512("abc") = <code>ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f</code></li>
      </ul>
      <p>点击「载入示例」会填入 abc 并重新真实计算，可与上述向量互相印证；也可把任一向量粘贴到「期望摘要」做自动对照。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t12 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t12__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t12__algos {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.t12__file {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t12__file-info {
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
.t12__file-name {
  overflow-wrap: anywhere;
}
.t12__results {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t12__results-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t12__empty {
  padding: 14px;
  font-size: 13px;
}
.t12__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.t12__row:last-child {
  border-bottom: none;
}
.t12__row-algo {
  flex-shrink: 0;
  min-width: 72px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.t12__row-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t12__row-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t12__row-badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t12__row-badge--bad {
  color: var(--error);
  background: var(--error-soft);
}
</style>
