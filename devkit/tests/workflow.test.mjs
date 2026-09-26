/**
 * 处理流程端到端测试：步骤库完整性、既有 8 个步骤的行为回归、
 * 批次 B（摘要与加解密）与批次 C（数据转换）新步骤，以及预设流程的真实执行。
 * 加解密步骤的期望值来自标准向量或 node:crypto 复核结果，不用自我往返当唯一证据。
 */
import { bytesToBase64, bytesToHex, hexToBytes, textToBytes } from '../app/utils/bytes.ts'
import { aesGcmEncrypt } from '../app/utils/crypto/aesgcm.ts'
import { computeHmac } from '../app/utils/crypto/hmac.ts'
import { sm4Encrypt } from '../app/utils/crypto/sm4.ts'
import { executors } from '../app/workflow/executors/index.ts'
import {
  buildWorkflowFromPreset,
  CONSENT_NOTICE_VERSION,
  createStep,
  defaultWorkflows,
  exportWorkflowText,
  findPreset,
  isSensitiveStep,
  makeConsent,
  normalizeSelection,
  parseImportText,
  presetSecretTypes,
  runStep,
  runWorkflow,
  stepDef,
  stepLibrary,
  stepTypes,
  workflowPresets
} from '../app/utils/workflow.ts'
import { makeCases } from './cases.mjs'

const h = (bytes) => bytesToHex(bytes)
const hx = (s) => hexToBytes(s).bytes
const TEXT = (p) => new TextDecoder().decode(p.bytes ?? new Uint8Array(0))
const AES_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const AES_IV = '101112131415161718191a1b'
const AES_T14_VEC = '399bee5d20bd1af28f26255a4c3449b473eaaab09087b1f3067293b23c2a3fc51516fe62dc'
const SM4_KEY = '0123456789abcdeffedcba9876543210'
const SM4_IV = '000102030405060708090a0b0c0d0e0f'
const SM2_PUB =
  '0463bb89d7efec4f2590d5486e249082c4c4ba68458ed484db2dbc3c1f6ac11187668e8c6cfed5c75c669433fb037606961bcf99a8c3ce12c6fa9e44a22d64454d'
const SM2_PRIV = '62f1724b3e02e23b38a8594f0cd01b963b1607e43631e20d75d35060464fa774'
const SM2_MSG = 'DevKit SM2 冒烟'
const SM2_SIG =
  '178ad21eeb334f351d77e034f17505af69e4d0431ad2a819f0cb22c93f4f34d765af22944b1ecaa6346f8efd30b93d78f15c0e087229057904186ed7433a20a7'
const SM2_CT =
  'e3642e93167253042a349c8ebdb90849eb23599e9a3f5315869c587bf386149cf275aa602437e160dca17fb02123b149af2cf3cbc0728d4371971b14aed36ca6f738faa0e20c4176147e218bb7319f1a20ae8915bc19be822a66807c6534fe5959d3d8b10c7c41b8c61a8beb011a7c3d0c'

// 运行侧现在会校验风险确认：会真正执行的敏感步骤必须带当前版本的 consent。
const CONSENT = { accepted: true, acceptedAt: Date.now(), noticeVersion: CONSENT_NOTICE_VERSION }
const sensitiveStep = (type, cfg = {}) => {
  const step = createStep(type, cfg)
  return { ...step, consent: CONSENT, secretRef: step.id }
}

