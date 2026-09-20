<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

type Conv = 'escape' | 'unescape' | 'hex'
type HexDir = 'text2hex' | 'hex2text'

const conv = ref<Conv>('escape')
const hexDir = ref<HexDir>('text2hex')
// 转义模式：默认只转义非 ASCII（保持英文可读），勾选后全部字符都转成 \uXXXX
const escapeAll = ref(false)

const input = ref('')
const output = ref('')
const errMsg = ref('')
const outName = ref('result.txt')
const infoMeta = ref<string[]>([])

const SAMPLE_TEXT = 'DevKit 工具箱 v2 🎉'

/** 文本 → \uXXXX 转义（按 UTF-16 码元逐个转义，增补平面字符自然成为代理对两段） */
function escapeUnicode(text: string, all: boolean): { out: string; astral: number } {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const cu = text.charCodeAt(i)
    if (all || cu >= 0x80) out += '\\u' + cu.toString(16).padStart(4, '0')
    else out += text.charAt(i)
  }
  let astral = 0
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) astral++
  }
  return { out, astral }
}

/**
 * \uXXXX 转义 → 文本：逐字符扫描（不用 eval）。
 * 规则：`\\`（两个反斜杠）表示一个字面反斜杠，后面的 u4e2d 按普通文本保留；
 * 单个 `\u` 后必须是 4 位十六进制，否则报错。
 */
function unescapeUnicode(src: string): { text: string; error?: string } {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src.charAt(i)
    if (ch === '\\') {
      const next = src.charAt(i + 1)
      if (next === '\\') {
        out += '\\'
        i += 2
        continue
      }
      if (next === 'u') {
        const hex = src.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        return {
          text: '',
          error: `第 ${i + 1} 个字符处的 \\u 转义不完整：\\u 后需要 4 位十六进制（当前为「${hex || '已到结尾'}」）`
        }
      }
      // 反斜杠后不是 u：原样保留
      out += ch
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return { text: out }
}

/** 定位第一个无效 UTF-8 字节的下标；返回 bytes.length 表示末尾序列被截断；-1 表示有效 */
function firstInvalidUtf8Byte(bytes: Uint8Array): number {
  const dec = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < bytes.length; i++) {
    try {
      dec.decode(bytes.subarray(i, i + 1), { stream: true })
    } catch {
      return i
    }
  }
  try {
    dec.decode()
  } catch {
    return bytes.length
  }
  return -1
}

const SAMPLE_ESCAPED = escapeUnicode(SAMPLE_TEXT, false).out
const SAMPLE_HEX = bytesToHex(textToBytes(SAMPLE_TEXT))

const sig = () => JSON.stringify([conv.value, hexDir.value, escapeAll.value, input.value])
const run = useToolRun(sig)

function execute() {
  errMsg.value = ''
  output.value = ''
  infoMeta.value = []
  const src = input.value
  if (!src) {
    run.markIdle()
    return
  }
  try {
    if (conv.value === 'escape') {
      const { out, astral } = escapeUnicode(src, escapeAll.value)
      output.value = out
      outName.value = 'escaped.txt'
      infoMeta.value = [
        `输入：字符 ${codePointCount(src).toLocaleString()}（码点）`,
        `UTF-16 码元 ${src.length.toLocaleString()}`,
        `UTF-8 字节 ${byteLength(src).toLocaleString()}`
      ]
      run.markOk(
        astral > 0
          ? `包含 ${astral} 个增补平面字符（码点 > 0xFFFF，如 emoji），已用代理对（两个 \\uXXXX 转义）表示`
          : ''
      )
    } else if (conv.value === 'unescape') {
      const { text, error } = unescapeUnicode(src)
      if (error) throw new Error(error)
      output.value = text
      outName.value = 'unescaped.txt'
      infoMeta.value = [
        `输出：字符 ${codePointCount(text).toLocaleString()}（码点）`,
        `UTF-16 码元 ${text.length.toLocaleString()}`,
        `UTF-8 字节 ${byteLength(text).toLocaleString()}`
      ]
      run.markOk(
        src.includes('\\\\')
          ? '成对的反斜杠（\\\\）已按字面反斜杠文本保留，未当作转义前缀'
          : ''
      )
    } else if (hexDir.value === 'text2hex') {
      const bytes = textToBytes(src)
      output.value = bytesToHex(bytes)
      outName.value = 'utf8-bytes.hex'
      infoMeta.value = [
        `字符 ${codePointCount(src).toLocaleString()}（码点）`,
        `UTF-8 字节 ${bytes.length.toLocaleString()}`
      ]
      run.markOk(`UTF-8 编码共 ${bytes.length.toLocaleString()} 字节，输出为连续小写 Hex（无分隔符）`)
    } else {
      const { bytes, error } = hexToBytes(src)
      if (error) throw new Error(error)
      const t = bytesToText(bytes)
      if (t.error) {
        const pos = firstInvalidUtf8Byte(bytes)
        throw new Error(
          pos === bytes.length
            ? '末尾的 UTF-8 多字节序列不完整：最后一个字符的字节可能被截断，请检查 Hex 是否完整'
            : pos >= 0
              ? `第 ${pos + 1} 个字节（Hex 第 ${pos * 2 + 1} 位起）不是有效的 UTF-8 序列，请检查该字节及相邻字节`
              : t.error
        )
      }
      output.value = t.text
      outName.value = 'decoded.txt'
      infoMeta.value = [
        `Hex ${bytes.length.toLocaleString()} 字节`,
        `解码为字符 ${codePointCount(t.text).toLocaleString()}（码点）`
      ]
      run.markOk('')
    }
  } catch (e) {
    errMsg.value = errMessage(e)
    run.markFail(errMsg.value)
  }
}

