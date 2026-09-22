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

/**
 * 更新会整页重新加载，而输入只存在于页面内存里。
 * 主内容区还有内容时先不提示刷新，等用户把输入清掉（或复制走）再出现，避免打断正在做的事。
 */
function hasPendingInput() {
  if (typeof document === 'undefined') return false
  const nodes = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'main textarea, main input[type="text"]'
  )
  for (const el of nodes) {
    if (el.disabled || el.readOnly) continue
    if (el.value.trim()) return true
  }
  return false
}

const pendingInput = ref(false)
/** 非模态更新条：不阻断操作，且只在没有未执行输入时出现 */
const showUpdateBar = computed(() => pwa.needRefresh.value && !pendingInput.value)

function refreshPendingInput() {
  pendingInput.value = hasPendingInput()
}

watch(
  () => pwa.needRefresh.value,
  (v) => {
    if (v) refreshPendingInput()
  }
)

onMounted(() => {
  refreshPendingInput()
  document.addEventListener('input', refreshPendingInput, true)
  document.addEventListener('focusout', refreshPendingInput, true)
})

onUnmounted(() => {
  document.removeEventListener('input', refreshPendingInput, true)
  document.removeEventListener('focusout', refreshPendingInput, true)
})
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

    <!-- 状态 3：发现新版本（底部更新条，非模态；有未执行输入时不出现） -->
    <Transition name="pwa-pop">
      <div v-if="showUpdateBar" class="pwastatus__update" role="status">
        <DkIcon class="pwastatus__update-icon" name="arrow-down-to-line" :size="15" />
        <div class="pwastatus__update-text">
          <p class="pwastatus__update-title">新版本已下载，刷新后生效</p>
          <p class="pwastatus__update-sub">
            当前页面还能继续用；刷新会重新加载页面，输入只在内存里，请先复制要保留的结果。
          </p>
        </div>
        <span class="grow"></span>
        <DkButton size="sm" variant="ghost" :disabled="applying" @click="pwa.postponeUpdate()">稍后</DkButton>
        <DkButton size="sm" variant="primary" :disabled="applying" @click="applyUpdate">
          <DkIcon name="refresh-cw" :size="13" />{{ applying ? '切换中…' : '立即更新' }}
        </DkButton>
      </div>
    </Transition>
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
/* 更新条：贴底、非模态，随时可略过 */
.pwastatus__update {
  position: fixed;
  left: 20px;
  right: 20px;
  bottom: 20px;
  z-index: 190;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 11px 14px;
  border: 1px solid var(--accent-ring);
  border-radius: 11px;
  background: var(--accent-soft);
  box-shadow: var(--shadow-2);
}
.pwastatus__update-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.pwastatus__update-text {
  flex: 1;
  min-width: 200px;
}
.pwastatus__update-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.pwastatus__update-sub {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
@media (max-width: 720px) {
  .pwastatus__update {
    left: 12px;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
  /* 窄屏把按钮挤到下一行，避免文字被压成一条 */
  .pwastatus__update-text {
    flex-basis: 100%;
  }
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
