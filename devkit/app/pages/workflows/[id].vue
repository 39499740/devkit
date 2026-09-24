<script setup lang="ts">
import {
  stepDef,
  stepLibrary,
  runStep,
  runWorkflow,
  normalizeSelection,
  payloadKindLabel,
  isSensitiveStep,
  isCurrentConsent,
  MISSING_SECRET_HINT,
  type StepConfigValue,
  type StepResult,
  type StepType,
  type WorkflowStep
} from '~/utils/workflow'
import { CONSENT_NOTICE_VERSION } from '~/workflow/secrets'

const route = useRoute()
const store = useWorkflows()
const toast = useToast()
const transfer = useTransfer()
const clipboard = useClipboard()

const id = computed(() => route.params.id as string)
const wf = computed(() => store.get(id.value))
/**
 * 流程现在保存在本机浏览器，SSR 阶段读不到任何数据：
 * 这里不能直接 404，否则刷新页面时真正的流程也会被判定为不存在。
 */
const notFound = computed(() => store.hydrated.value && !wf.value)
/** 模板里要判断「还没读完本地数据」，所以解构成顶层 ref 让模板自动解包 */
const hydrated = store.hydrated

useSeo({
  title: computed(() => `${wf.value?.name ?? '处理流程'} - 在线编排与运行 · DevKit`),
  description: computed(
    () => `在线编排并逐步运行「${wf.value?.name ?? '处理流程'}」：每一步的输入输出都在浏览器内存中传递，不落盘、不上传。`
  )
})

const { open: consentOpen, request: requestConsent, accept: acceptConsent, cancel: cancelConsent } = useSecretConsent()

/** 确认记录只在 request 返回 true 之后才构造，保证「没弹窗就没确认」 */
const currentConsent = () => ({
  accepted: true as const,
  acceptedAt: Date.now(),
  noticeVersion: CONSENT_NOTICE_VERSION
})

const search = ref('')
const input = ref('')
const results = ref<StepResult[]>([])
const selected = ref(-1)
const stopOnError = ref(true)
const clearAfterRun = ref(false)
const lastRunAt = ref(0)
const busy = ref(false)

/**
 * 结果失效：任何会改变计算语义的操作（改输入/参数、增删/移动/复制步骤、写入密钥）
 * 都必须让旧结果作废，否则界面会把上一步的输出贴到另一步名下，并继续显示「全部成功」。
 */
function invalidateResults() {
  results.value = []
}

/** 流程输入改走这里而不是 watch(input)：runAll 里会清空输入，watch 会误清新结果 */
function onInputChange(v: string) {
  input.value = v
  invalidateResults()
}

/** 本地存储错误横幅：记住被关掉的那条文案，出现新错误时还能再提示一次 */
const dismissedStorageError = ref('')
const storageErrorText = computed(() =>
  store.storageError.value && store.storageError.value !== dismissedStorageError.value ? store.storageError.value : ''
)
function dismissStorageError() {
  dismissedStorageError.value = store.storageError.value
}

const steps = computed(() => wf.value?.steps ?? [])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return stepLibrary
  return stepLibrary.filter((s) => s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q) || s.desc.includes(q))
})

const addedTypes = computed(() => new Set(steps.value.map((s) => s.type)))

/**
 * 接收跨工具传递：以流程 id 作为消费方，只有带本流程 intent 的载荷才会追加步骤。
 * take 是一次性消费，回到列表再进来不会重复追加。
 */
onMounted(async () => {
  const p = transfer.take(id.value)
  if (!p) return
  // 内容先作为流程输入带入：即使后面拒绝添加步骤，这次传递也不算白费
  input.value = p.text
  invalidateResults()
  const intent = p.intent
  if (intent?.workflowId === id.value) {
    if (intent.stepType) {
      if (isSensitiveStep(intent.stepType) && !(await requestConsent())) {
        toast.warning('已取消：未追加含密钥的步骤（内容已作为流程输入带入）')
        return
      }
      const res = store.addStep(id.value, intent.stepType, { consent: currentConsent() })
      if (!res.ok) {
        toast.warning(res.error ?? '追加步骤失败')
        return
      }
      invalidateResults()
      selected.value = steps.value.length - 1
      toast.success(`已把「${stepDef(intent.stepType).name}」追加为第 ${steps.value.length} 步`)
      return
    }
    toast.success('结果已作为流程输入带入（仅内存传递）')
    return
  }
  toast.success('已接收其他工具传来的内容（仅内存）')
})

