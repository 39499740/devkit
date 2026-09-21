<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { formatSql, minifySql, type SqlDialect } from '~/utils/sql'

defineProps<{ tool: ToolMeta }>()

const toast = useToast()
const clipboard = useClipboard()
const { prefs } = usePrefs()

const dialect = ref<SqlDialect>('mysql')
const indent = ref<'2' | '4'>(prefs.value.defaultIndent === '4' ? '4' : '2')
const uppercase = ref(true)
const input = ref('')
const output = ref('')
const warnings = ref<string[]>([])
const notes = ref<string[]>([])
const elapsed = ref(0)

const SAMPLE = `select u.id,u.name,o.total,o.created_at
from users u
join orders o
on o.user_id=u.id
left join profiles p
on p.user_id=u.id
where o.total>1000
and u.status='active'
and o.created_at>='2024-01-01'
order by o.total desc
limit 20;`

const sig = () => JSON.stringify([dialect.value, indent.value, uppercase.value, input.value])
const run = useToolRun(sig)

function execute() {
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    warnings.value = []
    notes.value = []
    return
  }
  const t0 = performance.now()
  try {
    const res = formatSql(input.value, {
      dialect: dialect.value,
      indent: Number(indent.value),
      uppercaseKeywords: uppercase.value
    })
    output.value = res.sql
    warnings.value = res.warnings
    notes.value = res.notes
    elapsed.value = Math.round(performance.now() - t0)
    run.markOk(res.warnings.join(' · '))
  } catch (e) {
    output.value = ''
    warnings.value = []
    notes.value = []
    run.markFail(errMessage(e))
  }
}

function compressOutput() {
  if (!output.value.trim()) return
  const res = minifySql(output.value, dialect.value)
  output.value = res.sql
  notes.value = res.notes
  toast.success('已压缩为一行')
}

function compress() {
  if (!input.value.trim()) {
    toast.warning('请先输入 SQL')
    return
  }
  const t0 = performance.now()
  try {
    const res = minifySql(input.value, dialect.value)
    output.value = res.sql
    warnings.value = []
    notes.value = res.notes
    elapsed.value = Math.round(performance.now() - t0)
    run.markOk('已压缩')
  } catch (e) {
    run.markFail(errMessage(e))
  }
}

async function paste() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      toast.warning('剪贴板里没有文本')
      return
    }
    input.value = text
    execute()
  } catch {
    toast.warning('浏览器未授予剪贴板读取权限，请手动粘贴')
  }
}

const meta = computed(() => {
  const list = [`${output.value ? output.value.split('\n').length : 0} 行`, `${output.value.length} 字符`]
  if (run.status.value === 'ok') list.push(`耗时 ${elapsed.value} ms`)
  return list
})

const dialectQuote = computed(() => (dialect.value === 'mysql' ? '`反引号`' : '“双引号”'))

watch([dialect, indent, uppercase], execute)

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
  <div class="t42">
    <div class="t42__toolbar">
      <span class="t42__label">方言</span>
      <DkSegmented
        size="sm"
        :model-value="dialect"
        :options="[
          { value: 'mysql', label: 'MySQL' },
          { value: 'postgres', label: 'PostgreSQL' },
          { value: 'sqlite', label: 'SQLite' }
        ]"
        aria-label="SQL 方言"
        @update:model-value="dialect = $event as SqlDialect"
      />
      <span class="t42__sep"></span>
      <span class="t42__label">缩进</span>
      <DkSegmented
        size="sm"
        :model-value="indent"
        :options="[
          { value: '2', label: '2' },
          { value: '4', label: '4' }
        ]"
        aria-label="缩进宽度"
        @update:model-value="indent = $event as '2' | '4'"
      />
      <span class="t42__sep"></span>
      <label class="t42__switch">
        <DkSwitch :on="uppercase" label="关键字大写" @toggle="uppercase = !uppercase" />
        <span class="t42__label">关键字大写</span>
      </label>
      <span class="grow"></span>
      <span class="t42__hint tertiary">{{ dialectQuote }}</span>
      <DkButton size="sm" variant="ghost" @click="paste">
        <DkIcon name="clipboard" :size="12" />粘贴
      </DkButton>
      <DkButton size="sm" variant="ghost" @click="input = SAMPLE; execute()">
        <DkIcon name="zap" :size="12" />载入示例
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />格式化
      </DkButton>
      <DkButton size="sm" @click="compress">
        <DkIcon name="minus" :size="12" />压缩
      </DkButton>
      <DkButton
        size="sm"
        :disabled="!output || run.status.value !== 'ok'"
        @click="clipboard.copy(output, '格式化结果')"
      >
        <DkIcon name="copy" :size="12" />复制
      </DkButton>
      <DkButton
        size="sm"
        :disabled="!output || run.status.value !== 'ok'"
        @click="downloadText('formatted.sql', output, 'text/plain;charset=utf-8')"
      >
        <DkIcon name="download" :size="12" />下载
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : notes.join(' · ')"
      :meta="meta"
      :retry="execute"
    />

    <p v-if="warnings.length" class="t42__warn">
      <DkIcon name="alert-triangle" :size="13" />
      <span>{{ warnings.join('；') }}</span>
    </p>

    <div class="t42__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="SQL 输入"
            placeholder="粘贴 SQL（可含注释），或点击「载入示例」"
            :height="'calc(60vh - 60px)'"
            filename="input.sql"
            :error="run.status.value === 'error' ? run.errorMsg.value : ''"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            lang="格式化结果 · SQL"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(60vh - 60px)'"
            filename="formatted.sql"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="output && run.status.value === 'ok'" class="t42__send">
      <span class="tertiary">继续处理：</span>
      <SendToMenu :text="output" from="sql-format" kind="text" />
    </div>
  </div>
</template>

<style scoped>
.t42 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t42__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t42__label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t42__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t42__switch {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.t42__hint {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.t42__warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
  line-height: 1.6;
}
.t42__panes {
  min-height: 320px;
}
.t42__send {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}
</style>
