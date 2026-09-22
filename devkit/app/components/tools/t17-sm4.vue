<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { base64ToBytes, bytesToBase64, bytesToHex, bytesToText, hexToBytes, textToBytes } from '~/utils/bytes'
import { sm4Decrypt, sm4Encrypt } from '~/utils/crypto/sm4'

defineProps<{ tool: ToolMeta }>()

const op = ref<'enc' | 'dec'>('enc')
const mode = ref<'cbc' | 'ecb'>('cbc')
const padding = ref<'pkcs#7' | 'none'>('pkcs#7')
const keyEnc = ref<'hex' | 'utf8'>('utf8')
const key = ref('')
const iv = ref('')
const ptEnc = ref<'utf8' | 'hex' | 'base64'>('utf8') // 加密：明文输入编码
const ctEnc = ref<'hex' | 'base64'>('hex') // 解密：密文输入编码
const encOut = ref<'hex' | 'base64'>('hex') // 加密：输出编码
const decOut = ref<'utf8' | 'hex' | 'base64'>('utf8') // 解密：输出编码
const input = ref('')

const busy = ref(false)
const result = ref<{ text: string; isHexView: boolean; hex: string; bytes: number } | null>(null)

const toast = useToast()
const clipboard = useClipboard()

/** 示例向量：node + sm-crypto 真实计算，并已验证可解密回原文 */
const SAMPLE_KEY = 'DevKit-SM4-Key12' // 16 个 ASCII 字符，UTF-8 编码恰好 16 字节
const SAMPLE_KEY_HEX = '4465764b69742d534d342d4b65793132'
const SAMPLE_IV = '0123456789abcdeffedcba9876543210'
const SAMPLE_PT = '国密 SM4 分组加密示例'
const SAMPLE_CT = '38aca3c7539d7e6fff13841268b72c1eb3337a7658b22591e65d1e6cc6ca8ef8'

const sig = () =>
  JSON.stringify([op.value, mode.value, padding.value, keyEnc.value, key.value, iv.value, ptEnc.value, ctEnc.value, encOut.value, decOut.value, input.value])
const run = useToolRun(sig)

/** 密钥解码：Hex（32 字符）或 UTF-8（恰好 16 字节），sm4 内部统一使用 Hex 形式 */
const keyHex = computed<{ hex: string; error?: string }>(() => {
  if (!key.value.trim()) return { hex: '' }
  if (keyEnc.value === 'hex') {
    const r = hexToBytes(key.value)
    if (r.error) return { hex: '', error: `密钥 Hex 非法：${r.error}` }
    return { hex: bytesToHex(r.bytes) }
  }
  const bytes = textToBytes(key.value)
  return { hex: bytesToHex(bytes) }
})

const keyErr = computed(() => {
  if (!key.value.trim()) return ''
  if (keyHex.value.error) return keyHex.value.error
  const len = keyHex.value.hex.length / 2
  if (len !== 16) {
    return keyEnc.value === 'hex'
      ? `密钥解码后 ${len} 字节，需要 16 字节（SM4 密钥固定 128 位，32 个 Hex 字符）`
      : `密钥 UTF-8 编码后 ${len} 字节，需要恰好 16 字节（16 个 ASCII 字符；非 ASCII 字符多字节编码会导致超长）`
  }
  return ''
})

const keyHelp = computed(() => {
  if (!key.value.trim()) return 'SM4 密钥固定 16 字节（128 位）：Hex 32 字符，或恰好 16 个 ASCII 字符'
  if (keyErr.value) return '先修正上方错误后才能执行'
  return `密钥有效：解码后 16 字节（Hex 形式 ${keyHex.value.hex}）`
})

/** IV 校验：仅 CBC 模式需要，16 字节 */
const ivDecoded = computed(() => hexToBytes(iv.value))
const ivErr = computed(() => {
  if (mode.value !== 'cbc') return ''
  if (!iv.value.trim()) return 'IV 为空：CBC 模式需要 16 字节 IV（32 个 Hex 字符），可点击「随机 IV」生成'
  if (ivDecoded.value.error) return `IV Hex 非法：${ivDecoded.value.error}`
  const len = ivDecoded.value.bytes.length
  if (len !== 16) return `IV 解码后 ${len} 字节，需要 16 字节（32 个 Hex 字符）`
  return ''
})

