<script setup lang="ts">
useSeo({
  title: '偏好设置 · DevKit',
  description: 'DevKit 偏好设置：主题、代码字号、缩进、自动换行、动效与匿名访问统计开关，偏好只保存在当前浏览器。',
  noindex: true
})

const { prefs, update, reset } = usePrefs()
const fav = useFavorites()
const recent = useRecent()
const toast = useToast()

const runtime = useRuntimeConfig()
const analyticsOn = computed(
  () => Boolean(runtime.public.analytics.provider) && Boolean(runtime.public.analytics.siteId)
)

const clearOpen = ref(false)
const secretClearOpen = ref(false)
const wfClearOpen = ref(false)
const scope = reactive({ prefs: true, favorites: true, recent: true })

const workflowStore = useWorkflows()

const scopeCount = computed(
  () => Number(scope.prefs) + Number(scope.favorites) + Number(scope.recent)
)

const favDesc = computed(() => {
  const n = fav.entries.value.length
  if (!n) return '暂无收藏的工具标识'
  const missing = fav.entries.value.filter((e) => !e.at).length
  return missing
    ? `${n} 个收藏的工具标识与收藏时间（其中 ${missing} 条为旧版记录，没有时间）`
    : `${n} 个收藏的工具标识与收藏时间`
})

const recentDesc = computed(() => {
  const n = recent.entries.value.length
  return n ? `${n} 条工具名称与访问时间` : '暂无访问记录'
})

function openClear() {
  scope.prefs = true
  scope.favorites = true
  scope.recent = true
  clearOpen.value = true
}

function doClear() {
  if (scope.prefs) reset()
  if (scope.favorites) fav.clear()
  if (scope.recent) recent.clear()
  const parts: string[] = []
  if (scope.prefs) parts.push('偏好设置')
  if (scope.favorites) parts.push('收藏')
  if (scope.recent) parts.push('访问记录')
  toast.success(`已清除${parts.join('、')}`)
  clearOpen.value = false
}

function doReset() {
  reset()
  toast.success('偏好设置已恢复为默认值')
}

/** 只清密钥：步骤保留，重新填写即可继续跑 */
function doClearSecrets() {
  const res = workflowStore.clearSecrets()
  secretClearOpen.value = false
  if (res.ok) toast.success('已清空本机保存的密钥；相关步骤会显示「缺少密钥」，重新填写即可')
  else toast.warning(res.error ?? '清空已保存密钥失败')
}

function doClearWorkflows() {
  const res = workflowStore.clearAll()
  wfClearOpen.value = false
  if (res.ok) toast.success('已清空本机保存的流程与运行记录')
  else toast.warning(res.error ?? '清空流程与运行记录失败')
}
</script>

