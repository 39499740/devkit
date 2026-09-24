<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { base64ToBytes, bytesToBase64, bytesToHex, bytesToText, hexToBytes, textToBytes } from '~/utils/bytes'
import { aesGcmDecrypt, aesGcmEncrypt, isAesGcmAuthFailure, splitCombined, type AesTagBits } from '~/utils/crypto/aesgcm'

defineProps<{ tool: ToolMeta }>()

const ws = ref<'enc' | 'dec'>('enc')
const keyBits = ref<'128' | '192' | '256'>('256')
const keyEnc = ref<'hex' | 'base64' | 'utf8'>('hex')
const key = ref('')
const iv = ref('')
const aad = ref('')
const tagLen = ref<'96' | '112' | '128'>('128')
const encOutEnc = ref<'hex' | 'base64'>('hex')
const decInEnc = ref<'hex' | 'base64'>('hex')
const input = ref('')

const busy = ref(false)
const encResult = ref<{ combined: string; ivHex: string; ctHex: string; tagHex: string } | null>(null)
const decResult = ref<{ text: string; isHex: boolean; hex: string; bytes: number } | null>(null)

const toast = useToast()
const clipboard = useClipboard()

/** 示例向量：node 24 WebCrypto（与浏览器 crypto.subtle 同一算法）真实计算并复核往返 */
const SAMPLE_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' // 32 字节 = AES-256
const SAMPLE_IV = '101112131415161718191a1b' // 12 字节
const SAMPLE_PT = 'DevKit AES-GCM 示例'
const SAMPLE_AAD = 'devkit'
const SAMPLE_CT_HEX = '399bee5d20bd1af28f26255a4c3449b473eaaab09087b1f3067293b23c2a3fc51516fe62dc' // 密文||认证标签

const needKeyBytes = computed(() => parseInt(keyBits.value, 10) / 8)
const tagBytes = computed(() => parseInt(tagLen.value, 10) / 8)

const sig = () =>
  JSON.stringify([ws.value, keyBits.value, keyEnc.value, key.value, iv.value, aad.value, tagLen.value, encOutEnc.value, decInEnc.value, input.value])
const run = useToolRun(sig)

/** 密钥解码 + 长度精确校验（密钥是原始字节，不是口令） */
const keyDecoded = computed<{ bytes: Uint8Array; error?: string }>(() => {
  if (!key.value.trim()) return { bytes: new Uint8Array(0) }
  if (keyEnc.value === 'hex') {
    const r = hexToBytes(key.value)
    return r.error ? { bytes: r.bytes, error: `密钥 Hex 非法：${r.error}` } : r
  }
  if (keyEnc.value === 'base64') {
    const r = base64ToBytes(key.value)
    return r.error ? { bytes: r.bytes, error: `密钥 Base64 非法：${r.error}` } : r
  }
  return { bytes: textToBytes(key.value) }
})

const keyErr = computed(() => {
  if (!key.value.trim()) return ''
  if (keyDecoded.value.error) return keyDecoded.value.error
  const len = keyDecoded.value.bytes.length
  const need = needKeyBytes.value
  if (len !== need) return `密钥解码后 ${len} 字节，需要 ${need} 字节（AES-${keyBits.value}）`
  return ''
})

const keyHelp = computed(() => {
  if (!key.value.trim()) return `密钥是原始字节（不是口令，本工具不做任何密码派生）：当前 AES-${keyBits.value} 需要 ${needKeyBytes.value} 字节`
  if (keyErr.value) return '先修正上方错误后才能执行'
  return `解码后密钥长度：${keyDecoded.value.bytes.length} 字节`
})

const ivDecoded = computed(() => hexToBytes(iv.value))

const ivErr = computed(() => {
  if (!iv.value.trim()) return 'IV（nonce）为空：加密前请填写或点击「随机 IV」生成'
  if (ivDecoded.value.error) return `IV Hex 非法：${ivDecoded.value.error}`
  return ''
})

