<script setup lang="ts">
import { presetNeedsSecret, stepDef, runWorkflow, type WorkflowPreset } from '~/utils/workflow'
import { CONSENT_NOTICE_VERSION } from '~/workflow/secrets'

useSeo({
  title: '在线处理流程编排 - 免登录 · DevKit',
  description:
    '把 Base64、JSON 格式化、JSONPath 提取、JSON Schema 校验等本地工具串成一条流水线，逐步查看每一步输出。运行数据只在浏览器内存中传递，不上传、不保存输入；流程配置保存在本机浏览器。'
})

const store = useWorkflows()
const router = useRouter()
const toast = useToast()

const creating = ref(false)
const newName = ref('')
const newDesc = ref('')
const importing = ref(false)
const importText = ref('')
const importError = ref('')
const running = ref<string | null>(null)
const sampleInput = ref('')

const wfs = computed(() => store.workflows.value)
const stepLibrary = store.stepLibrary

const { open: consentOpen, request: requestConsent, accept: acceptConsent, cancel: cancelConsent } =
  useSecretConsent()

/** 确认记录只对刚确认过的那一次有效，所以每次添加都现造一个 */
const currentConsent = () => ({
  accepted: true as const,
  acceptedAt: Date.now(),
  noticeVersion: CONSENT_NOTICE_VERSION
})

function presetChain(preset: WorkflowPreset): string[] {
  return preset.steps.map((s) => stepDef(s.type).name)
}

/** 含密钥的预设必须先取得风险确认，被拒就什么都不加 */
async function addPresetFlow(preset: WorkflowPreset) {
  if (presetNeedsSecret(preset) && !(await requestConsent())) {
    toast.warning('已取消：未添加含密钥的预设')
    return
  }
  try {
    const wf = store.addPreset(preset.key, { consent: currentConsent() })
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    toast.warning(errMessage(e))
  }
}

function open(id: string) {
  router.push(`/workflows/${id}`)
}

function create() {
  const wf = store.create(newName.value, newDesc.value)
  creating.value = false
  newName.value = ''
  newDesc.value = ''
  router.push(`/workflows/${wf.id}`)
}

async function doImport() {
  importError.value = ''
  let needsConsent = false
  try {
    needsConsent = store.inspectImport(importText.value).secretTypes.length > 0
  } catch (e) {
    importError.value = errMessage(e)
    return
  }
  // 含密钥的流程先确认风险；被拒时整体不导入，不留半条流程
  if (needsConsent && !(await requestConsent())) {
    toast.warning('已取消导入：该流程包含密钥步骤')
    return
  }
  try {
    const wf = store.importWorkflow(importText.value, { consent: currentConsent() })
    importing.value = false
    importText.value = ''
    router.push(`/workflows/${wf.id}`)
  } catch (e) {
    importError.value = errMessage(e)
  }
}

function remove(id: string, name: string) {
  store.remove(id)
  toast.success(`已删除「${name}」`)
}

/** 用一段示例输入把整条流程跑一遍，并把真实结果记入运行记录 */
async function quickRun(id: string) {
  const wf = store.get(id)
  if (!wf) return
  if (!wf.steps.length) {
    toast.warning('这条流程还没有步骤，先进入编排页添加')
    return
  }
  running.value = id
  try {
    const input = sampleInput.value.trim() || lastRunInput(wf.steps.map((s) => s.type))
    const res = await runWorkflow(wf, input, {
      stopOnError: true,
      secretOf: (s) => store.stepSecrets(wf.id, s.id)
    })
    store.addRun({
      workflowId: wf.id,
      name: wf.name,
      summary: wf.steps.map((s) => stepDef(s.type).name).join(' → '),
      status: res.status,
      ms: res.ms
    })
    if (res.status === 'ok') toast.success(`「${wf.name}」运行完成，耗时 ${res.ms} ms`)
    else toast.warning(`「${wf.name}」运行中断：${res.results.find((r) => r.status === 'fail')?.note ?? '步骤失败'}`)
  } catch (e) {
    toast.warning(errMessage(e))
  } finally {
    running.value = null
  }
}