export const run = async () => {
  const { cases, ok, eqj, rejects } = makeCases()

  // ── 步骤库完整性（新增步骤必须同时落 catalog 与 executors）──
  eqj('步骤库 24 种', stepLibrary.length, 24)
  eqj('步骤类型不重复', new Set(stepTypes).size, stepTypes.length)
  ok(
    '每个步骤类型都有执行器',
    stepTypes.every((t) => typeof executors[t] === 'function'),
    stepTypes.filter((t) => !executors[t]).join(',')
  )
  ok(
    '每个执行器都对应一个步骤定义',
    Object.keys(executors).every((t) => stepTypes.includes(t)),
    Object.keys(executors).filter((t) => !stepTypes.includes(t)).join(',')
  )
  eqj('敏感步骤只有 4 种', stepTypes.filter(isSensitiveStep), ['hmac', 'aes-gcm', 'sm2', 'sm4'])
  ok(
    '每个字段都有合法 control',
    stepLibrary.every((s) => s.fields.every((f) => ['text', 'select', 'switch', 'textarea', 'secret'].includes(f.control)))
  )
  ok(
    'select 字段都带 options 且默认值在 options 内',
    stepLibrary.every((s) =>
      s.fields.every((f) => f.control !== 'select' || (f.options?.length && (f.default === undefined || f.options.some((o) => o.value === f.default))))
    )
  )

  // ── 默认流程 ──
  const defaults = defaultWorkflows()
  eqj('默认 3 条流程', defaults.length, 3)
  ok('默认流程不含密钥步骤', defaults.every((w) => w.steps.every((s) => !isSensitiveStep(s.type))))
  ok(
    '默认流程步骤 id 稳定',
    defaults[0].steps.map((s) => s.id).join(',') === 'wf-order-snapshot-s1,wf-order-snapshot-s2,wf-order-snapshot-s3,wf-order-snapshot-s4'
  )

  // ── 选中项规范化（回归：点「流程输出」越界导致整页崩掉）──
  eqj('-1 是流程输入', normalizeSelection(4, -1), { kind: 'input' })
  eqj('0 是第 1 步', normalizeSelection(4, 0), { kind: 'step', index: 0 })
  eqj('4 是流程输出', normalizeSelection(4, 4), { kind: 'output' })
  eqj('越界（10）落回流程输出', normalizeSelection(4, 10), { kind: 'output' })
  eqj('小数下标向下取整', normalizeSelection(4, 1.7), { kind: 'step', index: 1 })
  eqj('NaN 落回流程输入', normalizeSelection(4, Number.NaN), { kind: 'input' })

  // ── 既有 8 个步骤的行为回归 ──
  const snapshot = defaults[0]
  const snapshotInput = bytesToBase64(
    textToBytes(JSON.stringify({ order: { id: 'o-1', total: 199.5, items: [{ sku: 'A-1', qty: 2 }] } }))
  )
  const snapRes = await runWorkflow(snapshot, snapshotInput, { stopOnError: true })
  ok(
    '订单快照解析端到端成功',
    snapRes.status === 'ok' && snapRes.results.length === 4 && snapRes.finalOutput.includes('public class Order') && snapRes.finalOutput.includes('private double total'),
    snapRes.finalOutput.slice(0, 120)
  )
  const pathRes = await runStep(createStep('jsonpath', { expr: '$.list[?(@.price < 100)].title' }), JSON.stringify({ list: [{ title: 'a', price: 99 }, { title: 'b', price: 199 }] }), 0)
  ok('JSONPath 步骤对 RawNumber 也能过滤', pathRes.status === 'ok' && pathRes.output.includes('a') && !pathRes.output.includes('b'))
  const schemaFail = await runWorkflow(defaults[2], encodeURIComponent('{"code":"x"}'), { stopOnError: true })
  ok('Schema 校验失败时中断', schemaFail.status === 'fail' && schemaFail.results.length === 3 && schemaFail.results[2].status === 'fail')
  const schemaContinue = await runWorkflow(defaults[2], encodeURIComponent('{"code":"x"}'), { stopOnError: false })
  ok('失败时中断关闭则继续跑完', schemaContinue.status === 'fail' && schemaContinue.results.length === 3)
  // 回归：关闭中断后，失败步骤之后的「成功」只是回退输入的回显——必须如实标注，
  // 否则「下载标记」显示成功，用户会把未转换的原始输入当成 config.yaml 存盘
  const cfgConvert = defaults[1]
  const cfgBad = await runWorkflow(cfgConvert, '{"app": {"name": "inventory-api"', { stopOnError: false })
  ok(
    '失败继续：整体状态如实为失败且第 1/2 步失败',
    cfgBad.status === 'fail' && cfgBad.results[0].status === 'fail' && cfgBad.results[1].status === 'fail',
    cfgBad.results.map((r) => `${r.index}:${r.status}`).join(',')
  )
  ok(
    '失败继续：回退输入的下载步骤 note 标注未经过失败步骤处理',
    cfgBad.results[2].status === 'ok' && cfgBad.results[2].note.includes('第 1、2 步失败') && cfgBad.results[2].note.includes('回退为流程输入'),
    cfgBad.results[2].note
  )
  ok('失败继续：回退输入的下载步骤日志带同样告警', cfgBad.results[2].logs.some((l) => l.includes('回退为流程输入')))
  const cfgGood = await runWorkflow(cfgConvert, '{"app":{"name":"x"}}', { stopOnError: false })
  ok(
    '全部成功：成功路径的 note 不带回退告警',
    cfgGood.status === 'ok' && !cfgGood.results.some((r) => r.note.includes('回退')),
    cfgGood.results.map((r) => r.note).join(' | ')
  )
  const yamlDepth = 1000
  const deepConfig = '{"a":'.repeat(yamlDepth) + '12345678901234567890' + '}'.repeat(yamlDepth)
  const deepYaml = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), deepConfig, 0)
  ok('YAML 深度上限内可转换且大整数不丢精度', deepYaml.status === 'ok' && deepYaml.output.includes('12345678901234567890'), deepYaml.note)
  const deepBack = deepYaml.status === 'ok'
    ? await runStep(createStep('json-yaml', { direction: 'yaml2json' }), deepYaml.output, 0)
    : null
  ok('YAML 深度上限内可往返读取', deepBack?.status === 'ok' && deepBack.output.includes('12345678901234567890'), deepBack?.note)
  const tooDeepConfig = '{"a":'.repeat(yamlDepth + 1) + '1' + '}'.repeat(yamlDepth + 1)
  const deepFlow = await runWorkflow(cfgConvert, tooDeepConfig, { stopOnError: true })
  ok('配置迁移超出 YAML 能力边界时第一步即明确失败', deepFlow.status === 'fail' && deepFlow.results.length === 1 && deepFlow.results[0].note.includes('最多支持 1000 层'), deepFlow.results.map((r) => r.note).join(' | '))
  const deepDirect = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), tooDeepConfig, 0)
  ok('单独 JSON→YAML 步骤超限时给出确定的中文错误', deepDirect.status === 'fail' && deepDirect.note.includes('最多支持 1000 层'), deepDirect.note)
  const badJson = await runStep(createStep('json-format'), '{oops', 0)
  ok('非法输入给出可读错误', badJson.status === 'fail' && badJson.note.length > 0)
  const yamlRes = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), '{"a":1}', 0)
  const backJson = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'a: 1', 0)
  ok('JSON / YAML 双向可用', yamlRes.status === 'ok' && yamlRes.output.includes('a: 1') && backJson.output.includes('"a": 1'))
  const dl = await runStep(createStep('download', { filename: 'x.txt' }), 'hello', 0)
  ok('下载步骤只标记文件名不改内容', dl.status === 'ok' && dl.output === 'hello' && dl.note.includes('x.txt'))

  // ── 载荷契约：二进制用 bytes 传递 ──
  const binaryIn = bytesToBase64(new Uint8Array([0xff, 0x00, 0x10, 0xfe, 0x42]))
  const decoded = await runStep(createStep('base64-decode'), binaryIn, 0)
  eqj('Base64 解码二进制得到 bytes 载荷', decoded.outputKind, 'bytes')
  ok('Base64 解码保留原始字节', decoded.payload.bytes && h(decoded.payload.bytes) === 'ff0010fe42')
  const digestBytes = await runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'auto' }), decoded.payload, 0)
  const digestDirect = await runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'hex' }), 'ff0010fe42', 0)
  eqj('auto 编码沿用上一步字节', digestBytes.output, digestDirect.output)
  const textDecoded = await runStep(createStep('base64-decode'), bytesToBase64(textToBytes('{"a":1}')), 0)
  eqj('Base64 解码文本得到文本载荷', textDecoded.outputKind, 'text')

  // ── 批次 B：摘要与加解密 ──
  const d1 = await runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'utf8', outputEncoding: 'hex' }), 'abc', 0)
  eqj('摘要步骤 SHA-256("abc")', d1.output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const d2 = await runStep(createStep('digest', { algo: 'MD5', inputEncoding: 'hex', expected: '900150983cd24fb0d6963f7d28e17f72' }), '616263', 0)
  ok('摘要步骤支持 Hex 输入与期望值对照', d2.output === '900150983cd24fb0d6963f7d28e17f72' && d2.note.includes('一致'), d2.note)
  const d3 = await runStep(createStep('digest', { algo: 'SHA-512', expected: 'deadbeef' }), 'abc', 0)
  ok('摘要不匹配时如实说明', d3.note.includes('不一致'), d3.note)
  const d4 = await runStep(createStep('digest', { algo: 'MD5', outputEncoding: 'base64' }), 'abc', 0)
  eqj('摘要 Base64 输出', d4.output, 'kAFQmDzST7DWlj99KOF/cg==')

  const hmacStep = sensitiveStep('hmac', { algo: 'SHA-256', keyEncoding: 'hex', outputEncoding: 'hex' })
  const h1 = await runStep(hmacStep, 'Hi There', 0, { secrets: { key: '0b'.repeat(20) } })
  eqj('HMAC 步骤 RFC4231 TC1', h1.output, 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  const h2 = await runStep(hmacStep, 'Hi There', 0, { secrets: {} })
  ok('缺少 HMAC 密钥时明确失败', h2.status === 'fail' && h2.note.includes('缺少密钥'), h2.note)
  ok('缺少密钥的日志带清理提示', h2.logs.some((l) => l.includes('清空已保存密钥')))
  const h3 = await runStep(hmacStep, 'Hi There', 0, { secrets: { key: '0b'.repeat(20) } })
  ok('日志里不出现密钥值', h3.logs.every((l) => !l.includes('0b'.repeat(20))))

  const aesDec = sensitiveStep('aes-gcm', { operation: 'decrypt', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'hex' })
  const a1 = await runStep(aesDec, AES_T14_VEC, 0, { secrets: { key: AES_KEY, iv: AES_IV, aad: 'devkit' } })
  eqj('AES-GCM 解密步骤还原样例明文', a1.output, 'DevKit AES-GCM 示例')
  const a2 = await runStep(aesDec, AES_T14_VEC, 0, { secrets: { key: 'ff'.repeat(32), iv: AES_IV, aad: 'devkit' } })
  ok('AES-GCM 认证失败给出专有提示', a2.status === 'fail' && a2.note.includes('认证失败'), a2.note)
  const aesEnc = sensitiveStep('aes-gcm', { operation: 'encrypt', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex' })
  const a3 = await runStep(aesEnc, 'DevKit AES-GCM 示例', 0, { secrets: { key: AES_KEY, iv: AES_IV, aad: 'devkit' } })
  eqj('AES-GCM 加密步骤命中工具页样例向量', a3.output, AES_T14_VEC)
  const aesRound = await runWorkflow(
    { id: 'wf-aes-round', name: 'aes', desc: '', steps: [aesEnc, aesDec] },
    '往返文本',
    { stopOnError: true, secretOf: () => ({ key: AES_KEY, iv: AES_IV, aad: 'devkit' }) }
  )
  ok('AES-GCM 加密→解密往返一致', aesRound.status === 'ok' && aesRound.finalOutput === '往返文本', aesRound.finalOutput)
  const aesMissingTag = await runStep(aesDec, '0011', 0, { secrets: { key: AES_KEY, iv: AES_IV, aad: '' } })
  ok('AES-GCM 密文不足标签长度时报错', aesMissingTag.status === 'fail' && aesMissingTag.note.includes('不足认证标签'), aesMissingTag.note)

  const s3 = await runStep(createStep('sm3'), 'abc', 0)
  eqj('SM3 步骤 GB/T 向量', s3.output, '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0')

  const sm4Vec = await runStep(sensitiveStep('sm4', { operation: 'encrypt', mode: 'ecb', padding: 'none', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'hex' }), SM4_KEY, 0, { secrets: { key: SM4_KEY } })
  eqj('SM4 步骤 GB/T 标准向量', sm4Vec.output, '681edf34d206965e86b3e94f536e4246')
  const sm4CbcCt = h(sm4Encrypt(textToBytes('{"code":1}'), SM4_KEY, { mode: 'cbc', padding: 'pkcs#7', ivHex: SM4_IV }))
  const sm4Dec = await runStep(
    sensitiveStep('sm4', { operation: 'decrypt', mode: 'cbc', padding: 'pkcs#7', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'auto' }),
    sm4CbcCt,
    0,
    { secrets: { key: SM4_KEY, iv: SM4_IV } }
  )
  eqj('SM4 CBC 解密步骤还原明文', sm4Dec.output, '{"code":1}')
  const sm4NoIv = await runStep(sensitiveStep('sm4', { mode: 'cbc', keyEncoding: 'hex', inputEncoding: 'hex' }), sm4CbcCt, 0, { secrets: { key: SM4_KEY } })
  ok('SM4 CBC 缺 IV 时报错', sm4NoIv.status === 'fail' && sm4NoIv.note.includes('IV'), sm4NoIv.note)

  const sm2VerifyStep = sensitiveStep('sm2', { operation: 'verify', publicKey: SM2_PUB, signature: SM2_SIG })
  const v1 = await runStep(sm2VerifyStep, SM2_MSG, 0)
  ok('SM2 验签步骤通过', v1.status === 'ok' && v1.note.includes('验签通过'), v1.note)
  const v2 = await runStep(sm2VerifyStep, SM2_MSG + '改过', 0)
  ok('SM2 验签不通过时中止并说明是真实结论', v2.status === 'fail' && v2.note.includes('验签不通过') && v2.note.includes('不是执行错误'), v2.note)
  const v3 = await runStep(sensitiveStep('sm2', { operation: 'decrypt', encoding: 'hex' }), SM2_CT, 0, { secrets: { privateKey: SM2_PRIV } })
  eqj('SM2 解密步骤还原外部密文', v3.output, SM2_MSG)
  const v4 = await runStep(sensitiveStep('sm2', { operation: 'verify', publicKey: SM2_PUB, signature: SM2_SIG }), SM2_MSG, 0, {})
  ok('缺少私钥不影响验签（验签只用公钥）', v4.status === 'ok')

  // ── 运行侧风险确认门禁（写入侧早已校验，运行侧现在也要拦住旧确认）──
  const noConsentHmac = createStep('hmac', { algo: 'SHA-256', keyEncoding: 'hex', outputEncoding: 'hex' })
  const gateNoConsent = await runStep(noConsentHmac, 'Hi There', 0, { secrets: { key: '0b'.repeat(20) } })
  ok(
    '敏感步骤无风险确认时拒绝运行',
    gateNoConsent.status === 'fail' && gateNoConsent.note.includes('重新确认风险'),
    gateNoConsent.note
  )
  ok('无确认被拒的日志里不出现密钥值', gateNoConsent.logs.every((l) => !l.includes('0b'.repeat(20))))
  const gateWithConsent = await runStep(hmacStep, 'Hi There', 0, { secrets: { key: '0b'.repeat(20) } })
  ok('敏感步骤带有效风险确认时正常运行', gateWithConsent.status === 'ok' && gateWithConsent.output === h1.output, gateWithConsent.note)
  const staleConsent = { accepted: true, acceptedAt: Date.now(), noticeVersion: CONSENT_NOTICE_VERSION - 1 }
  const gateStale = await runStep({ ...hmacStep, consent: staleConsent }, 'Hi There', 0, { secrets: { key: '0b'.repeat(20) } })
  ok(
    '旧版本风险确认失效后拒绝运行',
    gateStale.status === 'fail' && gateStale.note.includes('重新确认风险'),
    gateStale.note
  )
  const gateDigest = await runStep(createStep('digest', { algo: 'SHA-256' }), 'abc', 0)
  const gateSm3 = await runStep(createStep('sm3'), 'abc', 0)
  const gateJson = await runStep(createStep('json-format'), '{"a":1}', 0)
  ok(
    '非敏感步骤无确认仍可运行',
    gateDigest.status === 'ok' && gateSm3.status === 'ok' && gateJson.status === 'ok',
    `${gateDigest.note} | ${gateSm3.note} | ${gateJson.note}`
  )

  // ── 批次 C：数据转换 ──
  const b64 = await runStep(createStep('base64-encode'), 'DevKit 本地工具箱', 0)
  eqj('Base64 编码', b64.output, bytesToBase64(textToBytes('DevKit 本地工具箱')))
  const b64url = await runStep(createStep('base64-encode', { urlSafe: true }), '\u00ff\u00fe?', 0)
  ok('Base64URL 不使用 + / 与填充', !/[+/=]/.test(b64url.output), b64url.output)
  const ue1 = await runStep(createStep('url-encode'), 'a=1&b=中 文', 0)
  eqj('URL 编码（组件）', ue1.output, encodeURIComponent('a=1&b=中 文'))
  const ue2 = await runStep(createStep('url-encode', { component: 'uri' }), 'https://a.com/b?c=中', 0)
  eqj('URL 编码（整条 URI）', ue2.output, encodeURI('https://a.com/b?c=中'))
  const ud = await runStep(createStep('url-decode'), encodeURIComponent('{"code":1}'), 0)
  eqj('URL 解码', ud.output, '{"code":1}')
  const udBad = await runStep(createStep('url-decode'), '%ZZ', 0)
  ok('URL 解码非法百分号给出可读错误', udBad.status === 'fail' && udBad.note.includes('百分号'), udBad.note)
  const jm = await runStep(createStep('json-minify'), '{ "a" : 1, "a": 2 }', 0)
  ok('JSON 压缩并检测重复键', jm.output === '{"a":2}' && jm.note.includes('重复键'), `${jm.output} | ${jm.note}`)
  const td = await runStep(createStep('text-dedup', { removeBlank: true, trim: true }), '  a \nb\n\na\n', 0)
  eqj('文本去重整理', td.output, 'a\nb')
  const rx1 = await runStep(createStep('regex-replace', { pattern: '(\\d+)', flags: 'g', replacement: '#$1' }), 'a1b22', 0)
  eqj('正则替换', rx1.output, 'a#1b#22')
  const rx2 = await runStep(createStep('regex-replace', { mode: 'match', pattern: '(?<y>\\d{4})-(?<m>\\d{2})', flags: 'g' }), '2024-03 与 2025-11', 0)
  eqj('正则提取命名组', JSON.parse(rx2.output), [{ y: '2024', m: '03' }, { y: '2025', m: '11' }])
  const rx3 = await runStep(createStep('regex-replace', { pattern: '(', flags: 'g' }), 'x', 0)
  ok('非法正则给出可读错误', rx3.status === 'fail' && rx3.note.includes('表达式语法错误'), rx3.note)
  const csv1 = await runStep(createStep('csv-json', { infer: true }), 'name,age\nAlice,30\nBob,25', 0)
  eqj('CSV → JSON（含类型推断）', JSON.parse(csv1.output), [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }])
  const csv2 = await runStep(createStep('csv-json', { direction: 'json2csv' }), '[{"a":1,"b":"x,y"}]', 0)
  eqj('JSON → CSV', csv2.output, 'a,b\n1,"x,y"')
  const jp = await runStep(createStep('jmespath', { expr: '@[*].name' }), '[{"name":"Alice"},{"name":"Bob"}]', 0)
  eqj('JMESPath 提取', JSON.parse(jp.output), ['Alice', 'Bob'])
  const jsg = await runStep(createStep('json-schema-gen', { draft: 'draft-07' }), '{"a":1}', 0)
  ok('JSON Schema 生成按 Draft 输出', JSON.parse(jsg.output).$schema.includes('draft-07'), jsg.output)
  const sq1 = await runStep(createStep('sql-format', { dialect: 'mysql' }), 'select id,name from t where a=1', 0)
  ok('SQL 格式化', sq1.output.includes('SELECT') && sq1.output.split('\n').length > 1, sq1.output)
  const sq2 = await runStep(createStep('sql-format', { mode: 'minify' }), 'select 1 -- 注释\nfrom t', 0)
  ok('SQL 压缩并去掉注释', sq2.output.startsWith('select 1') && sq2.output.includes('from t') && !sq2.output.includes('注释'), sq2.output)
  const xmlNode = await runStep(createStep('xml', { mode: 'format' }), '<a><b/></a>', 0)
  ok('XML 步骤在无 DOM 环境下给出明确边界提示', xmlNode.status === 'fail' && xmlNode.note.includes('DOMParser'), xmlNode.note)

  // ── 预设流程 ──
  eqj('预设 7 条', workflowPresets.length, 7)
  const secretPresets = workflowPresets.filter((p) => presetSecretTypes(p).length)
  eqj('含密钥的预设 5 条', secretPresets.map((p) => p.key).sort(), ['aes-response', 'hmac-verify', 'request-sign', 'sm-cipher', 'sm2-verify'])
  await rejects('缺风险确认时不允许构建含密钥预设', () => buildWorkflowFromPreset(findPreset('aes-response')), /必须先确认风险/)
  const consent = makeConsent(1700000000000)
  const aesPreset = buildWorkflowFromPreset(findPreset('aes-response'), { consent })
  ok(
    '预设的敏感步骤带上确认记录与 secretRef',
    aesPreset.steps[1].consent?.accepted === true && aesPreset.steps[1].secretRef === aesPreset.steps[1].id
  )
  // 回归：同一含密钥预设允许重复添加，两个实例不能共用流程 ID / 步骤 ID，
  // 否则密钥按 (workflowId, stepId) 存储时会互相覆盖
  const aesPresetTwin = buildWorkflowFromPreset(findPreset('aes-response'), { consent })
  ok('重复添加同一预设：流程 ID 不同', aesPreset.id !== aesPresetTwin.id, `${aesPreset.id} / ${aesPresetTwin.id}`)
  ok(
    '重复添加同一预设：步骤 ID 不重复',
    aesPreset.steps.every((s, i) => s.id !== aesPresetTwin.steps[i].id),
    aesPreset.steps.map((s) => s.id).join(',')
  )
  ok(
    '重复添加同一预设：secretRef 指向自己的步骤',
    aesPresetTwin.steps.every((s) => !s.secretRef || s.secretRef === s.id)
  )

  const jsonText = JSON.stringify({ order: { id: 'o-1', total: 199.5 } })
  const aesCombined = await aesGcmEncrypt(textToBytes(jsonText), { key: hx(AES_KEY), iv: hx(AES_IV), aad: new Uint8Array(0), tagLength: 128 })
  const aesPresetRun = await runWorkflow(aesPreset, bytesToBase64(aesCombined), {
    stopOnError: true,
    secretOf: () => ({ key: AES_KEY, iv: AES_IV })
  })
  ok(
    '预设「AES 响应解密」端到端跑通',
    aesPresetRun.status === 'ok' && JSON.parse(aesPresetRun.finalOutput).order.total === 199.5,
    aesPresetRun.results.map((r) => r.note).join(' | ')
  )

  const smPreset = buildWorkflowFromPreset(findPreset('sm-cipher'), { consent })
  const smCt = h(sm4Encrypt(textToBytes(jsonText), SM4_KEY, { mode: 'cbc', padding: 'pkcs#7', ivHex: SM4_IV }))
  const smPresetRun = await runWorkflow(smPreset, smCt, { stopOnError: true, secretOf: () => ({ key: SM4_KEY, iv: SM4_IV }) })
  ok(
    '预设「国密报文处理」端到端跑通',
    smPresetRun.status === 'ok' && JSON.parse(smPresetRun.results[1].output).order.id === 'o-1',
    smPresetRun.results.map((r) => r.note).join(' | ')
  )
  ok('国密预设最后一步输出 SM3 摘要（64 位 Hex）', /^[0-9a-f]{64}$/.test(smPresetRun.finalOutput), smPresetRun.finalOutput)

  const signPreset = buildWorkflowFromPreset(findPreset('request-sign'), { consent })
  const signRun = await runWorkflow(signPreset, '{ "b": 2, "a": 1 }', { stopOnError: true, secretOf: () => ({ key: 'Jefe' }) })
  const expectedMac = await computeHmac('SHA-256', textToBytes('Jefe'), textToBytes('{"b":2,"a":1}'))
  ok(
    '预设「请求签名生成」端到端跑通',
    signRun.status === 'ok' &&
      signRun.results[1].output === h(expectedMac) &&
      signRun.finalOutput === bytesToBase64(textToBytes(h(expectedMac))),
    signRun.results.map((r) => r.note).join(' | ')
  )

  await rejects('HMAC 校验预设缺风险确认时不能构建', () => buildWorkflowFromPreset(findPreset('hmac-verify')), /必须先确认风险/)
  const verifyPreset = buildWorkflowFromPreset(findPreset('hmac-verify'), { consent })
  ok('HMAC 校验预设要求期望值一致', verifyPreset.steps[0].config.verifyExpected === true)
  const verifyMissing = await runWorkflow(verifyPreset, '{"b":2,"a":1}', {
    stopOnError: true,
    secretOf: () => ({ key: 'Jefe' })
  })
  ok('HMAC 校验预设缺期望值明确失败',
    verifyMissing.status === 'fail' && verifyMissing.results[0].note.includes('期望 HMAC') && verifyMissing.finalOutput === '{"b":2,"a":1}')
  verifyPreset.steps[0].config.expected = h(expectedMac)
  const verifyMatch = await runWorkflow(verifyPreset, '{"b":2,"a":1}', {
    stopOnError: true,
    secretOf: () => ({ key: 'Jefe' })
  })
  ok('HMAC 校验预设命中期望值才成功',
    verifyMatch.status === 'ok' && verifyMatch.results[0].note.includes('校验通过') && verifyMatch.finalOutput === h(expectedMac))
  verifyPreset.steps[0].config.expected = '00'.repeat(32)
  const verifyMismatch = await runWorkflow(verifyPreset, '{"b":2,"a":1}', {
    stopOnError: true,
    secretOf: () => ({ key: 'Jefe' })
  })
  ok('HMAC 校验预设不一致时流程失败且无可用产物',
    verifyMismatch.status === 'fail' && verifyMismatch.results[0].note.includes('校验不通过') && verifyMismatch.results[0].output === '')

  const csvPreset = buildWorkflowFromPreset(findPreset('csv-clean'))
  const csvRun = await runWorkflow(csvPreset, 'name,age\nAlice,30\nBob,25', { stopOnError: true })
  ok(
    '预设「CSV 接口数据清洗」端到端跑通',
    csvRun.status === 'ok' && JSON.parse(csvRun.finalOutput).join(',') === 'Alice,Bob',
    csvRun.results.map((r) => r.note).join(' | ')
  )

  // SM2 步骤本身带私钥字段，所以即使只验签也要先有风险确认
  const sm2Preset = buildWorkflowFromPreset(findPreset('sm2-verify'), { consent })
  const sm2Step = sm2Preset.steps[1]
  const sm2Run = await runWorkflow({ ...sm2Preset, steps: [sm2Preset.steps[0], { ...sm2Step, config: { ...sm2Step.config, publicKey: SM2_PUB, signature: SM2_SIG } }, sm2Preset.steps[2]] }, encodeURIComponent(SM2_MSG), { stopOnError: true })
  ok(
    '预设「SM2 签名验证」端到端跑通',
    sm2Run.status === 'ok' && sm2Run.finalOutput === SM2_MSG,
    sm2Run.results.map((r) => r.note).join(' | ')
  )

  // ── 导出 / 导入：密钥不进导出内容 ──
  const withSecret = buildWorkflowFromPreset(findPreset('request-sign'), { consent })
  const exported = exportWorkflowText(withSecret)
  ok('导出的敏感步骤标记 requiresSecret', JSON.parse(exported).steps.some((s) => s.requiresSecret === true))
  // 兜底回归：即使敏感字段被人为写进 config，导出也必须剔除
  const leaky = { id: 'wf-leak', name: 'leak', desc: '', steps: [{ id: 's1', type: 'hmac', config: { algo: 'SHA-256', key: 'SUPER-SECRET-KEY' } }] }
  ok('导出会剔除混进 config 的敏感字段', !exportWorkflowText(leaky).includes('SUPER-SECRET-KEY'), exportWorkflowText(leaky))
  const reimport = parseImportText(exported)
  eqj('导入识别出敏感步骤类型', reimport.secretTypes, ['hmac'])
  ok('导入不会带入确认记录', reimport.workflow.steps.every((s) => !s.consent))
  await rejects('导入不支持的步骤类型整体拒绝', () => parseImportText('{"steps":[{"type":"rm -rf"}]}'), /不支持的步骤类型/)
  await rejects('导入非法 JSON 明确报错', () => parseImportText('{oops'), /不是合法的 JSON/)

  return cases
}
