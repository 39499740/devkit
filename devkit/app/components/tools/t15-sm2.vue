<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import smCrypto from 'sm-crypto'
import sm2utils from 'sm-crypto/src/sm2/utils'
import { BigInteger } from 'jsbn'

const { sm2 } = smCrypto

defineProps<{ tool: ToolMeta }>()

const ws = ref<'cipher' | 'sign'>('cipher')
const cOp = ref<'enc' | 'dec'>('enc')
const sOp = ref<'sign' | 'verify'>('sign')

const pubKey = ref('')
const privKey = ref('')
const cipherMode = ref<'1' | '0'>('1') // 1 = C1C3C2（默认），0 = C1C2C3
const cipherEnc = ref<'hex' | 'base64'>('hex')
const userId = ref('1234567812345678')
const sigFormat = ref<'raw' | 'der'>('raw')
const cInput = ref('') // 加密明文 / 解密密文
const sMsg = ref('') // 签名/验签共用原文
const sigInput = ref('') // 验签输入（签名结果自动填入）

const busy = ref(false)
const encResult = ref<{ hex: string; b64: string } | null>(null)
const decResult = ref<{ text: string; bytes: number } | null>(null)
const signResult = ref<{ sig: string; format: string } | null>(null)
const verifyResult = ref<boolean | null>(null)

const toast = useToast()
const clipboard = useClipboard()

/** 示例数据：node + sm-crypto 真实生成并验证（可解密、可验签通过）后写死 */
const SAMPLE_PUB = '04153365094222d65b0733da2de3515b7a45c58eaacf7f8a77da497ec2a5edf7c2d4cb0636be80c3b18b32229044734b0b8d5a50be7eba40b450f60d3b667e5aed'
const SAMPLE_PRIV = '2ee6ca8da15004e8a98324f0dc8abf2be01b2d9ff9236fcf25301fc641ae5371'
const SAMPLE_PT = '你好，DevKit！SM2 国密非对称加密。'
const SAMPLE_CT_HEX = '709ae8c0ea961093b7f31f7a4b7675733baa95ebb1b9bdc3ad8b9a5fc630f3c81bd0dc0d711865e88cb9ee596ea12621bdd394c8bb9c64d69e393f2119484835e39c5c60d06c0f2ce4bae33db8e34db93b66b20f7d83331af75636dc520419a8cc27254135b7273d818c4e91801ae1f93399d221e6b66bd1adb7a63d995f0764942c7cd06aa96f327bb17c0b5c64'
const SAMPLE_SIGN_MSG = 'DevKit SM2 签名验签示例文本'
const SAMPLE_SIG_RAW = 'c6638f4749d35e688af204c50499bc105db2b404912972e02a3091eae63246be97ba81878c328c525befe1a6aaea137bc5fb8be60533b5a47581e21f6d7fe766'
const SAMPLE_SIG_DER = '304502200da4e0319a1d962ac318e004ab21d0004b3b47a215986b80042b57c40f3f8e7e022100f8a49d13cf175c14386fab79ce01763b140ea2efd168821c8a50dd9f20dc59aa'

const sig = () =>
  JSON.stringify([ws.value, cOp.value, sOp.value, pubKey.value, privKey.value, cipherMode.value, cipherEnc.value, userId.value, sigFormat.value, cInput.value, sMsg.value, sigInput.value])
const run = useToolRun(sig)

const cleanHex = (s: string) => s.replace(/\s+/g, '').toLowerCase()

const leftPad = (s: string, n: number) => (s.length >= n ? s : '0'.repeat(n - s.length) + s)

/** 独立复核空明文（C2 为 0 字节）密文的 C3 = SM3(x2 || y2)，区分「C3 校验失败」与「明文为空」 */
function emptyPlaintextC3Valid(ctHex: string, privHex: string, mode: number): boolean {
  const c1 = sm2utils.getGlobalCurve().decodePointHex('04' + ctHex.slice(0, 128))
  if (!c1) return false
  const p = c1.multiply(new BigInteger(privHex, 16))
  const x2 = leftPad(p.getX().toBigInteger().toString(16), 64)
  const y2 = leftPad(p.getY().toBigInteger().toString(16), 64)
  const bytes: number[] = []
  for (let i = 0; i < x2.length; i += 2) bytes.push(parseInt(x2.substr(i, 2), 16))
  for (let i = 0; i < y2.length; i += 2) bytes.push(parseInt(y2.substr(i, 2), 16))
  const expectedC3 = smCrypto.sm3(bytes)
  const actualC3 = mode === 0 ? ctHex.slice(ctHex.length - 64) : ctHex.slice(128, 192)
  return expectedC3 === actualC3.toLowerCase()
}

