<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { RawNumber, localizeJsonMessage } from '~/utils/json'

const props = defineProps<{ tool: ToolMeta }>()

/** node 真实生成的 HS256 示例（密钥 devkit-secret，公开测试密钥）：
 *  node -e "const c=require('crypto');const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 *  const p=Buffer.from(JSON.stringify({sub:'devkit-demo',name:'本地工具箱',iat:1700000000,exp:1900000000})).toString('base64url');
 *  const s=c.createHmac('sha256','devkit-secret').update(h+'.'+p).digest('base64url');console.log(h+'.'+p+'.'+s)" */
const SAMPLE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZraXQtZGVtbyIsIm5hbWUiOiLmnKzlnLDlt6XlhbfnrrEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.m-TEfec4PcwDypb1zPDKzu2fIUQiZ82QTW5cFIlXIXY'
/** 篡改示例：把 Payload 的 sub 由 devkit-demo 改为 devkit-admin 并保留原签名（签名段有效位未变），用于演示「解码成功但验签失败」 */
const SAMPLE_TAMPERED = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZraXQtYWRtaW4iLCJuYW1lIjoi5pys5Zyw5bel5YW3566xIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.m-TEfec4PcwDypb1zPDKzu2fIUQiZ82QTW5cFIlXIXY'

const token = ref('')

interface DecodeState {
  headerText: string
  payloadText: string
  header: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  alg: string
  sigText: string
  sigBytes: number
  decodeNote: string
}

const decoded = ref<DecodeState | null>(null)
const decodeError = ref('')
const verifyOpen = ref(false)
const collapseKey = ref(0)

const sigDecode = () => JSON.stringify([token.value])
const run = useToolRun(sigDecode)

/** 常见 claim 中文解释（不含时间字段，时间字段单独渲染） */
const CLAIM_INFO: Record<string, string> = {
  sub: 'Subject：主体标识（该 Token 所属用户的唯一标识）',
  iss: 'Issuer：签发者（签发该 Token 的服务方标识）',
  aud: 'Audience：受众（预期接收该 Token 的一方，可能是数组）',
  jti: 'JWT ID：Token 唯一编号（用于防止重放）'
}

interface TimeClaim {
  name: 'iat' | 'nbf' | 'exp'
  label: string
  raw: string
  local: string
  state: 'ok' | 'bad' | 'warn'
  stateText: string
}

