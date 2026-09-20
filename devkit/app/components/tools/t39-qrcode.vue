<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

defineProps<{ tool: ToolMeta }>()

const tab = ref<'generate' | 'scan'>('generate')

const toast = useToast()
const clipboard = useClipboard()

/* ---------- 生成 ---------- */
const DEFAULT_TEXT = 'https://example.com/devkit'
const text = ref(DEFAULT_TEXT)
const size = ref('256')
const ecc = ref('M')
const canvasRef = ref<HTMLCanvasElement | null>(null)
const svgCache = ref('')
const genErr = ref('')

/** 输入内容的真实 UTF-8 字节数（不推算容量上限，只展示事实） */
const contentBytes = computed(() => (text.value ? byteLength(text.value) : 0))

const SIZE_OPTIONS = [128, 192, 256, 320, 384, 512, 768, 1024].map((n) => ({ value: String(n), label: `${n} × ${n}` }))
const ECC_OPTIONS = [
  { value: 'L', label: 'L（约 7% 纠错）' },
  { value: 'M', label: 'M（约 15% 纠错）' },
  { value: 'Q', label: 'Q（约 25% 纠错）' },
  { value: 'H', label: 'H（约 30% 纠错）' }
]

const sigGen = () => JSON.stringify([text.value, size.value, ecc.value])
const runGen = useToolRun(sigGen)

/** 库抛出的「数据太长」类错误 → 统一中文提示 */
function friendlyGenError(e: unknown): string {
  const msg = errMessage(e)
  if (/too (big|long)|amount of data|code length|data overflow/i.test(msg)) {
    return '内容超出二维码容量，请缩短或降低纠错级别'
  }
  return `生成失败：${msg}`
}

async function generate() {
  if (!text.value) {
    svgCache.value = ''
    genErr.value = ''
    runGen.markIdle()
    return
  }
  try {
    const opts = { width: parseInt(size.value, 10), errorCorrectionLevel: ecc.value as 'L' | 'M' | 'Q' | 'H', margin: 2 }
    if (canvasRef.value) await QRCode.toCanvas(canvasRef.value, text.value, opts)
    svgCache.value = await QRCode.toString(text.value, { type: 'svg', errorCorrectionLevel: opts.errorCorrectionLevel, margin: 2 })
    genErr.value = ''
    runGen.markOk(`QR Code ${opts.width}×${opts.width}，纠错级别 ${opts.errorCorrectionLevel}，由输入内容真实生成`)
  } catch (e) {
    svgCache.value = ''
    genErr.value = friendlyGenError(e)
    runGen.markFail(genErr.value)
  }
}

/** 预览型：输入/参数变化即重新生成（轻抖动合并） */
let genTimer: ReturnType<typeof setTimeout> | undefined
watch([text, size, ecc], () => {
  if (tab.value !== 'generate') return
  if (genTimer) clearTimeout(genTimer)
  genTimer = setTimeout(() => void generate(), 150)
})
watch(tab, (t) => {
  if (t === 'generate') void nextTick(() => void generate())
})
onMounted(() => {
  if (tab.value === 'generate') void nextTick(() => void generate())
})
onUnmounted(() => {
  if (genTimer) clearTimeout(genTimer)
})

function downloadPng() {
  const cv = canvasRef.value
  if (!cv) return
  cv.toBlob((blob) => {
    if (blob) downloadBlob(`qrcode-${Date.now()}.png`, blob)
  }, 'image/png')
}

function downloadSvg() {
  if (!svgCache.value) return
  downloadText(`qrcode-${Date.now()}.svg`, svgCache.value, 'image/svg+xml')
}

/** 识别当前生成预览：把 canvas 像素交给 jsQR，验证生成 → 识别回环真实可用 */
async function recognizeCanvas() {
  const cv = canvasRef.value
  if (!cv || !text.value || genErr.value) return
  scanText.value = ''
  scanErr.value = ''
  scanMeta.value = ''
  scanBusy.value = true
  try {
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建 canvas 上下文')
    const imageData = ctx.getImageData(0, 0, cv.width, cv.height)
    const res = jsQR(imageData.data, imageData.width, imageData.height)
    scanFile.value = { name: '当前生成预览（画布，非文件）', size: 0, width: cv.width, height: cv.height, kind: 'canvas' }
    if (res && res.data) {
      scanText.value = res.data
      scanMeta.value = res.data === text.value ? '回环识别成功，内容与输入逐字符一致' : '识别成功，但内容与当前输入不一致，请核对'
    } else {
      scanErr.value = '未能在当前生成预览中检测到二维码'
    }
  } catch (e) {
    scanErr.value = `识别失败：${errMessage(e)}`
  } finally {
    scanBusy.value = false
    tab.value = 'scan'
  }
}