const ivHelp = computed(() => {
  if (!iv.value.trim()) return '推荐 12 字节（96 位）；同一密钥下不要重用 IV'
  if (ivDecoded.value.error) return 'IV 仅支持 Hex 输入'
  return `IV 解码后 ${ivDecoded.value.bytes.length} 字节${ivDecoded.value.bytes.length === 12 ? '（推荐长度）' : '（GCM 推荐 12 字节）'}`
})

/** 解密输入解码 */
const ctDecoded = computed(() => (decInEnc.value === 'hex' ? hexToBytes(input.value) : base64ToBytes(input.value)))

/** 随机密钥 / 随机 IV（crypto.getRandomValues 仅在点击回调中调用） */
function randomKey() {
  const bytes = new Uint8Array(needKeyBytes.value)
  crypto.getRandomValues(bytes)
  keyEnc.value = 'hex'
  key.value = bytesToHex(bytes)
  toast.success(`已生成随机 ${keyBits.value} 位密钥（${needKeyBytes.value} 字节）`)
}

function randomIv() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  iv.value = bytesToHex(bytes)
  toast.success('已生成 12 字节随机 IV')
}

/** 真实计算：统一走共享实现 ~/utils/crypto/aesgcm（WebCrypto AES-GCM），仅在点击回调中执行 */
async function execute() {
  if (busy.value) return
  if (keyErr.value) {
    encResult.value = null
    decResult.value = null
    run.markFail(keyErr.value)
    return
  }
  if (ivErr.value) {
    encResult.value = null
    decResult.value = null
    run.markFail(ivErr.value)
    return
  }
  if (!key.value.trim() || !input.value.trim()) {
    encResult.value = null
    decResult.value = null
    run.markIdle()
    return
  }
  const keyBytes = keyDecoded.value.bytes
  const ivBytes = ivDecoded.value.bytes
  const aadBytes = textToBytes(aad.value)
  busy.value = true
  try {
    const tagLength = parseInt(tagLen.value, 10) as AesTagBits
    const aesOpts = { key: keyBytes, iv: ivBytes, aad: aadBytes, tagLength }
    if (ws.value === 'enc') {
      const out = await aesGcmEncrypt(textToBytes(input.value), aesOpts)
      const { ciphertext, tag } = splitCombined(out, tagLength)
      encResult.value = {
        combined: encOutEnc.value === 'hex' ? bytesToHex(out) : bytesToBase64(out),
        ivHex: bytesToHex(ivBytes),
        ctHex: bytesToHex(ciphertext),
        tagHex: bytesToHex(tag)
      }
      decResult.value = null
      run.markOk(
        `AES-GCM 加密成功（AES-${keyBits.value}，认证标签 ${tagLen.value} 位，AAD ${aadBytes.length} 字节）；结果 = 密文||认证标签 拼接`
      )
    } else {
      const r = ctDecoded.value
      if (r.error) {
        encResult.value = null
        decResult.value = null
        run.markFail(`密文 ${decInEnc.value === 'hex' ? 'Hex' : 'Base64'} 非法：${r.error}（输入编码当前为 ${decInEnc.value === 'hex' ? 'Hex' : 'Base64'}）`)
        return
      }
      if (r.bytes.length < tagBytes.value) {
        encResult.value = null
        decResult.value = null
        run.markFail(`密文（含认证标签）共 ${r.bytes.length} 字节，不足认证标签长度（${tagBytes.value} 字节）：请确认输入的是「密文||认证标签」拼接格式`)
        return
      }
      try {
        const out = await aesGcmDecrypt(r.bytes, aesOpts)
        const hex = bytesToHex(out)
        const t = bytesToText(out)
        decResult.value = t.error
          ? { text: hex, isHex: true, hex, bytes: out.length }
          : { text: t.text, isHex: false, hex, bytes: out.length }
        encResult.value = null
        run.markOk(
          t.error
            ? `解密成功（${out.length} 字节），但结果不是有效 UTF-8 文本，已按 Hex 显示；可切换编码查看`
            : `AES-GCM 解密成功（${out.length} 字节，认证通过）`
        )
      } catch (e) {
        // 与参数格式错误区分：认证失败专指 GCM 标签校验不通过
        encResult.value = null
        decResult.value = null
        if (isAesGcmAuthFailure(e)) {
          run.markFail('认证失败：密钥错误、密文被修改或 AAD 不一致（IV 与认证标签长度也须与加密时相同）')
        } else {
          run.markFail(`解密失败：${errMessage(e)}`)
        }
      }
    }
  } catch (e) {
    encResult.value = null
    decResult.value = null
    run.markFail(`执行失败：${errMessage(e)}`)
  } finally {
    busy.value = false
  }
}

