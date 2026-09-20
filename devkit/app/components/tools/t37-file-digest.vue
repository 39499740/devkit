<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import SparkMD5 from 'spark-md5'

defineProps<{ tool: ToolMeta }>()

const MAX_SIZE = 512 * 1024 * 1024
const SHA_MEM_WARN = 256 * 1024 * 1024
const CHUNK = 2 * 1024 * 1024

type Algo = 'MD5' | 'SHA-256' | 'SHA-512'
type ItemStatus = 'pending' | 'reading' | 'done' | 'error' | 'cancelled'

interface DigestItem {
  id: number
  file: File
  status: ItemStatus
  /** 已真实读取的字节数（进度与它一致，不编造百分比之外的量） */
  read: number
  results: Partial<Record<Algo, { hex?: string; error?: string }>>
  expected: string
  cancel: boolean
}

const algoMd5 = ref(true)
const algo256 = ref(true)
const algo512 = ref(false)
const items = ref<DigestItem[]>([])
const running = ref(false)
let nextId = 1
let runToken = 0

const toast = useToast()
const clipboard = useClipboard()

const selectedAlgos = computed<Algo[]>(() => {
  const list: Algo[] = []
  if (algoMd5.value) list.push('MD5')
  if (algo256.value) list.push('SHA-256')
  if (algo512.value) list.push('SHA-512')
  return list
})

const needSha = computed(() => algo256.value || algo512.value)

const sig = () => JSON.stringify([algoMd5.value, algo256.value, algo512.value, items.value.map((i) => `${i.file.name}:${i.file.size}:${i.file.lastModified}`)])
const run = useToolRun(sig)

const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length)
const failCount = computed(() => items.value.filter((i) => i.status === 'error').length)
const cancelledCount = computed(() => items.value.filter((i) => i.status === 'cancelled').length)
const busyCount = computed(() => items.value.filter((i) => i.status === 'pending' || i.status === 'reading').length)
/** 全部到达终态（无排队/进行中）且至少一个成功，才允许导出清单 */
const canExport = computed(() => items.value.length > 0 && doneCount.value > 0 && busyCount.value === 0)

const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: '排队中',
  reading: '读取中',
  done: '完成',
  error: '失败',
  cancelled: '已取消'
}

function onFiles(fs: File[]) {
  for (const f of fs) {
    if (f.size > MAX_SIZE) {
      toast.warning(`文件「${f.name}」超出当前限制（${formatBytes(MAX_SIZE)}），已跳过`)
      continue
    }
    items.value.push({ id: nextId++, file: f, status: 'pending', read: 0, results: {}, expected: '', cancel: false })
  }
  void processQueue()
}

/** 顺序逐个处理：一个文件失败/被取消不影响后续文件 */
async function processQueue() {
  if (running.value) return
  if (!selectedAlgos.value.length) {
    run.markFail('请至少选择一种算法（MD5 / SHA-256 / SHA-512）')
    return
  }
  running.value = true
  const token = ++runToken
  try {
    for (;;) {
      if (token !== runToken) return // 已被重新计算取代
      const item = items.value.find((i) => i.status === 'pending')
      if (!item) break
      await processItem(item)
    }
  } finally {
    if (token === runToken) {
      running.value = false
      summarize()
    }
  }
}