/* ---------- 识别 ---------- */
interface ScanSource {
  name: string
  /** 文件字节数；canvas 预览为 0 */
  size: number
  width: number
  height: number
  kind: 'file' | 'canvas'
}

const scanErr = ref('')
const scanText = ref('')
const scanBusy = ref(false)
const scanMeta = ref('')
const scanFile = ref<ScanSource | null>(null)

/** 来源信息文案：文件显示名称 / 大小 / 尺寸；画布只显示尺寸 */
const scanSourceText = computed(() => {
  const s = scanFile.value
  if (!s) return ''
  const dims = s.width ? ` · ${s.width}×${s.height}` : ''
  return s.kind === 'file' ? `${s.name} · ${formatBytes(s.size)}${dims}` : `${s.name}${dims}`
})

async function onScanFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  scanText.value = ''
  scanErr.value = ''
  scanMeta.value = ''
  scanFile.value = { name: f.name, size: f.size, width: 0, height: 0, kind: 'file' }
  scanBusy.value = true
  try {
    const bmp = await createImageBitmap(f)
    scanFile.value = { name: f.name, size: f.size, width: bmp.width, height: bmp.height, kind: 'file' }
    try {
      const cv = document.createElement('canvas')
      cv.width = bmp.width
      cv.height = bmp.height
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('无法创建 canvas 上下文')
      ctx.drawImage(bmp, 0, 0)
      const imageData = ctx.getImageData(0, 0, cv.width, cv.height)
      const res = jsQR(imageData.data, imageData.width, imageData.height)
      if (res && res.data) {
        scanText.value = res.data
        scanMeta.value = `来源 ${f.name}（${formatBytes(f.size)}，${bmp.width}×${bmp.height}），识别成功`
      } else {
        scanErr.value = '未在图片中检测到二维码，请确认图片清晰完整'
      }
    } finally {
      bmp.close()
    }
  } catch (e) {
    scanErr.value = `读取图片失败：${errMessage(e)}（文件可能损坏或格式不受当前浏览器支持）`
  } finally {
    scanBusy.value = false
  }
}

async function copyScan() {
  if (!scanText.value) return
  await clipboard.copy(scanText.value, '识别结果')
}
</script>

