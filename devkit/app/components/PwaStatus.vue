<script setup lang="ts">
/**
 * G10 PWA 状态：已可离线使用、当前离线、发现新版本三种真实状态。
 * 可用工具清单来自本机「已访问过」的记录，不编造缓存内容。
 */
import { getToolById } from '~/data/tools'

const pwa = usePwa()
const toast = useToast()

const visited = ref<string[]>([])

onMounted(() => {
  try {
    const raw = localStorage.getItem('devkit.visited.v1')
    visited.value = raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    visited.value = []
  }
})

const cachedTools = computed(() =>
  visited.value
    .slice(-4)
    .reverse()
    .flatMap((id) => {
      const t = getToolById(id)
      return t ? [t.name] : []
    })
)

function retry() {
  if (typeof window !== 'undefined') window.location.reload()
}

const applying = ref(false)

async function applyUpdate() {
  if (applying.value) return
  applying.value = true
  toast.success('正在切换到新版本，页面会自动重新加载')
  await pwa.applyUpdate()
}
</script>

<template>
  <div class="pwastatus">
    <!-- 状态 1：安装完成、已完成离线缓存（只出现一次，可关闭） -->
    <Transition name="pwa-pop">
      <div v-if="pwa.offlineReady.value" class="pwastatus__toast" role="status">
        <DkIcon name="circle-check" :size="15" />
        <div class="pwastatus__toast-text">
          <p class="pwastatus__toast-title">已完成离线缓存，断网也能使用</p>
          <p class="pwastatus__toast-sub">已缓存的工具页会优先从本机读取，输入内容依旧只在浏览器内处理。</p>
        </div>
        <DkButton size="sm" variant="ghost" @click="pwa.dismissOfflineReady()">知道了</DkButton>
      </div>
    </Transition>

    <!-- 状态 2：当前离线 -->
    <Transition name="pwa-pop">
      <div v-if="pwa.initialized.value && !pwa.online.value" class="pwastatus__offline" role="status">
        <DkIcon name="wifi-off" :size="14" />
        <span class="pwastatus__offline-title">当前离线 · 已缓存的工具仍可使用</span>
        <span class="pwastatus__offline-sub">未缓存的内容需要联网后重试</span>
        <span v-if="cachedTools.length" class="pwastatus__tools">
          <span v-for="name in cachedTools" :key="name" class="pwastatus__tool">
            <DkIcon name="circle-check" :size="11" />{{ name }}
          </span>
        </span>
        <span class="grow"></span>
        <DkButton size="sm" @click="retry">
          <DkIcon name="refresh-cw" :size="12" />重试
        </DkButton>
      </div>
    </Transition>

    <!-- 状态 3：发现新版本（由用户决定何时生效） -->
    <DkModal :open="pwa.needRefresh.value" title="DevKit 新版本已就绪" width="470px" @close="pwa.postponeUpdate()">
      <div class="pwastatus__update">
        <p class="pwastatus__update-lead">后台已下载更新，由你决定何时生效。</p>
        <div class="pwastatus__update-row">
          <DkIcon name="arrow-down-to-line" :size="15" />
          <span>更新将在下次打开时生效，不会中断当前工作。</span>
        </div>
        <div class="pwastatus__update-workspace">
          <p class="pwastatus__update-title">当前工作区不受影响</p>
          <p class="pwastatus__update-desc">
            未提交的输入仍保留在本次页面内存中；选择「立即更新」会先让新版本接管、再自动重新加载当前页面；选择「稍后」则保留当前版本直到下次打开，并且本次会话内不会再打扰你。
          </p>
          <div class="pwastatus__tags">
            <span class="pwastatus__tag">当前版本正在运行</span>
            <span class="pwastatus__tag pwastatus__tag--new">新版本已下载</span>
          </div>
        </div>
      </div>
      <template #footer>
        <DkButton size="sm" :disabled="applying" @click="pwa.postponeUpdate()">稍后</DkButton>
        <DkButton size="sm" variant="primary" :disabled="applying" @click="applyUpdate">
          <DkIcon name="refresh-cw" :size="13" />{{ applying ? '切换中…' : '立即更新' }}
        </DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.pwastatus__toast,
.pwastatus__offline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pwastatus__toast {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 190;
  width: min(460px, calc(100vw - 40px));
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  box-shadow: var(--shadow-2);
  color: var(--ok);
}
.pwastatus__toast-text {
  flex: 1;
  min-width: 160px;
}
.pwastatus__toast-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.pwastatus__toast-sub {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.pwastatus__offline {
  position: fixed;
  left: 20px;
  right: 20px;
  bottom: 20px;
  z-index: 190;
  padding: 10px 14px;
  border: 1px solid var(--warn);
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  box-shadow: var(--shadow-2);
}
.pwastatus__offline-title {
  font-size: 12.5px;
  font-weight: 600;
}
.pwastatus__offline-sub {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.pwastatus__tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pwastatus__tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  background: var(--surface);
  color: var(--ok);
  font-size: 11.5px;
}
.pwastatus__update {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pwastatus__update-lead {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.pwastatus__update-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-primary);
}
.pwastatus__update-workspace {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-subtle);
}
.pwastatus__update-title {
  font-size: 12.5px;
  font-weight: 600;
}
.pwastatus__update-desc {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.pwastatus__tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.pwastatus__tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11.5px;
}
.pwastatus__tag--new {
  background: var(--ok-soft);
  border-color: transparent;
  color: var(--ok);
}
.pwa-pop-enter-active,
.pwa-pop-leave-active {
  transition: all 0.18s;
}
.pwa-pop-enter-from,
.pwa-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