/** 示例输入按流程首步类型给，避免与真实数据混淆 */
function lastRunInput(types: string[]): string {
  const first = types[0]
  if (first === 'base64-decode') {
    return btoa(JSON.stringify({ order: { id: 'o-1001', total: 199.0, items: [{ sku: 'A-1', qty: 2 }] } }))
  }
  if (first === 'url-decode') return encodeURIComponent('{"code":1,"items":[{"sku":"A-1"}]}')
  return '{"store":{"book":[{"title":"示例书","price":59}]}}'
}

const recentRuns = computed(() => store.runs.value.slice(0, 8))

function stepChain(wfId: string) {
  const wf = store.get(wfId)
  return (wf?.steps ?? []).map((s) => ({ name: stepDef(s.type).name }))
}

function lastRunOf(id: string) {
  return store.runsOf(id)[0]
}
</script>

<template>
  <div class="wf">
    <header class="wf__head">
      <span class="wf__head-icon">
        <DkIcon name="workflow" :size="17" />
      </span>
      <div class="wf__head-text">
        <h1 class="wf__title">处理流程</h1>
        <p class="wf__desc">把多个本地工具串成一条流水线，数据只在本次页面内存中传递</p>
      </div>
      <span class="grow"></span>
      <span class="wf__badge">
        <DkIcon name="shield-check" :size="13" />本地处理 · 输入不上传
      </span>
    </header>

    <div class="wf__ops">
      <span class="wf__ops-count">{{ wfs.length }} 个流程 · 全部在浏览器内执行</span>
      <span class="wf__badge wf__badge--soft">
        <DkIcon name="circle-check" :size="12" />输入不落盘
      </span>
      <span class="grow"></span>
      <DkButton size="sm" @click="importing = true">
        <DkIcon name="upload" :size="12" />导入流程
      </DkButton>
      <DkButton size="sm" variant="primary" @click="creating = true">
        <DkIcon name="plus" :size="12" />新建处理流程
      </DkButton>
    </div>

    <section class="wf__presets">
      <div class="wf__presets-head">
        <DkIcon name="package" :size="14" />
        <h2 class="wf__presets-title">预设流程</h2>
        <span class="tertiary">点一下就能加进我的流程，含密钥的预设会先弹出风险确认</span>
      </div>
      <div class="wf__preset-grid">
        <article v-for="p in store.presets" :key="p.key" class="wf__preset">
          <div class="wf__preset-head">
            <span class="wf__preset-name">{{ p.name }}</span>
            <span v-if="presetNeedsSecret(p)" class="wf__badge wf__badge--warn">含密钥</span>
            <span class="grow"></span>
            <DkButton size="sm" @click="addPresetFlow(p)">
              <DkIcon name="plus" :size="12" />添加
            </DkButton>
          </div>
          <p class="wf__preset-desc">{{ p.desc }}</p>
          <div class="wf__chain">
            <template v-for="(s, i) in presetChain(p)" :key="`${p.key}-${i}`">
              <span class="wf__step">
                <span class="wf__step-idx">{{ i + 1 }}</span>
                <span class="ellipsis">{{ s }}</span>
              </span>
              <span v-if="i < presetChain(p).length - 1" class="wf__arrow">
                <DkIcon name="chevron-right" :size="11" />
              </span>
            </template>
          </div>
          <p v-if="p.secretHint" class="wf__preset-hint">
            <DkIcon name="key" :size="12" />{{ p.secretHint }}
          </p>
        </article>
      </div>
    </section>

    <section class="wf__cards">
      <article v-for="wf in wfs" :key="wf.id" class="wf__card">
        <div class="wf__card-head">
          <span class="wf__card-icon">
            <DkIcon name="workflow" :size="16" />
          </span>
          <span class="wf__card-name">{{ wf.name }}</span>
          <span class="wf__badge wf__badge--soft">{{ wf.steps.length }} 步</span>
          <span class="grow"></span>
          <DkIconButton title="删除流程" @click="remove(wf.id, wf.name)">
            <DkIcon name="trash" :size="14" />
          </DkIconButton>
        </div>
        <p class="wf__card-desc">{{ wf.desc || '还没有填写说明' }}</p>
        <div class="wf__chain">
          <template v-for="(s, i) in stepChain(wf.id)" :key="`${wf.id}-${i}`">
            <span class="wf__step">
              <span class="wf__step-idx">{{ i + 1 }}</span>
              <span class="ellipsis">{{ s.name }}</span>
            </span>
            <span v-if="i < stepChain(wf.id).length - 1" class="wf__arrow">
              <DkIcon name="chevron-right" :size="11" />
            </span>
          </template>
          <span v-if="!wf.steps.length" class="tertiary">还没有步骤，进入编排页从「步骤库」添加。</span>
        </div>
        <div class="wf__card-foot">
          <span v-if="lastRunOf(wf.id)" class="wf__run-info">
            <DkIcon name="history" :size="12" />
            {{ fmtAgo(lastRunOf(wf.id)!.at) }} · {{ lastRunOf(wf.id)!.status === 'ok' ? '成功' : '失败' }} ·
            {{ lastRunOf(wf.id)!.ms }} ms
          </span>
          <span v-else class="tertiary">尚未运行</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" :loading="running === wf.id" @click="quickRun(wf.id)">
            <DkIcon name="play" :size="12" />运行
          </DkButton>
          <DkButton size="sm" @click="open(wf.id)">
            <DkIcon name="arrow-right" :size="12" />编排
          </DkButton>
        </div>
      </article>
    </section>

    <section class="wf__runs">
      <div class="wf__runs-head">
        <DkIcon name="history" :size="14" />
        <h2 class="wf__runs-title">最近运行</h2>
        <span class="tertiary">记录只保存状态、耗时与步骤摘要，不含输入与输出；保存在本机浏览器</span>
        <span class="grow"></span>
        <DkButton size="sm" variant="ghost" :disabled="!store.runs.value.length" @click="store.clearRuns()">
          <DkIcon name="trash" :size="12" />清空记录
        </DkButton>
      </div>
      <p v-if="!recentRuns.length" class="wf__empty">
        还没有运行记录。点击任意流程的「运行」，或在编排页逐步执行后，这里会显示真实的运行结果与耗时。
      </p>
      <div v-else class="wf__run-list">
        <div v-for="r in recentRuns" :key="r.id" class="wf__run">
          <DkIcon :name="r.status === 'ok' ? 'circle-check' : 'circle-x'" :size="14" />
          <div class="wf__run-body">
            <span class="wf__run-name">{{ r.name }}</span>
            <span class="wf__run-sum mono">{{ r.summary }}</span>
          </div>
          <span class="wf__badge" :class="r.status === 'ok' ? 'wf__badge--ok' : 'wf__badge--err'">
            {{ r.status === 'ok' ? '成功' : '失败' }}
          </span>
          <span class="wf__run-col mono">{{ r.ms }} ms</span>
          <span class="wf__run-col">{{ fmtAgo(r.at) }}</span>
        </div>
      </div>
      <p class="wf__runs-foot">
        共 {{ store.runs.value.length }} 次运行 · 记录只保存状态、耗时与步骤摘要，不含输入与输出；保存在本机浏览器
      </p>
    </section>

    <section class="wf__privacy">
      <span class="wf__privacy-icon">
        <DkIcon name="shield-check" :size="16" />
      </span>
      <div class="wf__privacy-text">
        <p class="wf__privacy-title">运行数据只在内存中，流程配置在本机</p>
        <p class="wf__privacy-desc">
          运行输入和中间结果仅在本次页面内存中传递，不发送到服务器。流程配置会保存到本机浏览器；加解密步骤中的密钥仅在你确认风险后保存到 localStorage。
        </p>
      </div>
      <span class="grow"></span>
      <span class="wf__badge wf__badge--soft">输入不落盘</span>
      <span class="wf__badge wf__badge--soft">不上传</span>
      <span class="wf__badge wf__badge--soft">密钥明文保存在本机</span>
      <NuxtLink to="/settings" class="wf__privacy-link">
        <DkIcon name="sliders" :size="12" />数据清理入口
      </NuxtLink>
    </section>

    <DkModal :open="creating" title="新建处理流程" width="440px" @close="creating = false">
      <div class="wf__form">
        <DkField label="流程名称">
          <DkInput v-model="newName" placeholder="例如：接口响应校验" />
        </DkField>
        <DkField label="说明">
          <DkInput v-model="newDesc" placeholder="这条流程解决什么问题（可留空）" />
        </DkField>
        <p class="wf__hint tertiary">新建后进入编排页，从「步骤库」把工具加进来即可。</p>
      </div>
      <template #footer>
        <DkButton size="sm" @click="creating = false">取消</DkButton>
        <DkButton size="sm" variant="primary" @click="create">创建</DkButton>
      </template>
    </DkModal>

    <DkModal :open="importing" title="导入处理流程" width="520px" @close="importing = false">
      <div class="wf__form">
        <DkField label="流程 JSON">
          <textarea
            v-model="importText"
            class="wf__textarea mono"
            rows="8"
            placeholder='{"name":"我的流程","desc":"","steps":[{"type":"json-format","config":{"indent":"2"}}]}'
          ></textarea>
        </DkField>
        <p v-if="importError" class="wf__error">{{ importError }}</p>
        <p class="wf__hint tertiary">
          只接受结构正确的 JSON；步骤类型必须是步骤库里的 {{ stepLibrary.length }} 种之一，出现不支持的步骤会整体拒绝导入。
        </p>
        <p class="wf__hint tertiary">导入含密钥的步骤时不会带入任何密钥，需要重新填写。</p>
      </div>
      <template #footer>
        <DkButton size="sm" @click="importing = false">取消</DkButton>
        <DkButton size="sm" variant="primary" @click="doImport">导入</DkButton>
      </template>
    </DkModal>

    <DkRiskConsent
      :open="consentOpen"
      title="添加含密钥的流程"
      @confirm="acceptConsent"
      @cancel="cancelConsent"
    />
  </div>
