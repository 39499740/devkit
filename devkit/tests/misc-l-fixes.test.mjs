/**
 * 并行修复线程 misc-l 的回归测试：
 * 1. AES 枚举校验：keyEncoding / operation 非法值抛中文错误，不再静默降级（utf8 / decrypt）；
 * 2. SM2 解密：text 载荷但携带 bytes 时按 bytes 解（与 kind==='bytes' 行为一致）；
 * 3. 流程名文件名清洗（[id].vue）：outputFilename / exportJson 复用 sanitizeFilename；
 * 4. hydrate：localStorage getItem 抛异常时不中断挂载，保留默认流程并写入可读错误。
 *
 * 说明：任务 3 的 [id].vue 是 SFC，不能被 Node 直接 import。
 * 这里用 @vue/compiler-sfc 自检编译，并从源码抽取 sanitizeFilename/outputFilename/exportJson
 * 的真实函数体用 new Function 执行——测的是页面里的实际实现，而不是另写的等价模型。
 * 任务 2 的 hydrate 用 Nuxt 全局桩（useState/useToast/onMounted + window.localStorage）真实调用。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, eq } from './helpers.mjs'
import { bytesToBase64, bytesToHex, hexToBytes } from '../app/utils/bytes.ts'
import { sm2Encrypt } from '../app/utils/crypto/sm2.ts'
import { cryptoExecutors } from '../app/workflow/executors/crypto.ts'
import { textPayload } from '../app/workflow/types.ts'
import { defaultWorkflows } from '../app/workflow/presets.ts'
import { RUNS_KEY, WORKFLOWS_KEY } from '../app/workflow/storage.ts'
import { readStoredItem, useWorkflows } from '../app/composables/useWorkflows.ts'

// 测试运行器把用例打包到 /tmp，import.meta.url 不可靠；npm/隔离运行器都以 devkit 为 cwd
const projectRoot = process.cwd()
const h = (bytes) => bytesToHex(bytes)

export const cases = []

const rejects = async (name, fn, matcher) => {
  try {
    await fn()
    cases.push({ name, ok: false, detail: '期望抛错，但没有抛出' })
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    const ok = matcher.test(msg)
    cases.push({ name, ok, detail: ok ? '' : `错误消息不匹配 ${matcher}：${msg}` })
  }
}

/* ────────────────────────────────────────────────────────────
 * 任务 4：AES-GCM 枚举校验
 * ──────────────────────────────────────────────────────────── */
const aes = cryptoExecutors['aes-gcm']

const AES_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const AES_IV = '101112131415161718191a1b'
const AES_SECRETS = { key: AES_KEY, iv: AES_IV, aad: '' }
const aesConfig = (over = {}) => ({
  operation: 'encrypt',
  keyBits: '256',
  keyEncoding: 'hex',
  inputEncoding: 'utf8',
  outputEncoding: 'hex',
  tagLength: '128',
  ...over
})

// 非法 keyEncoding：必须中文报错，不能静默按 UTF-8 解密钥（会得到完全不同的 32 字节）
await rejects(
  'AES keyEncoding=bogus 抛中文「不支持的密钥编码」',
  () => aes(textPayload('hello'), aesConfig({ keyEncoding: 'bogus' }), AES_SECRETS),
  /不支持的密钥编码：bogus/
)
// 非法 operation：必须中文报错，不能静默当 decrypt（会把明文当密文解）
await rejects(
  'AES operation=bogus 抛中文「不支持的操作」',
  () => aes(textPayload('hello'), aesConfig({ operation: 'bogus' }), AES_SECRETS),
  /不支持的操作：bogus/
)
// 合法枚举仍然正常
const aesOk = await aes(textPayload('hello'), aesConfig(), AES_SECRETS)
cases.push(
  check(
    'AES 合法枚举（hex/encrypt）仍正常加密',
    () => !!aesOk && aesOk.note.includes('AES-256-GCM 加密成功') && /^[0-9a-f]+$/.test(aesOk.payload.text)
  )
)
const aesOkB64 = await aes(
  textPayload('hello'),
  aesConfig({ keyEncoding: 'base64' }),
  { key: bytesToBase64(hexToBytes(AES_KEY).bytes), iv: AES_IV, aad: '' }
)
cases.push(check('AES 合法 keyEncoding=base64 仍正常加密', () => !!aesOkB64 && aesOkB64.note.includes('AES-256-GCM 加密成功')))

