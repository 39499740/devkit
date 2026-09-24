/**
 * 并行修复线程的回归测试（misc-fixes）：
 * 1. CSV 类型推断不再静默丢高精度小数（超精度保持字符串 + 中文告警）；
 * 2. 二进制结果的日志字节数按真实字节（而非 Hex 视图字符数）；
 * 3. 文本去重正确处理 CRLF（\r\n / \r 统一为 \n），重复行能被去除；
 * 4. AES-GCM 加密的英文底层错误本地化（不回显 operation failed）。
 * 全部经真实实现/执行器计算，不伪造算法结果。
 */
import { check, eq } from './helpers.mjs'
import { csvToJson, inferCsvValue } from '../app/utils/csv.ts'
import { tidyText } from '../app/utils/text.ts'
import { createStep, makeConsent, runStep } from '../app/utils/workflow.ts'

const CONSENT = makeConsent(Date.now())
const AES_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const AES_IV = '101112131415161718191a1b'
const mkAes = (config) => ({ ...createStep('aes-gcm', config), consent: CONSENT })

export const cases = []

/* ── 任务 1：CSV 类型推断精度 ── */
cases.push(eq("inferCsvValue('1.5') → 1.5", inferCsvValue('1.5'), 1.5))
cases.push(eq("inferCsvValue('0.5') → 0.5", inferCsvValue('0.5'), 0.5))
cases.push(eq("inferCsvValue('1.50') 仅格式差异仍转 number", inferCsvValue('1.50'), 1.5))
cases.push(eq("inferCsvValue('007') 保持字符串", inferCsvValue('007'), '007'))
cases.push(
  eq('超精度小数（20 位整数 + 小数）保持字符串', inferCsvValue('12345678901234567890.5'), '12345678901234567890.5')
)
cases.push(
  eq('超精度小数（19 位有效数字）保持字符串', inferCsvValue('1.234567890123456789'), '1.234567890123456789')
)

// 可选 warnings 收集：超精度时给出中文告警
const inferWarnings = []
const kept = inferCsvValue('1.234567890123456789', inferWarnings)
cases.push(
  check(
    'inferCsvValue 可选收集精度告警（中文）',
    () => kept === '1.234567890123456789' && inferWarnings.length === 1 && inferWarnings[0].includes('超出可精确表示的精度')
  )
)
const noWarnings = []
inferCsvValue('1.5', noWarnings)
cases.push(check('普通小数不产生精度告警', () => noWarnings.length === 0))

// csvToJson 推断开启：超精度小数保持字符串且 warnings 机制带出告警
const csvBig = csvToJson('a\n12345678901234567890.5', { separator: ',', header: true, infer: true })
cases.push(eq('csvToJson 推断：超精度小数保持字符串', JSON.parse(csvBig.json), [{ a: '12345678901234567890.5' }]))
cases.push(
  check(
    'csvToJson 推断：超精度小数产生中文精度告警',
    () => csvBig.warnings.some((w) => w.includes('超出可精确表示的精度'))
  )
)
const csvBig2 = csvToJson('a\n1.234567890123456789', { separator: ',', header: true, infer: true })
cases.push(eq('csvToJson 推断：19 位有效数字保持字符串', JSON.parse(csvBig2.json), [{ a: '1.234567890123456789' }]))
const csvSmall = csvToJson('a\n1.5', { separator: ',', header: true, infer: true })
cases.push(eq('csvToJson 推断：普通小数仍转 number', JSON.parse(csvSmall.json), [{ a: 1.5 }]))
cases.push(check('csvToJson 推断：普通小数无精度告警', () => !csvSmall.warnings.some((w) => w.includes('超出可精确表示的精度'))))

/* ── 任务 2：二进制结果日志字节数 ── */
const bin = await runStep(createStep('base64-decode'), '/wAQ/g==', 0)
cases.push(eq('base64-decode 输出为 bytes 载荷', bin.outputKind, 'bytes'))
cases.push(
  check(
    'base64-decode 保留原始 4 字节（ff0010fe）',
    () => !!bin.payload.bytes && bin.payload.bytes.length === 4 && bin.output === 'ff0010fe'
  )
)
const outLine = bin.logs.find((l) => l.startsWith('输出'))
cases.push(
  check(
    '输出日志按真实字节数 4 B（而非 Hex 视图的 8 B）并注明二进制',
    () => !!outLine && outLine.includes('4 B') && !outLine.includes('8 B') && outLine.includes('二进制')
  )
)
cases.push(check('输出日志不含把 Hex 当字节的 8 B 误报', () => bin.logs.every((l) => !(l.startsWith('输出') && l.includes('8 B')))))