</template>

<style scoped>
.wf {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1680px;
  margin: 0 auto;
}
.wf__head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
}
.wf__head-icon {
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
.wf__head-text {
  min-width: 0;
}
.wf__title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}
.wf__desc {
  font-size: 12px;
  color: var(--text-secondary);
}
.wf__badge {
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
.wf__badge--soft {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.wf__badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.wf__badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11.5px;
  height: 21px;
}
.wf__badge--err {
  background: var(--error-soft);
  color: var(--error);
  font-size: 11.5px;
  height: 21px;
}
.wf__ops {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.wf__ops-count {
  font-size: 13px;
  color: var(--text-secondary);
}
.wf__presets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wf__presets-head {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 窄屏时让说明整行换下去，标题不会被挤成两行 */
  flex-wrap: wrap;
}
.wf__presets-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.wf__preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}
.wf__preset {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  min-width: 0;
}
.wf__preset-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.wf__preset-name {
  font-size: 14.5px;
  font-weight: 600;
}
.wf__preset-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.wf__preset-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.wf__privacy-link {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--surface-subtle);
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
}
.wf__privacy-link:hover {
  text-decoration: none;
}
.wf__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}
.wf__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  min-width: 0;
}
.wf__card-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.wf__card-icon {
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
.wf__card-name {
  font-size: 14.5px;
  font-weight: 600;
}
.wf__card-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.wf__chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-subtle);
  min-height: 44px;
}
.wf__step {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  font-size: 12.5px;
  color: var(--text-primary);
  min-width: 0;
}
.wf__step-idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--surface);
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}
.wf__arrow {
  display: flex;
  color: var(--border-strong);
  padding-left: 6px;
  height: 10px;
  align-items: center;
}
.wf__card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.wf__run-info {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.wf__runs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.wf__runs-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wf__runs-title {
  font-size: 14px;
  font-weight: 600;
}
.wf__empty {
  padding: 8px 0;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.wf__run-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.wf__run {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}
.wf__run:last-child {
  border-bottom: none;
}
.wf__run-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.wf__run-name {
  font-weight: 500;
}
.wf__run-sum {
  font-size: 11.5px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf__run-col {
  font-size: 11.5px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  min-width: 56px;
  text-align: right;
}
.wf__runs-foot {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.wf__privacy {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  flex-wrap: wrap;
}
.wf__privacy-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--ok-soft);
  color: var(--ok);
  flex-shrink: 0;
}
.wf__privacy-text {
  min-width: 240px;
  flex: 1;
}
.wf__privacy-title {
  font-size: 13px;
  font-weight: 600;
}
.wf__privacy-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.wf__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wf__textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--editor-bg);
  font-size: var(--code-font-size);
  line-height: 1.6;
  color: var(--text-primary);
  resize: vertical;
}
.wf__error {
  font-size: 12px;
  color: var(--error);
}
.wf__hint {
  font-size: 11.5px;
  line-height: 1.6;
}
@media (max-width: 720px) {
  .wf__head {
    flex-wrap: wrap;
  }
  .wf__cards,
  .wf__preset-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
