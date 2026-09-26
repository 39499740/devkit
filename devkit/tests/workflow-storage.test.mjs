/**
 * 流程持久化与密钥存储回归：
 * 损坏数据不崩页、配额超限必须报「未保存」、密钥不进流程文件与导出内容、
 * 删除步骤/流程同步清理密钥、旧确认记录不迁移。
 */
import {
  clearSecrets,
  CONSENT_NOTICE_VERSION,
  emptySecrets,
  isCurrentConsent,
  loadSecrets,
  makeConsent,
  memoryKv,
  missingRequiredSecrets,
  parseSecrets,
  persistSecrets,
  redactSecrets,
  removeSecretOfStep,
  removeSecretsOfSteps,
  removeSecretsOfWorkflow,
  SECRETS_KEY,
  secretFields,
  serializeSecrets,
  upsertSecret
} from '../app/workflow/secrets.ts'
import {
  exportWorkflowText,
  parseImportText,
  parseRuns,
  parseWorkflows,
  persistRuns,
  persistWorkflows,
  RUNS_KEY,
  sanitizeWorkflow,
  serializeRuns,
  serializeWorkflows,
  WORKFLOWS_KEY
} from '../app/workflow/storage.ts'
import { browserKv } from '../app/workflow/secrets.ts'
import { makeCases } from './cases.mjs'

const SECRET_VALUE = 'S3CRET-VALUE-42'

function wfWithHmac() {
  return {
    id: 'wf-1',
    name: '签名流程',
    desc: '',
    steps: [{ id: 's1', type: 'hmac', config: { algo: 'SHA-256', keyEncoding: 'utf8' }, secretRef: 's1' }]
  }
}

/** setItem 直接抛异常的 kv：模拟配额已满 / 隐私模式 */
function quotaKv() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {}
  }
}

