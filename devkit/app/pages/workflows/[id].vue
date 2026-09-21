<script setup lang="ts">
import { stepDef, stepLibrary, runStep, runWorkflow, type StepResult, type StepType } from '~/utils/workflow'

const route = useRoute()
const router = useRouter()
const store = useWorkflows()
const toast = useToast()
const transfer = useTransfer()
const clipboard = useClipboard()

const id = computed(() => route.params.id as string)
const wf = computed(() => store.get(id.value))
if (!wf.value) {
  throw createError({ statusCode: 404, statusMessage: '处理流程不存在', fatal: true })
}

useSeo({
  title: computed(() => `${wf.value?.name ?? '处理流程'} - 在线编排与运行 · DevKit`),
  description: computed(
    () => `在线编排并逐步运行「${wf.value?.name ?? '处理流程'}」：每一步的输入输出都在浏览器内存中传递，不落盘、不上传。`
  )
})

const search = ref('')
const input = ref('')
const results = ref<StepResult[]>([])
const selected = ref(-1)
const stopOnError = ref(true)
const clearAfterRun = ref(false)
const lastRunAt = ref(0)
const busy = ref(false)

const steps = computed(() => wf.value?.steps ?? [])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return stepLibrary
  return stepLibrary.filter((s) => s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q) || s.desc.includes(q))
})

const addedTypes = computed(() => new Set(steps.value.map((s) => s.type)))

/** 接收跨工具传递：只有带 workflow 意图时才会自动追加步骤 */
onMounted(() => {
  const p = transfer.take()
  if (!p) return
  input.value = p.text
  const intent = (p as { intent?: { workflowId: string; stepType?: StepType } }).intent
  if (intent && intent.workflowId === id.value && intent.stepType) {
    store.addStep(id.value, { type: intent.stepType, config: {} })
    toast.success(`已把「${stepDef(intent.stepType).name}」追加为第 ${steps.value.length} 步`)
    selected.value = steps.value.length - 1
  } else {
    toast.success('已接收其他工具传来的内容（仅内存）')
  }
})

function stepStatus(i: number): StepResult['status'] | 'pending' {
  return results.value[i]?.status ?? 'pending'
}

function inputOf(i: number): string {
  if (i === 0) return input.value
  return results.value[i - 1]?.output ?? input.value
}

function runAll() {
  if (!wf.value) return
  if (!steps.value.length) {
    toast.warning('这条流程还没有步骤')
    return
  }
  if (!input.value.trim()) {
    toast.warning('请先填写或接收流程输入')
    return
  }
  busy.value = true
  const res = runWorkflow(wf.value, input.value, { stopOnError: stopOnError.value })
  results.value = res.results
  selected.value = Math.max(0, res.results.findIndex((r) => r.status === 'fail'))
  if (selected.value === -1) selected.value = Math.min(steps.value.length - 1, res.results.length - 1)
  lastRunAt.value = Date.now()
  store.addRun({
    workflowId: id.value,
    name: wf.value.name,
    summary: steps.value.map((s) => stepDef(s.type).name).join(' → '),
    status: res.status,
    ms: res.ms
  })
  if (res.status === 'ok') toast.success(`全部 ${res.results.length} 步运行完成，耗时 ${res.ms} ms`)
  else toast.warning(`已中断：${res.results.find((r) => r.status === 'fail')?.note ?? '步骤失败'}`)
  if (clearAfterRun.value) input.value = ''
  busy.value = false
}

function runOne(i: number) {
  const step = steps.value[i]
  if (!step) return
  busy.value = true
  const res = runStep(step, inputOf(i), i)
  const list = [...results.value]
  list[i] = res
  results.value = list
  selected.value = i
  if (res.status === 'ok') toast.success(`第 ${i + 1} 步完成：${res.note}`)
  else toast.warning(`第 ${i + 1} 步失败：${res.note}`)
  busy.value = false
}

function runSelected() {
  if (selected.value < 0) {
    toast.warning('当前选中的是「流程输入」，请先选择要运行的步骤')
    return
  }
  runOne(selected.value)
}

function clearInput() {
  input.value = ''
  results.value = []
  selected.value = -1
  toast.success('已清空流程输入与本次中间结果')
}

function add(type: StepType) {
  store.addStep(id.value, { type, config: {} })
  selected.value = steps.value.length - 1
}

function removeStep(i: number) {
  store.removeStep(id.value, i)
  results.value = results.value.filter((_, idx) => idx !== i)
  if (selected.value >= i) selected.value = Math.max(-1, selected.value - 1)
}