async function processItem(item: DigestItem) {
  item.status = 'reading'
  item.read = 0
  item.results = {}
  const file = item.file
  const spark = selectedAlgos.value.includes('MD5') ? new SparkMD5.ArrayBuffer() : null
  const chunks: Uint8Array[] | null = needSha.value ? [] : null
  let offset = 0
  try {
    while (offset < file.size) {
      if (item.cancel) {
        item.status = 'cancelled'
        return
      }
      const end = Math.min(offset + CHUNK, file.size)
      const buf = await file.slice(offset, end).arrayBuffer()
      if (item.cancel) {
        item.status = 'cancelled'
        return
      }
      spark?.append(buf)
      chunks?.push(new Uint8Array(buf))
      offset = end
      item.read = offset
    }
    if (item.cancel) {
      item.status = 'cancelled'
      return
    }
    // MD5：end() 只调用一次（调用后状态重置，二次调用会得到错误结果）
    if (spark && selectedAlgos.value.includes('MD5')) {
      const hex = spark.end(false)
      item.results['MD5'] = { hex }
    }
    // SHA 系：crypto.subtle.digest 需要完整缓冲区
    if (needSha.value) {
      const full = new Uint8Array(file.size)
      let pos = 0
      for (const c of chunks ?? []) {
        full.set(c, pos)
        pos += c.length
      }
      for (const algo of ['SHA-256', 'SHA-512'] as Algo[]) {
        if (!selectedAlgos.value.includes(algo)) continue
        try {
          const buf = await crypto.subtle.digest(algo, full as unknown as BufferSource)
          item.results[algo] = { hex: bytesToHex(new Uint8Array(buf)) }
        } catch (e) {
          item.results[algo] = { error: `SHA 计算失败：${errMessage(e)}（SHA 需要完整载入内存，文件较大可能失败）` }
        }
      }
    }
    const okCount = Object.values(item.results).filter((r) => r && r.hex).length
    if (okCount === 0) {
      item.status = 'error'
    } else {
      item.status = 'done'
    }
  } catch (e) {
    item.status = 'error'
    item.results = { ...(item.results ?? {}) }
    const first = selectedAlgos.value[0] ?? 'MD5'
    item.results[first] = { error: `读取文件失败：${errMessage(e)}` }
  }
}

function summarize() {
  if (!items.value.length) {
    run.markIdle()
    return
  }
  if (doneCount.value > 0) {
    run.markOk(
      `${doneCount.value} 个文件计算成功${cancelledCount.value ? `，${cancelledCount.value} 个已取消` : ''}${failCount.value ? `，${failCount.value} 个失败（失败不影响其他文件）` : ''}`
    )
  } else if (failCount.value > 0) {
    run.markFail(`0 个文件计算成功，${failCount.value} 个失败${cancelledCount.value ? `，${cancelledCount.value} 个已取消` : ''}（失败不影响其他文件，可在列表中查看原因）`)
  } else if (cancelledCount.value > 0) {
    run.markFail(`${cancelledCount.value} 个文件已取消，没有可用的计算结果`)
  } else {
    run.markIdle()
  }
}

/** 重新计算：全部文件回到排队状态（用户改了算法后点「重新执行」） */
function recomputeAll() {
  if (!selectedAlgos.value.length) {
    run.markFail('请至少选择一种算法（MD5 / SHA-256 / SHA-512）')
    return
  }
  runToken++
  running.value = false
  for (const item of items.value) {
    item.status = 'pending'
    item.read = 0
    item.results = {}
    item.cancel = false
  }
  run.markIdle()
  void processQueue()
}

function cancelItem(item: DigestItem) {
  item.cancel = true
  if (item.status === 'pending') {
    item.status = 'cancelled'
  }
}

function removeItem(item: DigestItem) {
  item.cancel = true
  items.value = items.value.filter((i) => i.id !== item.id)
  if (!items.value.length) {
    runToken++
    running.value = false
    run.markIdle()
  } else {
    summarize()
  }
}

function clearAll() {
  runToken++
  running.value = false
  for (const i of items.value) i.cancel = true
  items.value = []
  run.markIdle()
}

/** 期望值归一化：忽略大小写与空白 */
function normExpected(item: DigestItem): string {
  return item.expected.replace(/\s+/g, '').toLowerCase()
}

function matchOf(item: DigestItem, algo: Algo): boolean | null {
  const exp = normExpected(item)
  const r = item.results[algo]
  if (!exp || !r || !r.hex) return null
  return r.hex === exp
}

function expectedErr(item: DigestItem): string {
  const exp = normExpected(item)
  if (exp && !/^[0-9a-f]*$/.test(exp)) return '期望值包含非十六进制字符，无法对照'
  return ''
}

function hexOf(item: DigestItem, algo: Algo): string {
  return item.results[algo]?.hex ?? ''
}

function errOf(item: DigestItem, algo: Algo): string {
  return item.results[algo]?.error ?? ''
}

async function copyHex(hex: string, algo: Algo) {
  await clipboard.copy(hex, `${algo} 摘要`)
}

