<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

type Target = 'jpeg' | 'png' | 'webp'

const MIME: Record<Target, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const toast = useToast()

const file = ref<File | null>(null)
const objectUrl = ref('')
const bitmap = ref<ImageBitmap | HTMLImageElement | null>(null)
const orig = ref<{ w: number; h: number; type: string; size: number } | null>(null)
const hasAlpha = ref(false)

const target = ref<Target>('jpeg')
const quality = ref(80) // 1-100，仅 JPEG/WebP 生效
const maxWidth = ref('')
const maxHeight = ref('')
const bgColor = ref('#ffffff')

const busy = ref(false)
const busyMsg = ref('')
const result = ref<{ url: string; blob: Blob; w: number; h: number; typeWarn: string } | null>(null)
const lastUrls: string[] = []

const sig = () =>
  JSON.stringify([
    file.value ? [file.value.name, file.value.size, file.value.lastModified] : null,
    target.value,
    quality.value,
    maxWidth.value,
    maxHeight.value,
    bgColor.value
  ])
const run = useToolRun(sig)

onUnmounted(() => {
  for (const u of lastUrls) URL.revokeObjectURL(u)
  lastUrls.length = 0
  if (bitmap.value && 'close' in bitmap.value) (bitmap.value as ImageBitmap).close()
})

function trackUrl(url: string): string {
  lastUrls.push(url)
  if (lastUrls.length > 8) URL.revokeObjectURL(lastUrls.shift() as string)
  return url
}

async function onFiles(fs: File[]) {
  const f = fs[0]
  if (!f) return
  if (!f.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)) {
    toast.warning(`文件「${f.name}」不是图片（MIME：${f.type || '未知'}）`)
    return
  }
  file.value = f
  result.value = null
  orig.value = null
  hasAlpha.value = false
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = ''
  }
  if (bitmap.value && 'close' in bitmap.value) (bitmap.value as ImageBitmap).close()
  bitmap.value = null
  objectUrl.value = trackUrl(URL.createObjectURL(f))
  busy.value = true
  busyMsg.value = '读取图片…'
  try {
    const bmp = await loadBitmap(f)
    bitmap.value = bmp
    orig.value = { w: 'width' in bmp ? bmp.width : 0, h: 'height' in bmp ? bmp.height : 0, type: f.type || '未知', size: f.size }
    hasAlpha.value = await detectAlpha(bmp)
    await convert()
  } catch (e) {
    run.markFail(`读取图片失败：${errMessage(e)}（文件可能损坏或格式不受当前浏览器支持）`)
  } finally {
    busy.value = false
  }
}

