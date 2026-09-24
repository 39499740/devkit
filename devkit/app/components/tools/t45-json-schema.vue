<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { inferSchema, validateInstance, type Draft, type SchemaError } from '~/utils/jsonschema'
import { toPlainJson } from '~/utils/json'
import { runComputation } from '~/workflow/workers/run-compute'

defineProps<{ tool: ToolMeta }>()

type Mode = 'generate' | 'validate'

const toast = useToast()
const clipboard = useClipboard()
const transfer = useTransfer()

const mode = ref<Mode>('validate')
const draft = ref<Draft>('2020-12')
const strict = ref(true)
const doc = ref('')
const schemaText = ref('')
const errors = ref<SchemaError[]>([])
const warnings = ref<string[]>([])
const elapsed = ref(0)
const status = ref<'idle' | 'pass' | 'fail'>('idle')

const SAMPLE_DOC = `{
  "user": {
    "id": "u-2048",
    "name": "张三",
    "age": "28",
    "tags": ["vip", "new"],
    "createdAt": "2024-03-11T09:20:00Z"
  },
  "orders": [
    {
      "id": "o-1001",
      "amount": 199.0,
      "status": "paid",
      "items": [{ "sku": "A-1", "qty": 2 }]
    },
    {
      "id": "o-1002",
      "amount": null,
      "status": "pending",
      "items": []
    }
  ],
  "source": "app-ios"
}`