<template>
  <div class="t39">
    <div class="t39__toolbar">
      <DkSegmented
        :model-value="tab"
        :options="[
          { value: 'generate', label: '生成' },
          { value: 'scan', label: '识别' }
        ]"
        @update:model-value="tab = $event as 'generate' | 'scan'"
      />
      <template v-if="tab === 'generate'">
        <span class="t39__param">
          <span class="t39__param-label">尺寸</span>
          <DkSelect v-model="size" :options="SIZE_OPTIONS" />
        </span>
        <span class="t39__param">
          <span class="t39__param-label">纠错级别</span>
          <DkSelect v-model="ecc" :options="ECC_OPTIONS" />
        </span>
      </template>
    </div>

    <!-- 生成 -->
    <template v-if="tab === 'generate'">
      <DkStatusBar
        :status="runGen.status.value"
        :message="runGen.status.value === 'error' ? runGen.errorMsg.value : runGen.staleNote.value"
        :meta="text ? [`${size} × ${size}`, `纠错 ${ecc}`, `内容 ${text.length} 字符 / ${contentBytes} 字节（UTF-8）`] : []"
        :retry="generate"
      />
      <DkField label="文本或 URL" help="二维码内容由这里的输入真实生成，支持中文；容量有限，内容越长越容易超限">
        <DkInput v-model="text" mono :error="!!genErr" placeholder="输入文本或 URL" />
      </DkField>
      <div class="t39__gen-body">
        <div class="t39__canvas-wrap" :class="{ 't39__canvas-wrap--empty': !text || !!genErr }">
          <canvas ref="canvasRef" class="t39__canvas" aria-label="二维码预览"></canvas>
          <p v-if="!text" class="t39__overlay tertiary">输入内容后自动生成</p>
          <p v-else-if="genErr" class="t39__overlay t39__overlay--err">{{ genErr }}</p>
        </div>
        <div class="t39__gen-actions">
          <DkButton size="sm" variant="primary" :disabled="!text || !!genErr" @click="downloadPng">
            <DkIcon name="download" :size="12" />
            下载 PNG
          </DkButton>
          <DkButton size="sm" :disabled="!text || !!genErr" @click="downloadSvg">
            <DkIcon name="download" :size="12" />
            下载 SVG
          </DkButton>
          <DkButton size="sm" :disabled="!text || !!genErr" title="把当前预览的像素交给识别引擎，验证生成 → 识别回环" @click="recognizeCanvas">
            <DkIcon name="image" :size="12" />
            识别当前预览
          </DkButton>
          <DkButton size="sm" variant="ghost" title="恢复默认示例 URL" @click="text = DEFAULT_TEXT">填入示例 URL</DkButton>
        </div>
      </div>
    </template>

    <!-- 识别 -->
    <template v-else>
      <DkStatusBar
        :status="scanBusy ? 'running' : scanText ? 'ok' : scanErr ? 'error' : 'idle'"
        :message="scanBusy ? '识别中…' : scanText ? scanMeta : scanErr ? scanErr : '拖入或选择包含二维码的图片'"
        :meta="scanText ? ['jsQR 本地识别'] : []"
      />
      <FileDrop
        accept="image/*"
        hint="图片只在本地解码识别；不会默认请求摄像头，也不会自动打开识别出的 URL"
        @files="onScanFiles"
        @reject="(reason: string) => toast.warning(reason)"
      />
      <div v-if="scanFile" class="t39__source">
        <DkIcon name="image" :size="14" />
        <span class="t39__source-name mono">{{ scanFile.name }}</span>
        <span v-if="scanFile.kind === 'file'" class="tertiary">{{ formatBytes(scanFile.size) }}</span>
        <span v-if="scanFile.width" class="tertiary">{{ scanFile.width }}×{{ scanFile.height }}</span>
        <span class="grow"></span>
        <span class="tertiary">{{ scanBusy ? '读取中…' : scanText ? '读取完成 · 已识别' : scanErr ? '读取完成 · 未识别' : '读取完成' }}</span>
      </div>
      <div v-if="scanText" class="t39__scan-result">
        <div class="t39__scan-head">
          <span>识别结果（文本原样展示，不自动打开其中的 URL）</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="primary" @click="copyScan">
            <DkIcon name="copy" :size="12" />
            复制
          </DkButton>
        </div>
        <p class="t39__scan-text mono">{{ scanText }}</p>
        <p class="tertiary t39__scan-note">来源：{{ scanSourceText }}；识别出的内容为 {{ scanText.length }} 个字符。如需访问其中链接请自行确认安全后手动打开。</p>
      </div>
      <p v-else-if="scanErr" class="t39__scan-err">{{ scanErr }}</p>
    </template>

    <DkCollapse title="使用说明">
      <ul>
        <li>生成与识别全部在浏览器本地完成（qrcode / jsQR 库）。</li>
        <li>纠错级别越高可恢复的污损越多，但可容纳的内容越少；内容超限会明确提示而不是生成残缺码。</li>
        <li>生成侧只展示输入内容的真实字符数与 UTF-8 字节数，不推算或承诺某个版本/纠错级别下的容量上限；是否超限以库的真实报错为准。</li>
        <li>识别成功后会显示来源文件的名字、大小与像素尺寸；也可以用「识别当前预览」把生成的画布直接交给识别引擎，验证生成 → 识别回环。</li>
        <li>识别基于整幅图片的像素数据：截图缩放过小、二维码被裁切或有大面积反光时可能识别失败。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t39 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t39__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t39__param {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.t39__param-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t39__param .dk-select {
  min-width: 150px;
}
.t39__gen-body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.t39__canvas-wrap {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 12px;
  line-height: 0;
}
.t39__canvas {
  max-width: 100%;
  width: 256px;
  height: auto;
}
.t39__canvas-wrap--empty .t39__canvas {
  opacity: 0.25;
}
.t39__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
.t39__overlay--err {
  color: var(--error);
}
.t39__gen-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.t39__source {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  font-size: 12.5px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}
.t39__source-name {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.t39__scan-result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t39__scan-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t39__scan-text {
  padding: 12px;
  font-size: var(--code-font-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t39__scan-note {
  padding: 0 12px 10px;
  font-size: 12px;
}
.t39__scan-err {
  padding: 12px 14px;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  background: var(--error-soft);
  color: var(--error);
  font-size: 13px;
}
</style>