function stepStatus(i: number): StepResult['status'] | 'pending' {
  return results.value[i]?.status ?? 'pending'
}

/** 上游的完整载荷优先：二进制结果必须把 bytes 传下去，只传 Hex 文本会让下一步解不出来 */
function inputOf(i: number) {
  if (i === 0) return input.value
  return results.value[i - 1]?.payload ?? input.value
}

async function runAll() {
  const current = wf.value
  if (!current) return
  if (!steps.value.length) {
    toast.warning('这条流程还没有步骤')
    return
  }
  if (!input.value.trim()) {
    toast.warning('请先填写或接收流程输入')
    return
  }
  busy.value = true
  try {
    const res = await runWorkflow(current, input.value, {
      stopOnError: stopOnError.value,
      secretOf: (s) => store.stepSecrets(id.value, s.id)
    })
    results.value = res.results
    // 运行完成后选中「第一个失败步骤」，全部成功则停在最后一步（不落到流程输出，避免误以为还能单步运行）
    const failedAt = res.results.findIndex((r) => r.status === 'fail')
    selected.value = failedAt >= 0 ? failedAt : Math.max(0, steps.value.length - 1)
    lastRunAt.value = Date.now()
    store.addRun({
      workflowId: id.value,
      name: current.name,
      summary: steps.value.map((s) => stepDef(s.type).name).join(' → '),
      status: res.status,
      ms: res.ms
    })
    if (res.status === 'ok') toast.success(`全部 ${res.results.length} 步运行完成，耗时 ${res.ms} ms`)
    else toast.warning(`已中断：${res.results.find((r) => r.status === 'fail')?.note ?? '步骤失败'}`)
    if (clearAfterRun.value) input.value = ''
  } finally {
    // 执行器抛异常时也要复位，否则按钮会一直转
    busy.value = false
  }
}

async function runOne(i: number) {
  const step = steps.value[i]
  if (!step) {
    toast.warning('该位置没有步骤可运行')
    return
  }
  // 上游未运行就单步运行，会拿「流程输入」当上游，算出一个与链路不符的结果
  if (i > 0 && !results.value[i - 1]) {
    toast.warning('上一步还没有结果：请先运行上一步，或点「运行全部」后再单步运行')
    return
  }
  busy.value = true
  try {
    const res = await runStep(step, inputOf(i), i, { secrets: store.stepSecrets(id.value, step.id) })
    // 只保留到本步：本步之后基于旧上游算出的结果已失效，必须作废，避免错位显示
    const list = results.value.slice(0, i)
    list[i] = res
    results.value = list
    selected.value = i
    if (res.status === 'ok') toast.success(`第 ${i + 1} 步完成：${res.note}`)
    else toast.warning(`第 ${i + 1} 步失败：${res.note}`)
  } finally {
    busy.value = false
  }
}

function runSelected() {
  const sel = selection.value
  if (sel.kind !== 'step') {
    toast.warning(
      sel.kind === 'input' ? '当前选中的是「流程输入」，请先在步骤链里选择要运行的步骤' : '当前选中的是「流程输出」，没有可单独运行的步骤'
    )
    return
  }
  runOne(sel.index)
}

function clearInput() {
  input.value = ''
  results.value = []
  selected.value = -1
  toast.success('已清空流程输入与本次中间结果')
}

/** 添加步骤的唯一入口：敏感步骤先拿到风险确认，被拒就什么都不做 */
async function addWithConsent(type: StepType) {
  if (isSensitiveStep(type) && !(await requestConsent())) {
    toast.warning('已取消：未添加含密钥的步骤')
    return
  }
  const res = store.addStep(id.value, type, { consent: currentConsent() })
  if (!res.ok) {
    toast.warning(res.error ?? '添加步骤失败')
    return
  }
  invalidateResults()
  selected.value = steps.value.length - 1
}

