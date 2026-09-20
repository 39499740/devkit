<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()

// ---------- 颜色解析（#hex / rgb() / hsl()，均支持 alpha） ----------
interface RGBA {
  r: number
  g: number
  b: number
  a: number
}
type ParseResult = RGBA | { error: string }

function isRGBA(p: ParseResult): p is RGBA {
  return !('error' in p)
}

function parseColor(input: string): ParseResult {
  const s = input.trim().toLowerCase()
  if (s === '') return { error: '颜色为空' }
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return { error: `#${hex} 含非十六进制字符` }
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: hex.length === 4 ? parseInt(hex[3]! + hex[3]!, 16) / 255 : 1
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      }
    }
    return { error: `#${hex} 长度不合法（支持 3 / 4 / 6 / 8 位）` }
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!m) return { error: `无法解析“${input}”：支持 #rgb/#rrggbb/#rrggbbaa、rgb()/rgba()、hsl()/hsla()` }
  const fn = m[1]!
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return { error: `${fn}() 参数不足（需要 3-4 个）` }
  const parseAlpha = (str: string | undefined): number | null => {
    if (str === undefined) return 1
    const v = str.endsWith('%') ? parseFloat(str) / 100 : parseFloat(str)
    if (Number.isNaN(v) || v < 0 || v > 1) return null
    return v
  }
  if (fn.startsWith('rgb')) {
    const chan: number[] = []
    for (const p of parts.slice(0, 3)) {
      const v = p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)
      if (Number.isNaN(v) || v < 0 || v > 255) return { error: 'rgb() 分量需在 0-255（或 0-100%）之间' }
      chan.push(Math.round(v))
    }
    const a = parseAlpha(parts[3])
    if (a === null) return { error: 'alpha 需在 0-1（或 0-100%）之间' }
    return { r: chan[0]!, g: chan[1]!, b: chan[2]!, a }
  }
  const h = parseFloat(parts[0]!)
  const sat = parseFloat(parts[1]!)
  const l = parseFloat(parts[2]!)
  if ([h, sat, l].some(Number.isNaN) || sat < 0 || sat > 100 || l < 0 || l > 100) {
    return { error: 'hsl() 需为 hsl(色相 0-360, 饱和度 0-100%, 亮度 0-100%)' }
  }
  const a = parseAlpha(parts[3])
  if (a === null) return { error: 'alpha 需在 0-1（或 0-100%）之间' }
  const rgb = hslToRgb(((h % 360) + 360) % 360, sat / 100, l / 100)
  return { r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b), a }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (h < 60) [rp, gp, bp] = [c, x, 0]
  else if (h < 120) [rp, gp, bp] = [x, c, 0]
  else if (h < 180) [rp, gp, bp] = [0, c, x]
  else if (h < 240) [rp, gp, bp] = [0, x, c]
  else if (h < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')
const round2 = (n: number) => Math.round(n * 100) / 100
const baseHex = (c: RGBA) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
const formatHex = (c: RGBA) => (c.a < 1 ? `${baseHex(c)}${hex2(Math.round(c.a * 255))}` : baseHex(c))
function formatRgb(c: RGBA): string {
  return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${round2(c.a)})` : `rgb(${c.r}, ${c.g}, ${c.b})`
}
function formatHsl(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b)
  return c.a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${round2(c.a)})` : `hsl(${h}, ${s}%, ${l}%)`
}
function cssColor(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`
}

// ---------- WCAG 对比度 ----------
function luminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}
function contrastRatio(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  const l1 = luminance(c1)
  const l2 = luminance(c2)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}
function composite(fg: RGBA, bg: RGBA): RGBA {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1
  }
}

// ---------- 颜色状态 ----------
const inputFormat = ref<'hex' | 'rgb' | 'hsl'>('hex')
const fgText = ref('#2563eb')
const fgOpacityStr = ref('100')
const bgText = ref('#ffffff')
const compBgText = ref('#ffffff')

const fgParsed = computed<ParseResult>(() => parseColor(fgText.value))
const bgParsed = computed<ParseResult>(() => parseColor(bgText.value))
const compBgParsed = computed<ParseResult>(() => parseColor(compBgText.value))

const fgErr = computed(() => (isRGBA(fgParsed.value) ? '' : fgParsed.value.error))
const bgErr = computed(() => (isRGBA(bgParsed.value) ? '' : bgParsed.value.error))
const compBgErr = computed(() => (isRGBA(compBgParsed.value) ? '' : compBgParsed.value.error))

const fgOpacity = computed(() => {
  const v = parseFloat(fgOpacityStr.value)
  return Number.isNaN(v) ? 1 : Math.min(1, Math.max(0, v / 100))
})
const opacityErr = computed(() => {
  const t = fgOpacityStr.value.trim()
  if (t === '') return '请输入不透明度（0-100）'
  const v = Number(t)
  if (Number.isNaN(v)) return `“${t}”不是数字`
  if (v < 0 || v > 100) return `需在 0-100 之间（当前 ${t}）`
  return ''
})

const compBgColor = computed<RGBA>(() =>
  isRGBA(compBgParsed.value) ? { ...compBgParsed.value, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
)

const fgRgba = computed<RGBA | null>(() => (isRGBA(fgParsed.value) ? { ...fgParsed.value, a: fgOpacity.value } : null))
const bgRgba = computed<RGBA | null>(() => (isRGBA(bgParsed.value) ? { ...bgParsed.value } : null))

const fgEff = computed<RGBA | null>(() => {
  const p = fgRgba.value
  if (!p) return null
  return p.a >= 1 ? p : composite(p, compBgColor.value)
})
const bgEff = computed<RGBA | null>(() => {
  const p = bgRgba.value
  if (!p) return null
  return p.a >= 1 ? p : composite(p, compBgColor.value)
})

const hasAlpha = computed(() => fgOpacity.value < 0.995 || (bgRgba.value?.a ?? 1) < 0.995)

const fgEffHex = computed(() => (fgEff.value ? baseHex(fgEff.value) : '#000000'))
const bgEffHex = computed(() => (bgEff.value ? baseHex(bgEff.value) : '#ffffff'))

const contrast = computed(() => {
  if (!fgEff.value || !bgEff.value) return null
  const ratio = contrastRatio(fgEff.value, bgEff.value)
  return { ratio }
})

const checks = computed(() => {
  if (!contrast.value) return []
  const r = contrast.value.ratio
  return [
    { label: 'AA 正文', need: '4.5:1', pass: r >= 4.5 },
    { label: 'AA 大字', need: '3:1', pass: r >= 3 },
    { label: 'AAA 正文', need: '7:1', pass: r >= 7 },
    { label: 'AAA 大字', need: '4.5:1', pass: r >= 4.5 }
  ]
})

// ---------- 建议替代色（保持色相/饱和度，调整亮度实算） ----------
interface Suggestion {
  hex: string
  ratio: number
  target: number
}
function suggestionFor(target: number): Suggestion | null {
  const f = fgRgba.value
  const bgc = bgEff.value
  if (!f || !bgc) return null
  const { h, s, l } = rgbToHsl(f.r, f.g, f.b)
  const dir = luminance(f) > luminance(bgc) ? 1 : -1
  const ratioAt = (ll: number) => {
    const rgb = hslToRgb(h, s / 100, ll / 100)
    return contrastRatio({ r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b) }, bgc)
  }
  const endpoint = dir > 0 ? 100 : 0
  if (ratioAt(endpoint) < target) return null
  let lo = dir > 0 ? l : 0
  let hi = dir > 0 ? 100 : l
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const ok = ratioAt(mid) >= target
    if (dir > 0) {
      if (ok) hi = mid
      else lo = mid
    } else {
      if (ok) lo = mid
      else hi = mid
    }
  }
  const ll = dir > 0 ? hi : lo
  const rgb = hslToRgb(h, s / 100, ll / 100)
  const c: RGBA = { r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b), a: 1 }
  return { hex: baseHex(c), ratio: contrastRatio(c, bgc), target }
}
const suggestions = computed<Suggestion[]>(() => {
  const r = contrast.value?.ratio
  if (r == null || !fgRgba.value) return []
  const out: Suggestion[] = []
  if (r < 4.5) {
    const a = suggestionFor(4.5)
    if (a) out.push(a)
  }
  if (r < 7) {
    const b = suggestionFor(7)
    if (b && (!out.length || b.hex !== out[0]!.hex)) out.push(b)
  }
  return out
})

const firstSuggestion = computed<Suggestion | null>(() => suggestions.value[0] ?? null)

// ---------- 上次有效色 ----------
const fgLastValid = ref('#2563eb')
const bgLastValid = ref('#ffffff')
const compBgLastValid = ref('#ffffff')
watch(
  fgParsed,
  (p) => {
    if (isRGBA(p)) {
      fgLastValid.value = fgText.value
      if (p.a < 0.995) fgOpacityStr.value = String(Math.round(p.a * 100))
    }
  },
  { immediate: true }
)
watch(bgParsed, (p) => { if (isRGBA(p)) bgLastValid.value = bgText.value }, { immediate: true })
watch(compBgParsed, (p) => { if (isRGBA(p)) compBgLastValid.value = compBgText.value }, { immediate: true })

function restoreFg() {
  fgText.value = fgLastValid.value
  execute()
}
function restoreBg() {
  bgText.value = bgLastValid.value
  execute()
}
function restoreCompBg() {
  compBgText.value = compBgLastValid.value
  execute()
}
function makeOpaque() {
  fgOpacityStr.value = '100'
  execute()
}

// ---------- 格式 ----------
const formatOptions = [
  { value: 'hex', label: 'HEX' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' }
]
const placeholder = computed(
  () =>
    ({
      hex: '#2563eb 或 #2563eb99',
      rgb: 'rgb(37, 99, 235) / rgba(37, 99, 235, 0.6)',
      hsl: 'hsl(221, 83%, 53%) / hsla(221, 83%, 53%, 0.6)'
    })[inputFormat.value]
)

function formatByMode(c: RGBA, mode: 'hex' | 'rgb' | 'hsl'): string {
  if (mode === 'hex') return formatHex(c)
  if (mode === 'rgb') return formatRgb(c)
  return formatHsl(c)
}
function changeFormat(mode: 'hex' | 'rgb' | 'hsl') {
  inputFormat.value = mode
  if (fgRgba.value) fgText.value = formatByMode(fgRgba.value, mode)
}

const formatRows = computed(() => {
  const p = fgRgba.value
  if (!p) return []
  return [
    { label: p.a < 1 ? 'HEX（合成）' : 'HEX', value: p.a < 1 ? fgEffHex.value : baseHex(p) },
    { label: 'HEX8', value: baseHex(p) + hex2(Math.round(p.a * 255)) },
    { label: 'RGB', value: `rgb(${p.r}, ${p.g}, ${p.b})` },
    { label: 'RGBA', value: `rgba(${p.r}, ${p.g}, ${p.b}, ${round2(p.a)})` },
    { label: 'HSL', value: formatByMode({ ...p, a: 1 }, 'hsl') },
    { label: 'HSLA', value: formatHsl(p) }
  ]
})
function copyAllFormats() {
  clipboard.copy(formatRows.value.map((r) => `${r.label} ${r.value}`).join('\n'), '全部色值格式')
}

// ---------- 预览事件 ----------
function onFgPicker(e: Event) {
  const hex = (e.target as HTMLInputElement).value
  fgText.value = fgOpacity.value < 0.995 ? hex + hex2(Math.round(fgOpacity.value * 255)) : hex
}
function onBgPicker(e: Event) {
  bgText.value = (e.target as HTMLInputElement).value
}
function onCompPicker(e: Event) {
  compBgText.value = (e.target as HTMLInputElement).value
}
function applySuggestion(s: Suggestion) {
  fgText.value = s.hex
  fgOpacityStr.value = '100'
  execute()
}

// ---------- 状态 ----------
const sig = () => JSON.stringify([fgText.value, fgOpacityStr.value, bgText.value, compBgText.value])
const run = useToolRun(sig)

function execute() {
  if (!fgText.value.trim() && !bgText.value.trim()) {
    run.markIdle()
    return
  }
  if (fgErr.value) {
    run.markFail(`前景色：${fgErr.value}`)
    return
  }
  if (bgErr.value) {
    run.markFail(`背景色：${bgErr.value}`)
    return
  }
  if (compBgErr.value) {
    run.markFail(`合成背景：${compBgErr.value}`)
    return
  }
  if (opacityErr.value) {
    run.markFail(`不透明度：${opacityErr.value}`)
    return
  }
  const c = contrast.value
  if (c) {
    run.markOk(
      hasAlpha.value
        ? `含透明度，已按合成背景 ${baseHex(compBgColor.value)} 计算：对比度 ${c.ratio.toFixed(2)}:1`
        : `对比度 ${c.ratio.toFixed(2)}:1（WCAG 相对亮度公式）`
    )
  } else {
    run.markOk('颜色格式有效，缺少背景色无法计算对比度')
  }
}

const canCopy = computed(() => run.status.value === 'ok')
function downloadReport() {
  if (run.status.value !== 'ok') return
  const lines = [
    `前景 ${fgText.value}${fgOpacity.value < 1 ? `（不透明度 ${Math.round(fgOpacity.value * 100)}%）` : ''}`,
    `背景 ${bgText.value}`,
    ...formatRows.value.map((r) => `${r.label}: ${r.value}`),
    contrast.value ? `对比度: ${contrast.value.ratio.toFixed(2)}:1` : '对比度: 未计算'
  ]
  downloadText('color.txt', lines.join('\n'), 'text/plain;charset=utf-8')
}

onMounted(execute)
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
  <div class="t30">
    <div class="t30__toolbar">
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="refresh" :size="12" />
        转换
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!canCopy || !formatRows.length" @click="copyAllFormats">
        <DkIcon name="copy" :size="12" />
        复制全部格式
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!canCopy" @click="downloadReport">
        <DkIcon name="download" :size="12" />
        下载
      </DkButton>
      <span class="t30__sep"></span>
      <DkButton size="sm" variant="ghost" title="蓝色与白底" @click="fgText = '#2563eb'; fgOpacityStr = '100'; bgText = '#ffffff'; compBgText = '#ffffff'; execute()">蓝色示例</DkButton>
      <DkButton size="sm" variant="ghost" title="低对比组合" @click="fgText = '#9ca3af'; fgOpacityStr = '100'; bgText = '#ffffff'; compBgText = '#ffffff'; execute()">低对比示例</DkButton>
      <DkButton size="sm" variant="ghost" title="半透明前景 + 合成背景" @click="fgText = '#2563eb'; fgOpacityStr = '60'; bgText = '#ffffff'; compBgText = '#ffffff'; execute()">透明度示例</DkButton>
      <span class="grow"></span>
      <span class="t30__kbd tertiary">⌘⏎ 转换</span>
    </div>

    <div v-if="fgErr" class="t30__tip t30__tip--err">
      <DkIcon name="alert-circle" :size="13" />
      <span>前景色无效：{{ fgErr }}；支持 #RGB、#RRGGBB、#RRGGBBAA 与 rgb() / hsl() 写法。</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="restoreFg">恢复上一个有效色 {{ fgLastValid }}</DkButton>
    </div>
    <div v-else-if="opacityErr" class="t30__tip t30__tip--err">
      <DkIcon name="alert-circle" :size="13" />
      <span>不透明度无效：{{ opacityErr }}</span>
    </div>
    <div v-else-if="bgErr" class="t30__tip t30__tip--err">
      <DkIcon name="alert-circle" :size="13" />
      <span>背景色无效：{{ bgErr }}</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="restoreBg">恢复上一个有效色 {{ bgLastValid }}</DkButton>
    </div>
    <div v-else-if="compBgErr" class="t30__tip t30__tip--err">
      <DkIcon name="alert-circle" :size="13" />
      <span>合成背景无效：{{ compBgErr }}</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="restoreCompBg">恢复上一个有效色 {{ compBgLastValid }}</DkButton>
    </div>
    <div v-else-if="hasAlpha && contrast" class="t30__tip">
      <DkIcon name="info" :size="13" />
      <span>前景色带 {{ Math.round(fgOpacity * 100) }}% 不透明度：对比度按合成后的实色 {{ fgEffHex }} 计算，合成背景不可省略。</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="makeOpaque">改为不透明</DkButton>
    </div>
    <div v-else-if="contrast && contrast.ratio < 4.5" class="t30__tip">
      <DkIcon name="alert-triangle" :size="13" />
      <span>对比度 {{ contrast.ratio.toFixed(2) }}:1 未达 AA 正文要求（4.5:1）：该组合可用于装饰或禁用态文字，不适合正文与小字号。</span>
      <span class="grow"></span>
      <DkButton v-if="firstSuggestion" size="sm" variant="ghost" @click="firstSuggestion && applySuggestion(firstSuggestion)">
        采用建议色 {{ firstSuggestion.hex }}
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="['WCAG 2.1 相对亮度', 'AA 正文 ≥4.5 / 大字 ≥3', 'AAA 正文 ≥7 / 大字 ≥4.5']"
      :retry="execute"
    />

    <div class="t30__grid">
      <div class="t30__col">
        <div class="t30__side" :class="{ 't30__side--err': !!fgErr }">
          <p class="t30__side-title">前景色（文本）</p>
          <DkField label="输入格式" help="切换后会把当前颜色改写成所选写法，解析本身兼容全部写法">
            <DkSegmented size="sm" :model-value="inputFormat" :options="formatOptions" @update:model-value="changeFormat($event as any)" />
          </DkField>
          <DkField label="颜色" :error="fgErr || undefined">
            <div class="t30__inrow">
              <input type="color" class="t30__picker" :value="fgEff ? baseHex(fgEff) : '#000000'" title="打开取色器" @input="onFgPicker" />
              <DkInput v-model="fgText" mono :error="!!fgErr" :placeholder="placeholder" />
            </div>
          </DkField>
          <DkField label="不透明度" :error="opacityErr || undefined">
            <div class="t30__inrow">
              <DkInput v-model="fgOpacityStr" mono :error="!!opacityErr" class="t30__opacity" placeholder="100" />
              <span class="tertiary">%</span>
            </div>
          </DkField>
        </div>

        <div class="t30__side" :class="{ 't30__side--err': !!bgErr }">
          <p class="t30__side-title">背景色</p>
          <DkField label="颜色" :error="bgErr || undefined">
            <div class="t30__inrow">
              <input type="color" class="t30__picker" :value="bgEff ? baseHex(bgEff) : '#000000'" title="打开取色器" @input="onBgPicker" />
              <DkInput v-model="bgText" mono :error="!!bgErr" placeholder="#ffffff" />
            </div>
          </DkField>
        </div>

        <div class="t30__side" :class="{ 't30__side--err': !!compBgErr }">
          <p class="t30__side-title">合成背景</p>
          <DkField label="合成背景色（透明色先压到它上面再算对比度）" :error="compBgErr || undefined" help="默认白 #ffffff，仅影响透明色/预览的合成">
            <div class="t30__inrow">
              <input type="color" class="t30__picker" :value="baseHex(compBgColor)" title="打开取色器" @input="onCompPicker" />
              <DkInput v-model="compBgText" mono :error="!!compBgErr" placeholder="#ffffff" />
            </div>
          </DkField>
        </div>
      </div>

      <div class="t30__col">
        <div class="t30__side">
          <div class="t30__side-head">
            <p class="t30__side-title">色值格式</p>
            <span class="tertiary t30__side-hint">单行可单独复制</span>
            <span class="grow"></span>
            <DkButton size="sm" variant="ghost" :disabled="!canCopy || !formatRows.length" @click="copyAllFormats">复制全部</DkButton>
          </div>
          <div v-if="formatRows.length" class="t30__outs">
            <div v-for="o in formatRows" :key="o.label" class="t30__out">
              <span class="t30__out-label">{{ o.label }}</span>
              <span class="t30__out-val mono">{{ o.value }}</span>
              <DkIconButton title="复制" :disabled="!canCopy" @click="clipboard.copy(o.value, o.label)">
                <DkIcon name="copy" :size="13" />
              </DkIconButton>
            </div>
          </div>
          <p v-else class="tertiary">颜色解析失败，未输出色值。输入内容已保留，修正后可直接重新转换。</p>
        </div>

        <div class="t30__side">
          <div class="t30__side-head">
            <p class="t30__side-title">对比度与预览</p>
            <span class="t30__tag">WCAG 2.1</span>
          </div>
          <div v-if="fgEff && bgEff" class="t30__preview" :style="{ background: cssColor(bgEff) }">
            <div class="t30__preview-big" :style="{ color: cssColor(fgEff) }">Aa</div>
            <div class="t30__preview-small" :style="{ color: cssColor(fgEff) }">正文 14px：中文与 English 混排示例</div>
          </div>
          <div v-else class="t30__preview t30__preview--empty tertiary">修正颜色后显示预览</div>

          <template v-if="contrast">
            <div class="t30__contrast">
              <div class="t30__ratio">
                <span class="t30__ratio-num mono">{{ contrast.ratio.toFixed(2) }}</span>
                <span class="t30__ratio-unit">: 1</span>
              </div>
              <div class="t30__grades">
                <span v-for="c in checks" :key="c.label" class="t30__grade" :class="c.pass ? 't30__grade--ok' : 't30__grade--fail'">
                  {{ c.pass ? '通过' : '未达' }} {{ c.label }}（{{ c.need }}）
                </span>
              </div>
            </div>

            <div v-if="suggestions.length" class="t30__sug">
              <p class="t30__sug-title">同色系可用替代（背景 {{ bgEffHex }}，保持色相/饱和度实算）</p>
              <div v-for="s in suggestions" :key="s.hex" class="t30__sug-row">
                <span class="t30__sug-chip" :style="{ background: s.hex }"></span>
                <span class="mono">{{ s.hex }}</span>
                <span class="tertiary">{{ s.ratio.toFixed(2) }} : 1</span>
                <span class="t30__grade" :class="s.ratio >= 4.5 ? 't30__grade--ok' : 't30__grade--fail'">
                  {{ s.ratio >= 4.5 ? '通过 AA 正文' : '大字可用' }}
                </span>
                <span class="grow"></span>
                <DkIconButton title="复制建议色" :disabled="!canCopy" @click="clipboard.copy(s.hex, '建议色')">
                  <DkIcon name="copy" :size="13" />
                </DkIconButton>
                <DkButton size="sm" variant="ghost" :disabled="!canCopy" @click="applySuggestion(s)">采用</DkButton>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <DkCollapse title="对比度的计算依据">
      <h4>WCAG 2.1 相对亮度公式</h4>
      <ul>
        <li>sRGB 分量先线性化：<code>c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4</code>。</li>
        <li>相对亮度加权：<code>L = 0.2126·R + 0.7152·G + 0.0722·B</code>。</li>
        <li>对比度：<code>ratio = (L1+0.05)/(L2+0.05)</code>（L1 为较亮者），范围 1-21。</li>
        <li>门槛：AA 正文 <code>≥4.5:1</code>，AA 大字 <code>≥3:1</code>，AAA 正文 <code>≥7:1</code>，AAA 大字 <code>≥4.5:1</code>。</li>
        <li>建议替代色保持原色相与饱和度，只调整亮度并用同一公式实算到恰好达到门槛，不自动替换你填写的颜色。</li>
      </ul>
      <h4>透明色</h4>
      <p>含 alpha 的前景色无法直接给出绝对对比度：先在合成背景色上做 alpha 合成得到实色，再计算它与背景的对比度。界面会注明「已按合成背景 #xxx 计算」。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t30 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t30__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t30__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t30__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t30__tip {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--warn);
  background: var(--warn-soft);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--warn);
}
.t30__tip--err {
  border-color: var(--error);
  background: var(--error-soft);
  color: var(--error);
}
.t30__grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 900px) {
  .t30__grid {
    grid-template-columns: 1fr;
  }
}
.t30__col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.t30__side {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.t30__side--err {
  border-color: var(--error);
}
.t30__side-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t30__side-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}
.t30__side-hint {
  font-size: 11px;
}
.t30__inrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t30__opacity {
  width: 90px;
}
.t30__picker {
  width: 34px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
  flex-shrink: 0;
}
.t30__outs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.t30__out {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.t30__out-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  width: 74px;
  flex-shrink: 0;
}
.t30__out-val {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t30__preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.t30__preview--empty {
  color: var(--text-tertiary);
  font-size: 13px;
  min-height: 100px;
  justify-content: center;
}
.t30__preview-big {
  font-size: 44px;
  font-weight: 600;
  line-height: 1.1;
}
.t30__preview-small {
  font-size: 14px;
}
.t30__contrast {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.t30__ratio {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.t30__ratio-num {
  font-size: 30px;
  font-weight: 700;
  color: var(--accent);
}
.t30__ratio-unit {
  font-size: 13px;
  color: var(--text-tertiary);
}
.t30__grades {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.t30__grade {
  font-size: 11.5px;
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}
.t30__grade--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t30__grade--fail {
  color: var(--error);
  background: var(--error-soft);
}
.t30__sug {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.t30__sug-title {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin: 0 0 6px;
}
.t30__sug-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}
.t30__sug-chip {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.t30__tag {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border-radius: 6px;
  padding: 2px 8px;
}
</style>
