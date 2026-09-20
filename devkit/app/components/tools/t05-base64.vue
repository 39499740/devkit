<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

type Direction = 'encode' | 'decode'
type Alphabet = 'std' | 'url'
type InputType = 'text' | 'file'
type DecodeView = 'text' | 'hex'

const toast = useToast()

const direction = ref<Direction>('encode')
const alphabet = ref<Alphabet>('std')
const inputType = ref<InputType>('text')
// decodeView 是结果展示格式：切换时立即重算，不参与「待更新」签名
const decodeView = ref<DecodeView>('text')

const input = ref('')
const output = ref('')
const file = ref<File | null>(null)
const fileBytes = ref<Uint8Array | null>(null)
const decodedBytes = ref<Uint8Array | null>(null)
const decodedBinary = ref(false)
const errMsg = ref('')
const outName = ref('result.txt')
const infoMeta = ref<string[]>([])

const SAMPLE = 'DevKit 本地工具箱'

const sig = () =>
  JSON.stringify([
    direction.value,
    alphabet.value,
    inputType.value,
    input.value,
    file.value ? `${file.value.name}:${file.value.size}:${file.value.lastModified}` : ''
  ])
const run = useToolRun(sig)

async function onFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  file.value = f
  fileBytes.value = new Uint8Array(await f.arrayBuffer())
  execute()
}

function removeFile() {
  file.value = null
  fileBytes.value = null
  execute()
}

function loadSample() {
  direction.value = 'encode'
  inputType.value = 'text'
  file.value = null
  fileBytes.value = null
  input.value = SAMPLE
  execute()
}

/** 把结果填回输入并切换方向（仅在文本输入 / 文本结果间有意义） */
function swap() {
  if (!output.value) return
  input.value = output.value
  if (direction.value === 'encode') {
    direction.value = 'decode'
  } else {
    direction.value = 'encode'
    inputType.value = 'text'
  }
  execute()
}

function execute() {
  errMsg.value = ''
  output.value = ''
  decodedBytes.value = null
  decodedBinary.value = false
  infoMeta.value = []
  try {
    if (direction.value === 'encode') {
      let bytes: Uint8Array | null = null
      if (inputType.value === 'file') {
        bytes = fileBytes.value
      } else if (input.value) {
        bytes = textToBytes(input.value)
      }
      if (!bytes) {
        run.markIdle()
        return
      }
      let b64 = bytesToBase64(bytes)
      if (alphabet.value === 'url') {
        // Base64URL：+ → -，/ → _，去掉尾部填充 =
        b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }
      output.value = b64
      outName.value = alphabet.value === 'url' ? 'encoded-base64url.txt' : 'encoded-base64.txt'
      infoMeta.value = [
        alphabet.value === 'url' ? 'Base64URL（-_ 替换 +/，无填充）' : '标准 Base64',
        `输入 ${bytes.length.toLocaleString()} 字节 → ${b64.length.toLocaleString()} 字符`
      ]
      run.markOk('')
    } else {
      if (!input.value.trim()) {
        run.markIdle()
        return
      }
      const { bytes, error } = base64ToBytes(input.value)
      if (error) throw new Error(error)
      const t = bytesToText(bytes)
      decodedBytes.value = bytes
      if (t.error) {
        // 非 UTF-8：不强行显示为文本，默认切 Hex，可下载原始字节
        decodedBinary.value = true
        decodeView.value = 'hex'
        output.value = bytesToHex(bytes)
        outName.value = 'decoded-hex.txt'
        infoMeta.value = [`解码得到 ${bytes.length.toLocaleString()} 字节`, '二进制数据（非 UTF-8）']
        run.markOk('解码结果不是有效 UTF-8，可能为二进制数据：已切换为 Hex 展示，可下载原始字节')
      } else {
        output.value = decodeView.value === 'hex' ? bytesToHex(bytes) : t.text
        outName.value = decodeView.value === 'hex' ? 'decoded-hex.txt' : 'decoded.txt'
        infoMeta.value = [
          `解码得到 ${bytes.length.toLocaleString()} 字节`,
          decodeView.value === 'hex' ? 'Hex 展示' : 'UTF-8 文本'
        ]
        run.markOk('')
      }
    }
  } catch (e) {
    errMsg.value = errMessage(e)
    output.value = ''
    decodedBytes.value = null
    run.markFail(errMsg.value)
  }
}

function downloadDecoded() {
  if (!decodedBytes.value || run.status.value !== 'ok') return
  downloadBlob('decoded.bin', new Blob([decodedBytes.value as unknown as BlobPart]))
}