function loadSample() {
  ws.value = 'enc'
  keyBits.value = '256'
  keyEnc.value = 'hex'
  key.value = SAMPLE_KEY
  iv.value = SAMPLE_IV
  aad.value = SAMPLE_AAD
  tagLen.value = '128'
  encOutEnc.value = 'hex'
  input.value = SAMPLE_PT
  execute()
}

function loadDecSample() {
  ws.value = 'dec'
  keyBits.value = '256'
  keyEnc.value = 'hex'
  key.value = SAMPLE_KEY
  iv.value = SAMPLE_IV
  aad.value = SAMPLE_AAD
  tagLen.value = '128'
  decInEnc.value = 'hex'
  input.value = SAMPLE_CT_HEX
  execute()
}
</script>

<template>
  <div class="t14">
    <div class="t14__toolbar">
      <DkSegmented
        :model-value="ws"
        :options="[
          { value: 'enc', label: '加密' },
          { value: 'dec', label: '解密' }
        ]"
        @update:model-value="ws = $event as any"
      />
      <span class="t14__tl">密钥位数</span>
      <DkSegmented
        size="sm"
        :model-value="keyBits"
        :options="[
          { value: '128', label: '128' },
          { value: '192', label: '192' },
          { value: '256', label: '256' }
        ]"
        @update:model-value="keyBits = $event as any"
      />
      <span class="t14__tl">密钥编码</span>
      <DkSegmented
        size="sm"
        :model-value="keyEnc"
        :options="[
          { value: 'hex', label: 'Hex', title: '密钥按 Hex 解码为字节' },
          { value: 'base64', label: 'Base64', title: '密钥按 Base64 解码为字节' },
          { value: 'utf8', label: 'UTF-8', title: '密钥按 UTF-8 编码为字节' }
        ]"
        @update:model-value="keyEnc = $event as any"
      />
      <span class="t14__tl">认证标签</span>
      <DkSegmented
        size="sm"
        :model-value="tagLen"
        :options="[
          { value: '96', label: '96 位' },
          { value: '112', label: '112 位' },
          { value: '128', label: '128 位' }
        ]"
        @update:model-value="tagLen = $event as any"
      />
      <span class="t14__tl">{{ ws === 'enc' ? '输出编码' : '输入编码' }}</span>
      <DkSegmented
        size="sm"
        :model-value="ws === 'enc' ? encOutEnc : decInEnc"
        :options="ws === 'enc'
          ? [
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' }
            ]
          : [
              { value: 'hex', label: 'Hex', title: '加密结果输出的密文||认证标签' },
              { value: 'base64', label: 'Base64' }
            ]"
        @update:model-value="(ws === 'enc' ? (encOutEnc = $event as any) : (decInEnc = $event as any))"
      />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="生成当前位数的随机密钥（Hex）" @click="randomKey">随机密钥</DkButton>
      <DkButton size="sm" variant="ghost" title="生成 12 字节随机 IV（Hex）" @click="randomIv">随机 IV</DkButton>
      <DkButton size="sm" variant="ghost" title="载入已核验的加密示例（node WebCrypto 复核）" @click="loadSample">加密示例</DkButton>
      <DkButton size="sm" variant="ghost" title="载入已核验的解密示例（密文可被本工具解密回去）" @click="loadDecSample">解密示例</DkButton>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="lock" :size="12" />
        {{ ws === 'enc' ? '加密' : '解密' }}
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? '正在计算…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[`AES-GCM / AES-${keyBits}`, `IV ${ivDecoded.error ? '?' : ivDecoded.bytes.length} 字节`, `标签 ${tagLen} 位`]"
      :retry="execute"
    />

    <div class="t14__params">
      <DkField label="密钥（原始字节，不是口令）" :error="keyErr || undefined" :help="keyHelp" secret>
        <template #default="{ revealed }">
          <DkInput
            v-model="key"
            :type="revealed ? 'text' : 'password'"
            mono
            :placeholder="keyEnc === 'hex' ? `Hex，如 ${SAMPLE_KEY.slice(0, 16)}…（${needKeyBytes * 2} 个字符）` : keyEnc === 'base64' ? 'Base64' : 'UTF-8 文本'"
            :error="!!keyErr"
            autocomplete="off"
          />
        </template>
      </DkField>
      <DkField label="IV / nonce（Hex）" :error="ivErr || undefined" :help="ivHelp">
        <div class="t14__iv-row">
          <DkInput v-model="iv" mono placeholder="如 101112131415161718191a1b（12 字节）" :error="!!ivErr" />
          <DkButton size="sm" variant="secondary" title="生成 12 字节随机 IV" @click="randomIv">
            <DkIcon name="refresh" :size="12" />
            随机
          </DkButton>
        </div>
      </DkField>
      <DkField
        label="AAD 附加认证数据（可选，UTF-8）"
        help="参与认证但不加密；解密时必须与加密时完全一致，否则认证失败"
      >
        <DkInput v-model="aad" mono placeholder="可留空；示例使用 devkit" autocomplete="off" />
      </DkField>
    </div>

    <div class="t14__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="ws === 'enc' ? '明文（UTF-8 文本）' : `密文（${decInEnc === 'hex' ? 'Hex' : 'Base64'}，密文||认证标签）`"
            :placeholder="ws === 'enc' ? '输入要加密的文本，或点击「加密示例」' : '粘贴加密结果（密文||认证标签 拼接），并填写原 IV 与 AAD'"
            :height="'calc(48vh - 60px)'"
            :filename="ws === 'enc' ? 'plaintext.txt' : 'ciphertext.txt'"
          />
        </template>
        <template #right>
          <template v-if="ws === 'enc'">
            <div class="t14__result">
              <div class="t14__result-head">
                <span>加密结果（密文||认证标签）</span>
                <span class="grow"></span>
                <span v-if="encResult" class="tertiary">{{ encOutEnc === 'hex' ? 'Hex（小写）' : 'Base64' }}</span>
              </div>
              <p v-if="!encResult" class="t14__empty tertiary">
                填写密钥与 IV 后点击「加密」。结果为 WebCrypto 原样输出的 密文||认证标签 拼接，
                复制后可在解密页配合同一密钥、IV、AAD 直接解开。
              </p>
              <template v-else>
                <div class="t14__row t14__row--main">
                  <span class="t14__row-label">密文||认证标签</span>
                  <span class="t14__row-val mono">{{ encResult.combined }}</span>
                  <DkIconButton
                    title="复制密文||认证标签"
                    :disabled="run.status.value === 'stale'"
                    @click="clipboard.copy(encResult.combined, '密文||认证标签')"
                  >
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
                <div class="t14__row">
                  <span class="t14__row-label">IV（nonce）</span>
                  <span class="t14__row-val mono">{{ encResult.ivHex }}</span>
                  <DkIconButton title="复制 IV" :disabled="run.status.value === 'stale'" @click="clipboard.copy(encResult.ivHex, 'IV')">
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
                <div class="t14__row">
                  <span class="t14__row-label">认证标签（{{ tagLen }} 位）</span>
                  <span class="t14__row-val mono">{{ encResult.tagHex }}</span>
                  <DkIconButton title="复制认证标签" :disabled="run.status.value === 'stale'" @click="clipboard.copy(encResult.tagHex, '认证标签')">
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
                <div class="t14__row">
                  <span class="t14__row-label">纯密文（不含标签）</span>
                  <span class="t14__row-val mono">{{ encResult.ctHex }}</span>
                  <DkIconButton title="复制纯密文" :disabled="run.status.value === 'stale'" @click="clipboard.copy(encResult.ctHex, '纯密文')">
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
                <p class="t14__note tertiary">密文格式：结果 = WebCrypto 输出的 密文||认证标签 顺序拼接（标签在末尾，{{ tagBytes }} 字节）。</p>
              </template>
            </div>
          </template>
          <template v-else>
            <div class="t14__dec">
              <p v-if="!decResult" class="t14__empty tertiary">
                解密需填写：原密钥、原 IV、原 AAD，且认证标签长度与加密时一致；输入为「密文||认证标签」拼接。
              </p>
              <template v-else>
                <div class="t14__dec-head">
                  <span>{{ decResult.isHex ? '解密结果（非 UTF-8，按 Hex 显示）' : '解密结果（UTF-8 文本）' }}</span>
                  <span class="grow"></span>
                  <span class="tertiary">{{ decResult.bytes }} 字节</span>
                </div>
                <DkEditor
                  :model-value="decResult.text"
                  readonly
                  :lang="decResult.isHex ? 'Hex' : '明文'"
                  :height="'calc(40vh - 60px)'"
                  :stale="run.status.value === 'stale'"
                  filename="decrypted.txt"
                />
                <div class="t14__dec-hex">
                  <span class="t14__row-label">结果 Hex</span>
                  <span class="t14__row-val mono">{{ decResult.hex }}</span>
                  <DkIconButton
                    title="复制结果 Hex"
                    :disabled="run.status.value === 'stale'"
                    @click="clipboard.copy(decResult.hex, '解密结果 Hex')"
                  >
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
              </template>
            </div>
          </template>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="示例向量与格式说明（已用 node WebCrypto 真实计算复核）">
      <h4>示例向量（AES-256-GCM，认证标签 128 位）</h4>
      <ul>
        <li>密钥（Hex，32 字节）：<code>{{ SAMPLE_KEY }}</code></li>
        <li>IV（Hex，12 字节）：<code>{{ SAMPLE_IV }}</code></li>
        <li>AAD（UTF-8）：<code>{{ SAMPLE_AAD }}</code></li>
        <li>明文：<code>{{ SAMPLE_PT }}</code></li>
        <li>密文||认证标签（Hex）：<code>{{ SAMPLE_CT_HEX }}</code></li>
      </ul>
      <p>点击「加密示例」会现场重新计算（结果应与上值一致）；点击「解密示例」载入该密文并现场解密，可验证往返。</p>
      <h4>密钥不是口令</h4>
      <p>密钥必须是与位数匹配的原始字节（128/192/256 位 = 16/24/32 字节）。本工具不执行任何密码派生（PBKDF2、scrypt 等）：
        口令不能直接当密钥用，长度不符会得到明确的字节数错误。</p>
      <h4>密文格式</h4>
      <p>结果 = WebCrypto AES-GCM 输出的 密文||认证标签 顺序拼接，标签固定在末尾（长度由「认证标签」选择决定）。
        解密时直接粘贴完整结果即可，无需手工拆分标签。GCM 是认证加密：解密时密钥、IV、AAD、标签长度任一与加密时不同，都会得到「认证失败」。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t14 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t14__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t14__tl {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t14__params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.t14__iv-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.t14__iv-row .dk-input,
.t14__iv-row > :first-child {
  flex: 1;
  min-width: 0;
}
.t14__panes {
  min-height: 300px;
}
.t14__result,
.t14__dec {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.t14__result-head,
.t14__dec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t14__empty {
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
}
.t14__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.t14__row--main .t14__row-val {
  font-weight: 500;
}
.t14__row-label {
  flex-shrink: 0;
  width: 128px;
  font-size: 12px;
  color: var(--text-secondary);
  padding-top: 2px;
}
.t14__row-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.t14__note {
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
}
.t14__dec {
  gap: 0;
}
.t14__dec .t14__dec-head {
  border-bottom: 1px solid var(--border);
}
.t14__dec > .t14__empty {
  flex: 1;
}
.t14__dec-hex {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
</style>