/** 公钥格式校验：04 开头非压缩 130 位，或 02/03 开头压缩 66 位 */
const pubErr = computed(() => {
  if (!pubKey.value.trim()) return ''
  const k = cleanHex(pubKey.value)
  if (!/^[0-9a-f]+$/.test(k)) return '公钥 Hex 非法：包含非十六进制字符'
  if (k.startsWith('04')) {
    if (k.length !== 130) return `公钥为 04 开头的非压缩格式，应为 130 位 Hex，当前 ${k.length} 位`
  } else if (k.startsWith('02') || k.startsWith('03')) {
    if (k.length !== 66) return `公钥为 ${k.slice(0, 2)} 开头的压缩格式，应为 66 位 Hex，当前 ${k.length} 位`
  } else {
    return '公钥应以 04 开头（非压缩，130 位 Hex）或 02/03 开头（压缩，66 位 Hex）'
  }
  if (!sm2.verifyPublicKey(k)) {
    return '公钥不是有效的 SM2 曲线点：不满足 y² = x³ + ax + b (mod p)，无法用于加密或验签，请检查公钥是否完整或属于 SM2 曲线'
  }
  return ''
})

const pubHelp = computed(() =>
  pubErr.value
    ? '先修正上方错误后才能执行'
    : pubKey.value.trim()
      ? `格式与曲线点均有效：${cleanHex(pubKey.value).startsWith('04') ? '非压缩（130 位，含 04 前缀）' : '压缩（66 位，含 02/03 前缀）'}`
      : '04 开头非压缩 130 位，或 02/03 开头压缩 66 位（Hex），且必须位于 SM2 曲线上'
)

/** 私钥格式校验：64 位 Hex（32 字节），不带 04 前缀 */
const privErr = computed(() => {
  if (!privKey.value.trim()) return ''
  const k = cleanHex(privKey.value)
  if (!/^[0-9a-f]+$/.test(k)) return '私钥 Hex 非法：包含非十六进制字符'
  if (k.length !== 64) return `私钥应为 64 位 Hex（32 字节），当前 ${k.length} 位`
  return ''
})

/** 解密输入解码（Hex 或 Base64 → Hex 字符串给 sm-crypto） */
const cipherToHex = computed<{ hex: string; error?: string }>(() => {
  const v = cInput.value.trim()
  if (!v) return { hex: '' }
  if (cipherEnc.value === 'hex') {
    const r = hexToBytes(v)
    if (r.error) return { hex: '', error: `密文 Hex 非法：${r.error}` }
    return { hex: bytesToHex(r.bytes) }
  }
  const r = base64ToBytes(v)
  if (r.error) return { hex: '', error: `密文 Base64 非法：${r.error}` }
  return { hex: bytesToHex(r.bytes) }
})

const sigHexErr = computed(() => {
  if (sOp.value !== 'verify' || !sigInput.value.trim()) return ''
  const v = cleanHex(sigInput.value)
  if (!/^[0-9a-f]+$/.test(v)) return '签名 Hex 非法：包含非十六进制字符'
  if (sigFormat.value === 'raw' && v.length !== 128) return `raw 签名应为 128 位 Hex（r||s 各 64 位），当前 ${v.length} 位`
  return ''
})

function genKeyPair() {
  const kp = sm2.generateKeyPairHex()
  pubKey.value = kp.publicKey
  privKey.value = kp.privateKey
  toast.success('已生成新密钥对（公钥 04 非压缩格式）')
}