async function duplicateStep(i: number) {
  const step = steps.value[i]
  if (!step) return
  if (isSensitiveStep(step.type) && !(await requestConsent())) {
    toast.warning('已取消：未复制该步骤')
    return
  }
  const res = store.duplicateStep(id.value, i, { consent: currentConsent() })
  if (!res.ok) {
    toast.warning(res.error ?? '复制步骤失败')
    return
  }
  invalidateResults()
  selected.value = i + 1
  toast.success(`已复制「${stepDef(step.type).name}」为第 ${i + 2} 步（密钥不复制，需要重新填写）`)
}

/** 移动步骤会改变上下游关系，旧结果一律作废；选中项跟随被移动的步骤，避免指向另一条 */
function moveStep(i: number, dir: -1 | 1) {
  store.moveStep(id.value, i, dir)
  invalidateResults()
  if (selected.value === i) selected.value = i + dir
  else if (selected.value === i + dir) selected.value = i
}

/** 修改步骤参数会改变计算结果，旧结果一律作废 */
function onConfigChange(key: string, value: StepConfigValue) {
  store.updateStepConfig(id.value, currentStepIndex.value, key, value)
  invalidateResults()
}

function removeStep(i: number) {
  store.removeStep(id.value, i)
  // 删除会改变其后所有步骤的输入：删除点之前的结果仍有效，下游一律作废，避免显示错位的成功
  results.value = results.value.slice(0, i)
  if (selected.value >= i) selected.value = Math.max(-1, selected.value - 1)
}

const SECRET_COMMIT_DELAY = 300

/** 密钥输入草稿：按 `stepId:key` 键控，保证输入即时显示；防抖结束后才写 store */
const secretDrafts = ref<Record<string, string>>({})
interface PendingSecret {
  /** 记录调度时的流程 ID：卸载/导航后仍能按正确的 (workflowId, stepId) 落盘 */
  workflowId: string
  step: WorkflowStep
  key: string
  timer: ReturnType<typeof setTimeout>
}
const pendingSecrets = new Map<string, PendingSecret>()

function secretKey(stepId: string, key: string) {
  return `${stepId}:${key}`
}

/** 密钥字段的显示值：草稿优先，其次已保存值；密钥值绝不写进 config */
function secretValue(stepId: string, key: string): string {
  const k = secretKey(stepId, key)
  if (k in secretDrafts.value) return secretDrafts.value[k] ?? ''
  return store.stepSecrets(id.value, stepId)[key] ?? ''
}

/** 密钥值只经这里写进本地存储，绝不回显、绝不写进 config；每次按键只更新草稿并重置防抖 */
function onSecretInput(step: WorkflowStep, key: string, value: string) {
  const k = secretKey(step.id, key)
  secretDrafts.value = { ...secretDrafts.value, [k]: value }
  const prev = pendingSecrets.get(k)
  if (prev) clearTimeout(prev.timer)
  const workflowId = id.value
  const timer = setTimeout(() => {
    pendingSecrets.delete(k)
    commitSecret(workflowId, step, key)
  }, SECRET_COMMIT_DELAY)
  pendingSecrets.set(k, { workflowId, step, key, timer })
}

/** 失焦立即提交，避免用户输入后马上切走还没落盘 */
function flushSecret(step: WorkflowStep, key: string) {
  const k = secretKey(step.id, key)
  const prev = pendingSecrets.get(k)
  if (prev) {
    clearTimeout(prev.timer)
    pendingSecrets.delete(k)
  }
  if (k in secretDrafts.value) commitSecret(prev?.workflowId ?? id.value, step, key)
}

