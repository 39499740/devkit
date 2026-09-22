<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { byteLength, bytesToBase64, bytesToHex, hexToBytes, textToBytes } from '~/utils/bytes'
import { computeHmac } from '~/utils/crypto/hmac'

defineProps<{ tool: ToolMeta }>()

const algo = ref<'SHA-256' | 'SHA-512'>('SHA-256')
const keyEnc = ref<'utf8' | 'hex'>('utf8')
const outEnc = ref<'hex' | 'base64'>('hex')
const message = ref('')
const key = ref('')
const expected = ref('')

const busy = ref(false)
const result = ref<{ hex: string; b64: string } | null>(null)

const sig = () => JSON.stringify([algo.value, message.value, key.value, keyEnc.value, outEnc.value, expected.value])
const run = useToolRun(sig)

const clipboard = useClipboard()

/** RFC 4231 Test Case 1 期望值（key = 0x0b × 20，data = "Hi There"，node crypto 复核） */
const RFC4231_TC1_SHA256 = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
const RFC4231_TC1_SHA512 = '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854'

/** 密钥解码：Hex 非法时给出定位提示 */
const keyErr = computed(() => {
  if (keyEnc.value !== 'hex' || !key.value.trim()) return ''
  const r = hexToBytes(key.value)
  return r.error ? `密钥 Hex 非法：${r.error}（密钥编码当前为 Hex）` : ''
})

const keyBytesLen = computed(() => {
  if (keyErr.value) return null
  return keyEnc.value === 'hex' ? hexToBytes(key.value).bytes.length : byteLength(key.value)
})

const keyHelp = computed(() =>
  keyBytesLen.value === null ? '先修正上方错误后才能解码' : `解码后密钥长度：${keyBytesLen.value} 字节`
)

const expectedNorm = computed(() => expected.value.replace(/\s+/g, '').toLowerCase())

const matchState = computed<'match' | 'mismatch' | null>(() => {
  if (!result.value || !expectedNorm.value) return null
  return result.value.hex === expectedNorm.value ? 'match' : 'mismatch'
})

/** 真实计算：统一走共享实现 ~/utils/crypto/hmac（WebCrypto importKey + sign），仅在点击回调中执行 */
async function execute() {
  if (busy.value) return
  if (keyErr.value) {
    result.value = null
    run.markFail(keyErr.value)
    return
  }
  const keyBytes = keyEnc.value === 'hex' ? hexToBytes(key.value).bytes : textToBytes(key.value)
  if (keyBytes.length === 0) {
    result.value = null
    run.markFail('密钥为空：请填写密钥（HMAC 密钥至少需要 1 字节）')
    return
  }
  busy.value = true
  try {
    const d = await computeHmac(algo.value, keyBytes, textToBytes(message.value))
    result.value = { hex: bytesToHex(d), b64: bytesToBase64(d) }
    const cmp =
      matchState.value === 'match' ? '；期望值对照：一致' : matchState.value === 'mismatch' ? '；期望值对照：不一致（见下方红色标识）' : ''
    run.markOk(`HMAC 计算成功（${algo.value}，密钥 ${keyBytes.length} 字节）${cmp}`)
  } catch (e) {
    result.value = null
    run.markFail(`HMAC 计算失败：${errMessage(e)}`)
  } finally {
    busy.value = false
  }
}

/** RFC 4231 Test Case 1：期望值为 node crypto 真实输出，结果由本工具现场计算 */
function loadSample() {
  algo.value = 'SHA-256'
  keyEnc.value = 'hex'
  outEnc.value = 'hex'
  key.value = '0b'.repeat(20)
  message.value = 'Hi There'
  expected.value = RFC4231_TC1_SHA256
  execute()
}

const display = computed(() => {
  if (!result.value) return ''
  return outEnc.value === 'hex' ? result.value.hex : result.value.b64
})
</script>