/** 真实计算：sm-crypto（纯 JS，本地执行） */
function execute() {
  if (busy.value) return
  verifyResult.value = null
  const mode = Number(cipherMode.value)

  if (ws.value === 'cipher') {
    if (cOp.value === 'enc') {
      if (pubErr.value) {
        encResult.value = null
        decResult.value = null
        run.markFail(pubErr.value)
        return
      }
      if (!cInput.value) {
        encResult.value = null
        decResult.value = null
        run.markIdle()
        return
      }
      if (!pubKey.value.trim()) {
        encResult.value = null
        decResult.value = null
        run.markFail('公钥为空：请填写公钥或点击「生成密钥对」')
        return
      }
      try {
        const hex = sm2.doEncrypt(cInput.value, cleanHex(pubKey.value), mode)
        encResult.value = { hex, b64: bytesToBase64(hexToBytes(hex).bytes) }
        decResult.value = null
        run.markOk(
          `SM2 加密成功（${cipherMode.value === '1' ? 'C1C3C2' : 'C1C2C3'}，明文 ${byteLength(cInput.value)} 字节，密文 ${hex.length / 2} 字节）；每次加密使用新的随机数 k，同参数重复加密结果不同`
        )
      } catch (e) {
        encResult.value = null
        run.markFail(`SM2 加密失败：${errMessage(e)}`)
      }
    } else {
      if (privErr.value) {
        encResult.value = null
        decResult.value = null
        run.markFail(privErr.value)
        return
      }
      if (!privKey.value.trim()) {
        encResult.value = null
        decResult.value = null
        run.markFail('私钥为空：请填写 64 位 Hex 私钥')
        return
      }
      if (!cInput.value.trim()) {
        encResult.value = null
        decResult.value = null
        run.markIdle()
        return
      }
      if (cipherToHex.value.error) {
        encResult.value = null
        decResult.value = null
        run.markFail(`${cipherToHex.value.error}（密文编码当前为 ${cipherEnc.value === 'hex' ? 'Hex' : 'Base64'}）`)
        return
      }
      const hex = cipherToHex.value.hex
      if (hex.length < 192 || hex.length % 2 !== 0) {
        encResult.value = null
        decResult.value = null
        run.markFail(`密文长度异常：解码后 ${hex.length / 2} 字节，SM2 密文至少 96 字节（C1 64 + C3 32 + C2 至少 0）`)
        return
      }
      try {
        const out = sm2.doDecrypt(hex, cleanHex(privKey.value), mode)
        if (out === '' && hex.length === 192) {
          if (emptyPlaintextC3Valid(hex, cleanHex(privKey.value), mode)) {
            decResult.value = { text: '（空字符串）', bytes: 0 }
            encResult.value = null
            run.markOk('SM2 解密成功：明文为空字符串（C2 为 0 字节），C3 校验通过')
          } else {
            decResult.value = null
            encResult.value = null
            run.markFail(
              `解密失败：C3 校验未通过。常见原因：私钥与密文不匹配、密文被修改，或 cipherMode（当前 ${cipherMode.value === '1' ? 'C1C3C2' : 'C1C2C3'}）与加密时不一致`
            )
          }
        } else if (out === '') {
          decResult.value = null
          encResult.value = null
          run.markFail(
            `解密失败：C3 校验未通过。常见原因：私钥与密文不匹配、密文被修改，或 cipherMode（当前 ${cipherMode.value === '1' ? 'C1C3C2' : 'C1C2C3'}）与加密时不一致`
          )
        } else {
          decResult.value = { text: out, bytes: byteLength(out) }
          encResult.value = null
          run.markOk(`SM2 解密成功（${cipherMode.value === '1' ? 'C1C3C2' : 'C1C2C3'}，C3 校验通过，明文 ${byteLength(out)} 字节）`)
        }
      } catch (e) {
        decResult.value = null
        run.markFail(`SM2 解密失败：${errMessage(e)}`)
      }
    }
    return
  }

  // ===== 签名验签工作区 =====
  if (!sMsg.value) {
    signResult.value = null
    verifyResult.value = null
    run.markIdle()
    return
  }
  if (sigHexErr.value) {
    signResult.value = null
    run.markFail(sigHexErr.value)
    return
  }
  if (sOp.value === 'sign') {
    if (privErr.value) {
      signResult.value = null
      run.markFail(privErr.value)
      return
    }
    if (!privKey.value.trim()) {
      signResult.value = null
      run.markFail('私钥为空：请填写 64 位 Hex 私钥或点击「生成密钥对」')
      return
    }
    try {
      const der = sigFormat.value === 'der'
      const out = sm2.doSignature(sMsg.value, cleanHex(privKey.value), { hash: true, userId: userId.value, der })
      signResult.value = { sig: out, format: der ? 'DER（ASN.1）' : 'raw（r||s）' }
      sigInput.value = out // 自动填入验签输入，便于接着验签
      run.markOk(`SM2 签名成功（SM3 摘要 + userId「${userId.value}」，${der ? 'DER' : 'raw r||s'} 编码，已自动填入验签输入）`)
    } catch (e) {
      signResult.value = null
      run.markFail(`SM2 签名失败：${errMessage(e)}`)
    }
  } else {
    if (pubErr.value) {
      verifyResult.value = null
      run.markFail(pubErr.value)
      return
    }
    if (!pubKey.value.trim()) {
      verifyResult.value = null
      run.markFail('公钥为空：请填写公钥（验签使用公钥）')
      return
    }
    if (!sigInput.value.trim()) {
      verifyResult.value = null
      run.markFail('签名为空：请填写待验证的签名（签名后自动填入，或粘贴外部签名）')
      return
    }
    try {
      const der = sigFormat.value === 'der'
      const pass = sm2.doVerifySignature(sMsg.value, cleanHex(sigInput.value), cleanHex(pubKey.value), {
        hash: true,
        userId: userId.value,
        der
      })
      verifyResult.value = pass
      if (pass) {
        run.markOk(`验签通过：签名与原文、公钥、userId「${userId.value}」及 ${der ? 'DER' : 'raw r||s'} 格式均匹配`)
      } else {
        run.markOk('验签不通过：这是一个真实计算出的结论，不是执行错误')
      }
    } catch (e) {
      verifyResult.value = null
      run.markFail(`验签执行失败：${errMessage(e)}（请检查签名格式是否与所选编码一致）`)
    }
  }
}