watch([direction, alphabet, inputType], execute)
watch(decodeView, execute)

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
  <div class="t05">
    <div class="t05__toolbar">
      <DkSegmented
        :model-value="direction"
        :options="[
          { value: 'encode', label: '编码' },
          { value: 'decode', label: '解码' }
        ]"
        @update:model-value="direction = $event as Direction"
      />
      <div class="t05__group">
        <span class="t05__group-label">字母表</span>
        <DkSegmented
          size="sm"
          :model-value="alphabet"
          :options="[
            { value: 'std', label: '标准 Base64', title: 'A-Z a-z 0-9 + / ，含 = 填充' },
            { value: 'url', label: 'Base64URL', title: 'URL 安全：+ → -，/ → _，去掉 = 填充' }
          ]"
          @update:model-value="alphabet = $event as Alphabet"
        />
      </div>
      <div v-if="direction === 'encode'" class="t05__group">
        <span class="t05__group-label">输入</span>
        <DkSegmented
          size="sm"
          :model-value="inputType"
          :options="[
            { value: 'text', label: '文本', title: '按 UTF-8 编码为字节后转 Base64' },
            { value: 'file', label: '文件', title: '读取文件原始字节后转 Base64' }
          ]"
          @update:model-value="inputType = $event as InputType"
        />
      </div>
      <div v-else class="t05__group">
        <span class="t05__group-label">结果</span>
        <DkSegmented
          size="sm"
          :model-value="decodeView"
          :options="[
            { value: 'text', label: '文本', title: '按 UTF-8 解码显示；非 UTF-8 时自动切为 Hex' },
            { value: 'hex', label: 'Hex', title: '小写十六进制字节展示' }
          ]"
          @update:model-value="decodeView = $event as DecodeView"
        />
      </div>
      <span class="grow"></span>
      <DkButton
        v-if="direction === 'decode'"
        size="sm"
        variant="ghost"
        title="将解码得到的原始字节下载为文件"
        :disabled="run.status.value !== 'ok' || !decodedBytes"
        @click="downloadDecoded"
      >
        <DkIcon name="download" :size="12" />下载解码文件
      </DkButton>
      <DkButton size="sm" variant="ghost" title="将结果填入输入并切换方向" :disabled="!output" @click="swap">
        <DkIcon name="swap" :size="12" />交换
      </DkButton>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        {{ direction === 'encode' ? '编码' : '解码' }}
      </DkButton>
      <span class="t05__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errMsg : run.staleNote.value"
      :meta="infoMeta"
      :retry="execute"
    />

    <div class="t05__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-if="direction === 'decode' || inputType === 'text'"
            v-model="input"
            lang="输入"
            :placeholder="direction === 'encode' ? '输入要编码的文本（按 UTF-8 编码为字节）' : '粘贴 Base64 字符串（可含换行）'"
            :height="'calc(60vh - 60px)'"
            :filename="direction === 'encode' ? 'input.txt' : 'input.b64'"
          />
          <div v-else class="t05__file">
            <div v-if="file && fileBytes" class="t05__fileinfo">
              <DkIcon name="file-binary" :size="14" />
              <span class="t05__filename mono">{{ file.name }}</span>
              <span class="t05__filesize tertiary">
                {{ fileBytes.length.toLocaleString() }} 字节（{{ formatBytes(fileBytes.length) }}）
              </span>
              <span class="grow"></span>
              <DkButton size="sm" variant="ghost" @click="removeFile">
                <DkIcon name="trash" :size="12" />移除
              </DkButton>
            </div>
            <FileDrop
              :multiple="false"
              :max-size="16 * 1024 * 1024"
              hint="文件在本地读取并编码，不会上传"
              @files="onFiles"
              @reject="(r: string) => toast.warning(r)"
            />
            <p class="t05__file-hint tertiary">
              拖入新文件可直接替换当前文件；单文件限制 16 MB
            </p>
          </div>
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            lang="结果"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(60vh - 60px)'"
            :filename="outName"
          />
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="使用说明">
      <h4>编码</h4>
      <ul>
        <li>文本输入按 UTF-8 编码为字节后再转 Base64，中文等多字节字符会得到较长的结果。</li>
        <li>Base64URL 是 URL 安全变体：<code>+</code> 与 <code>/</code> 替换为 <code>-</code> 与 <code>_</code>，并去掉尾部 <code>=</code> 填充。</li>
        <li>文件输入读取原始字节，适合图片等二进制文件。</li>
      </ul>
      <h4>解码</h4>
      <ul>
        <li>解码输入只认 Base64 字符（两种字母表都接受，可含空白与可选填充）。</li>
        <li>若解码结果不是有效 UTF-8，不会强行按文本显示，而是切换为 Hex 展示，并提供「下载解码文件」保存原始字节。</li>
        <li>输入包含非法字符或格式错误时，会在状态栏给出具体提示，输入内容保留。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t05 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t05__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t05__group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t05__group-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t05__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t05__panes {
  min-height: 320px;
}
.t05__file {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  justify-content: center;
}
.t05__fileinfo {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 13px;
}
.t05__filename {
  color: var(--text-primary);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t05__filesize {
  font-size: 12px;
  white-space: nowrap;
}
.t05__file-hint {
  font-size: 11px;
  text-align: center;
}
</style>