function fmtLocal(sec: number): string {
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}（本地时间）`
}

/** 时间 claim：原始数值 + 本地时间 + 是否已过期（红/绿） */
const timeClaims = computed<TimeClaim[]>(() => {
  const p = decoded.value?.payload
  if (!p) return []
  const now = Math.floor(Date.now() / 1000)
  const out: TimeClaim[] = []
  const defs: Array<{ name: TimeClaim['name']; label: string }> = [
    { name: 'iat', label: '签发时间' },
    { name: 'nbf', label: '生效时间' },
    { name: 'exp', label: '过期时间' }
  ]
  for (const d of defs) {
    if (!(d.name in p)) continue
    const v = p[d.name]
    const raw = v instanceof RawNumber ? v.raw : typeof v === 'number' ? String(v) : null
    if (raw === null || !/^-?\d+$/.test(raw)) {
      out.push({ name: d.name, label: d.label, raw: typeof v === 'object' ? JSON.stringify(v) : String(v), local: '—', state: 'warn', stateText: '非整数数值，无法按时间解释' })
      continue
    }
    const sec = parseInt(raw, 10)
    const local = fmtLocal(sec)
    if (d.name === 'exp') {
      const expired = sec <= now
      out.push({ name: d.name, label: d.label, raw, local, state: expired ? 'bad' : 'ok', stateText: expired ? '已过期' : '未过期' })
    } else if (d.name === 'nbf') {
      const ready = sec <= now
      out.push({ name: d.name, label: d.label, raw, local, state: ready ? 'ok' : 'bad', stateText: ready ? '已生效' : '尚未生效' })
    } else {
      const future = sec > now + 300
      out.push({ name: d.name, label: d.label, raw, local, state: future ? 'warn' : 'ok', stateText: future ? '签发时间在未来 5 分钟以上（时钟偏差或伪造）' : '正常' })
    }
  }
  return out
})

const plainClaims = computed(() => {
  const p = decoded.value?.payload
  if (!p) return []
  return Object.keys(p)
    .filter((k) => k in CLAIM_INFO)
    .map((k) => {
      const v = (p as Record<string, unknown>)[k]
      return { key: k, text: v instanceof RawNumber ? v.raw : typeof v === 'object' ? stringifyJson(v, 2) : String(v), desc: CLAIM_INFO[k]! }
    })
})

/** 实时解码（即算型：watch 触发，仅在客户端） */
function decode() {
  decoded.value = null
  decodeError.value = ''
  verifyResult.value = null
  const raw = token.value
  if (!raw.trim()) {
    run.markIdle()
    return
  }
  const parts = raw.trim().split('.')
  if (parts.length !== 3) {
    decodeError.value = `JWT 结构错误：应为 Header.Payload.Signature 三段（以 . 分隔），当前为 ${parts.length} 段`
    run.markFail(decodeError.value)
    return
  }
  const [h, p, s] = parts as [string, string, string]
  const header = decodeSeg(h, 'Header')
  const payload = decodeSeg(p, 'Payload')
  if (header.error || payload.error) {
    decodeError.value = header.error || payload.error || ''
    run.markFail(decodeError.value)
    return
  }
  const sigDec = base64ToBytes(s)
  const notes: string[] = []
  const alg = typeof header.value!.alg === 'string' ? (header.value!.alg as string) : ''
  if (alg === 'none') notes.push('Header 声明 alg 为 none（无签名）')
  if (!s) notes.push('签名段为空')
  decoded.value = {
    headerText: stringifyJson(header.value!, 2),
    payloadText: stringifyJson(payload.value!, 2),
    header: header.value!,
    payload: payload.value!,
    alg,
    sigText: s,
    sigBytes: sigDec.error ? 0 : sigDec.bytes.length,
    decodeNote: notes.join('；')
  }
  // alg 同步到验签下拉（用户仍需自行确认/修改）
  if ((VERIFY_ALGOS as readonly string[]).includes(alg)) verifyAlgo.value = alg as VerifyAlgo
  run.markOk(notes.length ? notes.join('；') : '解码成功 ≠ 签名有效，请在下方验签面板确认真实性')
}

function decodeSeg(seg: string, label: string): { value: Record<string, unknown> | null; error?: string } {
  if (!seg) return { value: null, error: `${label} 段为空` }
  const b = base64ToBytes(seg)
  if (b.error) return { value: null, error: `${label} Base64 解码失败：${b.error}（JWT 使用 Base64URL 字符集 A-Za-z0-9-_）` }
  const t = bytesToText(b.bytes)
  if (t.error) return { value: null, error: `${label} ${t.error}` }
  try {
    const { value } = parseJson(t.text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { value: null, error: `${label} 应为 JSON 对象，当前不是` }
    }
    return { value: value as Record<string, unknown> }
  } catch (e) {
    const pos = jsonErrorPosition(e, t.text)
    return { value: null, error: `${label} 不是有效 JSON：${pos ? `第 ${pos.line} 行第 ${pos.column} 列附近 ${pos.message}` : localizeJsonMessage(errMessage(e))}` }
  }
}

watch(token, decode)

/* ---------------- 独立验签面板 ---------------- */

const VERIFY_ALGOS = ['HS256', 'HS384', 'HS512', 'RS256', 'ES256', 'none'] as const
type VerifyAlgo = (typeof VERIFY_ALGOS)[number]
const verifyAlgo = ref<VerifyAlgo>('HS256')
const verifyKey = ref('')
const verifyBusy = ref(false)
const verifyResult = ref<{ pass: boolean; text: string } | null>(null)

const HS_HASH: Record<string, string> = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }
const ASYM = ['RS256', 'ES256']

const verifyHint = computed(() => {
  if (verifyAlgo.value === 'none') return 'alg 为 none 表示 Token 无签名，本工具拒绝将其视为有效签名。'
  if (ASYM.includes(verifyAlgo.value)) return '当前版本暂不支持非对称验签，请勿依赖解码结果判断真实性（需要公钥/JWKS）。'
  return `使用 WebCrypto HMAC（${HS_HASH[verifyAlgo.value]}）在本地重算签名并与第三段逐字节比对；不请求任何网络（含 JWKS）。`
})

const sigVerifyRun = (() => {
  const s = () => JSON.stringify([token.value, verifyAlgo.value, verifyKey.value])
  return useToolRun(s)
})()

async function verify() {
  if (verifyBusy.value) return
  verifyResult.value = null
  const parts = token.value.trim().split('.')
  if (!token.value.trim()) {
    sigVerifyRun.markFail('请先输入 Token')
    return
  }
  if (parts.length !== 3) {
    sigVerifyRun.markFail(`Token 结构错误（应为三段，当前 ${parts.length} 段），无法验签`)
    return
  }
  if (verifyAlgo.value === 'none') {
    sigVerifyRun.markFail('alg 为 none，拒绝视为有效签名')
    return
  }
  if (ASYM.includes(verifyAlgo.value)) {
    sigVerifyRun.markFail('当前版本暂不支持非对称验签，请勿依赖解码结果判断真实性')
    return
  }
  const keyBytes = textToBytes(verifyKey.value)
  if (keyBytes.length === 0) {
    sigVerifyRun.markFail(`请填写验签密钥（${verifyAlgo.value} 为 HMAC 算法，密钥按 UTF-8 文本编码）`)
    return
  }
  verifyBusy.value = true
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: HS_HASH[verifyAlgo.value]! },
      false,
      ['sign']
    )
    const signingInput = textToBytes(`${parts[0]}.${parts[1]}`)
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, signingInput as unknown as BufferSource)
    const computed = new Uint8Array(sigBuf)
    const expectedRes = base64ToBytes(parts[2]!)
    if (expectedRes.error) {
      sigVerifyRun.markFail(`签名段 Base64 解码失败：${expectedRes.error}`)
      return
    }
    const expected = expectedRes.bytes
    let match = computed.length === expected.length
    if (match) {
      for (let i = 0; i < computed.length; i++) {
        if (computed[i] !== expected[i]) {
          match = false
          break
        }
      }
    }
    if (match) {
      verifyResult.value = { pass: true, text: `签名验证通过（${verifyAlgo.value}）` }
      sigVerifyRun.markOk(`签名验证通过（${verifyAlgo.value}），HMAC 密钥 ${keyBytes.length} 字节，逐字节比对一致`)
    } else {
      verifyResult.value = { pass: false, text: '签名不匹配：密钥错误或 Token 被修改' }
      sigVerifyRun.markFail('签名不匹配：密钥错误或 Token 被修改（解码成功不代表签名有效）')
    }
  } catch (e) {
    sigVerifyRun.markFail(`验签计算失败：${errMessage(e)}`)
  } finally {
    verifyBusy.value = false
  }
}

function loadSample(tampered = false) {
  token.value = tampered ? SAMPLE_TAMPERED : SAMPLE_TOKEN
  verifyAlgo.value = 'HS256'
  verifyKey.value = 'devkit-secret'
  verifyOpen.value = true
  collapseKey.value++
  verifyResult.value = null
  decode()
}
</script>

<template>
  <div class="t33">
    <div class="t33__toolbar">
      <span class="t33__tl">Token</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入 node 真实生成的 HS256 示例（密钥 devkit-secret，公开测试密钥）" @click="loadSample(false)">
        示例：有效签名
      </DkButton>
      <DkButton size="sm" variant="ghost" title="载入被篡改 Payload 的示例（sub 改为 devkit-admin，签名段不变），演示验签失败" @click="loadSample(true)">
        示例：被篡改签名
      </DkButton>
      <DkButton size="sm" variant="ghost" @click="token = ''">清空</DkButton>
    </div>

    <DkEditor
      v-model="token"
      lang="JWT（eyJhbGciOi…）"
      placeholder="粘贴 JWT（三段以 . 分隔），输入即实时解码；或点击上方示例"
      :height="'96px'"
      filename="token.txt"
      :show-stats="false"
    />

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? decodeError : run.staleNote.value"
      :meta="decoded ? [`Header ${Object.keys(decoded.header ?? {}).length} 键`, `Payload ${Object.keys(decoded.payload ?? {}).length} 键`, decoded.sigBytes ? `签名 ${decoded.sigBytes} 字节` : ''] : []"
      :retry="decode"
    />

    <template v-if="decoded">
      <div v-if="decoded.decodeNote" class="t33__note t33__note--warn">
        <DkIcon name="alert-triangle" :size="14" />
        {{ decoded.decodeNote }}
      </div>

      <div class="t33__panes">
        <div class="t33__col">
          <div class="t33__col-head">Header（Base64URL 解码）</div>
          <DkEditor :model-value="decoded.headerText" readonly lang="Header JSON" :height="'220px'" filename="jwt-header.json" />
        </div>
        <div class="t33__col">
          <div class="t33__col-head">Payload（Base64URL 解码）</div>
          <DkEditor :model-value="decoded.payloadText" readonly lang="Payload JSON" :height="'220px'" filename="jwt-payload.json" />
        </div>
      </div>

      <div class="t33__claims">
        <div class="t33__claims-head">Payload 字段解释</div>
        <div class="t33__claims-body">
          <table v-if="plainClaims.length || timeClaims.length" class="t33__table">
            <tbody>
              <tr v-for="c in plainClaims" :key="c.key">
                <td class="t33__td-key mono">{{ c.key }}</td>
                <td class="t33__td-val mono">{{ c.text }}</td>
                <td class="t33__td-desc">{{ c.desc }}</td>
              </tr>
              <tr v-if="timeClaims.length">
                <td :colspan="3" class="t33__td-sec">时间字段（原始数值 + 本地时间 + 状态）</td>
              </tr>
              <tr v-for="t in timeClaims" :key="t.name">
                <td class="t33__td-key mono">{{ t.name }}</td>
                <td class="t33__td-val mono">
                  {{ t.raw }}
                  <span class="t33__time-local">{{ t.local }}</span>
                </td>
                <td class="t33__td-desc">
                  <span class="t33__state" :class="`t33__state--${t.state}`">{{ t.stateText }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="tertiary t33__claims-empty">Payload 中没有 sub / iss / aud / jti / iat / nbf / exp 等常见字段。</p>
        </div>
      </div>
    </template>

    <DkCollapse :key="collapseKey" :default-open="verifyOpen" title="签名验证（独立执行：解码成功 ≠ 签名有效）">
      <div class="t33__verify">
        <div class="t33__note t33__note--info">
          <DkIcon name="shield" :size="14" />
          解码成功 ≠ 签名有效：解码不使用密钥，任何人都可构造。请选择算法并用密钥验证签名。
        </div>
        <div class="t33__verify-form">
          <DkField label="算法（从 Header 带出，请确认）" :help="verifyHint">
            <DkSelect v-model="verifyAlgo" :options="VERIFY_ALGOS.map((a) => ({ value: a, label: a === 'none' ? 'none（无签名）' : a }))" />
          </DkField>
          <DkField
            v-if="!ASYM.includes(verifyAlgo) && verifyAlgo !== 'none'"
            label="HMAC 密钥（UTF-8 文本）"
            help="示例使用公开测试密钥 devkit-secret（仅演示用，请勿在生产环境使用）"
            secret
          >
            <template #default="{ revealed }">
              <DkInput v-model="verifyKey" :type="revealed ? 'text' : 'password'" mono placeholder="如 devkit-secret" autocomplete="off" />
            </template>
          </DkField>
          <div class="t33__verify-actions">
            <DkButton
              size="sm"
              variant="primary"
              :loading="verifyBusy"
              :disabled="verifyAlgo === 'none' || ASYM.includes(verifyAlgo)"
              :title="ASYM.includes(verifyAlgo) ? '暂不支持非对称验签' : verifyAlgo === 'none' ? '拒绝验签 none' : '本地重算 HMAC 并比对签名'"
              @click="verify"
            >
              <DkIcon name="shield" :size="12" />
              验证签名
            </DkButton>
            <span class="tertiary t33__verify-hint">{{ verifyHint }}</span>
          </div>
          <DkStatusBar
            :status="verifyBusy ? 'running' : sigVerifyRun.status.value"
            :message="verifyBusy ? '正在本地重算签名…' : sigVerifyRun.status.value === 'error' ? sigVerifyRun.errorMsg.value : sigVerifyRun.staleNote.value"
            :retry="verify"
            retry-label="重新验证"
          />
          <div v-if="verifyResult" class="t33__vres" :class="verifyResult.pass ? 't33__vres--ok' : 't33__vres--bad'">
            <DkIcon :name="verifyResult.pass ? 'check' : 'x'" :size="14" />
            {{ verifyResult.text }}
          </div>
        </div>
      </div>
    </DkCollapse>

    <DkCollapse title="关于本工具">
      <ul>
        <li>解码完全在浏览器本地进行（Base64URL + UTF-8 + JSON），不发起任何网络请求（包括 JWKS）。</li>
        <li>验签支持 HS256 / HS384 / HS512（WebCrypto HMAC，与第三段逐字节比对）；RS256 / ES256 暂不支持，alg 为 none 时拒绝视为有效签名。</li>
        <li>示例 Token 由 node crypto 真实生成（HS256，密钥 <code>devkit-secret</code>，公开测试密钥）；「被篡改签名」示例将 Payload 的 <code>sub</code> 由 <code>devkit-demo</code> 改为 <code>devkit-admin</code> 并保留原签名（签名段未改）——解码仍然成功，但验签必然失败。</li>
        <li>过期判断以本机时钟为准（exp ≤ 当前秒数视为已过期）。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t33 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t33__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t33__tl {
  font-size: 12px;
  color: var(--text-secondary);
}
.t33__panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-width: 0;
}
@media (max-width: 860px) {
  .t33__panes {
    grid-template-columns: 1fr;
  }
}
.t33__col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.t33__col-head {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.t33__claims {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t33__claims-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.t33__claims-body {
  padding: 4px 12px 10px;
}
.t33__claims-empty {
  padding: 10px 0;
  font-size: 13px;
}
.t33__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.t33__table td {
  padding: 7px 10px 7px 0;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.t33__table tr:last-child td {
  border-bottom: none;
}
.t33__td-key {
  width: 64px;
  color: var(--accent);
  font-weight: 500;
}
.t33__td-val {
  min-width: 0;
  word-break: break-all;
  color: var(--text-primary);
}
.t33__td-desc {
  color: var(--text-secondary);
  font-size: 12px;
}
.t33__td-sec {
  font-size: 12px;
  color: var(--text-tertiary);
  padding-top: 10px !important;
}
.t33__time-local {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 12px;
}
.t33__state {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.t33__state--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t33__state--bad {
  color: var(--error);
  background: var(--error-soft);
}
.t33__state--warn {
  color: var(--warn);
  background: var(--warn-soft);
}
.t33__note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  line-height: 1.6;
}
.t33__note--warn {
  color: var(--warn);
  background: var(--warn-soft);
}
.t33__note--info {
  color: var(--text-secondary);
  background: var(--surface-subtle);
}
.t33__verify {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.t33__verify-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}
.t33__verify-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.t33__verify-hint {
  font-size: 11.5px;
  min-width: 0;
}
.t33__vres {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
}
.t33__vres--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.t33__vres--bad {
  color: var(--error);
  background: var(--error-soft);
}
</style>
