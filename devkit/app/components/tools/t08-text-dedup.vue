<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

// 默认值遵循红线：不 trim、不去空行、大小写敏感 —— 默认不改任何空格
const caseSensitive = ref(true)
const removeBlank = ref(false)
const trimLines = ref(false)
const sortMode = ref<'keep' | 'dict'>('keep')

const input = ref('')
const output = ref('')
const stat = ref({ inLines: 0, outLines: 0, dup: 0, blank: 0 })

const SAMPLE = `apple
Apple
  banana
banana
cherry

apple
  banana
cherry`

const sig = () =>
  JSON.stringify([input.value, caseSensitive.value, removeBlank.value, trimLines.value, sortMode.value])
const run = useToolRun(sig)

/** 实时预览：输入或任一选项变化立即重算，结果始终与输入一致 */
function execute() {
  const src = input.value
  if (!src) {
    output.value = ''
    stat.value = { inLines: 0, outLines: 0, dup: 0, blank: 0 }
    run.markIdle()
    return
  }
  const lines = src.split('\n')
  const seen = new Set<string>()
  const result: string[] = []
  let dup = 0
  let blank = 0
  for (const raw of lines) {
    // 仅在显式勾选「trim」时才去掉行首尾空格
    const line = trimLines.value ? raw.trim() : raw
    // 空行 = 只含空白字符的行；仅在显式勾选「去除空行」时删除
    if (removeBlank.value && line.trim() === '') {
      blank++
      continue
    }
    const key = caseSensitive.value ? line : line.toLowerCase()
    if (seen.has(key)) {
      dup++
      continue
    }
    seen.add(key)
    result.push(line)
  }
  if (sortMode.value === 'dict') result.sort()
  output.value = result.join('\n')
  stat.value = { inLines: lines.length, outLines: result.length, dup, blank }
  const parts: string[] = []
  if (dup > 0) parts.push(`删除重复 ${dup} 行`)
  if (blank > 0) parts.push(`删除空行 ${blank} 行`)
  run.markOk(parts.length ? `${parts.join('，')}` : '未发现重复行')
}

watch([input, caseSensitive, removeBlank, trimLines, sortMode], execute)
</script>

<template>
  <div class="t08">
    <div class="t08__toolbar">
      <DkCheckbox v-model="caseSensitive" label="大小写敏感" title="关闭后 JSON 与 json 视为同一行，保留首次出现的写法" />
      <DkCheckbox v-model="removeBlank" label="去除空行" title="删除只含空白字符的行" />
      <DkCheckbox v-model="trimLines" label="整理时 trim 行首尾空格" title="默认不改空格；勾选后才去掉每行首尾空白" />
      <div class="t08__group">
        <span class="t08__group-label">排序</span>
        <DkSegmented
          size="sm"
          :model-value="sortMode"
          :options="[
            { value: 'keep', label: '保持原序', title: '保持首次出现顺序（默认）' },
            { value: 'dict', label: '字典序', title: '按 Unicode 码点升序排列结果行' }
          ]"
          @update:model-value="sortMode = $event as 'keep' | 'dict'"
        />
      </div>
      <span class="grow"></span>
      <span class="t08__live tertiary">实时预览：修改输入或选项立即生效</span>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="input = SAMPLE">载入示例</DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.staleNote.value"
      :meta="[`输入 ${stat.inLines.toLocaleString()} 行`, `输出 ${stat.outLines.toLocaleString()} 行`]"
      :retry="execute"
    />

    <div class="t08__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="原始文本"
            placeholder="粘贴逐行列表，或点击「载入示例」&#10;默认保留所有空格与空行，仅在显式勾选后才处理"
            :height="'calc(60vh - 60px)'"
            filename="input.txt"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            lang="整理结果"
            placeholder="去重结果实时显示在这里"
            :height="'calc(60vh - 60px)'"
            filename="deduped.txt"
          />
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="去重与整理规则">
      <ul>
        <li>逐行去重，保留每行首次出现时的原文与位置；大小写不敏感时同样保留首次出现的写法（不统一大小写）。</li>
        <li>默认不改任何空格：行首尾空格、空行都原样保留；<code>trim</code> 与「去除空行」是两个显式选项。</li>
        <li>空行指只含空格 / 制表符等空白字符的行；末尾换行符按真实行数计入统计。</li>
        <li>字典序按 Unicode 码点升序（英文在前、中文在后），如需保持原顺序请选择「保持原序」。</li>
        <li>预览实时计算：状态栏显示输入 / 输出行数与删除的重复行、空行数量。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t08 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t08__toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t08__group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t08__group-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t08__live {
  font-size: 11px;
  white-space: nowrap;
}
.t08__panes {
  min-height: 320px;
}
</style>
