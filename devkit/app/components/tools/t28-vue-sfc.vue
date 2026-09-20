<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const toast = useToast()

interface PropRow {
  name: string
  type: 'String' | 'Number' | 'Boolean' | 'Array' | 'Object' | 'Date'
  required: boolean
  def: string
}
interface EmitRow {
  name: string
}

const compName = ref('UserForm')
const lang = ref<'ts' | 'js'>('ts')
const propRows = ref<PropRow[]>([{ name: 'title', type: 'String', required: true, def: '' }, { name: 'disabled', type: 'Boolean', required: false, def: 'false' }])
const emitRows = ref<EmitRow[]>([{ name: 'submit' }])
const styleKind = ref<'scoped' | 'global' | 'none'>('scoped')
const styleLang = ref<'css' | 'scss'>('css')
const output = ref('')
const errDetail = ref('')
const warnList = ref<string[]>([])

const PROP_TYPES = ['String', 'Number', 'Boolean', 'Array', 'Object', 'Date'] as const
const TS_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'unknown[]',
  Object: 'Record<string, unknown>',
  Date: 'Date'
}

// 组件名校验：合法标识符 + 非保留字（JS 保留字与 Vue 内建组件名）
const JS_RESERVED = new Set(
  ('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'as implements interface let package private protected public static yield let static')
    .split(' ')
    .filter(Boolean)
)
const VUE_RESERVED = new Set(['component', 'transition', 'transitiongroup', 'transition-group', 'keepalive', 'keep-alive', 'teleport', 'suspense', 'slot', 'template'])

function isValidIdent(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)
}

const nameErr = computed(() => {
  const n = compName.value.trim()
  if (!n) return '请填写组件名'
  if (!isValidIdent(n)) return `组件名 “${n}” 不是合法的标识符（字母/数字/_/$，且不能以数字开头）`
  if (JS_RESERVED.has(n) || VUE_RESERVED.has(n.toLowerCase())) return `组件名 “${n}” 是保留字（JS 保留字或 Vue 内建组件名）`
  return ''
})

const nameWarn = computed(() => {
  const n = compName.value.trim()
  if (!n || nameErr.value) return ''
  // 单词组件名（不含连字符/驼峰分隔）给黄色建议，不阻止生成
  const words = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean)
  if (words.length < 2) return '组件名建议多词（Vue 风格指南），如 UserForm / AppHeader'
  return ''
})

function validDefault(def: string): boolean {
  const s = def.trim()
  if (!s) return true
  if (/^-?\d+(\.\d+)?$/.test(s)) return true
  if (/^'([^'\\\n]|\\.)*'$/.test(s)) return true
  if (/^"([^"\\\n]|\\.)*"$/.test(s)) return true
  if (s === 'true' || s === 'false' || s === 'null' || s === '[]' || s === '{}') return true
  return false
}

const emitNameRe = /^[A-Za-z][A-Za-z0-9:_-]*$/

const rowsErr = computed(() => {
  const seenP = new Set<string>()
  for (let i = 0; i < propRows.value.length; i++) {
    const r = propRows.value[i]!
    const n = r.name.trim()
    if (!n) continue // 空行忽略
    if (!isValidIdent(n)) return `props 第 ${i + 1} 行：名称 “${n}” 不是合法标识符`
    if (seenP.has(n)) return `props 第 ${i + 1} 行：名称 “${n}” 重复`
    seenP.add(n)
    if (!validDefault(r.def)) return `props 第 ${i + 1} 行：默认值仅支持字面量（数字、引号字符串、true/false、[]、{}、null）`
  }
  const seenE = new Set<string>()
  for (let i = 0; i < emitRows.value.length; i++) {
    const n = emitRows.value[i]!.name.trim()
    if (!n) continue
    if (!emitNameRe.test(n)) return `emits 第 ${i + 1} 行：事件名 “${n}” 不合法（字母开头，可含字母数字 : _ -）`
    if (seenE.has(n)) return `emits 第 ${i + 1} 行：事件名 “${n}” 重复`
    seenE.add(n)
  }
  return ''
})

