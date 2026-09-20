<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { diffLines } from 'diff'

defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const toast = useToast()

const src = ref('')
const errDetail = ref('')
const previewUrl = ref('')
const optimized = ref('')
const blocked = ref(false)
const unsafeItems = ref<{ kind: string; line: number; snippet: string }[]>([])
const origBytes = ref(0)
const optBytes = ref(0)
const grewBy = ref(0)
const diffParts = ref<{ type: 'add' | 'del' | 'ctx'; text: string }[]>([])
const previewInfo = ref('')
const srcEditor = ref<{ $el?: HTMLElement }>()

const wsMode = ref<'on' | 'off'>('on')
const viewBoxMode = ref<'yes' | 'no'>('yes')
const metaMode = ref<'no' | 'yes'>('no')
const decimals = ref<'2' | '3' | '4' | '6'>('2')

const collapseWs = computed(() => wsMode.value === 'on')
const keepViewBox = computed(() => viewBoxMode.value === 'yes')
const rmMeta = computed(() => metaMode.value === 'yes')

const stats = ref({ tagBefore: 0, tagAfter: 0, wsBefore: 0, wsAfter: 0, metaBefore: false, metaAfter: false })
const visualChanges = ref<string[]>([])
const precisionChange = ref('')

const decOptions = computed(() => {
  const o = [
    { value: '2', label: '2 位' },
    { value: '3', label: '3 位' },
    { value: '4', label: '4 位' }
  ]
  if (decimals.value === '6' || precisionChange.value) o.push({ value: '6', label: '6 位' })
  return o
})

const SAMPLE = `<!-- 应用图标 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
  <title>指南针图标</title>
  <circle cx="12" cy="12" r="10" fill="none" stroke="#2563eb" stroke-width="1.500"/>
  <path d="M12 6 L14.5 12 L12 18 L9.5 12 Z" fill="#2563eb"/>
</svg>`

const UNSAFE_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" onload="alert(1)">
  <scr` + 'ipt' + `>document.location='https://evil.example'</scr` + 'ipt' + `>
  <image href="https://evil.example/x.png" width="10" height="10"/>
  <circle cx="12" cy="12" r="10" fill="#2563eb" onclick="steal()"/>
</svg>`

const PRECISE_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <circle cx="12.345678" cy="11.987654" r="8.123456" fill="none" stroke="#2563eb" stroke-width="1.23456"/>
  <path d="M4.123456 24.654321 C 12.987654 5.123456, 36.111111 5.222222, 44.333333 24.444444"/>
</svg>`

function lineOf(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle)
  if (idx < 0) return 1
  let line = 1
  for (let i = 0; i < idx; i++) if (haystack[i] === '\n') line++
  return line
}

function scanUnsafe(root: Element, source: string): { kind: string; line: number; snippet: string }[] {
  const items: { kind: string; line: number; snippet: string }[] = []
  for (const tag of ['script', 'foreignObject']) {
    for (const el of Array.from(root.getElementsByTagName(tag))) {
      const label = tag === 'script' ? 'script 元素' : 'foreignObject 元素'
      items.push({ kind: label, line: lineOf(source, `<${el.nodeName}`), snippet: `<${el.nodeName}>` })
    }
  }
  const all = [root as Element, ...Array.from(root.getElementsByTagName('*'))]
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name
      if (/^on[a-z]+$/i.test(name)) {
        items.push({ kind: `事件属性 ${name}`, line: lineOf(source, `${name}=`), snippet: `${name}="${attr.value}"` })
      } else if (name === 'href' || name === 'xlink:href') {
        const v = attr.value.trim()
        if (!v.startsWith('#') && !v.startsWith('data:')) {
          items.push({ kind: '外部引用', line: lineOf(source, v), snippet: `${name}="${v}"` })
        }
      }
    }
  }
  return items
}

