<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()

const input = ref('')
const output = ref('')
const dir = ref<'escape' | 'unescape'>('escape')
const outForm = ref<'literal' | 'textblock'>('literal')
const errDetail = ref('')
const notes = ref<string[]>([])

/** 原文 -> Java 字符串字面量内容（不含首尾引号）：" \ 换行 回车 Tab，其他控制字符 \uXXXX，中文保留 */
function javaEscapeBody(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    switch (ch) {
      case '"':
        out += '\\"'
        break
      case '\\':
        out += '\\\\'
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      default:
        if (code < 0x20 || code === 0x7f) {
          out += '\\u' + code.toString(16).padStart(4, '0')
        } else {
          out += ch
        }
    }
  }
  return out
}

/** 文本块（Java 15+）：换行按原样保留，反斜杠与双引号仍需转义 */
function javaTextBlock(s: string): string {
  const lines = s.split('\n').map((line) => line.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r'))
  return `"""\n${lines.join('\n')}\n"""`
}

/** Java 字符串字面量 -> 原文：逐字符状态机 */
function javaUnescape(src: string): { text: string; error: string | null } {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]!
    if (c !== '\\') {
      out += c
      i++
      continue
    }
    // 反斜杠开始
    if (i + 1 >= n) {
      return { text: out, error: `位置 ${i + 1}：字符串以反斜杠结尾，转义序列不完整` }
    }
    const e = src[i + 1]!
    switch (e) {
      case 'b':
        out += '\b'
        i += 2
        break
      case 'f':
        out += '\f'
        i += 2
        break
      case 'n':
        out += '\n'
        i += 2
        break
      case 'r':
        out += '\r'
        i += 2
        break
      case 't':
        out += '\t'
        i += 2
        break
      case 's': // Java 15 转义 \s
        out += ' '
        i += 2
        break
      case "'":
        out += "'"
        i += 2
        break
      case '"':
        out += '"'
        i += 2
        break
      case '\\':
        // \\u4e2d 是「字面反斜杠 + 文本 u4e2d」，不是 unicode 转义
        out += '\\'
        i += 2
        break
      case 'u': {
        // JLS 允许多个连续 u：\uuu4e2d
        let j = i + 1
        while (j < n && src[j] === 'u') j++
        const hex = src.slice(j, j + 4)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return { text: out, error: `位置 ${i + 1}：\\u 转义需要 4 位十六进制数字，实际是 "${hex || '（已到末尾）'}"` }
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i = j + 4
        break
      }
      default: {
        if (e >= '0' && e <= '7') {
          // 八进制转义：\o、\oo、\ZeroToThree oo（值不超过 0377）
          let digits = e
          if (i + 2 < n && src[i + 2]! >= '0' && src[i + 2]! <= '7') {
            digits += src[i + 2]!
            if (e <= '3' && i + 3 < n && src[i + 3]! >= '0' && src[i + 3]! <= '7') {
              digits += src[i + 3]!
            }
          }
          const v = parseInt(digits, 8)
          if (v > 0o377) {
            return { text: out, error: `位置 ${i + 1}：八进制转义 \\${digits} 超过 \\377 上限` }
          }
          out += String.fromCharCode(v)
          i += 1 + digits.length
          break
        }
        return { text: out, error: `位置 ${i + 1}：\\${e} 不是合法的 Java 转义序列` }
      }
    }
  }
  return { text: out, error: null }
}

const SAMPLES: { label: string; text: string }[] = [
  { label: 'Windows 路径', text: 'C:\\Users\\hao\\config.json' },
  { label: 'JSON 片段', text: '{"key":"value"}' },
  { label: '中文与换行', text: '第一行：你好，世界\n第二行\t带制表符' },
]

const sig = () => JSON.stringify([input.value, dir.value, outForm.value])
const run = useToolRun(sig)

function execute() {
  notes.value = []
  if (!input.value.length) {
    run.markIdle()
    output.value = ''
    errDetail.value = ''
    return
  }
  try {
    if (dir.value === 'escape') {
      output.value = outForm.value === 'literal' ? `"${javaEscapeBody(input.value)}"` : javaTextBlock(input.value)
      if (outForm.value === 'textblock') {
        notes.value.push('文本块目标语法：Java 15+；换行按原样保留，反斜杠与双引号仍需转义。')
        notes.value.push('注意：编译器会按最小缩进剥离文本块行首空白、并删除行尾空格，若原文行首有空格请人工核对。')
      }
      run.markOk('只做文本转义，不解析或执行 Java 代码')
    } else {
      let s = input.value
      const t = s.trim()
      if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        s = t.slice(1, -1)
        notes.value.push('已自动去除输入首尾的字符串引号。')
      }
      const { text, error } = javaUnescape(s)
      if (error) {
        errDetail.value = error
        run.markFail(error)
        return
      }
      output.value = text
      run.markOk('只做文本转义，不解析或执行 Java 代码')
    }
  } catch (e) {
    errDetail.value = errMessage(e)
    run.markFail(errDetail.value)
  }
}