/** 真正写入本地存储：只有成功才提示一次；失败只 warning，绝不提示成功 */
function commitSecret(workflowId: string, step: WorkflowStep, key: string, notify = true) {
  const k = secretKey(step.id, key)
  if (!(k in secretDrafts.value)) return
  // 流程或步骤可能已被删除：直接丢弃草稿，不要写入不存在的数据，也不要弹无意义的警告。
  // 这里用调度时记录的 workflowId，而不是当前路由的 id，避免导航离开后误判为「步骤不存在」而丢草稿。
  if (!store.get(workflowId)?.steps.some((s) => s.id === step.id)) {
    const dropped = { ...secretDrafts.value }
    delete dropped[k]
    secretDrafts.value = dropped
    return
  }
  const value = secretDrafts.value[k] ?? ''
  const res = store.setStepSecret(workflowId, step.id, key, value)
  if (!res.ok) {
    if (notify) toast.warning(res.error ?? '密钥未保存')
    return
  }
  // 成功后清掉草稿，改为以 store 为唯一真源
  const next = { ...secretDrafts.value }
  delete next[k]
  secretDrafts.value = next
  invalidateResults()
  if (notify) toast.success(value === '' ? '已删除本机保存的密钥' : '密钥已保存到本机浏览器')
}

onUnmounted(() => {
  // 卸载时清掉防抖定时器；把尚未提交的草稿补写一次，避免快速离开丢输入
  const pending = [...pendingSecrets.values()]
  pendingSecrets.clear()
  for (const p of pending) {
    clearTimeout(p.timer)
    commitSecret(p.workflowId, p.step, p.key, false)
  }
})

async function reconfirmStep(step: WorkflowStep) {
  if (!(await requestConsent())) return
  const res = store.confirmStep(id.value, step.id)
  if (!res.ok) {
    toast.warning(res.error ?? '风险确认未保存')
    return
  }
  toast.success('风险确认已更新，现在可以填写密钥了')
}

/** 选中项可以是流程输入（-1）、某一步（0..n-1）或流程输出（n 及以上），越界不再直接取 steps[i] */
const selection = computed(() => normalizeSelection(steps.value.length, selected.value))

const currentNodeTitle = computed(() => {
  const sel = selection.value
  if (sel.kind === 'input') return '流程输入'
  if (sel.kind === 'output') return '流程输出'
  return `第 ${sel.index + 1} / ${steps.value.length} 步`
})

const currentStepIndex = computed(() => (selection.value.kind === 'step' ? selection.value.index : -1))

const currentStep = computed(() => (currentStepIndex.value >= 0 ? (steps.value[currentStepIndex.value] ?? null) : null))

const currentDef = computed(() => (currentStep.value ? stepDef(currentStep.value.type) : null))

const currentResult = computed(() => (currentStepIndex.value >= 0 ? (results.value[currentStepIndex.value] ?? null) : null))

const currentLogs = computed(() => currentResult.value?.logs ?? [])

/** 当前步骤缺哪些必填密钥（只给 label，不给值） */
const currentMissingSecrets = computed(() =>
  currentStep.value ? store.missingSecretsOf(id.value, currentStep.value) : []
)

/** 确认记录可能是旧文案版本或压根没有，两种情况都要求重新确认 */
const currentConsentOk = computed(() => isCurrentConsent(currentStep.value?.consent))

/** 流程输出：每一步都有真实结果且最后一步成功时，才提供可用输出 */
const finalOutput = computed(() => {
  const n = steps.value.length
  if (!n || results.value.filter((r) => !!r).length !== n) return { text: '', ok: false as const }
  const last = results.value[n - 1]
  if (last?.status === 'ok') return { text: last.output, ok: true as const }
  return { text: '', ok: false as const }
})

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
  const current = wf.value
  if (!current) return
  // 走 store 的导出：密钥、私钥、IV、AAD 一律不落进文件
  downloadText(`${current.name || 'workflow'}.json`, store.exportText(id.value), 'application/json')
}