export const run = async () => {
  const { cases, ok, eqj, rejects } = makeCases()

  // ── 内存 kv 与浏览器边界 ──
  const kv = memoryKv()
  kv.setItem('a', '1')
  eqj('memoryKv 可读写', kv.getItem('a'), '1')
  kv.removeItem('a')
  eqj('memoryKv 可删除', kv.getItem('a'), null)
  eqj('Node 环境下没有浏览器存储', browserKv(), null)

  // ── 密钥文件解析 ──
  eqj('空密钥文件', parseSecrets(null).file.items.length, 0)
  ok('损坏的密钥 JSON 不崩页并给出提示', parseSecrets('{oops').error.includes('无法解析'), parseSecrets('{oops').error)
  ok('结构异常的密钥文件也会提示', parseSecrets('{"items":5}').error.length > 0)
  const round = parseSecrets(serializeSecrets(upsertSecret(emptySecrets(), { workflowId: 'wf-1', stepId: 's1', fields: { key: SECRET_VALUE }, now: 1000 }))).file
  eqj('密钥可序列化再读回', secretFields(round, 'wf-1', 's1').key, SECRET_VALUE)

  // ── 写入 / 更新 / 删除 ──
  let file = upsertSecret(emptySecrets(), { workflowId: 'wf-1', stepId: 's1', fields: { key: 'k1' }, now: 1000 })
  eqj('新增密钥记录', file.items.length, 1)
  file = upsertSecret(file, { workflowId: 'wf-1', stepId: 's1', fields: { key: 'k2', iv: 'i2' }, now: 2000 })
  eqj('同一步骤只有一条记录', file.items.length, 1)
  eqj('更新后的字段', Object.keys(file.items[0].fields).sort(), ['iv', 'key'])
  eqj('保留创建时间、更新修改时间', [file.items[0].createdAt, file.items[0].updatedAt], [1000, 2000])
  file = upsertSecret(file, { workflowId: 'wf-1', stepId: 's2', fields: { key: 'k3' }, now: 3000 })
  eqj('另一流程的密钥按 stepId 隔离', secretFields(removeSecretsOfWorkflow(file, 'wf-1'), 'wf-1', 's1').key, undefined)
  ok('按流程删除只影响该流程', removeSecretsOfWorkflow(file, 'wf-1').items.length === 0)
  ok('按步骤批量删除', removeSecretsOfSteps(file, 'wf-1', ['s1']).items.every((s) => s.stepId !== 's1'))
  ok('单步删除', removeSecretOfStep(file, 'wf-1', 's1').items.every((s) => s.stepId !== 's1'))
  const emptied = upsertSecret(file, { workflowId: 'wf-1', stepId: 's1', fields: { key: '' }, now: 4000 })
  ok('字段全空时删除记录，不留空壳', emptied.items.every((s) => s.stepId !== 's1'))

  // ── 回归：不同流程出现相同 stepId（重复添加同一含密钥预设、重复导入同一文件）──
  // 密钥记录必须按 (workflowId, stepId) 定位，否则后一条流程保存密钥会抹掉前一条的记录
  const SAME_STEP = 'aes-response-s2'
  let shared = upsertSecret(emptySecrets(), { workflowId: 'wf-a', stepId: SAME_STEP, fields: { key: 'KEY-A', iv: 'IV-A' }, now: 1000 })
  shared = upsertSecret(shared, { workflowId: 'wf-b', stepId: SAME_STEP, fields: { key: 'KEY-B' }, now: 2000 })
  eqj('重名步骤：两条流程各留一条密钥记录', shared.items.length, 2)
  eqj('重名步骤：第一条流程的密钥不被覆盖', secretFields(shared, 'wf-a', SAME_STEP).key, 'KEY-A')
  eqj('重名步骤：第一条流程的 IV 不被覆盖', secretFields(shared, 'wf-a', SAME_STEP).iv, 'IV-A')
  eqj('重名步骤：第二条流程写入自己的密钥', secretFields(shared, 'wf-b', SAME_STEP).key, 'KEY-B')
  const removedA = removeSecretOfStep(shared, 'wf-a', SAME_STEP)
  eqj('重名步骤：删除一条流程的步骤不影响另一条', secretFields(removedA, 'wf-b', SAME_STEP).key, 'KEY-B')
  eqj('重名步骤：删除只移除本流程的记录', removedA.items.length, 1)
  eqj('重名步骤：批量删除同样按流程隔离', secretFields(removeSecretsOfSteps(shared, 'wf-a', [SAME_STEP]), 'wf-b', SAME_STEP).key, 'KEY-B')
  const clearedA = upsertSecret(shared, { workflowId: 'wf-a', stepId: SAME_STEP, fields: { key: '' }, now: 3000 })
  eqj('重名步骤：清空某流程的密钥不动另一条', secretFields(clearedA, 'wf-b', SAME_STEP).key, 'KEY-B')

  // ── 写入失败必须如实返回 ──
  const saveFail = persistSecrets(quotaKv(), file)
  ok('配额超限时报「密钥未保存」', !saveFail.ok && /密钥未保存/.test(saveFail.error), JSON.stringify(saveFail))
  const saveNoKv = persistSecrets(null, file)
  ok('没有本地存储时也返回失败而不是假装成功', !saveNoKv.ok && !!saveNoKv.error)
  const okSave = persistSecrets(kv, file)
  ok('正常写入成功', okSave.ok)
  eqj('写入后能读回', loadSecrets(kv).file.items.length, file.items.length)
  clearSecrets(kv)
  eqj('清空后存储键被移除', kv.getItem(SECRETS_KEY), null)

  // ── 必填密钥与脱敏 ──
  eqj('HMAC 缺密钥时报告必填字段', missingRequiredSecrets('hmac', {}).map((f) => f.key), ['key'])
  eqj('HMAC 有密钥时不报缺', missingRequiredSecrets('hmac', { key: 'x' }).length, 0)
  eqj('AES 缺 IV 也算缺密钥', missingRequiredSecrets('aes-gcm', { key: 'k' }).map((f) => f.key), ['iv'])
  eqj('SM4 的 IV 不是必填（ECB 不需要）', missingRequiredSecrets('sm4', { key: 'k' }).length, 0)
  eqj('摘要步骤没有必填密钥', missingRequiredSecrets('digest', {}).length, 0)
  eqj('脱敏会盖住密钥值', redactSecrets('失败：密钥 ' + SECRET_VALUE + ' 无效', { key: SECRET_VALUE }), '失败：密钥 •••• 无效')
  eqj('过短的密钥值不做全局替换', redactSecrets('a1b', { key: '1' }), 'a1b')

  // ── 确认记录 ──
  ok('当前版本确认有效', isCurrentConsent(makeConsent(1)))
  ok('旧文案版本的确认失效', !isCurrentConsent({ accepted: true, acceptedAt: 1, noticeVersion: CONSENT_NOTICE_VERSION - 1 }))
  ok('没有确认记录时视为未确认', !isCurrentConsent(undefined))

  // ── 流程文件解析 ──
  eqj('本地没有保存过时返回 null（调用方用默认流程）', parseWorkflows(null).workflows, null)
  ok('流程 JSON 损坏时回退并给出提示', parseWorkflows('{oops').workflows === null && parseWorkflows('{oops').error.includes('无法解析'))
  ok('结构异常同样回退', parseWorkflows('{"items":3}').error.length > 0)
  eqj('空列表就是空列表（用户删光了流程）', parseWorkflows(serializeWorkflows([])).workflows, [])
  const withJunk = JSON.parse(serializeWorkflows([{ ...wfWithHmac(), steps: [...wfWithHmac().steps, { id: 'x', type: '不存在的步骤' }] }]))
  const ws = parseWorkflows(JSON.stringify(withJunk))
  eqj('无法识别的步骤被跳过', ws.workflows[0].steps.length, 1)
  ok('跳过步骤时给出有损提示', /无法识别的步骤/.test(ws.warning), ws.warning)
  const stripTest = sanitizeWorkflow({
    id: 'wf-x',
    name: 'n',
    steps: [{ id: 's1', type: 'hmac', config: { algo: 'SHA-256', key: SECRET_VALUE, 野字段: 'x' } }]
  })
  ok('config 里的敏感字段与未声明字段都不会读进来', !JSON.stringify(stripTest).includes(SECRET_VALUE) && !JSON.stringify(stripTest).includes('野字段'))
  const dupIds = sanitizeWorkflow({ id: 'wf-y', name: 'n', steps: [{ id: 'same', type: 'json-format' }, { id: 'same', type: 'json-minify' }] })
  ok('重复的步骤 id 会被重新分配', dupIds.steps[0].id !== dupIds.steps[1].id)
  const oldConsent = sanitizeWorkflow({
    id: 'wf-z',
    name: 'n',
    steps: [{ id: 's1', type: 'hmac', config: {}, consent: { accepted: true, acceptedAt: 1, noticeVersion: CONSENT_NOTICE_VERSION - 1 } }]
  })
  ok('旧版本的确认记录不迁移', oldConsent.steps[0].consent === undefined)
  const oldConfigFlow = {
    id: 'wf-config-convert', name: '配置格式互转', steps: [
      { id: 's1', type: 'json-format', config: { indent: '2' } },
      { id: 's2', type: 'json-yaml', config: { direction: 'json2yaml' } },
      { id: 's3', type: 'download', config: { filename: 'config.yaml' } }
    ]
  }
  eqj('旧版已保存的配置迁移流程自动补 YAML 深度预检', sanitizeWorkflow(oldConfigFlow).steps[0].config.yamlCompatibility, true)
  const optedOut = structuredClone(oldConfigFlow)
  optedOut.steps[0].config.yamlCompatibility = false
  eqj('用户明确关闭 YAML 预检时保留选择', sanitizeWorkflow(optedOut).steps[0].config.yamlCompatibility, false)
  eqj('非对象的工作流被拒绝', sanitizeWorkflow('nope'), null)

  // ── 与浏览器存储的边界一致 ──
  const wfSave = persistWorkflows(quotaKv(), [wfWithHmac()])
  ok('流程写入失败时提示未保存', !wfSave.ok && /未保存/.test(wfSave.error), JSON.stringify(wfSave))
  const kv2 = memoryKv()
  ok('流程可以写入并读回', persistWorkflows(kv2, [wfWithHmac()]).ok && parseWorkflows(kv2.getItem(WORKFLOWS_KEY)).workflows.length === 1)

  // ── 密钥只存在密钥文件里，不进流程文件与导出内容 ──
  const secretFile = upsertSecret(emptySecrets(), { workflowId: 'wf-1', stepId: 's1', fields: { key: SECRET_VALUE }, now: 1 })
  const wfJson = serializeWorkflows([wfWithHmac()])
  ok('流程文件里没有密钥值', !wfJson.includes(SECRET_VALUE))
  ok('密钥文件里确实是明文（这是必须如实告知用户的事实）', serializeSecrets(secretFile).includes(SECRET_VALUE))
  ok('导出流程不含密钥值', !exportWorkflowText(wfWithHmac()).includes(SECRET_VALUE))
  ok('导出流程标记 requiresSecret', JSON.parse(exportWorkflowText(wfWithHmac())).steps[0].requiresSecret === true)

  // ── 导入 ──
  await rejects('导入非法 JSON', () => parseImportText('{oops'), /不是合法的 JSON/)
  await rejects('导入缺 steps', () => parseImportText('{"name":"x"}'), /缺少 steps 数组/)
  await rejects('导入未知步骤类型', () => parseImportText('{"steps":[{"type":"nope"}]}'), /不支持的步骤类型/)
  const imported = parseImportText('{"name":"我的流程","steps":[{"type":"hmac","config":{"algo":"SHA-512","key":"LEAK"}},{"type":"json-format","config":{"indent":"4"}}]}')
  eqj('导入识别敏感步骤', imported.secretTypes, ['hmac'])
  ok('导入不带入密钥与确认记录', imported.workflow.steps[0].config.key === undefined && imported.workflow.steps[0].consent === undefined)
  eqj('导入保留非敏感参数', imported.workflow.steps[1].config.indent, '4')

  // ── 运行记录 ──
  eqj('无记录时为空', parseRuns(null).runs.length, 0)
  ok('损坏的运行记录被清空并提示', parseRuns('{oops').error.length > 0)
  const runs = parseRuns(
    serializeRuns([
      { id: 'r1', workflowId: 'wf-1', name: 'n', summary: 'A → B', status: 'ok', ms: 12, at: 5, input: SECRET_VALUE, output: SECRET_VALUE }
    ])
  ).runs
  eqj('运行记录只保留允许的字段', Object.keys(runs[0]).sort(), ['at', 'id', 'ms', 'name', 'status', 'summary', 'workflowId'])
  ok('运行记录不含输入输出', !JSON.stringify(parseRuns(serializeRuns([{ id: 'r1', workflowId: 'w', name: 'n', summary: 's', status: 'ok', ms: 1, at: 2, input: SECRET_VALUE }])).runs).includes(SECRET_VALUE))
  const runsSave = persistRuns(quotaKv(), runs)
  ok('运行记录写入失败时提示', !runsSave.ok && !!runsSave.error)
  ok('运行记录写入成功', persistRuns(memoryKv(), runs).ok)
  eqj('运行记录键名固定', RUNS_KEY, 'devkit-workflow-runs-v1')

  return cases
}