const ivHelp = computed(() =>
  mode.value !== 'cbc' ? 'ECB 模式不需要 IV' : !iv.value.trim() ? '16 字节（32 个 Hex 字符），加密与解密必须使用同一 IV' : ivErr.value ? '仅支持 Hex 输入' : `IV 有效：${ivDecoded.value.bytes.length} 字节`
)

function randomKey() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  keyEnc.value = 'hex'
  key.value = bytesToHex(bytes)
  toast.success('已生成 16 字节随机密钥（Hex）')
}

function randomIv() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  iv.value = bytesToHex(bytes)
  toast.success('已生成 16 字节随机 IV')
}

/** 输入解码 */
const inputDecoded = computed<{ bytes: Uint8Array; error?: string }>(() => {
  const v = input.value
  if (op.value === 'enc') {
    if (ptEnc.value === 'utf8') return { bytes: textToBytes(v) }
    const r = ptEnc.value === 'hex' ? hexToBytes(v) : base64ToBytes(v)
    return r.error ? { bytes: r.bytes, error: `明文 ${ptEnc.value === 'hex' ? 'Hex' : 'Base64'} 非法：${r.error}` } : r
  }
  const r = ctEnc.value === 'hex' ? hexToBytes(v) : base64ToBytes(v)
  return r.error ? { bytes: r.bytes, error: `密文 ${ctEnc.value === 'hex' ? 'Hex' : 'Base64'} 非法：${r.error}` } : r
})

/** 真实计算：走共享实现 ~/utils/crypto/sm4（sm-crypto 纯 JS，本地执行） */
function execute() {
  if (busy.value) return
  if (keyErr.value) {
    result.value = null
    run.markFail(keyErr.value)
    return
  }
  if (ivErr.value) {
    result.value = null
    run.markFail(ivErr.value)
    return
  }
  if (!key.value.trim() || !input.value.trim()) {
    result.value = null
    run.markIdle()
    return
  }
  const inR = inputDecoded.value
  if (inR.error) {
    result.value = null
    const which = op.value === 'enc' ? (ptEnc.value === 'hex' ? 'Hex' : ptEnc.value === 'base64' ? 'Base64' : '') : ctEnc.value === 'hex' ? 'Hex' : 'Base64'
    run.markFail(`${inR.error}${which ? `（输入编码当前为 ${which}）` : ''}`)
    return
  }
  const bytes = inR.bytes
  if (op.value === 'enc' && padding.value === 'none' && bytes.length % 16 !== 0) {
    result.value = null
    run.markFail(`NoPadding 不添加填充：当前输入 ${bytes.length} 字节，NoPadding 需为 16 的整数倍（可改用 PKCS#7，或调整输入）`)
    return
  }
  if (op.value === 'dec' && bytes.length % 16 !== 0) {
    result.value = null
    run.markFail(`解密密文长度错误：当前 ${bytes.length} 字节，不是 16 的整数倍（SM4 密文必为 16 字节的整数倍，请检查输入编码或密文是否完整）`)
    return
  }

  const opts = {
    mode: mode.value,
    padding: padding.value,
    ivHex: mode.value === 'cbc' ? bytesToHex(ivDecoded.value.bytes) : undefined
  }

  try {
    const u8 = op.value === 'enc' ? sm4Encrypt(bytes, keyHex.value.hex, opts) : sm4Decrypt(bytes, keyHex.value.hex, opts)
    const hex = bytesToHex(u8)
    if (op.value === 'enc') {
      result.value = {
        text: encOut.value === 'hex' ? hex : bytesToBase64(u8),
        isHexView: encOut.value !== 'hex',
        hex,
        bytes: u8.length
      }
      run.markOk(
        `SM4 ${mode.value.toUpperCase()} 加密成功（${padding.value === 'pkcs#7' ? 'PKCS#7 填充' : '无填充'}，明文 ${bytes.length} 字节 → 密文 ${u8.length} 字节）${mode.value === 'cbc' ? '；解密需同一密钥与 IV' : ''}`
      )
    } else {
      if (decOut.value === 'utf8') {
        const t = bytesToText(u8)
        if (t.error) {
          result.value = { text: hex, isHexView: true, hex, bytes: u8.length }
          run.markOk(`解密成功（${u8.length} 字节），但结果不是有效 UTF-8 文本（NoPadding 下常见，末尾可能含填充残留字节），已按 Hex 显示`)
        } else {
          result.value = { text: t.text, isHexView: false, hex, bytes: u8.length }
          run.markOk(
            `SM4 ${mode.value.toUpperCase()} 解密成功（${padding.value === 'pkcs#7' ? 'PKCS#7 去填充校验通过' : 'NoPadding，未去除任何字节'}，输出 ${u8.length} 字节）`
          )
        }
      } else {
        result.value = {
          text: decOut.value === 'hex' ? hex : bytesToBase64(u8),
          isHexView: decOut.value !== 'hex',
          hex,
          bytes: u8.length
        }
        run.markOk(`SM4 ${mode.value.toUpperCase()} 解密成功（${padding.value === 'pkcs#7' ? 'PKCS#7 去填充校验通过' : 'NoPadding，未去除任何字节'}，输出 ${u8.length} 字节）`)
      }
    }
  } catch (e) {
    result.value = null
    const msg = errMessage(e)
    if (msg.includes('padding is invalid')) {
      run.markFail('解密失败：PKCS#7 去填充校验未通过（通常是密钥错误或密文被修改；请核对密钥、IV 与模式）')
    } else if (msg.includes('key is invalid')) {
      run.markFail('解密失败：密钥无效（应解码后为 16 字节）')
    } else if (msg.includes('iv is invalid')) {
      run.markFail('解密失败：IV 无效（应解码后为 16 字节）')
    } else {
      run.markFail(`SM4 ${op.value === 'enc' ? '加密' : '解密'}失败：${msg}`)
    }
  }
}