async function loadBitmap(f: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(f)
    } catch {
      /* 落回 <img> 路径 */
    }
  }
  const url = URL.createObjectURL(f)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('浏览器无法解码该图片'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** 透明检测：缩到最长边 256px 的画布上扫描 alpha 通道（真实采样，不是猜测） */
async function detectAlpha(bmp: ImageBitmap | HTMLImageElement): Promise<boolean> {
  try {
    const w = bmp.width
    const h = bmp.height
    const scale = Math.min(1, 256 / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const cv = document.createElement('canvas')
    cv.width = cw
    cv.height = ch
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(bmp, 0, 0, cw, ch)
    const data = ctx.getImageData(0, 0, cw, ch).data
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true
    return false
  } catch {
    return false
  }
}

function clearFile() {
  file.value = null
  bitmap.value = null
  orig.value = null
  result.value = null
  hasAlpha.value = false
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = ''
  }
  run.markIdle()
}

/** 尺寸约束校验：正整数（像素）或留空 */
function validateDim(v: string): boolean {
  if (!v.trim()) return true
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 && String(n) === v.trim()
}

const maxWErr = computed(() => (validateDim(maxWidth.value) ? '' : '最大宽度需为正整数（像素）或留空'))
const maxHErr = computed(() => (validateDim(maxHeight.value) ? '' : '最大高度需为正整数（像素）或留空'))

/** 目标尺寸：等比缩放，只缩不放；留空 = 不限制该边 */
function targetSize(): { w: number; h: number; note: string } {
  const o = orig.value
  if (!o) return { w: 0, h: 0, note: '' }
  let w = o.w
  let h = o.h
  const notes: string[] = []
  const mw = parseInt(maxWidth.value, 10)
  const mh = parseInt(maxHeight.value, 10)
  const limits: Array<[number, number, string]> = []
  if (maxWidth.value.trim() && Number.isFinite(mw) && mw > 0) limits.push([mw, o.w, `最大宽 ${mw}`])
  if (maxHeight.value.trim() && Number.isFinite(mh) && mh > 0) limits.push([mh, o.h, `最大高 ${mh}`])
  for (const [limit, cur, label] of limits) {
    if (cur > limit) {
      const s = limit / cur
      w = Math.round(w * s)
      h = Math.round(h * s)
      notes.push(label)
    }
  }
  return { w: Math.max(1, w), h: Math.max(1, h), note: notes.join('、') }
}

async function convert() {
  if (!file.value || !bitmap.value || !orig.value) return
  if (maxWErr.value || maxHErr.value) {
    run.markFail(`尺寸约束无效：${maxWErr.value || maxHErr.value}`)
    return
  }
  busy.value = true
  busyMsg.value = '转换中…'
  try {
    const { w, h, note } = targetSize()
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('无法创建 canvas 上下文')
    if (target.value === 'jpeg') {
      // JPEG 不支持透明：先整体铺底色，再把原图画上去
      ctx.fillStyle = bgColor.value
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(bitmap.value, 0, 0, w, h)
    const mime = MIME[target.value]
    const blob = await new Promise<Blob | null>((resolve) =>
      cv.toBlob((b) => resolve(b), mime, quality.value / 100)
    )
    if (!blob) throw new Error('当前浏览器无法导出该格式')
    const typeWarn = blob.type !== mime ? `当前浏览器不支持导出 ${target.value.toUpperCase()}，实际输出为 ${blob.type}` : ''
    if (result.value) URL.revokeObjectURL(result.value.url)
    result.value = { url: trackUrl(URL.createObjectURL(blob)), blob, w, h, typeWarn }
    const ratio = orig.value.size > 0 ? (1 - blob.size / orig.value.size) * 100 : 0
    run.markOk(
      `${note ? `已按 ${note} 等比缩放；` : ''}输出 ${w}×${h} ${blob.type}${ratio >= 0 ? `，比原文件小 ${ratio.toFixed(1)}%` : `，比原文件大 ${(-ratio).toFixed(1)}%`}`
    )
  } catch (e) {
    run.markFail(`转换失败：${errMessage(e)}`)
  } finally {
    busy.value = false
  }
}

/** 预览型工具：参数变化即重算（滑杆做轻抖动合并） */
let timer: ReturnType<typeof setTimeout> | undefined
watch([target, quality, maxWidth, maxHeight, bgColor], () => {
  if (!file.value || !bitmap.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void convert(), 150)
})
onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

const sizeDelta = computed<{ pct: number; smaller: boolean } | null>(() => {
  if (!result.value || !orig.value || orig.value.size === 0) return null
  const pct = (1 - result.value.blob.size / orig.value.size) * 100
  return { pct: Math.abs(pct), smaller: pct >= 0 }
})

function outName(): string {
  const src = file.value?.name ?? 'image'
  const base = src.replace(/\.[^./\\]+$/, '') || src
  const ext = EXT[result.value?.blob.type ?? ''] ?? 'img'
  return `${base}.${ext}`
}

function download() {
  if (!result.value) return
  downloadBlob(outName(), result.value.blob)
}
</script>

<template>
  <div class="t38">
    <div class="t38__toolbar">
      <DkSegmented
        :model-value="target"
        :options="[
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' }
        ]"
        @update:model-value="target = $event as Target"
      />
      <span v-if="target !== 'png'" class="t38__quality">
        <span class="t38__quality-label">质量</span>
        <input v-model.number="quality" class="t38__range" type="range" min="1" max="100" />
        <span class="mono t38__quality-val">{{ quality }}</span>
      </span>
      <span v-if="target === 'jpeg'" class="t38__bg">
        <span class="t38__quality-label">底色</span>
        <input v-model="bgColor" class="t38__color" type="color" :aria-label="'JPEG 底色'" />
      </span>
      <span class="grow"></span>
      <DkButton v-if="file" size="sm" variant="ghost" @click="clearFile">移除</DkButton>
      <DkButton size="sm" variant="primary" :disabled="!file || !bitmap" :loading="busy" @click="convert">
        <DkIcon name="refresh" :size="12" />
        重新转换
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? busyMsg : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="orig ? [`原始 ${orig.w}×${orig.h}`, '文件不离开本地'] : []"
      :retry="convert"
    />

    <FileDrop
      accept="image/*"
      :max-size="100 * 1024 * 1024"
      hint="拖入图片（PNG / JPEG / GIF / WebP 等，以当前浏览器能解码为准），全部本地处理"
      @files="onFiles"
      @reject="(reason: string) => toast.warning(reason)"
    />

    <template v-if="file">
      <div class="t38__cols">
        <div class="t38__panel">
          <div class="t38__panel-head">
            <span>原始图片</span>
          </div>
          <div class="t38__panel-body">
            <img v-if="objectUrl" class="t38__thumb" :src="objectUrl" alt="原始图片预览" />
            <p v-if="orig" class="t38__meta tertiary">
              {{ orig.w }}×{{ orig.h }} 像素 · MIME {{ orig.type }} · 真实大小 {{ formatBytes(orig.size) }}
            </p>
            <p v-else class="t38__meta tertiary">读取中…</p>
            <p v-if="hasAlpha" class="t38__meta t38__meta--warn">检测到透明区域</p>
          </div>
        </div>

        <div class="t38__panel">
          <div class="t38__panel-head">
            <span>转换结果</span>
          </div>
          <div class="t38__panel-body">
            <template v-if="result">
              <img class="t38__thumb" :src="result.url" alt="转换结果预览" />
              <p class="t38__meta tertiary">
                {{ result.w }}×{{ result.h }} 像素 · MIME {{ result.blob.type }} · 真实大小 {{ formatBytes(result.blob.size) }}
              </p>
              <p v-if="orig" class="t38__delta" :class="sizeDelta && sizeDelta.smaller ? 't38__delta--ok' : 't38__delta--warn'">
                <template v-if="sizeDelta && sizeDelta.smaller">比原文件小 {{ sizeDelta.pct.toFixed(1) }}%</template>
                <template v-else-if="sizeDelta">比原文件大 {{ sizeDelta.pct.toFixed(1) }}% —— 结果反而更大，可尝试调低质量或换格式</template>
              </p>
              <p v-if="result.typeWarn" class="t38__meta t38__meta--warn">{{ result.typeWarn }}</p>
              <DkButton size="sm" variant="primary" @click="download">
                <DkIcon name="download" :size="12" />
                下载（{{ outName() }}）
              </DkButton>
            </template>
            <p v-else class="t38__meta tertiary">转换后这里显示新图与大小对比。</p>
          </div>
        </div>
      </div>

      <div class="t38__opts">
        <DkField label="最大宽度（像素）" :error="maxWErr" help="等比缩放，只缩不放；留空 = 保持原始宽度">
          <DkInput v-model="maxWidth" mono placeholder="如 1920，留空不限" :error="!!maxWErr" />
        </DkField>
        <DkField label="最大高度（像素）" :error="maxHErr" help="等比缩放，只缩不放；留空 = 保持原始高度">
          <DkInput v-model="maxHeight" mono placeholder="如 1080，留空不限" :error="!!maxHErr" />
        </DkField>
        <DkField
          v-if="target === 'jpeg'"
          label="透明区域底色"
          help="JPEG 不支持透明，透明区域将填充底色；PNG / WebP 仍保留透明"
        >
          <div class="t38__bg-row">
            <input v-model="bgColor" class="t38__color" type="color" aria-label="透明区域底色" />
            <span class="mono t38__bg-val">{{ bgColor }}</span>
          </div>
        </DkField>
      </div>
      <p class="t38__hint tertiary">提示：转换在本地 canvas 完成，不承诺每张图片都会变小——小图或已高度压缩的图转出后可能更大。</p>
    </template>
    <p v-else class="t38__empty tertiary">选择图片后自动转换；修改格式 / 质量 / 尺寸立即重新计算。</p>

    <DkCollapse title="使用说明">
      <ul>
        <li>质量滑杆仅对 JPEG / WebP 生效（PNG 为无损格式，canvas 导出 PNG 无质量参数）。</li>
        <li>导出格式由 canvas.toBlob 完成；个别浏览器不支持导出 WebP 时会如实提示并显示实际输出类型。</li>
        <li>透明 PNG 转 JPEG 时需要选择底色（默认白色），透明区域会被底色填充。</li>
        <li>下载文件名为「原名.新扩展名」，例如 photo.png 转 JPEG 后是 photo.jpg。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t38 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t38__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t38__quality,
.t38__bg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.t38__quality-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t38__quality-val {
  font-size: 12px;
  min-width: 24px;
  text-align: right;
}
.t38__range {
  width: 120px;
  accent-color: var(--accent);
}
.t38__color {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
}
.t38__cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 720px) {
  .t38__cols {
    grid-template-columns: 1fr;
  }
}
.t38__panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t38__panel-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t38__panel-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.t38__thumb {
  max-width: 100%;
  max-height: 260px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(45deg, var(--surface-subtle) 25%, transparent 25%, transparent 75%, var(--surface-subtle) 75%),
    linear-gradient(45deg, var(--surface-subtle) 25%, transparent 25%, transparent 75%, var(--surface-subtle) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
.t38__meta {
  font-size: 12px;
}
.t38__meta--warn {
  color: var(--warn);
}
.t38__delta {
  font-size: 13px;
  font-weight: 500;
}
.t38__delta--ok {
  color: var(--ok);
}
.t38__delta--warn {
  color: var(--warn);
}
.t38__opts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.t38__bg-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t38__bg-val {
  font-size: 12px;
  color: var(--text-secondary);
}
.t38__hint,
.t38__empty {
  font-size: 12px;
}
.t38__empty {
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
</style>