<template>
  <div class="settings">
    <header class="settings__head">
      <div class="settings__title">
        <span class="settings__icon"><DkIcon name="sliders" :size="17" /></span>
        <div>
          <h1 class="settings__name">偏好设置</h1>
          <p class="settings__desc">偏好只保存在当前浏览器本地；工具输入与 Token 不会被保存，处理流程的密钥仅在确认风险后明文保存到本机浏览器。</p>
        </div>
      </div>
      <NuxtLink to="/privacy" class="settings__local" title="了解本地处理与隐私">
        <DkIcon name="shield-check" :size="13" />
        本地处理
      </NuxtLink>
    </header>

    <section class="panel">
      <div class="panel__head">
        <span class="panel__title">偏好设置</span>
        <span class="grow"></span>
        <span class="panel__hint">偏好保存在此浏览器 · 修改即写入本地</span>
      </div>

      <div class="panel__body">
        <div class="panel__col">
          <section class="group">
            <div class="group__head"><DkIcon name="palette" :size="14" /><span>外观</span></div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">主题</span>
                <span class="row__desc">浅色、深色或跟随系统；切换后立即生效并写入本地偏好。</span>
              </div>
              <DkSegmented
                label="主题"
                :model-value="prefs.theme"
                :options="[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' }
                ]"
                @update:model-value="update({ theme: $event as any })"
              />
            </div>
          </section>

          <section class="group">
            <div class="group__head"><DkIcon name="file-code" :size="14" /><span>编辑器</span></div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">代码字号</span>
                <span class="row__desc">只影响输入与结果区的代码文字，界面与正文文字不变。</span>
              </div>
              <DkSegmented
                label="代码字号"
                :model-value="String(prefs.codeFontSize)"
                :options="[
                  { value: '12', label: '12 px' },
                  { value: '13', label: '13 px' },
                  { value: '14', label: '14 px' }
                ]"
                @update:model-value="update({ codeFontSize: Number($event) })"
              />
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">默认缩进</span>
                <span class="row__desc">JSON、HTML、CSS 等格式化工具的默认缩进方式。</span>
              </div>
              <DkSegmented
                label="默认缩进"
                :model-value="prefs.defaultIndent"
                :options="[
                  { value: '2', label: '2 空格' },
                  { value: '4', label: '4 空格' },
                  { value: 'tab', label: 'Tab' }
                ]"
                @update:model-value="update({ defaultIndent: $event as any })"
              />
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">编辑器自动换行</span>
                <span class="row__desc">关闭时长行横向滚动，不裁剪内容；开启后按面板宽度折行。</span>
              </div>
              <DkSwitch
                :on="prefs.editorWrap"
                label="编辑器自动换行"
                @toggle="update({ editorWrap: !prefs.editorWrap })"
              />
            </div>
          </section>
        </div>

        <div class="panel__col">
          <section class="group">
            <div class="group__head"><DkIcon name="zap" :size="14" /><span>动效与记录</span></div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">减少动画</span>
                <span class="row__desc">关闭过渡与进度动画，保留状态文字与颜色提示。</span>
              </div>
              <DkSwitch
                :on="prefs.reduceMotion"
                label="减少动画"
                @toggle="update({ reduceMotion: !prefs.reduceMotion })"
              />
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">记录最近使用</span>
                <span class="row__desc">只记录工具名称与访问时间，不记录输入内容。</span>
              </div>
              <DkSwitch
                :on="prefs.recordRecent"
                label="记录最近使用"
                @toggle="update({ recordRecent: !prefs.recordRecent })"
              />
            </div>
            <div v-if="analyticsOn" class="row">
              <div class="row__info">
                <span class="row__title">匿名访问统计</span>
                <span class="row__desc">
                  只让统计脚本知道访问了哪个页面与来源，用于统计 PV 与各页面使用情况；不含输入、密钥、Token 与文件内容。关闭后不再加载统计脚本。
                </span>
              </div>
              <DkSwitch
                :on="prefs.analytics"
                label="匿名访问统计"
                @toggle="update({ analytics: !prefs.analytics })"
              />
            </div>
          </section>

          <section class="group">
            <div class="group__head"><DkIcon name="trash" :size="14" /><span>本地数据</span></div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">重置偏好</span>
                <span class="row__desc">恢复默认主题、字号、缩进、自动换行、动效与统计开关设置；不影响收藏与访问记录。</span>
              </div>
              <DkButton size="sm" title="重置偏好" @click="doReset">
                <DkIcon name="refresh" :size="13" />重置
              </DkButton>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">清除本地数据</span>
                <span class="row__desc">可选择清除偏好、收藏与访问记录；输入内容从不保存，处理流程数据见下方「处理流程数据」。</span>
              </div>
              <DkButton size="sm" title="选择清除范围" @click="openClear">
                <DkIcon name="alert-triangle" :size="13" style="color: var(--error)" />
                <span style="color: var(--error)">选择清除范围…</span>
              </DkButton>
            </div>
          </section>

          <section class="group">
            <div class="group__head"><DkIcon name="workflow" :size="14" /><span>处理流程数据</span></div>
            <div class="row">
              <div class="row__info">
                <span class="row__title mono">devkit-workflows-v2</span>
                <span class="row__desc">处理流程：名称、说明、步骤顺序与非敏感参数（缩进、算法、方向、编码）。</span>
              </div>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title mono">devkit-workflow-secrets-v1</span>
                <span class="row__desc">
                  加解密步骤的密钥、私钥、IV 与 AAD，明文保存；localStorage 不是密钥保险箱，同源脚本、浏览器扩展与调试工具都可能读到。
                </span>
              </div>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title mono">devkit-workflow-runs-v1</span>
                <span class="row__desc">运行记录：状态、耗时与步骤摘要，不含输入与输出。</span>
              </div>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">流程输入与中间结果</span>
                <span class="row__desc">从未写入本地存储，无需清理。</span>
              </div>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">清空已保存密钥</span>
                <span class="row__desc">删除本机保存的全部流程密钥；步骤会保留，但需要重新填写密钥。</span>
              </div>
              <DkButton size="sm" title="清空已保存密钥" @click="secretClearOpen = true">
                <DkIcon name="key" :size="13" style="color: var(--error)" />
                <span style="color: var(--error)">清空密钥…</span>
              </DkButton>
            </div>
            <div class="row">
              <div class="row__info">
                <span class="row__title">清空全部流程与运行记录</span>
                <span class="row__desc">删除本机保存的全部处理流程、它们对应的密钥与运行记录，清除后无法恢复。</span>
              </div>
              <DkButton size="sm" title="清空全部流程与运行记录" @click="wfClearOpen = true">
                <DkIcon name="trash" :size="13" style="color: var(--error)" />
                <span style="color: var(--error)">清空全部…</span>
              </DkButton>
            </div>
            <div v-if="workflowStore.storageError.value" class="row">
              <div class="row__info">
                <span class="row__title" style="color: var(--error)">本地存储异常</span>
                <span class="row__desc">{{ workflowStore.storageError.value }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="panel__status">
        <span class="mono">偏好 · 本地存储</span>
        <span class="grow"></span>
        <span class="mono">未登录 · 不需要账号</span>
      </div>
    </section>

    <div class="notes">
      <section class="notes__col">
        <h2 class="notes__head"><DkIcon name="info" :size="14" />使用说明</h2>
        <div class="step">
          <span class="step__no">1</span>
          <div>
            <p class="step__title">修改即生效并本地保存</p>
            <p class="notes__text">主题、字号、缩进等改动立即生效，只写入当前浏览器。</p>
          </div>
        </div>
        <div class="step">
          <span class="step__no">2</span>
          <div>
            <p class="step__title">需要时随时清理</p>
            <p class="notes__text">重置偏好只恢复默认值；清除本地数据可选择清除范围。</p>
          </div>
        </div>
      </section>

      <section class="notes__col">
        <h2 class="notes__head"><DkIcon name="help" :size="14" />常见问题</h2>
        <div class="qa">
          <p class="qa__q">偏好会同步到其他设备吗？</p>
          <p class="notes__text">不会。偏好只保存在当前浏览器，网站不提供账号与云端同步。</p>
        </div>
        <div class="qa">
          <p class="qa__q">清除本地数据会删除输入内容吗？</p>
          <p class="notes__text">
            不会，因为输入内容从不保存；清除范围只有偏好、收藏与访问记录。处理流程的密钥可在下方「处理流程数据」里清空。
          </p>
        </div>
      </section>
    </div>

    <DkModal :open="clearOpen" title="清除本地数据" :danger="true" width="540px" @close="clearOpen = false">
      <p class="clear__lead">将清除以下保存在当前浏览器中的数据，清除后无法恢复：</p>

      <div class="clear__item">
        <DkIcon name="alert-circle" :size="14" style="color: var(--error)" />
        <span class="clear__text">
          <span class="clear__title">偏好设置</span>
          <span class="clear__desc">主题、代码字号、自动换行、默认缩进、减少动画</span>
        </span>
        <DkCheckbox v-model="scope.prefs" aria-label="清除偏好设置" />
      </div>

      <div class="clear__item">
        <DkIcon name="alert-circle" :size="14" style="color: var(--error)" />
        <span class="clear__text">
          <span class="clear__title">我的收藏</span>
          <span class="clear__desc">{{ favDesc }}</span>
        </span>
        <DkCheckbox v-model="scope.favorites" aria-label="清除我的收藏" />
      </div>

      <div class="clear__item">
        <DkIcon name="alert-circle" :size="14" style="color: var(--error)" />
        <span class="clear__text">
          <span class="clear__title">最近使用</span>
          <span class="clear__desc">{{ recentDesc }}</span>
        </span>
        <DkCheckbox v-model="scope.recent" aria-label="清除最近使用" />
      </div>

      <div class="clear__tip">
        <DkIcon name="alert-triangle" :size="14" style="color: var(--warn)" />
        <span>输入内容与 Token 从不保存，因此不在清除范围内；处理流程的密钥请在下方「处理流程数据」中清空。</span>
      </div>

      <template #footer>
        <DkButton size="sm" @click="clearOpen = false"><DkIcon name="x" :size="13" />取消</DkButton>
        <DkButton size="sm" variant="danger" :disabled="scopeCount === 0" @click="doClear">
          <DkIcon name="check" :size="13" />确认清除
        </DkButton>
      </template>
    </DkModal>

    <DkModal
      :open="secretClearOpen"
      title="清空已保存密钥"
      :danger="true"
      width="520px"
      @close="secretClearOpen = false"
    >
      <p class="clear__lead">将删除本机保存的全部处理流程密钥（密钥、私钥、IV 与 AAD，均为明文），清除后无法恢复。</p>
      <div class="clear__tip">
        <DkIcon name="alert-triangle" :size="14" style="color: var(--warn)" />
        <span>流程与步骤会保留，但需要重新填写密钥；相关步骤会显示「缺少密钥」。流程输入与中间结果从未写入本地存储，不受影响。</span>
      </div>
      <template #footer>
        <DkButton size="sm" @click="secretClearOpen = false"><DkIcon name="x" :size="13" />取消</DkButton>
        <DkButton size="sm" variant="danger" @click="doClearSecrets">
          <DkIcon name="check" :size="13" />确认清空密钥
        </DkButton>
      </template>
    </DkModal>

    <DkModal
      :open="wfClearOpen"
      title="清空全部流程与运行记录"
      :danger="true"
      width="520px"
      @close="wfClearOpen = false"
    >
      <p class="clear__lead">将删除本机保存的全部处理流程、它们对应的密钥与全部运行记录，清除后无法恢复。</p>
      <div class="clear__tip">
        <DkIcon name="alert-triangle" :size="14" style="color: var(--warn)" />
        <span>删除后需要重新从「预设流程」或「新建处理流程」开始搭建；流程输入与中间结果从未写入本地存储，不受影响。</span>
      </div>
      <template #footer>
        <DkButton size="sm" @click="wfClearOpen = false"><DkIcon name="x" :size="13" />取消</DkButton>
        <DkButton size="sm" variant="danger" @click="doClearWorkflows">
          <DkIcon name="check" :size="13" />确认清空
        </DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.settings {
  max-width: 1680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.settings__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.settings__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.settings__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.settings__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.settings__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.settings__local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.settings__local:hover {
  text-decoration: none;
  color: var(--accent);
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}
.panel__title {
  font-size: 12.5px;
  font-weight: 600;
}
.panel__hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.panel__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  padding: 18px;
  align-items: start;
}
.panel__col {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}
.group {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.group__head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px;
  background: var(--surface-subtle);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}
.group__head :deep(svg) {
  color: var(--accent);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  border-top: 1px solid var(--border);
}
.row__info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.row__title {
  font-size: 12.5px;
  font-weight: 600;
}
.row__desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.panel__status {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
}
.panel__status .grow + .mono {
  color: var(--text-secondary);
}
.notes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 44px;
  padding-top: 4px;
}
.notes__col {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.notes__head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
}
.notes__head :deep(svg) {
  color: var(--accent);
}
.notes__text {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.step__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.step__title {
  font-size: 12.5px;
  font-weight: 600;
}
.qa {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.qa__q {
  font-size: 12.5px;
  font-weight: 600;
}
.clear__lead {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.clear__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  cursor: pointer;
}
.clear__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.clear__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.clear__desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.clear__tip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--warn-soft);
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
@media (max-width: 900px) {
  .panel__body,
  .notes {
    grid-template-columns: 1fr;
  }
  .notes {
    gap: 24px;
  }
}
@media (max-width: 560px) {
  .row {
    flex-wrap: wrap;
  }
}
</style>