watch([dir, outForm], execute)

function loadSample(s: { label: string; text: string }) {
  dir.value = 'escape'
  input.value = s.text
  execute()
}

const SAMPLE_UNESCAPE = '"C:\\\\Users\\\\hao\\\\config.json\\n第二行 \\u4e2d\\u6587"'

function loadUnescapeSample() {
  dir.value = 'unescape'
  input.value = SAMPLE_UNESCAPE
  execute()
}

const outFilename = computed(() =>
  dir.value === 'escape' ? (outForm.value === 'textblock' ? 'textblock.java.txt' : 'string-literal.txt') : 'restored.txt',
)

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
  <div class="t23">
    <div class="t23__toolbar">
      <DkSegmented
        :model-value="dir"
        :options="[
          { value: 'escape', label: '原文 → Java 字面量' },
          { value: 'unescape', label: 'Java 字面量 → 原文' },
        ]"
        @update:model-value="dir = $event as any"
      />
      <div v-if="dir === 'escape'" class="t23__opt">
        <span class="t23__opt-label">输出形式</span>
        <DkSegmented
          size="sm"
          :model-value="outForm"
          :options="[
            { value: 'literal', label: '普通字面量' },
            { value: 'textblock', label: '文本块（Java 15+）' },
          ]"
          @update:model-value="outForm = $event as any"
        />
      </div>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入反向还原示例" @click="loadUnescapeSample">还原示例</DkButton>
      <DkButton
        v-for="s in SAMPLES"
        :key="s.label"
        size="sm"
        variant="ghost"
        :title="`载入示例：${s.text.slice(0, 40)}`"
        @click="loadSample(s)"
      >
        {{ s.label }}
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        {{ dir === 'escape' ? '转义' : '还原' }}
      </DkButton>
      <span class="t23__kbd tertiary">⌘/Ctrl + Enter</span>
    </div>

    <div class="t23__hint tertiary">本工具只做文本转义，不解析或执行 Java 代码；字符串表达式拼接不会当作完整 Java 求值。</div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[dir === 'escape' ? '原文 → 字面量' : '字面量 → 原文']"
      :retry="execute"
    />

    <div v-if="notes.length && run.status.value === 'ok'" class="t23__notes">
      <span v-for="(nt, i) in notes" :key="i" class="t23__note">{{ nt }}</span>
    </div>

    <div class="t23__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="dir === 'escape' ? '原文输入' : 'Java 字面量输入'"
            :placeholder="dir === 'escape' ? '输入要写入 Java 代码的原文（可含中文、换行、反斜杠）' : '粘贴 Java 字符串字面量（可含首尾引号），可先点右上角「还原示例」查看格式'"
            :height="'calc(58vh - 60px)'"
            :filename="dir === 'escape' ? 'input.txt' : 'literal.txt'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="dir === 'escape' ? 'Java 字面量输出' : '原文输出'"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :error="run.status.value === 'error' ? errDetail : ''"
            :height="'calc(58vh - 60px)'"
            :filename="outFilename"
          />
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="用法说明">
      <ul>
        <li>转义规则：<code>"</code> → <code>\"</code>、<code>\</code> → <code>\\</code>、换行 → <code>\n</code>、回车 → <code>\r</code>、Tab → <code>\t</code>，其余控制字符输出 <code>\uXXXX</code>；中文等非 ASCII 字符保留原样不转义。</li>
        <li>还原是逐字符状态机：支持 <code>\\ \" \n \r \t \b \f \s \'</code>、<code>\uXXXX</code>（允许多个连续 u）与八进制转义；<code>\\u4e2d</code>（双反斜杠后跟 u）会被正确还原为「字面反斜杠 + 文本 u4e2d」，不会误判为 unicode 转义。</li>
        <li>非法转义（如 <code>\x</code>）会报错并给出 1 起始的位置：位置 N：\x 不是合法的 Java 转义序列。</li>
        <li>文本块输出针对 Java 15+ 语法；换行按原样放入块内，行首缩进与行尾空格可能被编译器剥离，请人工核对。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t23 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t23__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t23__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t23__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t23__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t23__hint {
  font-size: 12px;
}
.t23__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px 12px;
}
.t23__note {
  font-size: 12px;
  color: var(--text-secondary);
}
.t23__panes {
  min-height: 320px;
}
</style>
