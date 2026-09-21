<script setup lang="ts">
/**
 * G09 发送到工具链弹层：把当前结果交给另一个工具继续处理，或加入一条处理流程。
 * 只列出真正实现了接收的目标；标「需补充 Schema」的目标需要用户再选一份 Schema。
 * 传递只发生在本次页面内存中，不进 URL、不写存储。
 */
const props = defineProps<{
  text: string
  from: string
  kind: 'json' | 'text'
}>()

const transfer = useTransfer()
const store = useWorkflows()
const toast = useToast()

const open = ref(false)
const selectedSlug = ref<string | null>(null)
const newFlowName = ref('')

const targets = computed(() => transfer.compatibleTargets(props.kind).filter((t) => t.slug !== props.from))

const summary = computed(() => {
  const text = props.text
  const bytes = new TextEncoder().encode(text).length
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  const lines = text ? text.split('\n').length : 0
  let shape = '文本'
  if (props.kind === 'json') {
    try {
      const v = JSON.parse(text)
      shape = Array.isArray(v)
        ? `JSON 数组 · ${v.length} 项`
        : v && typeof v === 'object'
          ? `JSON 对象 · ${Object.keys(v).length} 个字段`
          : `JSON ${typeof v}`
    } catch {
      shape = '文本（不是合法 JSON，按文本传递）'
    }
  }
  return `将传递：${shape} · ${lines} 行 · ${size}`
})

/** 内容本身是否为合法 JSON（与来源声明的 kind 无关：解码结果也可能是 JSON） */
const contentIsJson = computed(() => {
  try {
    JSON.parse(props.text)
    return true
  } catch {
    return false
  }
})

const contentTag = computed(() =>
  props.kind === 'json' ? (contentIsJson.value ? '格式有效' : '格式待确认') : contentIsJson.value ? '文本（合法 JSON）' : '文本内容'
)

/** 内容不是合法 JSON 时，需要 JSON 的目标不可选（但保留说明，便于理解为什么灰掉） */
const usable = (t: { requiresJson?: boolean }) => !t.requiresJson || contentIsJson.value

const tagOf = (t: { requiresJson?: boolean; needsExtra?: boolean }) => {
  if (t.requiresJson && !contentIsJson.value) return { text: '需合法 JSON', cls: 'sendto__tag--off' }
  if (t.needsExtra) return { text: '需补充 Schema', cls: 'sendto__tag--warn' }
  return { text: '完全兼容', cls: 'sendto__tag--ok' }
}

const selected = computed(() => {
  const t = targets.value.find((x) => x.slug === selectedSlug.value)
  return t && usable(t) ? t : null
})

function toggle() {
  if (!props.text.trim()) return
  open.value = !open.value
  if (open.value) {
    selectedSlug.value = (targets.value.find((t) => usable(t)) ?? targets.value[0])?.slug ?? null
    newFlowName.value = ''
  }
}

function confirmTool() {
  const target = selected.value
  if (!target) return
  transfer.send(props.text, props.from, props.kind)
  transfer.deliver(target.slug)
  open.value = false
}

function appendToWorkflow(workflowId: string, name: string) {
  transfer.sendToWorkflow(props.text, props.from, props.kind, workflowId, stepForFrom())
  open.value = false
  toast.success(`结果已带入「${name}」，仅在内存中传递`)
}

function createWorkflow() {
  transfer.sendToNewWorkflow(props.text, props.from, props.kind, newFlowName.value, stepForFrom())
  open.value = false
}

/** 来源工具对应的流程步骤类型；没有对应步骤时只把结果作为流程输入带入 */
function stepForFrom() {
  switch (props.from) {
    case 'json-format':
      return 'json-format' as const
    case 'base64':
      return 'base64-decode' as const
    case 'url-encode':
      return 'url-decode' as const
    case 'json-yaml':
      return 'json-yaml' as const
    case 'jsonpath-query':
      return 'jsonpath' as const
    case 'json-schema':
      return 'schema-validate' as const
    case 'json2java':
      return 'json2java' as const
    default:
      return undefined
  }
}