/** RFC 4180 CSV 字段：含逗号 / 引号 / 换行时整体加引号，内部引号写成两个 */
function csvCell(v: string | number): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 导出清单：文件名 / 大小 / 算法 / 摘要为核心列，另附状态、对照结果与失败备注，失败与取消如实标注 */
function buildManifestCsv(): string {
  const rows: Array<Array<string | number>> = [['文件名', '大小(字节)', '算法', '摘要', '状态', '对照结果', '备注']]
  for (const item of items.value) {
    const size = item.file.size
    const exp = normExpected(item)
    if (item.status === 'done') {
      for (const algo of selectedAlgos.value) {
        const r = item.results[algo]
        const verdict = exp && r?.hex ? (matchOf(item, algo) ? '一致' : '不一致') : exp ? '未计算' : ''
        rows.push([item.file.name, size, algo, r?.hex ?? '', r?.hex ? '完成' : '失败', verdict, r?.hex ? '' : (r?.error ?? '')])
      }
    } else if (item.status === 'error') {
      rows.push([item.file.name, size, '', '', '失败', '', Object.values(item.results).find((r) => r?.error)?.error ?? '未知原因'])
    } else if (item.status === 'cancelled') {
      rows.push([item.file.name, size, '', '', '已取消', '', ''])
    } else {
      rows.push([item.file.name, size, '', '', STATUS_LABEL[item.status], '', '未到达终态，未导出摘要'])
    }
  }
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  // 前置 UTF-8 BOM：表格软件据此识别中文表头
  return `\uFEFF${body}\r\n`
}

function exportManifest() {
  downloadText('digest-manifest.csv', buildManifestCsv(), 'text/csv;charset=utf-8')
}
</script>

