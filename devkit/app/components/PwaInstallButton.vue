<script setup lang="ts">
/**
 * S13 安装入口：页头徽标 + 安装引导弹层。
 * 安装条件按运行时真实状态逐项检查（manifest、Service Worker、浏览器安装入口）。
 */
const pwa = usePwa()
const toast = useToast()

const open = ref(false)

async function install() {
  const result = await pwa.promptInstall()
  if (result === 'accepted') {
    open.value = false
    toast.success('已提交安装，可从程序坞或开始菜单打开')
    return
  }
  if (result === 'dismissed') {
    toast.warning('已取消安装，随时可以再点一次')
    return
  }
  toast.warning('当前浏览器没有给出安装入口，可按弹层里的手动步骤安装')
}
</script>

<template>
  <div class="pwa-install">
    <span v-if="pwa.installed.value" class="pwa-install__badge pwa-install__badge--on">
      <DkIcon name="circle-check" :size="12" />
      已安装为桌面应用
    </span>
    <template v-else>
      <span class="pwa-install__badge">
        <DkIcon name="download" :size="12" />
        可安装为桌面应用
      </span>
      <DkButton size="sm" @click="open = true">
        <DkIcon name="arrow-down-to-line" :size="13" />安装 DevKit
      </DkButton>
    </template>

    <DkModal :open="open" title="安装 DevKit" width="560px" @close="open = false">
      <div class="pwa-guide">
        <p class="pwa-guide__lead">安装为桌面应用，随时离线使用</p>
        <div class="pwa-guide__features">
          <div v-for="f in [
            { icon: 'arrow-down-to-line', title: '安装为桌面应用', desc: '在程序坞或开始菜单中像普通应用一样打开' },
            { icon: 'wifi-off', title: '离线可用', desc: '安装后断网也能打开已缓存的工具页' },
            { icon: 'id-card', title: '无须账号', desc: '不需要登录，也不收集任何个人信息' },
            { icon: 'shield-check', title: '数据不上传', desc: '所有计算在浏览器内完成，输入内容不出本机' }
          ]" :key="f.title" class="pwa-guide__feature">
            <DkIcon :name="f.icon" :size="15" />
            <div class="pwa-guide__feature-text">
              <p class="pwa-guide__feature-title">{{ f.title }}</p>
              <p class="pwa-guide__feature-desc">{{ f.desc }}</p>
            </div>
          </div>
        </div>

        <div class="pwa-guide__check">
          <p class="pwa-guide__check-title">安装条件检查</p>
          <p class="pwa-guide__row" :class="pwa.manifestReady.value ? 'pwa-guide__row--ok' : 'pwa-guide__row--warn'">
            <DkIcon :name="pwa.manifestReady.value ? 'circle-check' : 'circle-alert'" :size="13" />
            manifest.webmanifest {{ pwa.manifestReady.value ? '已就绪' : '未检测到（站点清单未注入）' }}
            <span class="pwa-guide__muted">{{ pwa.manifestReady.value ? '当前版本' : '' }}</span>
          </p>
          <p class="pwa-guide__row" :class="pwa.swRegistered.value ? 'pwa-guide__row--ok' : 'pwa-guide__row--warn'">
            <DkIcon :name="pwa.swRegistered.value ? 'circle-check' : 'circle-alert'" :size="13" />
            Service Worker {{ pwa.swRegistered.value ? '已注册' : '尚未注册（生产构建生效）' }}
            <span class="pwa-guide__muted">{{ pwa.swRegistered.value ? '预缓存条目将在运行时统计' : '' }}</span>
          </p>
          <p class="pwa-guide__row" :class="pwa.canPrompt.value ? 'pwa-guide__row--ok' : 'pwa-guide__row--warn'">
            <DkIcon :name="pwa.canPrompt.value ? 'circle-check' : 'circle-alert'" :size="13" />
            {{ pwa.canPrompt.value ? '已满足浏览器安装条件' : '浏览器暂未提供自动安装入口' }}
            <span v-if="pwa.canPrompt.value" class="pwa-guide__tag">可安装</span>
          </p>
          <p v-if="!pwa.canPrompt.value" class="pwa-guide__manual">
            手动安装：Chrome / Edge 打开地址栏右侧的安装图标（或菜单 →「安装 DevKit」）；Safari 用「文件 → 添加到程序坞」。
          </p>
        </div>
        <p class="pwa-guide__foot">安装不会修改已有文件，也不会收集使用数据。</p>
      </div>
      <template #footer>
        <DkButton size="sm" @click="open = false">暂不</DkButton>
        <DkButton size="sm" variant="primary" :disabled="!pwa.canPrompt.value" @click="install">
          <DkIcon name="arrow-down-to-line" :size="13" />安装 DevKit
        </DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.pwa-install {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.pwa-install__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
}
.pwa-install__badge--on {
  background: var(--ok-soft);
  color: var(--ok);
}
.pwa-guide {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pwa-guide__lead {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.pwa-guide__features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.pwa-guide__feature {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--accent);
}
.pwa-guide__feature-text {
  min-width: 0;
}
.pwa-guide__feature-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.pwa-guide__feature-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.pwa-guide__check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-subtle);
}
.pwa-guide__check-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.pwa-guide__row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  line-height: 1.6;
  flex-wrap: wrap;
}
.pwa-guide__row--ok {
  color: var(--ok);
}
.pwa-guide__row--warn {
  color: var(--warn);
}
.pwa-guide__muted {
  color: var(--text-tertiary);
  font-size: 11.5px;
}
.pwa-guide__tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11px;
}
.pwa-guide__manual {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.pwa-guide__foot {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
</style>