const ROUND_SIMPLE = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'fx', 'fy', 'offset', 'stroke-width', 'stroke-dashoffset', 'stroke-miterlimit',
  'markerwidth', 'markerheight', 'refx', 'refy', 'pathlength'
])
const ROUND_MULTI = new Set(['d', 'points', 'stroke-dasharray', 'values', 'keytimes', 'keysplines'])
const NUM_ONE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/
const NUM_ALL = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function roundNumber(raw: string, n: number): { out: string; changed: boolean } {
  const num = Number(raw)
  if (!Number.isFinite(num)) return { out: raw, changed: false }
  const factor = 10 ** n
  const rounded = Math.round(num * factor) / factor
  let out = rounded.toFixed(n).replace(/\.?0+$/, '')
  if (out === '' || out === '-0') out = '0'
  return { out, changed: Math.abs(rounded - num) > 1e-12 }
}

function roundAttributes(text: string, n: number, seen: string[]): string {
  return text.replace(/\b([A-Za-z][\w:-]*)="([^"]*)"/g, (m, name: string, val: string) => {
    const ln = name.toLowerCase()
    if (ROUND_SIMPLE.has(ln)) {
      const t = val.trim()
      if (!NUM_ONE.test(t)) return m
      const r = roundNumber(t, n)
      if (r.changed && seen.length < 4) seen.push(`${t} → ${r.out}`)
      return `${name}="${r.out}"`
    }
    if (ROUND_MULTI.has(ln)) {
      const out = val.replace(NUM_ALL, (num) => {
        const r = roundNumber(num, n)
        if (r.changed && seen.length < 4) seen.push(`${num} → ${r.out}`)
        return r.out
      })
      return `${name}="${out}"`
    }
    return m
  })
}

function stripViewBox(text: string): string {
  const m = /<svg\b[^>]*>/i.exec(text)
  if (!m) return text
  const tag = m[0].replace(/\s+viewBox="[^"]*"/i, '')
  return text.slice(0, m.index) + tag + text.slice(m.index + m[0].length)
}

function stripMeta(text: string): string {
  return text
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<title\b[^>]*\/>/gi, '')
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc\s*>/gi, '')
    .replace(/<desc\b[^>]*\/>/gi, '')
    .replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata\s*>/gi, '')
    .replace(/<metadata\b[^>]*\/>/gi, '')
}

function optimizeSvg(text: string): { text: string; visual: string[]; precision: string } {
  let out = text
  const visual: string[] = []
  if (!keepViewBox.value && /viewBox=/.test(out)) {
    out = stripViewBox(out)
    visual.push('移除了 viewBox（缩放与裁剪行为可能改变）')
  }
  if (rmMeta.value) out = stripMeta(out)
  const seen: string[] = []
  out = roundAttributes(out, Number(decimals.value), seen)
  if (seen.length) visual.unshift(`把 ${seen[0]} 等坐标取整为 ${decimals.value} 位小数`)
  if (collapseWs.value) {
    out = out.replace(/>\s+</g, '><')
    out = out.replace(/\n\s+/g, '\n')
    out = out.trim()
  }
  return { text: out, visual, precision: seen[0] ?? '' }
}

function countTags(text: string): number {
  return (text.match(/<[A-Za-z][\w:-]*/g) ?? []).length
}
function countWs(text: string): number {
  return (text.match(/\s/g) ?? []).length
}
function hasMeta(text: string): boolean {
  return /<(title|desc|metadata)\b/i.test(text)
}

const sig = () => JSON.stringify([src.value, wsMode.value, viewBoxMode.value, metaMode.value, decimals.value])
const run = useToolRun(sig)