function loadEncSample() {
  op.value = 'enc'
  mode.value = 'cbc'
  padding.value = 'pkcs#7'
  keyEnc.value = 'utf8'
  key.value = SAMPLE_KEY
  iv.value = SAMPLE_IV
  ptEnc.value = 'utf8'
  encOut.value = 'hex'
  input.value = SAMPLE_PT
  execute()
}

function loadDecSample() {
  op.value = 'dec'
  mode.value = 'cbc'
  padding.value = 'pkcs#7'
  keyEnc.value = 'utf8'
  key.value = SAMPLE_KEY
  iv.value = SAMPLE_IV
  ctEnc.value = 'hex'
  decOut.value = 'utf8'
  input.value = SAMPLE_CT
  execute()
}
</script>

<template>
  <div class="t17">
    <div class="t17__toolbar">
      <DkSegmented
        :model-value="op"
        :options="[
          { value: 'enc', label: '加密' },
          { value: 'dec', label: '解密' }
        ]"
        @update:model-value="op = $event as any"
      />
      <span class="t17__tl">模式</span>
      <DkSegmented
        size="sm"
        :model-value="mode"
        :options="[
          { value: 'cbc', label: 'CBC', title: '密码分组链接，需要 16 字节 IV' },
          { value: 'ecb', label: 'ECB', title: '电码本，无 IV，相同分组产生相同密文' }
        ]"
        @update:model-value="mode = $event as any"
      />
      <span class="t17__tl">填充</span>
      <DkSegmented
        size="sm"
        :model-value="padding"
        :options="[
          { value: 'pkcs#7', label: 'PKCS#7', title: '填充至 16 字节整数倍（默认）' },
          { value: 'none', label: 'NoPadding', title: '不填充：输入字节数必须是 16 的整数倍' }
        ]"
        @update:model-value="padding = $event as any"
      />
      <span class="t17__tl">密钥编码</span>
      <DkSegmented
        size="sm"
        :model-value="keyEnc"
        :options="[
          { value: 'utf8', label: 'UTF-8', title: '恰好 16 个字符且编码后 16 字节（即 16 个 ASCII 字符）' },
          { value: 'hex', label: 'Hex', title: '32 个 Hex 字符（16 字节）' }
        ]"
        @update:model-value="keyEnc = $event as any"
      />
      <span class="t17__tl">{{ op === 'enc' ? '明文编码' : '密文编码' }}</span>
      <DkSegmented
        size="sm"
        :model-value="op === 'enc' ? ptEnc : ctEnc"
        :options="op === 'enc'
          ? [
              { value: 'utf8', label: 'UTF-8' },
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' }
            ]
          : [
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' }
            ]"
        @update:model-value="(op === 'enc' ? (ptEnc = $event as any) : (ctEnc = $event as any))"
      />
      <span class="t17__tl">输出编码</span>
      <DkSegmented
        size="sm"
        :model-value="op === 'enc' ? encOut : decOut"
        :options="op === 'enc'
          ? [
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' }
            ]
          : [
              { value: 'utf8', label: 'UTF-8' },
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' }
            ]"
        @update:model-value="(op === 'enc' ? (encOut = $event as any) : (decOut = $event as any))"
      />
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="生成 16 字节随机密钥（Hex）" @click="randomKey">随机密钥</DkButton>
      <DkButton v-if="mode === 'cbc'" size="sm" variant="ghost" title="生成 16 字节随机 IV（Hex）" @click="randomIv">随机 IV</DkButton>
      <DkButton size="sm" variant="ghost" title="载入 node 已核验的加密示例并现场计算" @click="loadEncSample">加密示例</DkButton>
      <DkButton size="sm" variant="ghost" title="载入 node 已核验的密文并现场解密（应还原为中文明文）" @click="loadDecSample">解密示例</DkButton>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="shield-check" :size="12" />
        {{ op === 'enc' ? '加密' : '解密' }}
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? '正在计算…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[mode.toUpperCase(), padding === 'pkcs#7' ? 'PKCS#7' : 'NoPadding', ...(mode === 'cbc' ? [`IV ${ivDecoded.error ? '?' : ivDecoded.bytes.length} 字节`] : ['无 IV'])]"
      :retry="execute"
    />

    <div class="t17__params">
      <DkField label="密钥（16 字节 / 128 位）" :error="keyErr || undefined" :help="keyHelp" secret>
        <template #default="{ revealed }">
          <DkInput
            v-model="key"
            :type="revealed ? 'text' : 'password'"
            mono
            :placeholder="keyEnc === 'hex' ? '32 个 Hex 字符，如 0123456789abcdeffedcba9876543210' : '16 个 ASCII 字符，如 DevKit-SM4-Key12'"
            :error="!!keyErr"
            autocomplete="off"
          />
        </template>
      </DkField>
      <DkField v-if="mode === 'cbc'" label="IV（Hex，16 字节）" :error="ivErr || undefined" :help="ivHelp">
        <div class="t17__iv-row">
          <DkInput v-model="iv" mono placeholder="32 个 Hex 字符，如 0123456789abcdeffedcba9876543210" :error="!!ivErr" />
          <DkButton size="sm" variant="secondary" title="生成 16 字节随机 IV" @click="randomIv">
            <DkIcon name="refresh" :size="12" />
            随机
          </DkButton>
        </div>
      </DkField>
      <DkField v-else label="IV" help="ECB 模式不使用 IV（该区域已隐藏，相同明文分组会加密成相同密文分组，不建议加密长数据）" />
    </div>

    <div class="t17__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="op === 'enc'
              ? `明文（${ptEnc === 'utf8' ? 'UTF-8 文本' : ptEnc === 'hex' ? 'Hex' : 'Base64'}）`
              : `密文（${ctEnc === 'hex' ? 'Hex' : 'Base64'}，须为 16 字节整数倍）`"
            :placeholder="op === 'enc'
              ? (padding === 'none'
                ? '输入内容（NoPadding：编码后的字节数必须是 16 的整数倍）'
                : '输入要加密的文本，或点击「加密示例」')
              : '粘贴 SM4 密文（16 字节的整数倍），密钥/IV/模式/填充须与加密时一致'"
            :height="'calc(48vh - 60px)'"
            :filename="op === 'enc' ? 'sm4-plaintext.txt' : 'sm4-ciphertext.txt'"
          />
        </template>
        <template #right>
          <div class="t17__result">
            <div class="t17__result-head">
              <span>{{ op === 'enc' ? `SM4-${mode.toUpperCase()} 密文` : '解密结果' }}</span>
              <span class="grow"></span>
              <span v-if="result" class="tertiary">{{ op === 'enc' ? (encOut === 'hex' ? 'Hex（小写）' : 'Base64') : decOut === 'utf8' ? (result.isHexView ? 'UTF-8 失败，已按 Hex 显示' : 'UTF-8 文本') : decOut === 'hex' ? 'Hex（小写）' : 'Base64' }}</span>
            </div>
            <p v-if="!result" class="t17__empty tertiary">
              {{ op === 'enc'
                ? `填写密钥${mode === 'cbc' ? '与 IV ' : ''}后点击「加密」。PKCS#7 会把明文填充到 16 字节整数倍；NoPadding 要求输入字节数本身就是 16 的整数倍。`
                : '填写密钥与密文后点击「解密」。解密使用与加密完全相同的密钥、IV（CBC）、模式与填充，任一不同都会得到乱码或报错。' }}
            </p>
            <template v-else>
              <div class="t17__dec-text mono">{{ result.text }}</div>
              <div class="t17__foot">
                <span class="tertiary">{{ result.bytes }} 字节 · Hex：{{ result.hex.slice(0, 32) }}{{ result.hex.length > 32 ? '…' : '' }}</span>
                <span class="grow"></span>
                <DkIconButton title="复制结果" :disabled="run.status.value === 'stale'" @click="clipboard.copy(result!.text, 'SM4 结果')">
                  <DkIcon name="copy" :size="14" />
                </DkIconButton>
              </div>
            </template>
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="示例向量与说明（node + sm-crypto 真实计算，往返已验证）">
      <h4>CBC / PKCS#7 示例</h4>
      <ul>
        <li>密钥（UTF-8）：<code>{{ SAMPLE_KEY }}</code>（16 个 ASCII 字符；Hex 形式 <code>{{ SAMPLE_KEY_HEX }}</code>）</li>
        <li>IV（Hex）：<code>{{ SAMPLE_IV }}</code></li>
        <li>明文（UTF-8）：<code>{{ SAMPLE_PT }}</code></li>
        <li>密文（Hex，node 真实计算）：<code>{{ SAMPLE_CT }}</code></li>
      </ul>
      <p>点击「加密示例」现场计算，结果应与上值一致；点击「解密示例」载入该密文现场解密，应还原出中文明文（node 已验证往返一致）。</p>
      <h4>参数约束</h4>
      <ul>
        <li>密钥固定 16 字节：Hex 输入须 32 个字符；UTF-8 输入须恰好编码为 16 字节（16 个 ASCII 字符，中文等多字节字符会超长）。</li>
        <li>CBC 需要 16 字节 IV（Hex 32 字符）；ECB 无 IV（安全性弱，仅作兼容用途）。</li>
        <li>PKCS#7 自动填充/去填充（去填充失败说明密钥错误或密文被修改）；NoPadding 要求输入字节数为 16 的整数倍，解密输出不剔除任何字节。</li>
        <li>密文必为 16 字节的整数倍：解密输入长度不满足会直接报错。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t17 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t17__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t17__tl {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t17__params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.t17__iv-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.t17__iv-row > :first-child {
  flex: 1;
  min-width: 0;
}
.t17__panes {
  min-height: 300px;
}
.t17__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.t17__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t17__empty {
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
}
.t17__dec-text {
  flex: 1;
  overflow: auto;
  padding: 12px;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
  line-height: 1.7;
  white-space: pre-wrap;
}
.t17__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
</style>