<template>
  <div class="t13">
    <div class="t13__toolbar">
      <span class="t13__tl">算法</span>
      <DkSegmented
        :model-value="algo"
        :options="[
          { value: 'SHA-256', label: 'HMAC-SHA-256' },
          { value: 'SHA-512', label: 'HMAC-SHA-512' }
        ]"
        @update:model-value="algo = $event as any"
      />
      <span class="t13__tl">密钥编码</span>
      <DkSegmented
        size="sm"
        :model-value="keyEnc"
        :options="[
          { value: 'utf8', label: 'UTF-8 文本', title: '密钥按 UTF-8 编码为字节' },
          { value: 'hex', label: 'Hex', title: '密钥按 Hex 解码为字节' }
        ]"
        @update:model-value="keyEnc = $event as any"
      />
      <span class="t13__tl">输出编码</span>
      <DkSegmented
        size="sm"
        :model-value="outEnc"
        :options="[
          { value: 'hex', label: 'Hex' },
          { value: 'base64', label: 'Base64' }
        ]"
        @update:model-value="outEnc = $event as any"
      />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="RFC 4231 Test Case 1：真实计算并自动对照" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="shield" :size="12" />
        计算 HMAC
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? '正在计算…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[algo, keyEnc === 'hex' ? '密钥 Hex' : '密钥 UTF-8', `消息 ${byteLength(message)} 字节`]"
      :retry="execute"
    />

    <div class="t13__grid">
      <div class="t13__msg">
        <DkEditor
          v-model="message"
          lang="消息（UTF-8 文本）"
          placeholder="输入参与计算的消息文本（可为空字符串）"
          :height="'100%'"
          filename="hmac-message.txt"
        />
      </div>
      <div class="t13__params">
        <DkField label="密钥" :error="keyErr || undefined" :help="keyHelp" secret>
          <template #default="{ revealed }">
            <DkInput
              v-model="key"
              :type="revealed ? 'text' : 'password'"
              mono
              :placeholder="keyEnc === 'hex' ? 'Hex 字节串，如 0b0b0b0b' : '如 0123456789012345678901234567890123456789'"
              :error="!!keyErr"
              autocomplete="off"
            />
          </template>
        </DkField>
        <DkField
          label="期望 MAC（可选，用于对照）"
          help="按 Hex 对照，忽略大小写与空白；填写后显示「一致 / 不一致」"
        >
          <DkInput v-model="expected" mono placeholder="期望值 Hex，留空仅计算不对照" />
        </DkField>
      </div>
    </div>

    <div class="t13__result">
      <div class="t13__result-head">
        <span>HMAC-{{ algo }} 结果</span>
        <span class="grow"></span>
        <span v-if="result" class="tertiary">输出：{{ outEnc === 'hex' ? 'Hex（小写）' : 'Base64' }}</span>
      </div>
      <p v-if="!result" class="t13__empty tertiary">填写密钥与消息后点击「计算 HMAC」，结果由浏览器 WebCrypto 现场计算。</p>
      <div v-else class="t13__row">
        <span class="t13__row-val mono">{{ display }}</span>
        <DkIconButton title="复制结果" :disabled="run.status.value === 'stale'" @click="clipboard.copy(display, 'HMAC 结果')">
          <DkIcon name="copy" :size="14" />
        </DkIconButton>
        <span
          v-if="matchState"
          class="t13__row-badge"
          :class="matchState === 'match' ? 't13__row-badge--ok' : 't13__row-badge--bad'"
        >{{ matchState === 'match' ? '与期望一致' : '与期望不一致' }}</span>
      </div>
    </div>

    <DkCollapse title="测试向量与说明（已用 node crypto 复核）">
      <h4>RFC 4231 Test Case 1</h4>
      <ul>
        <li>密钥：<code>0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b</code>（0x0b × 20 字节，密钥编码选 Hex）</li>
        <li>消息：<code>Hi There</code></li>
        <li>HMAC-SHA-256 = <code>{{ RFC4231_TC1_SHA256 }}</code></li>
        <li>HMAC-SHA-512 = <code>{{ RFC4231_TC1_SHA512 }}</code></li>
      </ul>
      <p>点击「载入示例」会填入该向量（密钥编码自动切到 Hex）并现场重新计算；期望值即上述真实值，可切换算法验证 SHA-512 分支。</p>
      <p>HMAC 是带密钥的消息认证码：密钥参与运算，输出长度由算法决定（SHA-256 为 32 字节，SHA-512 为 64 字节）。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t13 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t13__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t13__tl {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t13__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 1fr);
  gap: 12px;
  align-items: stretch;
  min-height: 220px;
}
@media (max-width: 860px) {
  .t13__grid {
    grid-template-columns: 1fr;
  }
}
.t13__msg {
  min-height: 220px;
}
.t13__params {
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: flex-start;
}
.t13__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t13__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t13__empty {
  padding: 14px;
  font-size: 13px;
}
.t13__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.t13__row-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t13__row-badge {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t13__row-badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t13__row-badge--bad {
  color: var(--error);
  background: var(--error-soft);
}
</style>