function loadEncSample() {
  ws.value = 'cipher'
  cOp.value = 'enc'
  pubKey.value = SAMPLE_PUB
  privKey.value = SAMPLE_PRIV
  cipherMode.value = '1'
  cipherEnc.value = 'hex'
  cInput.value = SAMPLE_PT
  execute()
}

function loadDecSample() {
  ws.value = 'cipher'
  cOp.value = 'dec'
  pubKey.value = SAMPLE_PUB
  privKey.value = SAMPLE_PRIV
  cipherMode.value = '1'
  cipherEnc.value = 'hex'
  cInput.value = SAMPLE_CT_HEX
  execute()
}

function loadSignSample() {
  ws.value = 'sign'
  sOp.value = 'sign'
  pubKey.value = SAMPLE_PUB
  privKey.value = SAMPLE_PRIV
  userId.value = '1234567812345678'
  sigFormat.value = 'raw'
  sMsg.value = SAMPLE_SIGN_MSG
  execute()
}

function loadVerifySample() {
  ws.value = 'sign'
  sOp.value = 'verify'
  pubKey.value = SAMPLE_PUB
  userId.value = '1234567812345678'
  sigFormat.value = 'raw'
  sMsg.value = SAMPLE_SIGN_MSG
  sigInput.value = SAMPLE_SIG_RAW
  execute()
}

const cipherDisplay = computed(() => {
  if (!encResult.value) return ''
  return cipherEnc.value === 'hex' ? encResult.value.hex : encResult.value.b64
})
</script>