<template>
  <div class="t37">
    <div class="t37__toolbar">
      <span class="t37__algos" title="可同时勾选多种算法，每种算法一列结果">
        <DkCheckbox v-model="algoMd5" label="MD5" />
        <DkCheckbox v-model="algo256" label="SHA-256" />
        <DkCheckbox v-model="algo512" label="SHA-512" />
      </span>
      <span class="t37__note tertiary">改算法后需重新执行</span>
      <span class="grow"></span>
      <DkButton v-if="items.length" size="sm" variant="ghost" @click="recomputeAll">
        <DkIcon name="refresh" :size="12" />
        重算全部
      </DkButton>
      <DkButton size="sm" :disabled="!canExport" title="全部文件到达终态且至少一个成功后可导出 CSV 摘要清单" @click="exportManifest">
        <DkIcon name="download" :size="12" />
        导出摘要清单
      </DkButton>
      <DkButton v-if="items.length" size="sm" variant="ghost" @click="clearAll">清空列表</DkButton>
    </div>

    <DkStatusBar
      :status="running ? 'running' : run.status.value"
      :message="running ? `正在计算（剩余 ${busyCount} 个文件）…` : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="selectedAlgos.length ? [...selectedAlgos, `单文件上限 ${formatBytes(MAX_SIZE)}`] : []"
      :retry="recomputeAll"
    />

    <FileDrop
      multiple
      :max-size="MAX_SIZE"
      hint="支持多文件，全部在浏览器本地读取与计算，不会上传"
      @files="onFiles"
      @reject="(reason: string) => toast.warning(reason)"
    />

    <div v-if="items.length" class="t37__list">
      <div v-for="item in items" :key="item.id" class="t37__item" :class="`t37__item--${item.status}`">
        <div class="t37__item-head">
          <DkIcon :name="item.status === 'done' ? 'file-check' : 'file-binary'" :size="14" />
          <span class="t37__item-name mono">{{ item.file.name }}</span>
          <span class="tertiary">{{ formatBytes(item.file.size) }}</span>
          <span class="t37__badge" :class="`t37__badge--${item.status}`">{{ STATUS_LABEL[item.status] }}</span>
          <span class="grow"></span>
          <DkButton
            v-if="item.status === 'pending' || item.status === 'reading'"
            size="sm"
            variant="ghost"
            title="取消该文件的计算"
            @click="cancelItem(item)"
          >
            取消
          </DkButton>
          <DkIconButton title="从列表移除" @click="removeItem(item)">
            <DkIcon name="trash" :size="14" />
          </DkIconButton>
        </div>

        <p v-if="item.status === 'reading'" class="t37__progress tertiary">
          已读取 {{ formatBytes(item.read) }} / 共 {{ formatBytes(item.file.size) }}{{ item.file.size > SHA_MEM_WARN && needSha ? '（SHA 需要完整载入内存，文件较大可能失败）' : '' }}
        </p>
        <p v-else-if="item.file.size > SHA_MEM_WARN && (item.status === 'pending' || item.status === 'done') && needSha" class="t37__progress tertiary">
          该文件超过 {{ formatBytes(SHA_MEM_WARN) }}：SHA 需要完整载入内存，文件较大可能失败
        </p>

        <div v-if="item.status === 'done' || item.status === 'error'" class="t37__digests">
          <div v-for="algo in selectedAlgos" :key="algo" class="t37__digest-row">
            <span class="t37__digest-algo">{{ algo }}</span>
            <template v-if="hexOf(item, algo)">
              <span class="t37__digest-val mono">{{ hexOf(item, algo) }}</span>
              <DkIconButton title="复制该摘要" @click="copyHex(hexOf(item, algo), algo)">
                <DkIcon name="copy" :size="14" />
              </DkIconButton>
              <span
                v-if="matchOf(item, algo) !== null"
                class="t37__match"
                :class="matchOf(item, algo) ? 't37__match--ok' : 't37__match--bad'"
              >{{ matchOf(item, algo) ? '一致' : '不一致' }}</span>
            </template>
            <span v-else-if="errOf(item, algo)" class="t37__digest-err">{{ errOf(item, algo) }}</span>
          </div>
        </div>

        <div v-if="item.status !== 'cancelled'" class="t37__expected">
          <span class="t37__expected-label">期望摘要（可选）</span>
          <DkInput v-model="item.expected" mono placeholder="期望摘要 Hex，忽略大小写与空白；填写后各算法独立对照" :error="!!expectedErr(item)" />
          <span v-if="expectedErr(item)" class="t37__expected-err">{{ expectedErr(item) }}</span>
        </div>
      </div>
    </div>
    <p v-else class="t37__empty tertiary">拖入多个文件后自动逐个计算；每文件可单独取消、移除、填写期望值对照。</p>

    <DkCollapse title="使用说明">
      <ul>
        <li>MD5 使用 spark-md5 增量计算（2MB 分块读取），SHA-256 / SHA-512 使用浏览器 WebCrypto，需要把整个文件载入内存。</li>
        <li>进度按真实读取量显示（已读取 / 共），不做耗时预估。</li>
        <li>单个文件失败或取消不影响其他文件；导出的 CSV 清单只包含真实算出的摘要，失败与取消按实际状态标注，不伪造结果。</li>
        <li>当前单文件限制 {{ formatBytes(MAX_SIZE) }}；超过 {{ formatBytes(SHA_MEM_WARN) }} 的文件计算 SHA 可能因内存不足失败。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t37 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t37__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t37__algos {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.t37__note {
  font-size: 11px;
}
.t37__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t37__item {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t37__item--error {
  border-color: var(--error);
}
.t37__item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.t37__item-name {
  font-size: 13px;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.t37__badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t37__badge--pending {
  color: var(--text-tertiary);
  background: var(--surface-subtle);
}
.t37__badge--reading {
  color: var(--accent);
  background: var(--accent-soft);
}
.t37__badge--done {
  color: var(--ok);
  background: var(--ok-soft);
}
.t37__badge--error {
  color: var(--error);
  background: var(--error-soft);
}
.t37__badge--cancelled {
  color: var(--warn);
  background: var(--warn-soft);
}
.t37__progress {
  font-size: 12px;
}
.t37__digests {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.t37__digest-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.t37__digest-algo {
  flex-shrink: 0;
  min-width: 64px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding-top: 2px;
}
.t37__digest-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t37__digest-err {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--error);
  overflow-wrap: anywhere;
}
.t37__match {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t37__match--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t37__match--bad {
  color: var(--error);
  background: var(--error-soft);
}
.t37__expected {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.t37__expected-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.t37__expected .dk-input {
  flex: 1;
  min-width: 220px;
}
.t37__expected-err {
  font-size: 12px;
  color: var(--error);
}
.t37__empty {
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
</style>