const currentNodeTitle = computed(() => {
  if (selected.value < 0) return '流程输入'
  return `第 ${selected.value + 1} / ${steps.value.length} 步`
})

const currentDef = computed(() => (selected.value < 0 ? null : stepDef(steps.value[selected.value]!.type)))

const currentLogs = computed(() => (selected.value < 0 ? [] : (results.value[selected.value]?.logs ?? [])))

const doneCount = computed(() => results.value.filter((r) => r.status === 'ok').length)
const failCount = computed(() => results.value.filter((r) => r.status === 'fail').length)
const pendingCount = computed(() => Math.max(0, steps.value.length - doneCount.value - failCount.value))

const chainMark = computed(() => {
  const parts: string[] = []
  if (failCount.value) parts.push(`${failCount.value} 个失败`)
  if (pendingCount.value) parts.push(`${pendingCount.value} 个待运行`)
  if (!parts.length) parts.push('全部成功')
  return parts.join(' · ')
})

const lastRunText = computed(() => {
  if (!lastRunAt.value) return '本次页面还没有运行记录'
  const r = store.runsOf(id.value)[0]
  return `上次运行 ${fmtAgo(lastRunAt.value)}${r ? ` · 耗时 ${r.ms} ms` : ''}`
})

function sizeText(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function exportJson() {
  if (!wf.value) return
  const payload = JSON.stringify({ name: wf.value.name, desc: wf.value.desc, steps: wf.value.steps }, null, 2)
  downloadText(`${wf.value.name || 'workflow'}.json`, payload, 'application/json')
}
</script>

<template>
  <div v-if="wf" class="wfe">
    <header class="wfe__head">
      <span class="wfe__head-icon">
        <DkIcon name="workflow" :size="17" />
      </span>
      <div class="wfe__head-text">
        <h1 class="wfe__title">编排与运行</h1>
        <p class="wfe__desc">
          {{ wf.name }} · {{ steps.length }} 个节点 · 可单步运行并查看每一步的输出
        </p>
      </div>
      <span class="grow"></span>
      <NuxtLink to="/workflows" class="wfe__back">
        <DkIcon name="chevron-left" :size="13" />流程列表
      </NuxtLink>
      <span class="wfe__badge">
        <DkIcon name="shield-check" :size="13" />本地处理 · 输入不上传
      </span>
    </header>

    <div class="wfe__note">
      <DkIcon name="shield-check" :size="14" />
      <span>数据仅在本次页面内存中传递，离开即清除</span>
      <span class="tertiary">不写入磁盘 · 不发送到服务器</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="exportJson">
        <DkIcon name="download" :size="12" />导出流程 JSON
      </DkButton>
    </div>

    <div class="wfe__ops">
      <span class="wfe__ops-count">已完成 {{ doneCount }} / {{ steps.length }} 节点</span>
      <span class="tertiary">{{ lastRunText }}</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="primary" :loading="busy" @click="runAll">
        <DkIcon name="play" :size="12" />运行全部
      </DkButton>
      <DkButton size="sm" :disabled="selected < 0" @click="runSelected">
        <DkIcon name="arrow-down" :size="12" />单步运行
      </DkButton>
      <DkButton size="sm" variant="ghost" @click="clearInput">
        <DkIcon name="trash" :size="12" />清空输入
      </DkButton>
    </div>

    <section class="wfe__input">
      <div class="wfe__input-head">
        <DkIcon name="corner-right-down" :size="14" />
        <span class="wfe__card-title">流程输入</span>
        <span class="wfe__badge wfe__badge--soft">
          {{ input ? `${lineCount(input)} 行 · ${sizeText(input)}` : '尚未提供输入' }}
        </span>
        <span class="grow"></span>
        <span class="tertiary">可以手动粘贴，也可以从其他工具「发送到 → 加入处理流程」传入</span>
      </div>
      <DkEditor
        v-model="input"
        hide-toolbar
        lang="流程输入 · 文本"
        placeholder="粘贴 Base64 / JSON / URL 编码文本，作为第一个步骤的输入"
        height="140px"
        filename="workflow-input.txt"
      />
    </section>

    <div class="wfe__cols">
      <section class="wfe__lib">
        <div class="wfe__card-head">
          <DkIcon name="layers" :size="14" />
          <span class="wfe__card-title">步骤库</span>
          <span class="grow"></span>
          <span class="tfe-muted">{{ stepLibrary.length }}</span>
        </div>
        <div class="wfe__lib-search">
          <label class="wfe__search">
            <DkIcon name="search" :size="13" />
            <input v-model="search" class="wfe__search-input" placeholder="搜索步骤" aria-label="搜索步骤" />
          </label>
        </div>
        <div class="wfe__lib-list">
          <button v-for="s in filtered" :key="s.type" class="wfe__lib-item" @click="add(s.type)">
            <span class="wfe__lib-icon">
              <DkIcon :name="s.type === 'download' ? 'download' : 'sparkles'" :size="14" />
            </span>
            <span class="wfe__lib-info">
              <span class="wfe__lib-name">{{ s.name }}</span>
              <span class="wfe__lib-cat">{{ s.cat }}</span>
            </span>
            <span v-if="addedTypes.has(s.type)" class="wfe__badge wfe__badge--ok wfe__badge--mini">已添加</span>
            <DkIcon v-else name="plus" :size="14" />
          </button>
          <p v-if="!filtered.length" class="wfe__empty">没有匹配的步骤。</p>
        </div>
        <div class="wfe__spacer"></div>
        <div class="wfe__settings">
          <span class="wfe__card-title">流程设置</span>
          <label class="wfe__switch">
            <DkSwitch :on="stopOnError" label="失败时中断流程" @toggle="stopOnError = !stopOnError" />
            <span>失败时中断流程</span>
          </label>
          <label class="wfe__switch">
            <DkSwitch :on="clearAfterRun" label="运行后自动清空输入" @toggle="clearAfterRun = !clearAfterRun" />
            <span>运行后自动清空输入</span>
          </label>
        </div>
        <div class="wfe__lib-foot">
          <DkButton
            size="sm"
            block
            disabled
            title="不支持自定义代码步骤：本工具只编排已实现的内置步骤，避免在页面里执行任意代码"
          >
            <DkIcon name="plus" :size="12" />添加自定义步骤
          </DkButton>
        </div>
      </section>

      <section class="wfe__chain">
        <div class="wfe__card-head">
          <DkIcon name="workflow" :size="14" />
          <span class="wfe__card-title">步骤链</span>
          <span class="grow"></span>
          <span class="wfe__badge" :class="failCount ? 'wfe__badge--err' : 'wfe__badge--soft'">{{ chainMark }}</span>
        </div>
        <div class="wfe__chain-body">
          <button class="wfe__node wfe__node--io" :class="{ 'wfe__node--on': selected === -1 }" @click="selected = -1">
            <span class="wfe__node-dot wfe__node-dot--io">
              <DkIcon name="corner-right-down" :size="14" />
            </span>
            <span class="wfe__node-info">
              <span class="wfe__node-name">流程输入</span>
              <span class="wfe__node-sub">{{ input ? `${lineCount(input)} 行 · ${sizeText(input)}` : '等待输入' }}</span>
            </span>
          </button>

          <template v-for="(s, i) in steps" :key="`${s.type}-${i}`">
            <div class="wfe__link">
              <span class="wfe__link-text">输出 → 输入</span>
              <span class="wfe__link-line"></span>
            </div>
            <div class="wfe__node" :class="{ 'wfe__node--on': selected === i }" @click="selected = i">
              <span
                class="wfe__node-dot"
                :class="{
                  'wfe__node-dot--ok': stepStatus(i) === 'ok',
                  'wfe__node-dot--fail': stepStatus(i) === 'fail'
                }"
              >
                <DkIcon
                  :name="stepStatus(i) === 'ok' ? 'circle-check' : stepStatus(i) === 'fail' ? 'circle-x' : 'play'"
                  :size="14"
                />
              </span>
              <span class="wfe__node-info">
                <span class="wfe__node-name">{{ i + 1 }} · {{ stepDef(s.type).name }}</span>
                <span class="wfe__node-sub">
                  {{ Object.keys(s.config).length ? Object.entries(s.config).map(([k, v]) => `${k}=${v}`).join(' · ') : stepDef(s.type).desc }}
                </span>
              </span>
              <span class="wfe__node-marks">
                <span v-if="results[i]" class="wfe__badge wfe__badge--mini">
                  输出 {{ sizeText(results[i]!.output) }}
                </span>
                <span v-if="results[i]" class="wfe__badge wfe__badge--mini">耗时 {{ results[i]!.ms }} ms</span>
              </span>
              <button
                class="wfe__node-act"
                title="单步运行"
                :disabled="busy"
                @click.stop="runOne(i)"
              >
                <DkIcon name="play" :size="12" />
              </button>
              <button class="wfe__node-act" title="上移" :disabled="i === 0" @click.stop="store.moveStep(id, i, -1)">
                <DkIcon name="chevron-up" :size="12" />
              </button>
              <button
                class="wfe__node-act"
                title="下移"
                :disabled="i === steps.length - 1"
                @click.stop="store.moveStep(id, i, 1)"
              >
                <DkIcon name="chevron-down" :size="12" />
              </button>
              <button class="wfe__node-act" title="删除该步骤" @click.stop="removeStep(i)">
                <DkIcon name="trash" :size="12" />
              </button>
            </div>
          </template>

          <div v-if="steps.length" class="wfe__link">
            <span class="wfe__link-text">输出 → 输入</span>
            <span class="wfe__link-line"></span>
          </div>
          <button
            v-if="steps.length"
            class="wfe__node wfe__node--io"
            :class="{ 'wfe__node--on': selected === steps.length }"
            @click="selected = steps.length"
          >
            <span class="wfe__node-dot wfe__node-dot--io">
              <DkIcon name="download" :size="14" />
            </span>
            <span class="wfe__node-info">
              <span class="wfe__node-name">流程输出</span>
              <span class="wfe__node-sub">
                {{ results.length === steps.length && results[steps.length - 1]?.status === 'ok' ? `可用 · ${sizeText(results[steps.length - 1]!.output)}` : '暂无输出' }}
              </span>
            </span>
          </button>
          <p v-if="!steps.length" class="wfe__empty">步骤链是空的：从左侧「步骤库」点一个步骤开始。</p>
        </div>
        <div class="wfe__chain-foot">
          <span class="tertiary">节点之间的数据只存在于内存，不落盘</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" @click="selected = steps.length - 1">
            <DkIcon name="arrow-down" :size="12" />定位到最后一步
          </DkButton>
        </div>
      </section>

      <section class="wfe__cur">
        <div class="wfe__card-head">
          <DkIcon name="sliders" :size="14" />
          <span class="wfe__card-title">当前步骤</span>
          <span class="grow"></span>
          <span class="wfe__badge wfe__badge--soft">{{ currentNodeTitle }}</span>
        </div>

        <div v-if="currentDef" class="wfe__cfg">
          <label class="wfe__field">
            <span class="wfe__field-label">步骤类型</span>
            <input class="wfe__field-input" :value="currentDef.name" readonly aria-label="步骤类型" />
          </label>
          <label v-for="f in currentDef.fields" :key="f.key" class="wfe__field">
            <span class="wfe__field-label">{{ f.label }}</span>
            <input
              class="wfe__field-input mono"
              :value="steps[selected]?.config[f.key] ?? ''"
              :placeholder="f.placeholder"
              :aria-label="f.label"
              @input="store.updateStepConfig(id, selected, f.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="wfe__switch">
            <DkSwitch :on="stopOnError" label="失败时中断流程" @toggle="stopOnError = !stopOnError" />
            <span>失败时中断流程</span>
          </label>
        </div>
        <div v-else class="wfe__cfg">
          <p class="wfe__hint">
            选中的是「流程输入」。在左侧步骤链里点一个步骤，即可编辑它的参数并单步运行。
          </p>
        </div>

        <div class="wfe__console-head">
          <span class="wfe__card-title">实时输出</span>
          <span class="tertiary">仅本次页面内存</span>
          <span class="grow"></span>
          <span
            v-if="selected >= 0 && results[selected]"
            class="wfe__badge"
            :class="results[selected]!.status === 'ok' ? 'wfe__badge--ok' : 'wfe__badge--err'"
          >
            {{ results[selected]!.status === 'ok' ? '成功' : '失败' }}
          </span>
        </div>
        <div class="wfe__console mono">
          <p v-if="!currentLogs.length" class="wfe__empty">
            还没有这一步的运行日志。点击「单步运行」或「运行全部」后，这里会打印真实的执行过程。
          </p>
          <p v-for="(l, i) in currentLogs" :key="i" class="wfe__log">{{ l }}</p>
        </div>
        <div class="wfe__stat">
          <span v-if="selected >= 0 && results[selected]">
            {{ sizeText(results[selected]!.output) }} 输出 · {{ results[selected]!.ms }} ms
          </span>
          <span v-else>未生成结果</span>
          <span class="grow"></span>
          <span v-if="selected >= 0 && results[selected]?.status === 'ok'" class="wfe__badge wfe__badge--ok wfe__badge--mini">
            <DkIcon name="circle-check" :size="11" />步骤成功
          </span>
        </div>

        <div class="wfe__cur-foot">
          <DkButton size="sm" :disabled="selected < 0 || busy" @click="runOne(selected)">
            <DkIcon name="refresh-cw" :size="13" />重试此步
          </DkButton>
          <DkButton
            size="sm"
            variant="ghost"
            :disabled="selected <= 0"
            @click="selected = selected - 1"
          >
            <DkIcon name="chevron-left" :size="12" />查看上一步
          </DkButton>
          <DkButton
            size="sm"
            variant="ghost"
            :disabled="selected < 0 || !results[selected]"
            @click="clipboard.copy(results[selected]?.output ?? '', '该步输出')"
          >
            <DkIcon name="copy" :size="12" />复制输出
          </DkButton>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wfe {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1680px;
  margin: 0 auto;
}
.wfe__head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  flex-wrap: wrap;
}
.wfe__head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--cat-format-soft);
  color: var(--cat-format);
  flex-shrink: 0;
}
.wfe__title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}
.wfe__desc {
  font-size: 12px;
  color: var(--text-secondary);
}
.wfe__back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.wfe__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.wfe__badge--soft {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.wfe__badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.wfe__badge--err {
  background: var(--error-soft);
  color: var(--error);
}
.wfe__badge--mini {
  height: 19px;
  padding: 0 7px;
  font-size: 11px;
}
.wfe__note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.wfe__ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.wfe__ops-count {
  font-size: 13px;
  color: var(--text-secondary);
}
.wfe__input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wfe__input-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.wfe__card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.wfe__cols {
  display: grid;
  grid-template-columns: 268px minmax(320px, 1fr) 420px;
  gap: 14px;
  align-items: start;
}
.wfe__lib,
.wfe__chain,
.wfe__cur {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  min-width: 0;
  height: calc(60vh - 40px);
  min-height: 460px;
  overflow: hidden;
}
.wfe__card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wfe__lib-search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wfe__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.wfe__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-primary);
}
.wfe__lib-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.wfe__lib-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  color: var(--text-secondary);
}
.wfe__lib-item:hover {
  background: var(--surface-hover);
}
.wfe__lib-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--surface-subtle);
  color: var(--accent);
  flex-shrink: 0;
}
.wfe__lib-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.wfe__lib-name {
  font-size: 12.5px;
  color: var(--text-primary);
}
.wfe__lib-cat {
  font-size: 11px;
  color: var(--text-tertiary);
}
.wfe__spacer {
  flex: 0 0 auto;
}
.wfe__settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.wfe__switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.wfe__lib-foot {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.wfe__chain-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.wfe__node {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  text-align: left;
  flex-wrap: wrap;
}
.wfe__node--on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-ring);
}
.wfe__node--io {
  background: var(--surface-subtle);
}
.wfe__node-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.wfe__node-dot--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.wfe__node-dot--fail {
  background: var(--error-soft);
  color: var(--error);
}
.wfe__node-dot--io {
  background: var(--accent-soft);
  color: var(--accent);
}
.wfe__node-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.wfe__node-name {
  font-size: 12.5px;
  color: var(--text-primary);
  font-weight: 500;
}
.wfe__node-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.wfe__node-marks {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.wfe__node-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.wfe__node-act:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}
.wfe__node-act:disabled {
  opacity: 0.35;
}
.wfe__link {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 26px;
  padding-left: 22px;
  font-size: 10.5px;
  color: var(--text-tertiary);
}
.wfe__link-line {
  width: 2px;
  height: 100%;
  background: var(--border-strong);
  border-radius: 1px;
}
.wfe__chain-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  flex-shrink: 0;
}
.wfe__cfg {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wfe__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wfe__field-label {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.wfe__field-input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  font-size: 12.5px;
  color: var(--text-primary);
}
.wfe__field-input[readonly] {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.wfe__console-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.wfe__console {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  margin: 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--editor-bg);
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-secondary);
}
.wfe__log {
  white-space: pre-wrap;
  word-break: break-word;
}
.wfe__stat {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.wfe__cur-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.wfe__empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.7;
}
.wfe__hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.tfe-muted {
  font-size: 11px;
  color: var(--text-tertiary);
}
@media (max-width: 1240px) {
  .wfe__cols {
    grid-template-columns: 240px minmax(280px, 1fr);
  }
  .wfe__cur {
    grid-column: 1 / -1;
    height: auto;
    min-height: 380px;
  }
}
@media (max-width: 820px) {
  .wfe__cols {
    grid-template-columns: minmax(0, 1fr);
  }
  .wfe__lib,
  .wfe__chain,
  .wfe__cur {
    height: auto;
    min-height: 320px;
  }
}
</style>