function execute() {
  diffParts.value = []
  previewUrl.value = ''
  optimized.value = ''
  grewBy.value = 0
  unsafeItems.value = []
  blocked.value = false
  visualChanges.value = []
  precisionChange.value = ''
  previewInfo.value = ''
  if (!src.value.trim()) {
    run.markIdle()
    errDetail.value = ''
    return
  }
  if (import.meta.server) return
  try {
    const doc = new DOMParser().parseFromString(src.value, 'image/svg+xml')
    const errEl = doc.querySelector('parsererror') || (doc.documentElement && doc.documentElement.nodeName.toLowerCase() === 'parsererror' ? doc.documentElement : null)
    if (errEl) {
      const detail = (errEl.textContent ?? '').trim().split('\n')[0]
      errDetail.value = `SVG 解析失败（parsererror）：${detail || '语法错误'}，已保留原输入`
      run.markFail(errDetail.value)
      return
    }
    const root = doc.documentElement
    if (!root || root.nodeName.toLowerCase() !== 'svg') {
      errDetail.value = `根元素不是 <svg>（当前为 <${root?.nodeName ?? '无'}>），请检查源码`
      run.markFail(errDetail.value)
      return
    }
    const items = scanUnsafe(root, src.value)
    unsafeItems.value = items
    blocked.value = items.length > 0
    const raw = new XMLSerializer().serializeToString(root)
    if (!blocked.value) {
      previewUrl.value = 'data:image/svg+xml,' + encodeURIComponent(raw)
      const w = root.getAttribute('width') ?? ''
      const h = root.getAttribute('height') ?? ''
      const vb = root.getAttribute('viewBox')
      previewInfo.value = [w && h ? `${w} × ${h}` : '', vb ? `viewBox ${vb}` : ''].filter(Boolean).join(' · ')
    }
    const opt = optimizeSvg(raw)
    optimized.value = opt.text
    visualChanges.value = opt.visual
    precisionChange.value = opt.precision
    origBytes.value = byteLength(src.value)
    optBytes.value = byteLength(opt.text)
    grewBy.value = Math.max(0, optBytes.value - origBytes.value)
    stats.value = {
      tagBefore: countTags(raw),
      tagAfter: countTags(opt.text),
      wsBefore: countWs(raw),
      wsAfter: countWs(opt.text),
      metaBefore: hasMeta(raw),
      metaAfter: hasMeta(opt.text)
    }
    diffParts.value = diffLines(src.value, opt.text).map((p) => ({
      type: p.added ? 'add' : p.removed ? 'del' : 'ctx',
      text: p.value.replace(/\n$/, '')
    }))
    errDetail.value = ''
    const notes: string[] = []
    if (blocked.value) notes.push(`检测到 ${items.length} 处不安全内容，预览已阻断，源码保持原样`)
    if (opt.visual.length) notes.push('本次优化可能改变渲染结果，请对比预览后再下载')
    if (grewBy.value > 0) notes.push(`优化后反而增大 ${grewBy.value} 字节`)
    run.markOk(notes.join('；'))
  } catch (e) {
    errDetail.value = `处理失败：${errMessage(e)}`
    run.markFail(errDetail.value)
  }
}

watch([wsMode, viewBoxMode, metaMode, decimals], execute)

function onFiles(files: File[]) {
  const f = files[0]
  if (!f) return
  if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') {
    toast.warning(`请选择 .svg 文件（当前：${f.name}）`)
    return
  }
  f.text().then((t) => {
    src.value = t
    execute()
    toast.success(`已载入 ${f.name}`)
  })
}

function download() {
  if (!optimized.value) return
  downloadText('optimized.svg', optimized.value, 'image/svg+xml')
}

function onReject(reason: string) {
  toast.warning(reason)
}

function focusSource() {
  const el = srcEditor.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null
  el?.focus()
}

function locateLine(line: number) {
  const el = srcEditor.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!el) return
  const lines = src.value.split('\n')
  let pos = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i]!.length + 1
  const end = pos + (lines[line - 1]?.length ?? 0)
  el.focus()
  el.setSelectionRange(pos, end)
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
  el.scrollTop = Math.max(0, (line - 1) * lh - el.clientHeight / 2)
}