function loadSample() {
  if (conv.value === 'escape') input.value = SAMPLE_TEXT
  else if (conv.value === 'unescape') input.value = SAMPLE_ESCAPED
  else input.value = hexDir.value === 'text2hex' ? SAMPLE_TEXT : SAMPLE_HEX
  execute()
}

/** 把结果填回输入并切换到反方向 */
function swap() {
  if (!output.value) return
  if (conv.value === 'escape') conv.value = 'unescape'
  else if (conv.value === 'unescape') conv.value = 'escape'
  else hexDir.value = hexDir.value === 'text2hex' ? 'hex2text' : 'text2hex'
  input.value = output.value
  execute()
}

watch([conv, hexDir, escapeAll], execute)

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
  <div class="t07">
    <div class="t07__toolbar">
      <DkSegmented
        :model-value="conv"
        :options="[
          { value: 'escape', label: '文本 → \\u 转义' },
          { value: 'unescape', label: '\\u 转义 → 文本' },
          { value: 'hex', label: '文本 ↔ Hex 字节' }
        ]"
        @update:model-value="conv = $event as Conv"
      />
      <div v-if="conv === 'hex'" class="t07__group">
        <span class="t07__group-label">方向</span>
        <DkSegmented
          size="sm"
          :model-value="hexDir"
          :options="[
            { value: 'text2hex', label: '文本 → Hex', title: '按 UTF-8 编码为字节，输出小写十六进制' },
            { value: 'hex2text', label: 'Hex → 文本', title: '十六进制（可含空白）按 UTF-8 解码为文本' }
          ]"
          @update:model-value="hexDir = $event as HexDir"
        />
      </div>
      <DkCheckbox
        v-if="conv === 'escape'"
        v-model="escapeAll"
        label="全部字符转义（含 ASCII 与换行）"
      />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="将结果填入输入并切换到反方向" :disabled="!output" @click="swap">
        <DkIcon name="swap" :size="12" />交换
      </DkButton>
      <DkButton size="sm" variant="ghost" title="载入与当前方向匹配的示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />转换
      </DkButton>
      <span class="t07__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errMsg : run.staleNote.value"
      :meta="infoMeta"
      :retry="execute"
    />

    <div class="t07__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="conv === 'hex' && hexDir === 'hex2text' ? 'Hex 输入' : '文本输入'"
            :placeholder="
              conv === 'unescape'
                ? '粘贴 \\uXXXX 转义序列（成对反斜杠表示字面反斜杠文本）'
                : conv === 'hex' && hexDir === 'hex2text'
                  ? '粘贴十六进制字节，如 e4b8ad658c，可含空白'
                  : '输入文本，支持中文、ASCII 与 emoji 混合'
            "
            :height="'calc(60vh - 60px)'"
            :filename="conv === 'hex' && hexDir === 'hex2text' ? 'input.hex' : 'input.txt'"
          />
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

    <DkCollapse title="字符数 ≠ 字节数（本工具的核心概念）">
      <h4>三把「尺子」</h4>
      <ul>
        <li>字符（码点）：用户眼中的一个字符。<code>🎉</code> 是 1 个字符。</li>
        <li>UTF-16 码元：JS 字符串的存储单位。<code>🎉</code> 占 2 个码元（代理对），<code>中</code> 占 1 个。</li>
        <li>UTF-8 字节：网络传输 / 文件落盘的实际字节。<code>🎉</code> 占 4 字节，<code>中</code> 占 3 字节，ASCII 字符占 1 字节。</li>
      </ul>
      <h4>转义规则</h4>
      <ul>
        <li>格式为 <code>\uXXXX</code>（4 位十六进制）；默认只转义非 ASCII 字符，英文与换行保持可读。</li>
        <li>码点 &gt; 0xFFFF 的字符（如 emoji）用代理对的两个 <code>\uXXXX</code> 表示，例如 🎉 为 <code>\ud83c\udf89</code>。</li>
        <li>还原时：成对的 <code>\\</code> 是字面反斜杠文本，原样保留；单个 <code>\u</code> 后不足 4 位十六进制会报错并定位位置。</li>
        <li>还原使用逐字符扫描替换，不使用 eval。</li>
      </ul>
      <h4>Hex 字节</h4>
      <ul>
        <li>文本 → Hex：按 UTF-8 编码，输出连续小写十六进制。</li>
        <li>Hex → 文本：忽略空白；长度必须为偶数且为合法十六进制；字节序列必须是有效 UTF-8，否则报错并定位到第几个字节。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t07 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t07__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t07__group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t07__group-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t07__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t07__panes {
  min-height: 320px;
}
</style>
