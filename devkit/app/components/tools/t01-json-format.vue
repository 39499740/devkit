<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()
const { prefs } = usePrefs()
const transfer = useTransfer()

const input = ref('')
const output = ref('')
const mode = ref<'format' | 'minify'>('format')
const indent = ref<'2' | '4' | 'tab'>(prefs.value.defaultIndent)
const view = ref<'code' | 'tree'>('code')
const dupKeys = ref<string[]>([])
const parsed = ref<unknown>(null)
const errDetail = ref('')
const replaceAsk = ref<{ text: string; from: string } | null>(null)

// G01：接收来自其他工具的内存传递；已有输入时先确认
onMounted(() => {
  const p = transfer.peek()
  if (p && p.from !== 'json-format') {
    if (input.value.trim()) {
      replaceAsk.value = { text: p.text, from: p.from }
    } else {
      applyIncoming(p.text)
    }
  }
})

function applyIncoming(text: string) {
  input.value = text
  replaceAsk.value = null
  execute()
}

const sig = () => JSON.stringify([input.value, mode.value, indent.value])
const run = useToolRun(sig)

const indentUnit = computed(() => (indent.value === 'tab' ? ('\t' as const) : (parseInt(indent.value, 10) as 2 | 4)))

const SAMPLE = `{"user":{"id":1234567890123456789,"name":"陈立","roles":["admin","editor"],"profile":{"email":"chen.li@example.com","active":true,"loginCount":128}},"config":{"theme":"dark","retry":3,"threshold":0.85}}`

function execute() {
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    parsed.value = null
    dupKeys.value = []
    errDetail.value = ''
    return
  }
  try {
    const { value, duplicateKeys } = parseJson(input.value)
    parsed.value = value
    dupKeys.value = duplicateKeys
    output.value = mode.value === 'format' ? stringifyJson(value, indentUnit.value) : minifyJson(value)
    errDetail.value = ''
    run.markOk(
      duplicateKeys.length
        ? `检测到 ${duplicateKeys.length} 个重复键：${duplicateKeys.slice(0, 3).join('、')}${duplicateKeys.length > 3 ? ' 等' : ''}（后者生效，未静默丢弃提示）`
        : ''
    )
  } catch (e) {
    parsed.value = null
    output.value = ''
    dupKeys.value = []
    const pos = jsonErrorPosition(e, input.value)
    errDetail.value = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : errMessage(e)
    run.markFail(errDetail.value)
  }
}

watch([mode, indent], execute)

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
  <div class="t01">
    <div class="t01__toolbar">
      <DkSegmented
        :model-value="mode"
        :options="[
          { value: 'format', label: '格式化' },
          { value: 'minify', label: '压缩' }
        ]"
        @update:model-value="mode = $event as any"
      />
      <div class="t01__indent">
        <span class="t01__indent-label">缩进</span>
        <DkSegmented
          size="sm"
          :model-value="indent"
          :options="[
            { value: '2', label: '2 空格' },
            { value: '4', label: '4 空格' },
            { value: 'tab', label: 'Tab' }
          ]"
          @update:model-value="indent = $event as any"
        />
      </div>
      <div class="t01__indent">
        <span class="t01__indent-label">视图</span>
        <DkSegmented
          size="sm"
          :model-value="view"
          :options="[
            { value: 'code', label: '代码' },
            { value: 'tree', label: '树形' }
          ]"
          @update:model-value="view = $event as any"
        />
      </div>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="input = SAMPLE; execute()">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        {{ mode === 'format' ? '格式化' : '压缩' }}
      </DkButton>
      <span class="t01__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :retry="execute"
    />

    <div class="t01__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="JSON 输入"
            placeholder="粘贴 JSON 文本，或点击「载入示例」"
            :height="'calc(60vh - 60px)'"
            filename="input.json"
          />
        </template>
        <template #right>
          <DkEditor
            v-if="view === 'code'"
            :model-value="output"
            readonly
            lang="结果"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(60vh - 60px)'"
            filename="formatted.json"
          />
          <div v-else class="t01__tree" :class="{ 't01__tree--empty': !output }">
            <p v-if="!output" class="tertiary">先成功执行一次，才能查看树形视图。</p>
            <JsonTree v-else-if="parsed !== null" :data="parsed" />
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="output && run.status.value === 'ok'" class="t01__send">
      <SendToMenu :text="output" from="json-format" kind="json" />
    </div>

    <DkModal
      :open="!!replaceAsk"
      title="替换当前输入？"
      width="420px"
      @close="replaceAsk = null"
    >
      <p>
        来自{{ replaceAsk ? '其他工具' : '' }}的结果准备发送到本工具，但当前已有未保存的输入。
        替换后原输入将丢失（不会自动保存）。
      </p>
      <template #footer>
        <DkButton size="sm" @click="replaceAsk = null">保留当前输入</DkButton>
        <DkButton size="sm" variant="primary" @click="replaceAsk && applyIncoming(replaceAsk.text)">替换并格式化</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.t01 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t01__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t01__indent {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t01__indent-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t01__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t01__panes {
  min-height: 320px;
}
.t01__tree {
  height: calc(60vh - 60px);
  min-height: 180px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--editor-bg);
  padding: 10px 14px;
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  line-height: 1.7;
}
.t01__tree--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 13px;
}
.t01__send {
  display: flex;
  justify-content: flex-end;
}
</style>