function loadSample() {
  src.value = SAMPLE
  execute()
}
function loadUnsafeSample() {
  src.value = UNSAFE_SAMPLE
  execute()
}
function loadPreciseSample() {
  src.value = PRECISE_SAMPLE
  execute()
}
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t31">
    <div class="t31__toolbar">
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        格式化并优化
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!optimized || run.status.value === 'stale'" @click="clipboard.copy(optimized, '优化结果')">
        <DkIcon name="copy" :size="12" />
        复制 SVG
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!optimized || run.status.value === 'stale'" @click="download">
        <DkIcon name="download" :size="12" />
        下载
      </DkButton>
      <span class="t31__divider"></span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入简单图标示例（viewBox、注释、title）" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" title="载入含 script / onload / 外部链接的不安全示例" @click="loadUnsafeSample">不安全示例</DkButton>
      <DkButton size="sm" variant="ghost" title="载入高精度坐标示例（验证取整提示）" @click="loadPreciseSample">高精度示例</DkButton>
      <span class="t31__kbd tertiary">⌘/Ctrl + Enter 优化</span>
    </div>

    <div class="t31__params">
      <div class="t31__opt">
        <span class="t31__opt-label">压缩空白</span>
        <DkSegmented
          size="sm"
          :model-value="wsMode"
          :options="[
            { value: 'on', label: '开启' },
            { value: 'off', label: '关闭' }
          ]"
          @update:model-value="wsMode = $event as 'on' | 'off'"
        />
      </div>
      <div class="t31__opt">
        <span class="t31__opt-label">保留 viewBox</span>
        <DkSegmented
          size="sm"
          :model-value="viewBoxMode"
          :options="[
            { value: 'yes', label: '是' },
            { value: 'no', label: '否' }
          ]"
          @update:model-value="viewBoxMode = $event as 'yes' | 'no'"
        />
      </div>
      <div class="t31__opt">
        <span class="t31__opt-label">删除 title/desc</span>
        <DkSegmented
          size="sm"
          :model-value="metaMode"
          title="删除 title / desc / metadata 会影响可访问性，默认不删除"
          :options="[
            { value: 'no', label: '否' },
            { value: 'yes', label: '是' }
          ]"
          @update:model-value="metaMode = $event as 'no' | 'yes'"
        />
      </div>
      <div class="t31__opt">
        <span class="t31__opt-label">小数位</span>
        <DkSegmented
          size="sm"
          :model-value="decimals"
          :options="decOptions"
          @update:model-value="decimals = $event as '2' | '3' | '4' | '6'"
        />
      </div>
      <span class="grow"></span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="origBytes ? [`原始 ${formatBytes(origBytes)}`, `优化后 ${formatBytes(optBytes)}`, origBytes && optBytes <= origBytes ? `-${Math.round((1 - optBytes / origBytes) * 100)}%` : `+${grewBy} 字节`] : ['安全预览：不执行脚本、不加载外部资源']"
      :retry="execute"
    />

    <div v-if="blocked" class="t31__banner t31__banner--error">
      <DkIcon name="alert-circle" :size="13" />
      <span>检测到 {{ unsafeItems.length }} 处不安全内容：预览已阻断，源码保持原样，不执行、不加载任何外部资源。</span>
      <span class="grow"></span>
      <DkButton v-if="unsafeItems.length" size="sm" variant="ghost" @click="locateLine(unsafeItems[0]!.line)">定位第 {{ unsafeItems[0]!.line }} 行</DkButton>
    </div>
    <div v-else-if="visualChanges.length" class="t31__banner t31__banner--warn">
      <DkIcon name="alert-triangle" :size="13" />
      <span>本次优化{{ visualChanges.join('；') }}：可能改变渲染结果，请对比预览后再下载。</span>
      <span class="grow"></span>
      <DkButton v-if="precisionChange" size="sm" variant="ghost" @click="decimals = '6'">保留 6 位小数</DkButton>
    </div>

    <div class="t31__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <div class="t31__left">
            <FileDrop
              accept=".svg,image/svg+xml"
              :max-size="5 * 1024 * 1024"
              hint="拖入 .svg 文件（≤5MB），内容保留在本地"
              @files="onFiles"
              @reject="onReject"
            />
            <DkEditor
              ref="srcEditor"
              v-model="src"
              lang="SVG 源码"
              placeholder="粘贴 SVG 源码，或拖入 .svg 文件"
              :error="run.status.value === 'error' ? errDetail : undefined"
              height="100%"
              filename="input.svg"
            />
          </div>
        </template>
        <template #right>
          <div class="t31__right">
            <div class="t31__panel">
              <div class="t31__panel-head">
                <DkIcon name="shield" :size="13" />
                <span>安全预览</span>
                <span class="t31__tag t31__tag--ok">不执行脚本</span>
                <span class="t31__tag t31__tag--ok">不加载远程资源</span>
                <span v-if="blocked" class="t31__tag t31__tag--error">预览已阻断</span>
                <span v-else-if="previewUrl" class="t31__tag">预览已隔离</span>
                <span class="grow"></span>
                <span v-if="previewInfo" class="tertiary t31__preview-info mono">{{ previewInfo }}</span>
              </div>
              <div class="t31__preview" :class="{ 't31__preview--empty': !previewUrl }">
                <img v-if="previewUrl" :src="previewUrl" alt="SVG 安全预览" @error="previewUrl = ''" />
                <div v-else-if="blocked" class="t31__blocked">
                  <DkIcon name="alert-circle" :size="20" class="t31__blocked-icon" />
                  <p class="t31__blocked-title">预览已阻止不安全内容</p>
                  <p class="t31__blocked-sub">移除 &lt;script&gt;、on* 事件与远程 href 后才能预览</p>
                  <ul class="t31__unsafe-list mono">
                    <li v-for="(u, i) in unsafeItems" :key="i">第 {{ u.line }} 行 · {{ u.kind }} · {{ u.snippet }}</li>
                  </ul>
                  <DkButton size="sm" variant="secondary" @click="focusSource">仅查看源码</DkButton>
                  <p class="tertiary t31__blocked-note">未执行任何脚本与网络请求</p>
                </div>
                <p v-else class="tertiary t31__preview-hint">解析成功后在此预览（不执行脚本、不加载远程资源）</p>
              </div>
            </div>

            <div v-if="origBytes" class="t31__panel">
              <div class="t31__panel-head">
                <span>优化前后</span>
                <span class="grow"></span>
                <span class="tertiary">{{ visualChanges.length ? '精度已降低 · 请对比后再下载' : '优化完成 · 视觉未改变' }}</span>
              </div>
              <div class="t31__stats">
                <div class="t31__stat">
                  <span class="t31__stat-k">字节</span>
                  <span class="mono t31__stat-v">{{ origBytes }} → {{ optBytes }}</span>
                  <span class="t31__stat-d" :class="optBytes <= origBytes ? 't31__stat-d--ok' : 't31__stat-d--warn'">
                    {{ optBytes <= origBytes ? `-${origBytes - optBytes} · -${origBytes ? Math.round((1 - optBytes / origBytes) * 100) : 0}%` : `+${grewBy} 字节` }}
                  </span>
                </div>
                <div class="t31__stat">
                  <span class="t31__stat-k">标签数</span>
                  <span class="mono t31__stat-v">{{ stats.tagBefore }} → {{ stats.tagAfter }}</span>
                  <span class="t31__stat-d">{{ stats.tagBefore === stats.tagAfter ? '节点未删除' : `已删除 ${stats.tagBefore - stats.tagAfter}` }}</span>
                </div>
                <div class="t31__stat">
                  <span class="t31__stat-k">空白字符</span>
                  <span class="mono t31__stat-v">{{ stats.wsBefore }} → {{ stats.wsAfter }}</span>
                  <span class="t31__stat-d" :class="stats.wsAfter < stats.wsBefore ? 't31__stat-d--ok' : ''">{{ stats.wsAfter < stats.wsBefore ? '已压缩' : '未压缩' }}</span>
                </div>
                <div class="t31__stat">
                  <span class="t31__stat-k">title / desc</span>
                  <span class="mono t31__stat-v">{{ stats.metaAfter ? '保留' : '已删除' }}</span>
                  <span class="t31__stat-d">{{ stats.metaAfter ? '可访问性完整' : '可访问性信息已移除' }}</span>
                </div>
              </div>
            </div>

            <DkEditor
              :model-value="optimized"
              readonly
              lang="优化结果"
              placeholder="优化后的 SVG 将显示在这里"
              :stale="run.status.value === 'stale'"
              height="100%"
              filename="optimized.svg"
            />
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="diffParts.length && run.status.value === 'ok'" class="t31__diff">
      <p class="t31__diff-title">前后差异（行级：红=删除，绿=新增）</p>
      <div class="t31__diff-body mono">
        <div v-for="(p, i) in diffParts" :key="i" class="t31__diff-line" :class="`t31__diff-line--${p.type}`">
          <span class="t31__diff-mark">{{ p.type === 'add' ? '+' : p.type === 'del' ? '-' : ' ' }}</span>
          <span class="t31__diff-text">{{ p.text }}</span>
        </div>
      </div>
    </div>

    <DkCollapse title="预览与优化的边界">
      <h4>安全预览</h4>
      <ul>
        <li>检测到 <code>&lt;script&gt;</code>、<code>&lt;foreignObject&gt;</code>、<code>on*</code> 事件属性或远程 <code>href</code>/<code>xlink:href</code>（非 <code>#</code>/<code>data:</code> 开头）时，<strong>阻断预览</strong>，源码保持原样，仅可查看与定位。</li>
        <li>只有未检测到上述内容时才用 <code>img data URL</code> 渲染：不执行脚本、不加载远程资源；优化输出始终是纯文本处理，不会执行任何内容。</li>
        <li>预览在隔离容器中渲染，与浏览器最终渲染可能略有差异。</li>
      </ul>
      <h4>优化选项</h4>
      <ul>
        <li>坐标小数位只对几何属性与路径数据取整；<code>1.500 → 1.5</code> 不损失精度，因此不触发“改变视觉”提示。</li>
        <li>关闭「保留 viewBox」或坐标精度下降（如 <code>12.345678 → 12.35</code>）会真实改变渲染，横幅会明确提示并给出「保留 6 位小数」。</li>
        <li><code>title</code>/<code>desc</code> 影响可访问性，默认不移除，需显式选择。</li>
        <li>字节数为 UTF-8 真实统计；优化后变大时会给出提示。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t31 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t31__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t31__divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t31__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t31__params {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.t31__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t31__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t31__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.55;
}
.t31__banner--error {
  background: var(--error-soft);
  color: var(--error);
}
.t31__banner--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.t31__panes {
  height: calc(60vh - 60px);
  min-height: 320px;
}
.t31__left,
.t31__right {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.t31__right {
  overflow: auto;
}
.t31__left :deep(.filedrop) {
  padding: 12px 16px;
}
.t31__panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
  flex-shrink: 0;
}
.t31__panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t31__tag {
  font-size: 11px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
}
.t31__tag--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.t31__tag--error {
  background: var(--error-soft);
  color: var(--error);
}
.t31__preview-info {
  font-size: 11px;
}
.t31__preview {
  border-radius: 0;
  background:
    repeating-conic-gradient(var(--surface-subtle) 0% 25%, var(--surface) 0% 50%) 0 0 / 16px 16px;
  min-height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.t31__preview img {
  max-width: 100%;
  max-height: 180px;
}
.t31__preview-hint {
  font-size: 12px;
  max-width: 420px;
  text-align: center;
  line-height: 1.6;
}
.t31__blocked {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 8px;
}
.t31__blocked-icon {
  color: var(--error);
}
.t31__blocked-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--error);
  margin: 0;
}
.t31__blocked-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}
.t31__unsafe-list {
  list-style: none;
  padding: 6px 10px;
  margin: 2px 0;
  background: var(--error-soft);
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  color: var(--error);
  text-align: left;
  max-width: 100%;
  max-height: 110px;
  overflow: auto;
}
.t31__blocked-note {
  font-size: 11px;
  margin: 0;
}
.t31__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px 14px;
  padding: 10px 12px;
}
.t31__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.t31__stat-k {
  font-size: 11px;
  color: var(--text-tertiary);
}
.t31__stat-v {
  font-size: 12.5px;
  color: var(--text-primary);
}
.t31__stat-d {
  font-size: 11px;
  color: var(--text-tertiary);
}
.t31__stat-d--ok {
  color: var(--ok);
}
.t31__stat-d--warn {
  color: var(--warn);
}
.t31__diff {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.t31__diff-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.t31__diff-body {
  max-height: 260px;
  overflow: auto;
  font-size: var(--code-font-size);
  line-height: 1.6;
  background: var(--editor-bg);
}
.t31__diff-line {
  display: flex;
  gap: 8px;
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
.t31__diff-line--add {
  background: var(--ok-soft);
}
.t31__diff-line--del {
  background: var(--error-soft);
}
.t31__diff-mark {
  width: 12px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.t31__diff-line--add .t31__diff-mark {
  color: var(--ok);
}
.t31__diff-line--del .t31__diff-mark {
  color: var(--error);
}
.t31__diff-text {
  min-width: 0;
}
</style>