/* ────────────────────────────────────────────────────────────
 * 任务 3：SM2 解密按 bytes（与 kind 无关）
 * ──────────────────────────────────────────────────────────── */
const SM2_PUB =
  '0463bb89d7efec4f2590d5486e249082c4c4ba68458ed484db2dbc3c1f6ac11187668e8c6cfed5c75c669433fb037606961bcf99a8c3ce12c6fa9e44a22d64454d'
const SM2_PRIV = '62f1724b3e02e23b38a8594f0cd01b963b1607e43631e20d75d35060464fa774'
const sm2 = cryptoExecutors['sm2']
const sm2DecryptCfg = { operation: 'decrypt', cipherMode: '1', encoding: 'hex' }
const sm2Secrets = { privateKey: SM2_PRIV }

const binBytes = new Uint8Array([0xff, 0x00, 0x10, 0xfe, 0x7a, 0x01])
const binHex = h(binBytes)
const cipherHex = sm2Encrypt(binBytes, SM2_PUB, 1)
const cipherBytes = hexToBytes(cipherHex).bytes
// 与真密文不一致的合法长度密文（96 字节全 0）：用来证明「按 text 解会失败」
const wrongCipherHex = '00'.repeat(96)

const runSafe = async (fn) => {
  try {
    return await fn()
  } catch (e) {
    return { status: 'fail', note: e && e.message ? e.message : String(e) }
  }
}

const textWithBytes = await runSafe(() =>
  sm2({ kind: 'text', text: wrongCipherHex, bytes: cipherBytes }, sm2DecryptCfg, sm2Secrets)
)
const kindBytes = await runSafe(() => sm2({ kind: 'bytes', text: 'zz', bytes: cipherBytes }, sm2DecryptCfg, sm2Secrets))
const textOnly = await runSafe(() => sm2({ kind: 'text', text: wrongCipherHex }, sm2DecryptCfg, sm2Secrets))

cases.push(
  check(
    'SM2 解密：kind=text 但携带 bytes → 按 bytes 解出原始字节',
    () => !!textWithBytes.payload && !!textWithBytes.payload.bytes && h(textWithBytes.payload.bytes) === binHex
  )
)
cases.push(
  check(
    'SM2 解密：与 kind=bytes 的结果完全一致（行为对齐）',
    () =>
      !!kindBytes.payload &&
      !!kindBytes.payload.bytes &&
      !!textWithBytes.payload.bytes &&
      h(textWithBytes.payload.bytes) === h(kindBytes.payload.bytes)
  )
)
cases.push(
  check(
    'SM2 解密：没有 bytes 时仍按 text Hex 解，错误密文如实失败（对照）',
    () => textOnly.status === 'fail' && /C3 校验未通过|解密失败/.test(textOnly.note)
  )
)
cases.push(eq('SM2 测试前提：text 与 bytes 确实不一致', wrongCipherHex === cipherHex, false))

/* ────────────────────────────────────────────────────────────
 * 任务 1：流程名清洗（[id].vue）
 * ──────────────────────────────────────────────────────────── */
const sfcPath = join(projectRoot, 'app', 'pages', 'workflows', '[id].vue')
const sfcSource = readFileSync(sfcPath, 'utf8')