<template>
  <div class="t15">
    <div class="t15__toolbar">
      <DkSegmented
        :model-value="ws"
        :options="[
          { value: 'cipher', label: '加解密' },
          { value: 'sign', label: '签名验签' }
        ]"
        @update:model-value="ws = $event as any"
      />
      <template v-if="ws === 'cipher'">
        <DkSegmented
          size="sm"
          :model-value="cOp"
          :options="[
            { value: 'enc', label: '加密（公钥）' },
            { value: 'dec', label: '解密（私钥）' }
          ]"
          @update:model-value="cOp = $event as any"
        />
        <span class="t15__tl">密文顺序</span>
        <DkSegmented
          size="sm"
          :model-value="cipherMode"
          :options="[
            { value: '1', label: 'C1C3C2', title: '新标准顺序（默认），sm-crypto cipher: 1' },
            { value: '0', label: 'C1C2C3', title: '旧标准顺序，sm-crypto cipher: 0' }
          ]"
          @update:model-value="cipherMode = $event as any"
        />
        <span class="t15__tl">密文编码</span>
        <DkSegmented
          size="sm"
          :model-value="cipherEnc"
          :options="[
            { value: 'hex', label: 'Hex' },
            { value: 'base64', label: 'Base64' }
          ]"
          @update:model-value="cipherEnc = $event as any"
        />
      </template>
      <template v-else>
        <DkSegmented
          size="sm"
          :model-value="sOp"
          :options="[
            { value: 'sign', label: '签名（私钥）' },
            { value: 'verify', label: '验签（公钥）' }
          ]"
          @update:model-value="sOp = $event as any"
        />
        <span class="t15__tl">签名编码</span>
        <DkSegmented
          size="sm"
          :model-value="sigFormat"
          :options="[
            { value: 'raw', label: 'raw（r||s）', title: '64 字节 r、s 直接拼接，128 位 Hex' },
            { value: 'der', label: 'DER', title: 'ASN.1 DER 编码' }
          ]"
          @update:model-value="sigFormat = $event as any"
        />
      </template>
      <span class="grow"></span>
      <DkButton size="sm" variant="secondary" title="sm2.generateKeyPairHex() 现场生成" @click="genKeyPair">
        <DkIcon name="key" :size="12" />
        生成密钥对
      </DkButton>
      <template v-if="ws === 'cipher'">
        <DkButton size="sm" variant="ghost" title="载入示例密钥与中文明文并现场加密" @click="loadEncSample">加密示例</DkButton>
        <DkButton size="sm" variant="ghost" title="载入 node 已验证的密文并现场解密" @click="loadDecSample">解密示例</DkButton>
      </template>
      <template v-else>
        <DkButton size="sm" variant="ghost" title="载入示例原文并现场签名" @click="loadSignSample">签名示例</DkButton>
        <DkButton size="sm" variant="ghost" title="载入 node 已验证的签名并现场验签（应通过）" @click="loadVerifySample">验签示例</DkButton>
      </template>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="shield" :size="12" />
        {{ ws === 'cipher' ? (cOp === 'enc' ? '加密' : '解密') : sOp === 'sign' ? '签名' : '验签' }}
      </DkButton>
    </div>

    <DkStatusBar
      :status="busy ? 'running' : run.status.value"
      :message="busy ? '正在计算…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[
        ws === 'cipher' ? (cOp === 'enc' ? 'SM2 加密' : 'SM2 解密') : sOp === 'sign' ? 'SM2 签名' : 'SM2 验签',
        ...(ws === 'cipher' ? [cipherMode === '1' ? 'C1C3C2' : 'C1C2C3'] : [`userId ${userId}`, sigFormat === 'raw' ? 'raw r||s' : 'DER'])
      ]"
      :retry="execute"
    />

    <div class="t15__params">
      <DkField v-if="ws === 'cipher' && cOp === 'enc'" label="公钥（Hex）" :error="pubErr || undefined" :help="pubHelp">
        <DkInput v-model="pubKey" mono placeholder="04 开头 130 位非压缩，或 02/03 开头 66 位压缩" :error="!!pubErr" />
      </DkField>
      <DkField
        v-if="ws === 'cipher' && cOp === 'dec'"
        label="私钥（Hex）"
        :error="privErr || undefined"
        help="64 位 Hex（32 字节），与加密所用公钥配对"
        secret
      >
        <template #default="{ revealed }">
          <DkInput
            v-model="privKey"
            :type="revealed ? 'text' : 'password'"
            mono
            placeholder="64 位 Hex 私钥"
            :error="!!privErr"
            autocomplete="off"
          />
        </template>
      </DkField>
      <DkField v-if="ws === 'sign' && sOp === 'sign'" label="私钥（Hex）" :error="privErr || undefined" help="64 位 Hex（32 字节）" secret>
        <template #default="{ revealed }">
          <DkInput
            v-model="privKey"
            :type="revealed ? 'text' : 'password'"
            mono
            placeholder="64 位 Hex 私钥"
            :error="!!privErr"
            autocomplete="off"
          />
        </template>
      </DkField>
      <DkField v-if="ws === 'sign'" label="userId（参与 SM3 摘要）" help="默认 1234567812345678；验签须与签名时一致">
        <DkInput v-model="userId" mono placeholder="1234567812345678" />
      </DkField>
      <DkField v-if="ws === 'sign' && sOp === 'verify'" label="公钥（Hex）" :error="pubErr || undefined" :help="pubHelp">
        <DkInput v-model="pubKey" mono placeholder="04 开头 130 位非压缩，或 02/03 开头 66 位压缩" :error="!!pubErr" />
      </DkField>
    </div>

    <div class="t15__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-if="ws === 'cipher'"
            v-model="cInput"
            :lang="cOp === 'enc' ? '明文（UTF-8 文本）' : `密文（${cipherEnc === 'hex' ? 'Hex' : 'Base64'}）`"
            :placeholder="cOp === 'enc' ? '输入要加密的文本；SM2 加密使用公钥' : `粘贴 ${cipherEnc === 'hex' ? 'Hex' : 'Base64'} 密文；解密使用私钥，cipherMode 须与加密时一致`"
            :height="'calc(48vh - 60px)'"
            :filename="cOp === 'enc' ? 'sm2-plaintext.txt' : 'sm2-cipher.txt'"
          />
          <DkEditor
            v-else
            v-model="sMsg"
            lang="原文（UTF-8 文本，签名/验签共用）"
            placeholder="输入签名的原文；同一原文既用于签名，也用于验签"
            :height="'calc(48vh - 60px)'"
            filename="sm2-message.txt"
          />
        </template>
        <template #right>
          <div class="t15__result">
            <div class="t15__result-head">
              <span>{{ ws === 'cipher' ? (cOp === 'enc' ? '加密结果' : '解密结果') : sOp === 'sign' ? '签名结果' : '验签结果' }}</span>
              <span class="grow"></span>
              <span v-if="ws === 'cipher' && encResult" class="tertiary">{{ cipherEnc === 'hex' ? 'Hex（小写）' : 'Base64' }}</span>
            </div>

            <template v-if="ws === 'cipher'">
              <p v-if="cOp === 'enc' && !encResult" class="t15__empty tertiary">
                填写公钥后点击「加密」。密文 = C1（64 字节，不含 04 前缀）|| C3（32 字节 SM3 摘要）|| C2（与明文等长），
                顺序由「密文顺序」决定。
              </p>
              <div v-if="cOp === 'enc' && encResult" class="t15__row">
                <span class="t15__row-val mono">{{ cipherDisplay }}</span>
                <DkIconButton
                  title="复制密文"
                  :disabled="run.status.value === 'stale'"
                  @click="clipboard.copy(cipherDisplay, 'SM2 密文')"
                >
                  <DkIcon name="copy" :size="14" />
                </DkIconButton>
              </div>
              <p v-if="cOp === 'dec' && !decResult" class="t15__empty tertiary">
                填写私钥与密文后点击「解密」。解密会校验 C3 摘要，失败时说明私钥不匹配、密文被修改或密文顺序不一致。
              </p>
              <template v-if="cOp === 'dec' && decResult">
                <div class="t15__dec-text mono">{{ decResult.text }}</div>
                <p class="t15__note tertiary">明文 {{ decResult.bytes }} 字节（UTF-8），C3 校验通过。</p>
              </template>
            </template>

            <template v-else>
              <p v-if="sOp === 'sign' && !signResult" class="t15__empty tertiary">
                填写私钥与原文后点击「签名」。签名前先对原文计算带 userId 的 SM3 摘要（SM2 规范要求），不是对原文直接签名。
              </p>
              <template v-if="sOp === 'sign' && signResult">
                <div class="t15__sig-format tertiary">{{ signResult.format }}</div>
                <div class="t15__row">
                  <span class="t15__row-val mono">{{ signResult.sig }}</span>
                  <DkIconButton
                    title="复制签名"
                    :disabled="run.status.value === 'stale'"
                    @click="clipboard.copy(signResult.sig, 'SM2 签名')"
                  >
                    <DkIcon name="copy" :size="14" />
                  </DkIconButton>
                </div>
              </template>
              <p v-if="sOp === 'verify' && verifyResult === null" class="t15__empty tertiary">
                填写公钥、原文与签名后点击「验签」。签名编码（raw/DER）与 userId 必须与签名时一致。
              </p>
              <div v-if="sOp === 'verify' && verifyResult !== null" class="t15__verify" :class="verifyResult ? 't15__verify--ok' : 't15__verify--bad'">
                <DkIcon :name="verifyResult ? 'check' : 'x'" :size="20" />
                <div>
                  <div class="t15__verify-title">{{ verifyResult ? '验签通过' : '验签不通过' }}</div>
                  <p class="t15__verify-note">
                    {{
                      verifyResult
                        ? `签名与原文、公钥、userId「${userId}」及 ${sigFormat === 'raw' ? 'raw（r||s）' : 'DER'} 格式均匹配。`
                        : `公钥未验证通过该签名。可能原因：签名或原文被修改、公钥不配对、签名编码（当前 ${sigFormat === 'raw' ? 'raw r||s' : 'DER'}）或 userId（当前 ${userId}）与签名时不一致。`
                    }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="示例数据与格式说明（node + sm-crypto 真实生成并验证）">
      <h4>示例密钥对（本地生成，仅用于测试）</h4>
      <ul>
        <li>公钥（04 非压缩 130 位）：<code>{{ SAMPLE_PUB }}</code></li>
        <li>私钥（64 位）：<code>{{ SAMPLE_PRIV }}</code></li>
      </ul>
      <h4>加解密示例（C1C3C2 / Hex）</h4>
      <ul>
        <li>明文：<code>{{ SAMPLE_PT }}</code></li>
        <li>密文（node 真实计算，已验证可解密回原文）：<code>{{ SAMPLE_CT_HEX.slice(0, 64) }}…</code>（点击「解密示例」载入完整密文）</li>
      </ul>
      <p>
        SM2 加密每次使用新的随机数 k，同一明文重复加密会得到不同密文（均可用同一私钥解密），因此「加密示例」现场计算的结果
        与上方 node 密文不同是正常且正确的。
        密文 Hex 不含 04 前缀：C1 直接以 x 坐标开头（前 128 位），C3 为 64 位 SM3 摘要，C2 与明文字节等长。
      </p>
      <h4>签名示例（raw r||s / DER，userId = 1234567812345678）</h4>
      <ul>
        <li>原文：<code>{{ SAMPLE_SIGN_MSG }}</code></li>
        <li>raw 签名（已验证验签通过）：<code>{{ SAMPLE_SIG_RAW }}</code></li>
        <li>DER 签名（已验证验签通过）：<code>{{ SAMPLE_SIG_DER }}</code></li>
      </ul>
      <p>签名包含随机数 k，同一原文重复签名结果不同；「签名示例」现场计算，可与上方向量互相验证格式与流程。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t15 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t15__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t15__tl {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t15__params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.t15__panes {
  min-height: 300px;
}
.t15__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.t15__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
}
.t15__empty {
  padding: 14px;
  font-size: 13px;
  line-height: 1.7;
}
.t15__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
}
.t15__row-val {
  flex: 1;
  min-width: 0;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
  line-height: 1.6;
}
.t15__sig-format {
  padding: 8px 12px 0;
  font-size: 12px;
}
.t15__dec-text {
  padding: 12px;
  font-size: var(--code-font-size);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-all;
  line-height: 1.7;
}
.t15__note {
  padding: 0 12px 10px;
  font-size: 12px;
}
.t15__verify {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 14px;
  padding: 14px;
  border-radius: var(--radius);
}
.t15__verify--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t15__verify--bad {
  color: var(--error);
  background: var(--error-soft);
}
.t15__verify-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.t15__verify-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
