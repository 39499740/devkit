/**
 * 默认流程与预设流程库。
 *
 * 含敏感步骤的预设不会自动创建：必须由用户先经过风险确认（useWorkflows.addPreset），
 * 与「步骤库添加」「导入流程」「发送到流程」走同一个确认入口；缺少确认时这里直接抛错，
 * 不会生成假的确认记录。
 * 预设的每一步都必须能真实跑通（单测会端到端执行）。
 */
import { createStep, defaultConfig, isSensitiveStep } from './catalog'
import { uid } from './storage'
import type { SecretConsent, StepConfig, StepType, Workflow, WorkflowStep } from './types'

export interface PresetStep {
  type: StepType
  config?: StepConfig
}

export interface WorkflowPreset {
  key: string
  name: string
  desc: string
  /** 预设里需要用户自己补的密钥提示；为空表示直接可跑 */
  secretHint?: string
  steps: PresetStep[]
}

export const workflowPresets: WorkflowPreset[] = [
  {
    key: 'aes-response',
    name: 'AES 响应解密',
    desc: 'Base64 解码 → AES-GCM 解密 → JSON 格式化',
    secretHint: '需要 AES 密钥与 IV：在 AES-GCM 步骤里填写，确认风险后保存到本机浏览器',
    steps: [
      { type: 'base64-decode' },
      {
        type: 'aes-gcm',
        config: {
          operation: 'decrypt',
          keyBits: '256',
          keyEncoding: 'hex',
          inputEncoding: 'auto',
          outputEncoding: 'hex',
          tagLength: '128'
        }
      },
      { type: 'json-format', config: { indent: '2' } }
    ]
  },
  {
    key: 'sm-cipher',
    name: '国密报文处理',
    desc: 'SM4 解密 → JSON 格式化 → SM3 摘要',
    // 顺序有讲究：SM3 的输出是摘要文本、不是 JSON，所以 JSON 格式化必须排在摘要之前
    secretHint: '需要 SM4 密钥（16 字节）与 CBC 模式的 IV',
    steps: [
      {
        type: 'sm4',
        config: {
          operation: 'decrypt',
          mode: 'cbc',
          padding: 'pkcs#7',
          keyEncoding: 'hex',
          // 密文按 Hex 文本传入（国密报文常见形态）；若上游是二进制请改成「自动」
          inputEncoding: 'hex',
          outputEncoding: 'auto'
        }
      },
      { type: 'json-format', config: { indent: '2' } },
      { type: 'sm3', config: { inputEncoding: 'auto', outputEncoding: 'hex' } }
    ]
  },
  {
    key: 'request-sign',
    name: '请求签名生成',
    desc: 'JSON 压缩 → HMAC-SHA256 → Base64 编码',
    secretHint: '需要 HMAC 密钥（UTF-8 文本或 Hex）',
    steps: [
      { type: 'json-minify', config: { checkDuplicateKeys: true } },
      { type: 'hmac', config: { algo: 'SHA-256', keyEncoding: 'utf8', inputEncoding: 'auto', outputEncoding: 'hex' } },
      { type: 'base64-encode', config: { urlSafe: false, lineBreak: false } }
    ]
  },
  {
    key: 'hmac-verify',
    name: 'HMAC 签名校验',
    desc: '原文 → HMAC-SHA256 校验期望值；缺少期望值或不一致时明确失败',
    secretHint: '需要 HMAC 密钥；在 HMAC 步骤参数中填写期望 HMAC（Hex）',
    steps: [
      { type: 'hmac', config: { algo: 'SHA-256', keyEncoding: 'utf8', inputEncoding: 'utf8', outputEncoding: 'hex', verifyExpected: true } }
    ]
  },
  {
    key: 'sm2-verify',
    name: 'SM2 签名验证',
    desc: 'URL 解码 → SM2 验签 → 下载结果',
    secretHint: '需要公钥与签名值（写进 SM2 步骤参数）；私钥不需要',
    steps: [
      { type: 'url-decode' },
      { type: 'sm2', config: { operation: 'verify', cipherMode: '1', encoding: 'hex', sigFormat: 'raw' } },
      { type: 'download', config: { filename: 'verified.txt' } }
    ]
  },
  {
    key: 'csv-clean',
    name: 'CSV 接口数据清洗',
    desc: 'CSV → JSON → JMESPath 取字段 → JSON 格式化 → 下载',
    steps: [
      { type: 'csv-json', config: { direction: 'csv2json', separator: ',', header: true, infer: true } },
      { type: 'jmespath', config: { expr: '@[*].name' } },
      { type: 'json-format', config: { indent: '2' } },
      { type: 'download', config: { filename: 'api-data.json' } }
    ]
  },
  {
    key: 'xml-contract',
    name: 'XML 接口数据转换',
    desc: 'XML → JSON → JSON Schema 生成 → 下载',
    steps: [
      { type: 'xml', config: { mode: 'xml2json', indent: '2' } },
      { type: 'json-schema-gen', config: { draft: '2020-12', strict: false } },
      { type: 'download', config: { filename: 'schema.json' } }
    ]
  }
]