// SFC 自检：用 Vue 官方编译器解析并编译 <script setup>。
// 用动态 import（参数为运行时表达式）避免 esbuild 把 compiler-sfc 及其可选模板引擎依赖打进包。
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const parsed = parseSfc(sfcSource, { filename: '[id].vue' })
cases.push(check('SFC 解析 [id].vue 无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
let compileError = ''
try {
  compileSfcScript(parsed.descriptor, { id: 'misc-l' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 编译 [id].vue 的 <script setup> 成功', () => !compileError, compileError))

/** 从 SFC 源码抽取真实函数体（用于执行页面里的实际实现，而不是另写等价模型） */
function extractFnBody(source, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`)
  const m = source.match(re)
  if (!m) throw new Error(`未在 [id].vue 中找到函数 ${name}()`)
  return m[1]
}

const sanitizeBody = extractFnBody(sfcSource, 'sanitizeFilename')
const sanitize = new Function('name', sanitizeBody)
cases.push(eq('sanitizeFilename 去掉路径分隔符与非法字符', sanitize('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij'))
cases.push(eq('sanitizeFilename 去首尾空白', sanitize('  流程  '), '流程'))
cases.push(eq('sanitizeFilename 全为非法字符时返回空串', sanitize('///<>'), ''))

const outputBody = extractFnBody(sfcSource, 'outputFilename')
const outputFilename = new Function('steps', 'wf', 'sanitizeFilename', 'binary', outputBody)
const stepsOf = (arr) => ({ value: arr })
const wfOf = (name) => ({ value: name === undefined ? undefined : { name } })

cases.push(eq('outputFilename：清洗流程名中的非法字符', outputFilename(stepsOf([]), wfOf('a/b:c'), sanitize), 'abc.out.txt'))
cases.push(eq('outputFilename：清洗后为空回退 workflow-output', outputFilename(stepsOf([]), wfOf('///'), sanitize), 'workflow-output.txt'))
cases.push(eq('outputFilename：无流程名回退 workflow-output（二进制）', outputFilename(stepsOf([]), wfOf(undefined), sanitize, true), 'workflow-output.bin'))
cases.push(
  eq(
    'outputFilename：download 步骤显式文件名优先且同样清洗',
    outputFilename(stepsOf([{ type: 'download', config: { filename: 'x/y' } }]), wfOf('wf'), sanitize),
    'xy'
  )
)
cases.push(
  eq(
    'outputFilename：download 文件名清洗后为空则回退流程名',
    outputFilename(stepsOf([{ type: 'download', config: { filename: '///' } }]), wfOf('wf'), sanitize),
    'wf.out.txt'
  )
)

const exportBody = extractFnBody(sfcSource, 'exportJson')
const exportJson = new Function('wf', 'store', 'id', 'sanitizeFilename', 'downloadText', exportBody)
const storeStub = { exportText: () => '{"v":1}' }
const idStub = { value: 'wf-1' }
let downloadedName = null
const downloadText = (name) => {
  downloadedName = name
}
const runExport = (name) => {
  downloadedName = null
  exportJson(wfOf(name), storeStub, idStub, sanitize, downloadText)
  return downloadedName
}
cases.push(eq('exportJson：清洗流程名非法字符', runExport('a/b:c'), 'abc.json'))
cases.push(eq('exportJson：清洗后为空回退 workflow', runExport('///'), 'workflow.json'))
cases.push(eq('exportJson：正常名字保持不变', runExport('我的流程'), '我的流程.json'))
downloadedName = null
exportJson({ value: null }, storeStub, idStub, sanitize, downloadText)
cases.push(eq('exportJson：无流程时不触发下载', downloadedName, null))

// 源码级证据：两个调用点都已经复用 sanitizeFilename
cases.push(
  check(
    '[id].vue 源码证据：outputFilename/exportJson 均调用 sanitizeFilename',
    () =>
      /outputFilename[\s\S]*sanitizeFilename\(wf\.value\?\.name/.test(sfcSource) &&
      /exportJson[\s\S]*sanitizeFilename\(current\.name\)/.test(sfcSource)
  )
)

/* ────────────────────────────────────────────────────────────
 * 任务 2：hydrate 容错
 * ──────────────────────────────────────────────────────────── */
// 纯函数：getter 抛异常时返回 null + 可读错误
cases.push(eq('readStoredItem 正常取值', readStoredItem({ getItem: () => 'v' }, 'k', '流程'), { raw: 'v' }))
cases.push(eq('readStoredItem 无存储时返回 null', readStoredItem(null, 'k', '流程'), { raw: null }))
const caught = readStoredItem(
  {
    getItem: () => {
      throw new Error('denied')
    }
  },
  'k',
  '流程'
)
cases.push(
  check(
    'readStoredItem 捕获 getter 异常并给出可读中文错误',
    () => caught.raw === null && /读取本地流程失败/.test(caught.error) && /隐私模式/.test(caught.error)
  )
)

/** 用 Nuxt 全局桩真实调用 useWorkflows().hydrate()；localStorage 按用例定制 */
async function runHydrateCase(makeLocalStorage) {
  const saved = {
    window: globalThis.window,
    useState: globalThis.useState,
    useToast: globalThis.useToast,
    onMounted: globalThis.onMounted
  }
  const states = new Map()
  const warnings = []
  globalThis.useState = (key, init) => {
    if (!states.has(key)) states.set(key, { value: typeof init === 'function' ? init() : init })
    return states.get(key)
  }
  globalThis.useToast = () => ({
    warning: (m) => warnings.push(m),
    success: () => {},
    error: () => {},
    info: () => {}
  })
  globalThis.onMounted = () => {}
  globalThis.window = { localStorage: makeLocalStorage() }
  try {
    const store = useWorkflows()
    let threw = ''
    try {
      store.hydrate()
    } catch (e) {
      threw = e && e.message ? e.message : String(e)
    }
    return { store, warnings, threw, defaultCount: defaultWorkflows().length }
  } finally {
    globalThis.window = saved.window
    globalThis.useState = saved.useState
    globalThis.useToast = saved.useToast
    globalThis.onMounted = saved.onMounted
  }
}

const noopKv = { setItem() {}, removeItem() {} }

// A. 只有流程 getter 抛异常
const caseA = await runHydrateCase(() => ({
  getItem: (k) => {
    if (k === WORKFLOWS_KEY) throw new Error('denied')
    return null
  },
  ...noopKv
}))
cases.push(
  check('hydrate：流程 getItem 抛异常不中断挂载', () => caseA.threw === '' && caseA.store.hydrated.value === true)
)
cases.push(eq('hydrate：失败时保留默认流程', caseA.store.workflows.value.length, caseA.defaultCount))
cases.push(
  check(
    'hydrate：流程读取失败写入 storageError（可读中文）',
    () => /读取本地流程失败/.test(caseA.store.storageError.value)
  )
)
cases.push(
  check('hydrate：流程读取失败同时给出 warning', () => caseA.warnings.some((w) => /读取本地流程失败/.test(w)))
)

// B. 只有运行记录 getter 抛异常
const caseB = await runHydrateCase(() => ({
  getItem: (k) => {
    if (k === RUNS_KEY) throw new Error('denied')
    return null
  },
  ...noopKv
}))
cases.push(
  check('hydrate：运行记录 getItem 抛异常不中断挂载', () => caseB.threw === '' && caseB.store.hydrated.value === true)
)
cases.push(eq('hydrate：运行记录读取失败时为空数组', caseB.store.runs.value, []))
cases.push(
  check(
    'hydrate：运行记录读取失败写入 storageError',
    () => /读取本地运行记录失败/.test(caseB.store.storageError.value)
  )
)

// C. 所有 getter 都抛异常
const caseC = await runHydrateCase(() => ({
  getItem: () => {
    throw new Error('denied')
  },
  ...noopKv
}))
cases.push(
  check(
    'hydrate：全部 getter 抛异常仍完成挂载且 storageError 非空',
    () => caseC.threw === '' && caseC.store.hydrated.value === true && caseC.store.storageError.value.length > 0
  )
)
cases.push(eq('hydrate：全部失败时密钥为空记录', caseC.store.secrets.value.items, []))