const SAMPLE_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "user": {
      "type": "object",
      "required": ["name", "age", "email"],
      "properties": {
        "age": { "type": "integer" },
        "email": { "type": "string", "format": "email" }
      }
    },
    "orders": {
      "type": "array",
      "items": {
        "required": ["amount"],
        "properties": { "amount": { "type": "number" } }
      }
    }
  }
}`

const sig = () => JSON.stringify([mode.value, draft.value, strict.value, doc.value, schemaText.value])
const run = useToolRun(sig)

/** 异步校验序号：同步生成 / 后续校验都会 +1，使旧校验结果失效 */
let runToken = 0
/** 校验进行中（仅用于按钮 loading 反馈） */
const busy = ref(false)

onMounted(() => {
  const p = transfer.take('json-schema')
  if (p) {
    doc.value = p.text
    toast.success('已接收其他工具传来的 JSON')
  }
})

function generate() {
  runToken += 1
  busy.value = false
  if (!doc.value.trim()) {
    run.markIdle()
    status.value = 'idle'
    return
  }
  const t0 = performance.now()
  try {
    const { value } = parseJson(doc.value)
    const schema = inferSchema(toPlainJson(value), { draft: draft.value, strict: strict.value })
    schemaText.value = JSON.stringify(schema, null, 2)
    errors.value = []
    warnings.value = strict.value ? ['严格模式已开启：生成了 additionalProperties: false'] : []
    status.value = 'pass'
    elapsed.value = Math.round(performance.now() - t0)
    run.markOk(strict.value ? '已生成（严格模式）' : '已生成')
  } catch (e) {
    errors.value = []
    warnings.value = []
    status.value = 'idle'
    run.markFail(errMessage(e))
  }
}

async function validate() {
  const token = ++runToken
  if (!doc.value.trim() || !schemaText.value.trim()) {
    busy.value = false
    run.markIdle()
    status.value = 'idle'
    errors.value = []
    return
  }
  // 快照入参：Worker 消息与同步回退读到同一份输入
  const instanceText = doc.value
  const currentSchema = schemaText.value
  const useStrict = strict.value
  busy.value = true
  const t0 = performance.now()
  try {
    // 走 Worker + 超时，隔离用户 schema 里 pattern 的灾难性回溯；无 Worker 时同步回退。
    const res = await runComputation(
      { fn: 'validate', instanceText, schemaText: currentSchema, strict: useStrict },
      () => {
        const { value: instance } = parseJson(instanceText)
        const { value: schema } = parseJson(currentSchema)
        return validateInstance(toPlainJson(instance), toPlainJson(schema), { strict: useStrict })
      },
      2000
    )
    if (token !== runToken) return
    errors.value = res.errors
    warnings.value = res.warnings
    status.value = res.valid ? 'pass' : 'fail'
    elapsed.value = Math.round(performance.now() - t0)
    if (res.valid) run.markOk(`校验通过，检查了 ${res.checked} 个 schema 节点`)
    else run.markFail(`校验失败 · ${res.errors.length} 个错误`)
  } catch (e) {
    if (token !== runToken) return
    errors.value = []
    warnings.value = []
    status.value = 'idle'
    run.markFail(errMessage(e))
  } finally {
    if (token === runToken) busy.value = false
  }
}

function formatSchema() {
  try {
    const { value } = parseJson(schemaText.value)
    schemaText.value = JSON.stringify(value, null, 2)
    toast.success('Schema 已格式化')
  } catch (e) {
    toast.warning(errMessage(e))
  }
}

function copyErrors() {
  if (!errors.value.length) {
    toast.warning('当前没有错误清单')
    return
  }
  const text = errors.value
    .map((e) => `${e.path} [${e.keyword}] ${e.message}（Schema 位置：${e.schemaPath}）`)
    .join('\n')
  clipboard.copy(text, '错误清单')
}

const meta = computed(() => {
  const list: string[] = []
  if (doc.value) list.push(`JSON ${lineCount(doc.value)} 行`)
  if (schemaText.value) list.push(`Schema ${lineCount(schemaText.value)} 行`)
  if (run.status.value === 'ok' || run.status.value === 'error') list.push(`耗时 ${elapsed.value} ms`)
  return list
})

watch([mode, draft, strict], () => {
  if (mode.value === 'validate') validate()
  else generate()
})

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    if (mode.value === 'validate') validate()
    else generate()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t45">
    <div class="t45__tabs" role="tablist" aria-label="JSON Schema 模式">
      <button
        v-for="t in [
          { v: 'generate', label: '从 JSON 生成 Schema' },
          { v: 'validate', label: '使用 Schema 校验' }
        ]"
        :key="t.v"
        class="t45__tab"
        :class="{ 't45__tab--on': mode === t.v }"
        role="tab"
        :aria-selected="mode === t.v"
        @click="mode = t.v as Mode"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="t45__toolbar">
      <span class="t45__label">规范</span>
      <DkSelect
        :model-value="draft"
        :options="[
          { value: '2020-12', label: 'Draft 2020-12' },
          { value: 'draft-07', label: 'Draft-07' }
        ]"
        aria-label="JSON Schema 规范"
        @update:model-value="draft = $event as Draft"
      />
      <span class="t45__sep"></span>
      <label class="t45__switch">
        <DkSwitch :on="strict" label="严格模式" @toggle="strict = !strict" />
        <span class="t45__label">严格模式</span>
      </label>
      <span class="t45__sep"></span>
      <DkButton size="sm" variant="primary" :loading="busy" @click="mode === 'validate' ? validate() : generate()">
        <DkIcon name="play" :size="12" />{{ mode === 'validate' ? '校验' : '生成' }}
      </DkButton>
      <DkButton
        size="sm"
        :disabled="!schemaText"
        @click="clipboard.copy(schemaText, 'JSON Schema')"
      >
        <DkIcon name="copy" :size="12" />复制
      </DkButton>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="doc = SAMPLE_DOC; schemaText = SAMPLE_SCHEMA; mode = 'validate'; validate()">
        <DkIcon name="zap" :size="12" />载入示例
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : warnings.join(' · ')"
      :meta="meta"
      :retry="mode === 'validate' ? validate : generate"
    />

    <div class="t45__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="doc"
            lang="JSON 文档"
            placeholder="粘贴待校验的 JSON，或点击「载入示例」"
            :height="'calc(60vh - 60px)'"
            filename="document.json"
            :error="run.status.value === 'error' && !errors.length ? run.errorMsg.value : ''"
          />
        </template>
        <template #right>
          <div class="t45__right">
            <div class="t45__schema">
              <div class="t45__panelhead">
                <span class="t45__panel-title">JSON Schema</span>
                <span class="t45__badge">{{ draft === '2020-12' ? 'Draft 2020-12' : 'Draft-07' }}</span>
                <span class="grow"></span>
                <DkButton size="sm" variant="ghost" :disabled="!schemaText" @click="clipboard.copy(schemaText, 'JSON Schema')">
                  <DkIcon name="copy" :size="12" />复制
                </DkButton>
                <DkButton size="sm" variant="ghost" :disabled="!schemaText" @click="formatSchema">
                  <DkIcon name="list-filter" :size="12" />格式化
                </DkButton>
              </div>
              <div class="t45__schema-body">
                <DkEditor
                  v-model="schemaText"
                  hide-toolbar
                  lang="JSON Schema"
                  placeholder="粘贴 JSON Schema，或用上面的「生成」从 JSON 推断"
                  :height="'100%'"
                  filename="schema.json"
                />
              </div>
              <div class="t45__panelfoot mono">
                JSON Schema · {{ draft === '2020-12' ? 'Draft 2020-12' : 'Draft-07' }}
                <span class="grow"></span>
                <span v-if="schemaText">{{ lineCount(schemaText) }} 行</span>
              </div>
            </div>

            <div class="t45__check">
              <div class="t45__panelhead" :class="status === 'fail' ? 't45__panelhead--fail' : status === 'pass' ? 't45__panelhead--ok' : ''">
                <DkIcon
                  :name="status === 'fail' ? 'circle-x' : status === 'pass' ? 'circle-check' : 'info'"
                  :size="15"
                />
                <span class="t45__panel-title">
                  {{ status === 'fail' ? '校验失败' : status === 'pass' ? '校验通过' : '尚未校验' }}
                </span>
                <span v-if="status !== 'idle'" class="t45__badge t45__badge--err">{{ errors.length }} 个错误</span>
                <span class="grow"></span>
                <DkButton size="sm" variant="ghost" :disabled="!errors.length" @click="copyErrors">
                  <DkIcon name="copy" :size="12" />复制错误清单
                </DkButton>
              </div>
              <div class="t45__errors">
                <p v-if="!errors.length" class="t45__empty">
                  {{ status === 'pass' ? '没有发现错误。' : '点击「校验」后，错误会按出现位置列在这里。' }}
                </p>
                <div v-for="(e, i) in errors" :key="`${e.pointer}-${e.keyword}-${i}`" class="t45__error">
                  <DkIcon name="alert-circle" :size="13" />
                  <div class="t45__error-body">
                    <p class="t45__error-head">
                      <span class="mono">{{ e.path }}</span>
                      <span>：{{ e.message }}</span>
                    </p>
                    <p class="t45__error-sub mono">Schema 位置：{{ e.schemaPath }}</p>
                  </div>
                </div>
              </div>
              <div class="t45__panelfoot">
                <span v-if="status !== 'idle'">共 {{ errors.length }} 个错误 · 校验耗时 {{ elapsed }} ms</span>
                <span v-else>尚未执行校验</span>
                <span class="grow"></span>
                <span>{{ strict ? '严格模式已开启' : '严格模式已关闭（format 仅提示）' }}</span>
              </div>
            </div>
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="schemaText && run.status.value === 'ok'" class="t45__send">
      <span class="tertiary">继续处理：</span>
      <SendToMenu :text="doc" from="json-schema" kind="json" />
    </div>
  </div>
</template>

<style scoped>
.t45 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t45__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.t45__tab {
  height: 36px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.t45__tab--on {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 500;
}
.t45__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t45__label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t45__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t45__switch {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.t45__panes {
  min-height: 320px;
}
.t45__right {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(60vh - 60px);
  min-height: 340px;
}
.t45__schema {
  display: flex;
  flex-direction: column;
  flex: 1 1 55%;
  min-height: 160px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t45__schema-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.t45__check {
  display: flex;
  flex-direction: column;
  flex: 1 1 45%;
  min-height: 160px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t45__panelhead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.t45__panelhead--fail {
  color: var(--error);
}
.t45__panelhead--ok {
  color: var(--ok);
}
.t45__panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.t45__panelhead--fail .t45__panel-title {
  color: var(--error);
}
.t45__panelhead--ok .t45__panel-title {
  color: var(--ok);
}
.t45__badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}
.t45__badge--err {
  background: var(--error-soft);
  color: var(--error);
}
.t45__errors {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.t45__empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.t45__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--error);
}
.t45__error-body {
  min-width: 0;
}
.t45__error-head {
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.6;
}
.t45__error-head .mono {
  color: var(--error);
}
.t45__error-sub {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.t45__panelfoot {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.t45__send {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}
</style>