/** 文件名清理：去掉首尾空白与路径分隔符/非法字符，避免下载名带目录或被系统拒绝 */
function sanitizeFilename(name: string): string {
  return name.trim().replace(/[/\\:*?"<>|]/g, '')
}

/**
 * 流程输出文件名：优先最后一个 `download` 步骤配置的 filename（清理后为空则回退），
 * 否则回退 `<流程名>.out.txt`；二进制输出用 `.bin` 后缀。
 */
function outputFilename(binary: boolean): string {
  for (let i = steps.value.length - 1; i >= 0; i--) {
    const step = steps.value[i]
    if (step?.type !== 'download') continue
    const configured = sanitizeFilename(String(step.config.filename ?? ''))
    if (configured) return configured
    break
  }
  const base = wf.value?.name ? `${wf.value.name}.out` : 'workflow-output'
  return `${base}${binary ? '.bin' : '.txt'}`
}

/** 下载流程输出：最后一步是二进制就导出原始字节，否则按文本导出 */
function downloadOutput() {
  if (!finalOutput.value.ok) return
  const payload = results.value[steps.value.length - 1]?.payload
  if (payload?.kind === 'bytes' && payload.bytes) {
    downloadBytes(outputFilename(true), payload.bytes)
    return
  }
  downloadText(outputFilename(false), finalOutput.value.text)
}
</script>

<template>
  <div v-if="wf" class="wfe">
    <div v-if="storageErrorText" class="wfe__alert">
      <DkIcon name="alert-triangle" :size="14" />
      <span>{{ storageErrorText }}</span>
      <span class="tertiary">可在偏好设置里清空本地数据</span>
      <span class="grow"></span>
      <button class="wfe__alert-close" title="关闭提示" aria-label="关闭提示" @click="dismissStorageError">
        <DkIcon name="x" :size="12" />
      </button>
    </div>

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
      <span>运行输入与中间结果仅在本次页面内存中传递，离开即清除</span>
      <span class="tertiary">流程配置会保存到本机浏览器；加解密步骤中的密钥仅在你确认风险后保存到 localStorage</span>
      <span class="grow"></span>
      <DkButton
        size="sm"
        variant="ghost"
        title="导出的步骤只保留算法、方向、编码等参数，密钥、私钥、IV、AAD 不会导出"
        @click="exportJson"
      >
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
        :model-value="input"
        hide-toolbar
        lang="流程输入 · 文本"
        placeholder="粘贴 Base64 / JSON / URL 编码文本，作为第一个步骤的输入"
        height="140px"
        filename="workflow-input.txt"
        @update:model-value="onInputChange"
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
          <button v-for="s in filtered" :key="s.type" class="wfe__lib-item" @click="addWithConsent(s.type)">
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
                <span v-if="isSensitiveStep(s.type)" class="wfe__badge wfe__badge--mini">含密钥</span>
                <span
                  v-if="store.missingSecretsOf(id, s).length"
                  class="wfe__badge wfe__badge--warn wfe__badge--mini"
                >
                  缺少密钥
                </span>
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
              <button class="wfe__node-act" title="复制该步骤（不复制密钥）" @click.stop="duplicateStep(i)">
                <DkIcon name="copy" :size="12" />
              </button>
              <button class="wfe__node-act" title="上移" :disabled="i === 0" @click.stop="moveStep(i, -1)">
                <DkIcon name="chevron-up" :size="12" />
              </button>
              <button
                class="wfe__node-act"
                title="下移"
                :disabled="i === steps.length - 1"
                @click.stop="moveStep(i, 1)"
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
          <span class="tertiary">节点之间的数据只存在于内存，不发送到服务器</span>
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

        <div v-if="currentStep && currentDef" class="wfe__cfg">
          <label class="wfe__field">
            <span class="wfe__field-label">步骤类型</span>
            <input class="wfe__field-input" :value="currentDef.name" readonly aria-label="步骤类型" />
          </label>

          <div v-if="isSensitiveStep(currentStep.type)" class="wfe__risk">
            <div class="wfe__risk-head">
              <span class="wfe__badge wfe__badge--mini">
                <DkIcon name="key" :size="11" />含本地持久化密钥
              </span>
            </div>
            <p class="wfe__risk-text">
              密钥以明文保存在本机浏览器 localStorage，不会发送到服务器；localStorage 不是密钥保险箱。
            </p>
            <div v-if="!currentConsentOk" class="wfe__risk-act">
              <span class="wfe__risk-warn">风险确认已失效，请重新确认后再填写密钥</span>
              <DkButton size="sm" @click="reconfirmStep(currentStep)">重新确认风险</DkButton>
            </div>
            <p v-if="currentMissingSecrets.length" class="wfe__risk-missing">
              缺少密钥：{{ currentMissingSecrets.join('、') }}（填写后自动保存；设置页可单独清空已保存密钥）
            </p>
            <p v-if="currentMissingSecrets.length" class="wfe__risk-hint">{{ MISSING_SECRET_HINT }}</p>
          </div>

          <template v-for="f in currentDef.fields" :key="f.key">
            <DkSecretField
              v-if="f.control === 'secret'"
              :label="f.label"
              :model-value="secretValue(currentStep.id, f.key)"
              :help="f.help"
              :placeholder="f.placeholder"
              :updated-at="store.secretUpdatedAt(id, currentStep.id)"
              :disabled="!currentConsentOk"
              @update:model-value="onSecretInput(currentStep, f.key, $event)"
              @blur="flushSecret(currentStep, f.key)"
            />
            <label v-else-if="f.control === 'switch'" class="wfe__switch">
              <DkSwitch
                :on="!!currentStep.config[f.key]"
                :label="f.label"
                @toggle="onConfigChange(f.key, !currentStep.config[f.key])"
              />
              <span>{{ f.label }}</span>
            </label>
            <label v-else-if="f.control === 'select'" class="wfe__field">
              <span class="wfe__field-label">{{ f.label }}</span>
              <DkSelect
                :model-value="String(currentStep.config[f.key] ?? f.default ?? '')"
                :options="f.options ?? []"
                :aria-label="f.label"
                @update:model-value="onConfigChange(f.key, $event)"
              />
              <span v-if="f.help" class="wfe__field-help">{{ f.help }}</span>
            </label>
            <label v-else-if="f.control === 'textarea'" class="wfe__field">
              <span class="wfe__field-label">{{ f.label }}</span>
              <textarea
                class="wfe__field-input mono wfe__field-area"
                :value="String(currentStep.config[f.key] ?? '')"
                :placeholder="f.placeholder"
                :aria-label="f.label"
                rows="4"
                @input="onConfigChange(f.key, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
              <span v-if="f.help" class="wfe__field-help">{{ f.help }}</span>
            </label>
            <label v-else class="wfe__field">
              <span class="wfe__field-label">{{ f.label }}</span>
              <input
                class="wfe__field-input mono"
                :value="String(currentStep.config[f.key] ?? '')"
                :placeholder="f.placeholder"
                :aria-label="f.label"
                @input="onConfigChange(f.key, ($event.target as HTMLInputElement).value)"
              />
              <span v-if="f.help" class="wfe__field-help">{{ f.help }}</span>
            </label>
          </template>

          <label class="wfe__switch">
            <DkSwitch :on="stopOnError" label="失败时中断流程" @toggle="stopOnError = !stopOnError" />
            <span>失败时中断流程</span>
          </label>
        </div>
        <div v-else-if="selection.kind === 'output'" class="wfe__cfg">
          <p class="wfe__hint">
            这是「流程输出」。{{ finalOutput.ok ? '最后一步已成功，可以直接复制或下载完整结果。' : '所有步骤都成功后才会有输出。' }}
          </p>
          <div class="wfe__out">
            <span class="wfe__badge wfe__badge--soft">{{ finalOutput.ok ? sizeText(finalOutput.text) : '暂无输出' }}</span>
            <span class="grow"></span>
            <DkButton size="sm" variant="ghost" :disabled="!finalOutput.ok" @click="clipboard.copy(finalOutput.text, '流程输出')">
              <DkIcon name="copy" :size="12" />复制
            </DkButton>
            <DkButton
              size="sm"
              variant="ghost"
              :disabled="!finalOutput.ok"
              @click="downloadOutput"
            >
              <DkIcon name="download" :size="12" />下载
            </DkButton>
          </div>
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
            v-if="currentResult?.outputKind === 'bytes'"
            class="wfe__badge wfe__badge--mini"
            :title="payloadKindLabel.bytes"
          >
            二进制结果（界面按 Hex 展示）
          </span>
          <span
            v-if="currentResult"
            class="wfe__badge"
            :class="currentResult.status === 'ok' ? 'wfe__badge--ok' : 'wfe__badge--err'"
          >
            {{ currentResult.status === 'ok' ? '成功' : '失败' }}
          </span>
        </div>
        <div class="wfe__console mono">
          <p v-if="!currentLogs.length" class="wfe__empty">
            {{ selection.kind === 'step' ? '还没有这一步的运行日志。点击「单步运行」或「运行全部」后，这里会打印真实的执行过程。' : '选中一个步骤后，这里会显示它的执行日志。' }}
          </p>
          <p v-for="(l, i) in currentLogs" :key="i" class="wfe__log">{{ l }}</p>
        </div>
        <div class="wfe__stat">
          <span v-if="currentResult">{{ sizeText(currentResult.output) }} 输出 · {{ currentResult.ms }} ms</span>
          <span v-else-if="selection.kind === 'output'">{{ finalOutput.ok ? sizeText(finalOutput.text) + ' 可用输出' : '未生成结果' }}</span>
          <span v-else>未生成结果</span>
          <span class="grow"></span>
          <span v-if="currentResult?.status === 'ok'" class="wfe__badge wfe__badge--ok wfe__badge--mini">
            <DkIcon name="circle-check" :size="11" />步骤成功
          </span>
        </div>

        <div class="wfe__cur-foot">
          <DkButton size="sm" :disabled="currentStepIndex < 0 || busy" @click="runSelected">
            <DkIcon name="refresh-cw" :size="13" />重试此步
          </DkButton>
          <DkButton
            size="sm"
            variant="ghost"
            :disabled="selected <= 0"
            @click="selected = Math.max(-1, selected - 1)"
          >
            <DkIcon name="chevron-left" :size="12" />查看上一步
          </DkButton>
          <DkButton
            size="sm"
            variant="ghost"
            :disabled="currentStepIndex < 0 || !currentResult"
            @click="clipboard.copy(currentResult?.output ?? '', '该步输出')"
          >
            <DkIcon name="copy" :size="12" />复制输出
          </DkButton>
        </div>
      </section>
    </div>
  </div>

  <div v-else class="wfe__missing">
    <DkIcon name="workflow" :size="22" />
    <template v-if="notFound">
      <p class="wfe__missing-text">找不到这条流程：它可能已被删除，或保存在另一个浏览器配置里。</p>
      <NuxtLink to="/workflows" class="wfe__back">
        <DkIcon name="chevron-left" :size="13" />返回流程列表
      </NuxtLink>
    </template>
    <p v-else class="wfe__missing-text">正在读取本机保存的流程…</p>
  </div>

  <DkRiskConsent
    :open="consentOpen"
    title="添加含密钥的步骤"
    @confirm="acceptConsent"
    @cancel="cancelConsent"
  />
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
.wfe__out {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
.wfe__alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--warn);
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--text-primary);
  font-size: 12px;
  flex-wrap: wrap;
}
.wfe__alert-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.wfe__alert-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.wfe__badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.wfe__risk {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--warn);
  border-radius: 8px;
  background: var(--warn-soft);
}
.wfe__risk-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wfe__risk-text {
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.wfe__risk-act {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wfe__risk-warn {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--error);
}
.wfe__risk-missing {
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--error);
}
.wfe__risk-hint {
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
.wfe__field-help {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
/* textarea 沿用输入框的边框与配色，只把固定高度改成可伸展 */
.wfe__field-area {
  height: auto;
  min-height: 64px;
  padding: 7px 10px;
  line-height: 1.7;
  resize: vertical;
}
.wfe__missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 320px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text-tertiary);
  text-align: center;
}
.wfe__missing-text {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-secondary);
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