function addProp() {
  propRows.value.push({ name: '', type: 'String', required: false, def: '' })
}
function removeProp(i: number) {
  propRows.value.splice(i, 1)
}
function addEmit() {
  emitRows.value.push({ name: '' })
}
function removeEmit(i: number) {
  emitRows.value.splice(i, 1)
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// ---------- 生成（纯静态模板，不执行、不调用 AI） ----------
function generate(): { code: string; warnings: string[] } {
  const name = compName.value.trim()
  const isTs = lang.value === 'ts'
  const propList = propRows.value.filter((r) => r.name.trim())
  const emitList = emitRows.value.filter((r) => r.name.trim()).map((r) => r.name.trim())
  const warnings: string[] = []

  const scriptLines: string[] = []
  if (isTs) {
    if (propList.length) {
      const fields = propLinesTs(propList, warnings)
      const withDefaults = propList.filter((p) => !p.required && p.def.trim())
      scriptLines.push('interface Props {')
      for (const f of fields) scriptLines.push('  ' + f)
      scriptLines.push('}')
      scriptLines.push('')
      if (withDefaults.length) {
        scriptLines.push('withDefaults(defineProps<Props>(), {')
        for (const p of withDefaults) scriptLines.push(`  ${p.name.trim()}: ${p.def.trim()},`)
        scriptLines.push('})')
      } else {
        scriptLines.push('defineProps<Props>()')
      }
    }
    if (emitList.length) {
      if (propList.length) scriptLines.push('')
      scriptLines.push('const emit = defineEmits<{')
      for (const e of emitList) scriptLines.push(`  (e: '${e}'): void;`)
      scriptLines.push('}>()')
    }
  } else {
    if (propList.length) {
      scriptLines.push('defineProps({')
      for (const p of propList) {
        const n = p.name.trim()
        if (p.required) scriptLines.push(`  ${n}: { type: ${p.type}, required: true },`)
        else if (p.def.trim()) scriptLines.push(`  ${n}: { type: ${p.type}, default: ${p.def.trim()} },`)
        else scriptLines.push(`  ${n}: ${p.type},`)
      }
      scriptLines.push('})')
    }
    if (emitList.length) {
      if (propList.length) scriptLines.push('')
      scriptLines.push(`const emit = defineEmits(${JSON.stringify(emitList)})`)
    }
  }

  // 模板（静态骨架：引用首个字符串 prop、布尔 prop 绑定 disabled、首个事件）
  const firstStr = propList.find((p) => p.type === 'String')
  const boolProp = propList.find((p) => p.type === 'Boolean')
  const submitEv = emitList.find((e) => /submit/i.test(e)) ?? emitList[0]
  const cls = kebab(name)
  const tpl: string[] = []
  const useForm = !!submitEv && /submit/i.test(submitEv)
  tpl.push(useForm ? `  <form class="${cls}" @submit.prevent="emit('${submitEv}')">` : `  <section class="${cls}">`)
  if (firstStr) tpl.push(`    <h2 class="${cls}__title">{{ ${firstStr.name.trim()} }}</h2>`)
  else tpl.push(`    <!-- 在此放置内容 -->`)
  if (submitEv) {
    const dis = boolProp ? ` :disabled="${boolProp.name.trim()}"` : ''
    tpl.push(useForm ? `    <button type="submit"${dis}>提交</button>` : `    <button type="button"${dis} @click="emit('${submitEv}')">提交</button>`)
  }
  tpl.push(useForm ? '  </form>' : '  </section>')

  const parts: string[] = []
  parts.push(`<script setup lang="${isTs ? 'ts' : 'js'}">`)
  if (scriptLines.length) {
    parts.push('')
    parts.push(scriptLines.join('\n'))
  }
  parts.push('')
  parts.push('</' + 'script>')
  parts.push('')
  parts.push('<template>')
  parts.push(tpl.join('\n'))
  parts.push('</template>')
  if (styleKind.value !== 'none') {
    const attrs = [styleLang.value === 'scss' ? 'lang="scss"' : '', styleKind.value === 'scoped' ? 'scoped' : ''].filter(Boolean).join(' ')
    parts.push('')
    parts.push(`<style${attrs ? ' ' + attrs : ''}>`)
    parts.push(`.${cls} {`)
    parts.push('  /* 样式 */')
    parts.push('}')
    parts.push('</style>')
  }
  return { code: parts.join('\n') + '\n', warnings }
}

function propLinesTs(propList: PropRow[], warnings: string[]): string[] {
  return propList.map((p) => {
    const n = p.name.trim()
    if (p.required && p.def.trim()) warnings.push(`props「${n}」：必选属性同时填了默认值，生成时忽略默认值`)
    const t = TS_TYPE_MAP[p.type]!
    return `${n}${p.required ? '' : '?'}: ${t}`
  })
}

// ---------- 执行 ----------
const sig = () => JSON.stringify([compName.value, lang.value, propRows.value, emitRows.value, styleKind.value, styleLang.value])
const run = useToolRun(sig)

function execute() {
  warnList.value = []
  if (nameErr.value) {
    output.value = ''
    errDetail.value = nameErr.value
    run.markFail(errDetail.value)
    return
  }
  if (rowsErr.value) {
    output.value = ''
    errDetail.value = rowsErr.value
    run.markFail(errDetail.value)
    return
  }
  const r = generate()
  output.value = r.code
  warnList.value = r.warnings
  if (nameWarn.value) warnList.value = [nameWarn.value, ...r.warnings]
  errDetail.value = ''
  run.markOk(`仅生成源码模板，不渲染组件、不执行任何源码`)
}

watch([compName, lang, propRows, emitRows, styleKind, styleLang], execute, { deep: true })
onMounted(execute)

function loadSample() {
  compName.value = 'UserForm'
  lang.value = 'ts'
  propRows.value = [
    { name: 'title', type: 'String', required: true, def: '' },
    { name: 'disabled', type: 'Boolean', required: false, def: 'false' }
  ]
  emitRows.value = [{ name: 'submit' }]
  styleKind.value = 'scoped'
  styleLang.value = 'css'
  execute()
}

function download() {
  if (!output.value) return
  downloadText(`${compName.value.trim()}.vue`, output.value, 'text/plain')
}
</script>

<template>
  <div class="t28">
    <div class="t28__toolbar">
      <DkSegmented
        :model-value="lang"
        :options="[
          { value: 'ts', label: 'TypeScript' },
          { value: 'js', label: 'JavaScript' }
        ]"
        @update:model-value="lang = $event as any"
      />
      <span class="t28__hint tertiary">script setup + Composition API（固定）</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入 UserForm 示例（title prop + submit 事件）" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        生成源码
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[lang === 'ts' ? 'defineProps 类型 + withDefaults' : 'defineProps 运行时对象', 'defineEmits']"
      :retry="execute"
    />

    <div class="t28__panes">
      <SplitPanes :initial="44" :min="25" :max="65">
        <template #left>
          <div class="t28__form">
            <DkField label="组件名" :error="nameErr || undefined" :help="nameErr ? undefined : 'PascalCase 多词命名（如 UserForm）'">
              <DkInput v-model="compName" mono placeholder="UserForm" :error="!!nameErr" />
            </DkField>
            <p v-if="nameWarn" class="t28__warn">
              <DkIcon name="alert-triangle" :size="13" />
              {{ nameWarn }}
            </p>

            <div class="t28__sec">
              <div class="t28__sec-head">
                <span>props（可留空）</span>
                <DkButton size="sm" variant="ghost" @click="addProp">
                  <DkIcon name="plus" :size="12" />
                  添加
                </DkButton>
              </div>
              <div v-for="(r, i) in propRows" :key="i" class="t28__prow">
                <DkInput v-model="r.name" mono placeholder="名称" class="t28__pname" />
                <DkSelect v-model="r.type" :options="PROP_TYPES.map((t) => ({ value: t, label: t }))" class="t28__ptype" />
                <DkCheckbox v-model="r.required" label="必选" />
                <DkInput v-model="r.def" mono placeholder="默认值（字面量）" class="t28__pdef" />
                <DkIconButton title="删除此行" @click="removeProp(i)">
                  <DkIcon name="x" :size="13" />
                </DkIconButton>
              </div>
            </div>

            <div class="t28__sec">
              <div class="t28__sec-head">
                <span>emits（可留空）</span>
                <DkButton size="sm" variant="ghost" @click="addEmit">
                  <DkIcon name="plus" :size="12" />
                  添加
                </DkButton>
              </div>
              <div v-for="(r, i) in emitRows" :key="i" class="t28__prow">
                <DkInput v-model="r.name" mono placeholder="事件名，如 submit / update:value" class="t28__ename" />
                <DkIconButton title="删除此行" @click="removeEmit(i)">
                  <DkIcon name="x" :size="13" />
                </DkIconButton>
              </div>
            </div>

            <div class="t28__sec t28__sec--row">
              <DkField label="样式作用域">
                <DkSegmented
                  size="sm"
                  :model-value="styleKind"
                  :options="[
                    { value: 'scoped', label: 'scoped' },
                    { value: 'global', label: '非 scoped' },
                    { value: 'none', label: '无样式' }
                  ]"
                  @update:model-value="styleKind = $event as any"
                />
              </DkField>
              <DkField v-if="styleKind !== 'none'" label="样式语言">
                <DkSegmented
                  size="sm"
                  :model-value="styleLang"
                  :options="[
                    { value: 'css', label: 'CSS' },
                    { value: 'scss', label: 'SCSS' }
                  ]"
                  @update:model-value="styleLang = $event as any"
                />
              </DkField>
            </div>

            <p v-for="(w, i) in warnList.filter((x) => !nameWarn || x !== nameWarn)" :key="i" class="t28__warn">
              <DkIcon name="alert-triangle" :size="13" />
              {{ w }}
            </p>
          </div>
        </template>
        <template #right>
          <div class="t28__out">
            <div class="t28__out-bar">
              <span class="t28__out-name mono">{{ compName.trim() || 'Component' }}.vue</span>
              <span class="grow"></span>
              <DkButton size="sm" variant="ghost" :disabled="!output" @click="clipboard.copy(output, '组件源码')">
                <DkIcon name="copy" :size="12" />
                复制
              </DkButton>
              <DkButton size="sm" variant="ghost" :disabled="!output" @click="download">
                <DkIcon name="download" :size="12" />
                下载 {{ compName.trim() || 'Component' }}.vue
              </DkButton>
            </div>
            <DkEditor
              :model-value="output"
              readonly
              lang="Vue SFC 源码"
              placeholder="按左侧表单配置生成的 .vue 源码模板"
              :stale="run.status.value === 'stale'"
              height="100%"
              :filename="`${compName.trim() || 'Component'}.vue`"
            />
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="使用说明">
      <h4>生成内容</h4>
      <ul>
        <li>仅生成源码模板，不渲染组件、不执行任何源码，也不调用 AI 后端。</li>
        <li>TypeScript：<code>defineProps</code> 使用类型 + <code>withDefaults</code>（有默认值时）；JavaScript：使用运行时对象写法。</li>
        <li>emits 使用 <code>defineEmits</code>；样式支持 scoped / 非 scoped / 无、CSS / SCSS。</li>
        <li>默认值仅支持字面量（数字、引号字符串、<code>true/false</code>、<code>[]</code>、<code>{}</code>、<code>null</code>）。</li>
      </ul>
      <h4>校验</h4>
      <p>组件名必须是合法标识符且不能是保留字；单词组件名仅给黄色建议（Vue 风格指南），不会阻止生成。props / emits 的名称、重复项、默认值错误会定位到具体行。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t28 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t28__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t28__hint {
  font-size: 12px;
}
.t28__panes {
  height: calc(60vh - 60px);
  min-height: 480px;
}
.t28__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow: auto;
  padding-right: 4px;
}
.t28__warn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  margin: 0;
}
.t28__sec {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t28__sec--row {
  flex-direction: row;
  gap: 24px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.t28__sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.t28__prow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t28__pname {
  flex: 3;
  min-width: 80px;
}
.t28__ptype {
  width: 100px;
}
.t28__pdef {
  flex: 2;
  min-width: 90px;
}
.t28__ename {
  flex: 1;
}
.t28__out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.t28__out-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t28__out-name {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