/* ── 任务 3：文本去重 CRLF ── */
const crlf = tidyText('a\r\nb\r\na', { caseSensitive: true, removeBlank: false, trim: false, sort: 'keep' })
cases.push(eq('CRLF 输入去重后统一为 LF', crlf.text, 'a\nb'))
cases.push(eq('CRLF 输入重复计数 dup=1', crlf.dup, 1))
cases.push(eq('CRLF 输入行数统计不变（3 → 2）', [crlf.inLines, crlf.outLines], [3, 2]))
const loneCr = tidyText('a\rb\ra', { caseSensitive: true, removeBlank: false, trim: false, sort: 'keep' })
cases.push(eq('单独 CR 也按换行处理并去重', loneCr.text, 'a\nb'))
const lf = tidyText('a\nb\na', { caseSensitive: true, removeBlank: false, trim: false, sort: 'keep' })
cases.push(eq('LF 回归：行为不变', lf.text, 'a\nb'))
cases.push(eq('LF 回归：行数统计不变', [lf.inLines, lf.outLines, lf.dup], [3, 2, 1]))

/* ── 任务 4：AES-GCM 加密错误本地化 ── */
// 4a. 非法认证标签长度：中文失败，不含英文 operation failed
const badTag = await runStep(
  mkAes({ operation: 'encrypt', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex', tagLength: '64' }),
  'hello',
  0,
  { secrets: { key: AES_KEY, iv: AES_IV, aad: '' } }
)
cases.push(
  check(
    'AES-GCM 非法标签长度：中文失败且无英文 operation failed',
    () => badTag.status === 'fail' && badTag.note.includes('认证标签长度') && !/operation failed/i.test(badTag.note)
  )
)

// 4b. 非法 IV（1 字节）：若运行环境拒绝则必须是中文映射（不回显英文）
const badIv = await runStep(
  mkAes({ operation: 'encrypt', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex', tagLength: '128' }),
  'hello',
  0,
  { secrets: { key: AES_KEY, iv: '00', aad: '' } }
)
cases.push(
  check(
    'AES-GCM 非法 IV：失败时为中文映射且无英文 operation failed',
    () =>
      badIv.status === 'ok' || // 个别环境接受短 IV，不强制失败
      (badIv.status === 'fail' && badIv.note.includes('AES-GCM 加密失败') && !/operation failed/i.test(badIv.note))
  )
)

// 4c. 直接让底层 WebCrypto 抛出真实英文错误，验证执行器一定把它本地化
const realCrypto = globalThis.crypto
let aesEnglishRes = null
try {
  const fakeSubtle = new Proxy(realCrypto.subtle, {
    get(target, prop) {
      if (prop === 'encrypt') {
        return () => {
          throw new DOMException('The operation failed for an operation-specific reason', 'OperationError')
        }
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    }
  })
  const fakeCrypto = Object.create(realCrypto)
  Object.defineProperty(fakeCrypto, 'subtle', { value: fakeSubtle, configurable: true })
  Object.defineProperty(globalThis, 'crypto', { value: fakeCrypto, configurable: true, writable: true })
  aesEnglishRes = await runStep(
    mkAes({ operation: 'encrypt', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex', tagLength: '128' }),
    'hello',
    0,
    { secrets: { key: AES_KEY, iv: AES_IV, aad: '' } }
  )
} finally {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true })
}
cases.push(
  check(
    'AES-GCM 加密底层英文错误被本地化（中文，无 operation failed）',
    () =>
      !!aesEnglishRes &&
      aesEnglishRes.status === 'fail' &&
      aesEnglishRes.note.includes('AES-GCM 加密失败') &&
      !/operation failed/i.test(aesEnglishRes.note) &&
      !/operation-specific reason/i.test(aesEnglishRes.note)
  )
)

// 4d. 解密分支既有映射保持：错误密钥 → 认证失败中文提示
const decWrongKey = await runStep(
  mkAes({ operation: 'decrypt', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'hex', tagLength: '128' }),
  '00'.repeat(32),
  0,
  { secrets: { key: 'ff'.repeat(32), iv: AES_IV, aad: '' } }
)
cases.push(
  check(
    'AES-GCM 解密认证失败：中文提示且无英文 operation failed（回归）',
    () => decWrongKey.status === 'fail' && decWrongKey.note.includes('认证失败') && !/operation failed/i.test(decWrongKey.note)
  )
)