export function findPreset(key: string): WorkflowPreset | undefined {
  return workflowPresets.find((p) => p.key === key)
}

/** 预设里需要风险确认的步骤类型 */
export function presetSecretTypes(preset: WorkflowPreset): StepType[] {
  return [...new Set(preset.steps.filter((s) => isSensitiveStep(s.type)).map((s) => s.type))]
}

export function presetNeedsSecret(preset: WorkflowPreset): boolean {
  return preset.steps.some((s) => isSensitiveStep(s.type))
}

export interface BuildPresetOptions {
  /** 敏感步骤必须带上这个确认记录；缺失时抛错而不是伪造一个 */
  consent?: SecretConsent
}

/**
 * 从预设构建流程：每次构建都生成独立的流程 ID 与步骤 ID。
 * 同一预设允许被添加多次（例如两个接口各解密一次），实例之间不能共用步骤 ID——
 * 密钥记录按 (workflowId, stepId) 定位，共用 ID 会让后添加的实例覆盖前一个的密钥。
 */
export function buildWorkflowFromPreset(preset: WorkflowPreset, opts: BuildPresetOptions = {}): Workflow {
  const steps: WorkflowStep[] = preset.steps.map((s) => {
    const step = createStep(s.type, { ...defaultConfig(s.type), ...(s.config ?? {}) })
    if (isSensitiveStep(s.type)) {
      if (!opts.consent) throw new Error(`预设「${preset.name}」包含密钥步骤，必须先确认风险`)
      step.secretRef = step.id
      step.consent = opts.consent
    }
    return step
  })
  return { id: uid('wf'), name: preset.name, desc: preset.desc, steps }
}

/** 首次使用时的默认流程：三条都不含密钥，可直接运行 */
export function defaultWorkflows(): Workflow[] {
  return [
    {
      id: 'wf-order-snapshot',
      name: '订单快照解析',
      desc: '把 Base64 订单快照解码后转成 Java 实体类',
      steps: [
        build('wf-order-snapshot', 0, 'base64-decode'),
        build('wf-order-snapshot', 1, 'json-format', { indent: '2' }),
        build('wf-order-snapshot', 2, 'jsonpath', { expr: '$.order' }),
        build('wf-order-snapshot', 3, 'json2java', { className: 'Order' })
      ]
    },
    {
      id: 'wf-config-convert',
      name: '配置格式互转',
      desc: '把 JSON 配置格式化后转成 YAML',
      steps: [
        build('wf-config-convert', 0, 'json-format', { indent: '2', yamlCompatibility: true }),
        build('wf-config-convert', 1, 'json-yaml', { direction: 'json2yaml' }),
        build('wf-config-convert', 2, 'download', { filename: 'config.yaml' })
      ]
    },
    {
      id: 'wf-response-check',
      name: '接口响应校验',
      desc: 'URL 解码响应体，格式化后按 Schema 校验',
      steps: [
        build('wf-response-check', 0, 'url-decode'),
        build('wf-response-check', 1, 'json-format', { indent: '2' }),
        build('wf-response-check', 2, 'schema-validate', {
          schema: '{ "type": "object", "required": ["code"], "properties": { "code": { "type": "integer" } } }'
        })
      ]
    }
  ]
}

function build(wfId: string, index: number, type: StepType, config?: StepConfig): WorkflowStep {
  const step = createStep(type, { ...defaultConfig(type), ...(config ?? {}) })
  step.id = `${wfId}-s${index + 1}`
  return step
}
