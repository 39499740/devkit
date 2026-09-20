<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

type Direction = 'encode' | 'decode'
type UriMode = 'uri' | 'component'

const direction = ref<Direction>('encode')
const mode = ref<UriMode>('uri')
// 查询串场景：application/x-www-form-urlencoded 中「+」表示空格。
// 默认关闭：普通 URL 解码中「+」就是字面加号，必须显式开启才替换。
const plusAsSpace = ref(false)

const input = ref('')
const output = ref('')
const errMsg = ref('')
const infoMeta = ref<string[]>([])

const SAMPLE = 'https://example.com/搜索?q=hello world&tag=中文&page=2+2'

const sig = () => JSON.stringify([direction.value, mode.value, plusAsSpace.value, input.value])
const run = useToolRun(sig)

const MODE_LABEL: Record<UriMode, string> = { uri: '完整 URI', component: '组件' }

/** 找到第一个非法的「%」位置（后跟的不是两位十六进制），找不到返回 -1 */
function findBadPercent(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) === '%' && !/^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) return i
  }
  return -1
}

function execute() {
  errMsg.value = ''
  output.value = ''
  infoMeta.value = []
  if (!input.value) {
    run.markIdle()
    return
  }
  try {
    let note = ''
    if (direction.value === 'encode') {
      output.value = mode.value === 'uri' ? encodeURI(input.value) : encodeURIComponent(input.value)
      note =
        mode.value === 'uri'
          ? '完整 URI 模式：保留 : / ? # [ ] @ & = 等结构字符，空格编码为 %20'
          : '组件模式：; / ? : @ & = + $ , # 等保留字符也会被编码'
    } else {
      // 先按选项处理 +，再统一只解码一层
      const src = plusAsSpace.value ? input.value.replace(/\+/g, ' ') : input.value
      output.value = mode.value === 'uri' ? decodeURI(src) : decodeURIComponent(src)
      if (plusAsSpace.value) note = '已按查询串约定将 + 解码为空格；'
      if (/%[0-9A-Fa-f]{2}/i.test(output.value)) {
        note +=
          mode.value === 'uri'
            ? '结果仍含百分号编码：完整 URI 模式下保留字符（如 %2F、%3F）不会解码，属预期行为'
            : '结果仍含百分号编码：本工具每次只解码一层，如需再次解码请再点一次执行（不会自动重复解码）'
      }
    }
    infoMeta.value = [
      MODE_LABEL[mode.value],
      `输入 ${input.value.length.toLocaleString()} 字符`,
      `输出 ${output.value.length.toLocaleString()} 字符`
    ]
    run.markOk(note)
  } catch {
    // decodeURI / decodeURIComponent 抛出的 URIError：无效百分号编码
    const src = plusAsSpace.value ? input.value.replace(/\+/g, ' ') : input.value
    const idx = findBadPercent(src)
    if (idx >= 0) {
      const tail = src.slice(idx + 1, idx + 3)
      errMsg.value = `无效的百分号编码：第 ${idx + 1} 个字符处的「%」后不是两位十六进制数（当前为「${tail || '已到结尾'}」），请修正后再解码`
    } else {
      errMsg.value =
        '解码失败：输入包含无效的 UTF-8 百分号编码序列（如被截断的多字节字符 %E4%B8 或孤立代理对 %ED%A0%80），请检查输入是否完整'
    }
    run.markFail(errMsg.value)
  }
}

function loadSample() {
  direction.value = 'encode'
  mode.value = 'uri'
  input.value = SAMPLE
  execute()
}

/** 把结果填回输入并切换方向，方便「解码后再看编码回来」 */
function swap() {
  if (!output.value) return
  input.value = output.value
  direction.value = direction.value === 'encode' ? 'decode' : 'encode'
  execute()
}

watch([direction, mode, plusAsSpace], execute)

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
  <div class="t06">
    <div class="t06__toolbar">
      <DkSegmented
        :model-value="direction"
        :options="[
          { value: 'encode', label: '编码' },
          { value: 'decode', label: '解码' }
        ]"
        @update:model-value="direction = $event as Direction"
      />
      <div class="t06__group">
        <span class="t06__group-label">模式</span>
        <DkSegmented
          size="sm"
          :model-value="mode"
          :options="[
            {
              value: 'uri',
              label: '完整 URI',
              title: 'encodeURI / decodeURI：保留 : / ? # [ ] @ & = 等结构字符，用于整条地址'
            },
            {
              value: 'component',
              label: '组件',
              title: 'encodeURIComponent / decodeURIComponent：所有特殊字符都会被编码，用于单个参数值'
            }
          ]"
          @update:model-value="mode = $event as UriMode"
        />
      </div>
      <DkCheckbox
        v-if="direction === 'decode'"
        v-model="plusAsSpace"
        label="「+」解码为空格（查询串场景）"
      />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="将结果填入输入并切换方向" :disabled="!output" @click="swap">
        <DkIcon name="swap" :size="12" />交换
      </DkButton>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        {{ direction === 'encode' ? '编码' : '解码' }}
      </DkButton>
      <span class="t06__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errMsg : run.staleNote.value"
      :meta="infoMeta"
      :retry="execute"
    />

    <div class="t06__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="输入"
            :placeholder="
              direction === 'encode'
                ? '输入完整 URL 或单个参数值，或点击「载入示例」'
                : '粘贴待解码的 URL 或百分号编码文本'
            "
            :height="'calc(60vh - 60px)'"
            :filename="direction === 'encode' ? 'input.txt' : 'input.url'"
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
            :filename="direction === 'encode' ? 'encoded.txt' : 'decoded.txt'"
          />
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="使用说明">
      <h4>两种模式的区别</h4>
      <ul>
        <li>完整 URI（encodeURI / decodeURI）：保留 <code>: / ? # [ ] @ &amp; =</code> 等结构字符，适合整条地址。</li>
        <li>组件（encodeURIComponent / decodeURIComponent）：连 <code>; / ? : @ &amp; = + $ , #</code> 也会被编码，适合单个查询参数值。</li>
        <li>同一段输入在两种模式下的结果不同，可用模式切换对比。</li>
      </ul>
      <h4>解码规则</h4>
      <ul>
        <li>每次执行只解码一层，不会自动重复解码；结果仍含 <code>%XX</code> 时会在状态栏提示。</li>
        <li>「+」解码为空格默认关闭：普通 URL 中 <code>+</code> 是字面加号；仅在处理表单查询串时需要显式开启。</li>
        <li>无效百分号编码（如 <code>%ZZ</code>、末尾孤立的 <code>%</code>、被截断的 <code>%E4%B8</code>）会报错并定位到字符位置，输入保留。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t06 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t06__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t06__group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t06__group-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t06__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t06__panes {
  min-height: 320px;
}
</style>