function iconOf(slug: string) {
  if (slug === 'json2java') return 'coffee'
  if (slug.includes('schema')) return 'shield-check'
  if (slug === 'xml-toolbox') return 'code-xml'
  if (slug === 'jsonpath-query') return 'list-filter'
  return 'file-code'
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="sendto">
    <button class="sendto__btn" :disabled="!text.trim()" title="发送到另一个工具（仅内存）" @click="toggle">
      <DkIcon name="send" :size="12" />
      发送到…
    </button>

    <Teleport to="body">
      <Transition name="sendto-fade">
        <div v-if="open" class="sendto__mask" @click.self="open = false">
          <div class="sendto__modal" role="dialog" aria-modal="true" aria-label="发送到其他工具">
            <div class="sendto__head">
              <span class="sendto__head-icon">
                <DkIcon name="send" :size="16" />
              </span>
              <div class="sendto__head-text">
                <p class="sendto__title">发送到…</p>
                <p class="sendto__sub">把当前结果交给另一个工具继续处理</p>
              </div>
              <span class="grow"></span>
              <button class="sendto__close" title="关闭" @click="open = false">
                <DkIcon name="x" :size="14" />
              </button>
            </div>

            <div class="sendto__summary">
              <DkIcon name="corner-right-down" :size="14" />
              <span class="sendto__summary-text">{{ summary }}</span>
              <span class="sendto__tag" :class="contentIsJson ? 'sendto__tag--ok' : ''">{{ contentTag }}</span>
            </div>

            <p class="sendto__group">继续处理</p>
            <div class="sendto__list">
              <button
                v-for="t in targets"
                :key="t.slug"
                class="sendto__item"
                :class="{ 'sendto__item--on': selectedSlug === t.slug, 'sendto__item--off': !usable(t) }"
                :disabled="!usable(t)"
                :title="usable(t) ? t.note : '当前内容不是合法 JSON，该工具无法接收'"
                @click="selectedSlug = t.slug"
              >
                <span class="sendto__item-icon">
                  <DkIcon :name="iconOf(t.slug)" :size="15" />
                </span>
                <span class="sendto__item-info">
                  <span class="sendto__item-name">{{ t.name }}</span>
                  <span class="sendto__item-note">{{ t.note }}</span>
                </span>
                <span class="sendto__tag" :class="tagOf(t).cls">{{ tagOf(t).text }}</span>
                <DkIcon name="chevron-right" :size="15" />
              </button>
              <p v-if="!targets.length" class="sendto__empty">当前没有兼容的目标工具。</p>
            </div>

            <p class="sendto__group">加入处理流程</p>
            <div class="sendto__list">
              <button
                v-for="wf in store.workflows.value"
                :key="wf.id"
                class="sendto__item"
                @click="appendToWorkflow(wf.id, wf.name)"
              >
                <span class="sendto__item-icon sendto__item-icon--flow">
                  <DkIcon name="workflow" :size="15" />
                </span>
                <span class="sendto__item-info">
                  <span class="sendto__item-name">{{ wf.name }}</span>
                  <span class="sendto__item-note">{{ wf.steps.length }} 个步骤 · 追加为第 {{ wf.steps.length + 1 }} 步</span>
                </span>
                <DkIcon name="chevron-right" :size="15" />
              </button>
              <div class="sendto__newflow">
                <input
                  v-model="newFlowName"
                  class="sendto__newflow-input"
                  placeholder="新建处理流程的名称"
                  aria-label="新建处理流程名称"
                />
                <DkButton size="sm" @click="createWorkflow">
                  <DkIcon name="plus" :size="12" />新建处理流程
                </DkButton>
              </div>
            </div>

            <div class="sendto__foot">
              <span class="sendto__foot-note">
                <DkIcon name="shield-check" :size="13" />
                不保存输入 · 切换工具时仅在本次页面内存中传递
              </span>
              <span class="grow"></span>
              <DkButton size="sm" @click="open = false">取消</DkButton>
              <DkButton size="sm" variant="primary" :disabled="!selected" @click="confirmTool">
                <DkIcon name="arrow-right" :size="13" />继续处理
              </DkButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sendto {
  position: relative;
  display: inline-flex;
}
.sendto__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.12s;
}
.sendto__btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.sendto__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.sendto__mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 17, 21, 0.5);
}
.sendto__modal {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(88vh, 900px);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.sendto__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.sendto__head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.sendto__title {
  font-size: 15px;
  font-weight: 600;
}
.sendto__sub {
  font-size: 12px;
  color: var(--text-secondary);
}
.sendto__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: var(--text-secondary);
}
.sendto__close:hover {
  background: var(--surface-hover);
}
.sendto__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.sendto__summary-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sendto__tag {
  display: inline-flex;
  align-items: center;
  height: 21px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-tertiary);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.sendto__tag--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.sendto__tag--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.sendto__tag--off {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.sendto__item--off {
  opacity: 0.55;
  cursor: not-allowed;
}
.sendto__group {
  padding: 10px 16px 4px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.sendto__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 10px;
  overflow: auto;
  flex-shrink: 1;
}
.sendto__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  text-align: left;
  color: var(--text-secondary);
}
.sendto__item:hover,
.sendto__item--on {
  border-color: var(--border);
  background: var(--surface-subtle);
}
.sendto__item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--accent);
  flex-shrink: 0;
}
.sendto__item-icon--flow {
  background: var(--cat-format-soft);
  color: var(--cat-format);
}
.sendto__item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.sendto__item-name {
  font-size: 13px;
  color: var(--text-primary);
}
.sendto__item-note {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.sendto__empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.sendto__newflow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 10px;
}
.sendto__newflow-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  font-size: 12.5px;
  color: var(--text-primary);
}
.sendto__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.sendto__foot-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.sendto-fade-enter-active,
.sendto-fade-leave-active {
  transition: opacity 0.15s;
}
.sendto-fade-enter-from,
.sendto-fade-leave-to {
  opacity: 0;
}
</style>
