/**
 * 步骤库：步骤名称、分类、参数定义。
 * 新增步骤时这里与 executors/index.ts 的映射必须同时补齐，缺一个会在启动时被 stepDef 兜底暴露出来。
 */
import type { StepConfig, StepConfigField, StepDef, StepType, WorkflowStep } from './types'
import { digestAlgoOptions } from '../utils/crypto/digest'
import { hmacAlgoOptions } from '../utils/crypto/hmac'
import { aesKeyBitsOptions, aesTagBitsOptions } from '../utils/crypto/aesgcm'
import { sm2CipherModeOptions, sm2SignatureFormatOptions, SM2_DEFAULT_USER_ID } from '../utils/crypto/sm2'
import { sm4ModeOptions, sm4PaddingOptions } from '../utils/crypto/sm4'
import { inputEncodingOptions, outputEncodingOptions } from '../utils/crypto/encoding'
import { sqlDialects } from '../utils/sql'

/** auto 只对「可能收到二进制上游」的加解密步骤有意义 */
export const autoInputEncodingOptions = [
  { value: 'auto', label: '自动（上游字节 / 否则按 UTF-8）' },
  ...inputEncodingOptions
]

/** auto 的边界必须写在界面上：直接粘贴 Hex / Base64 文本时要显式选编码 */
export const AUTO_INPUT_HELP =
  '自动 = 上一步输出二进制时直接取其字节（例如 Base64 解码后的密文）；手动粘贴 Hex / Base64 文本请显式选择对应编码'

export const stepLibrary: StepDef[] = [
  // ── 编码与文本 ──
  { type: 'base64-decode', name: 'Base64 解码', cat: '编码与文本', desc: '把 Base64 文本还原为原始文本', fields: [] },
  {
    type: 'base64-encode',
    name: 'Base64 编码',
    cat: '编码与文本',
    desc: '把文本按 UTF-8 编码为 Base64',
    fields: [
      { key: 'urlSafe', label: 'Base64URL（- _ 且去掉填充）', control: 'switch', default: false },
      { key: 'lineBreak', label: '每 76 字符换行', control: 'switch', default: false }
    ]
  },
  { type: 'url-decode', name: 'URL 解码', cat: '编码与文本', desc: '百分号编码还原为原文', fields: [] },
  {
    type: 'url-encode',
    name: 'URL 编码',
    cat: '编码与文本',
    desc: '把文本转成百分号编码',
    fields: [
      {
        key: 'component',
        label: '编码范围',
        control: 'select',
        default: 'component',
        options: [
          { value: 'component', label: '组件（encodeURIComponent，转义 & = ? /）' },
          { value: 'uri', label: '整条 URI（encodeURI，保留 : / ? & =）' }
        ]
      }
    ]
  },
  {
    type: 'text-dedup',
    name: '文本去重整理',
    cat: '编码与文本',
    desc: '按行去重，可去空行、去行首尾空格与排序',
    fields: [
      { key: 'caseSensitive', label: '大小写敏感', control: 'switch', default: true },
      { key: 'removeBlank', label: '去除空行', control: 'switch', default: false },
      { key: 'trim', label: '去掉行首尾空格', control: 'switch', default: false },
      {
        key: 'sort',
        label: '排序',
        control: 'select',
        default: 'keep',
        options: [
          { value: 'keep', label: '保持原顺序' },
          { value: 'dict', label: '按字典序排序' }
        ]
      }
    ]
  },
  {
    type: 'regex-replace',
    name: '正则提取替换',
    cat: '编码与文本',
    desc: '按正则提取匹配项或替换文本',
    fields: [
      {
        key: 'mode',
        label: '模式',
        control: 'select',
        default: 'replace',
        options: [
          { value: 'replace', label: '替换' },
          { value: 'match', label: '提取匹配（JSON 数组）' }
        ]
      },
      {
        key: 'pattern',
        label: '表达式',
        control: 'text',
        required: true,
        placeholder: '([\\w.+-]+)@([\\w-]+\\.[\\w.]+)'
      },
      { key: 'flags', label: 'flags', control: 'text', default: 'g', placeholder: 'g' },
      { key: 'replacement', label: '替换为', control: 'text', placeholder: '$1', help: '替换模式有效，支持 $1 与 $<name>' }
    ]
  },

  // ── 数据格式 ──
  {
    type: 'json-format',
    name: 'JSON 格式化',
    cat: '数据格式',
    desc: '解析并重新缩进 JSON',
    fields: [
      {
        key: 'indent',
        label: '缩进',
        control: 'select',
        default: '2',
        options: [
          { value: '2', label: '2 空格' },
          { value: '4', label: '4 空格' },
          { value: '0', label: '不缩进（单行）' }
        ]
      }
    ]
  },
  {
    type: 'json-minify',
    name: 'JSON 压缩',
    cat: '数据格式',
    desc: '去掉全部多余空白，压缩为单行',
    fields: [{ key: 'checkDuplicateKeys', label: '检查重复键', control: 'switch', default: true }]
  },
  {
    type: 'jsonpath',
    name: 'JSONPath 提取',
    cat: '数据格式',
    desc: '按表达式提取字段',
    fields: [{ key: 'expr', label: 'JSONPath 表达式', control: 'text', default: '$', placeholder: '$.store.book[*].title' }]
  },
  {
    type: 'jmespath',
    name: 'JMESPath 提取',
    cat: '数据格式',
    desc: '按 JMESPath 表达式提取字段',
    fields: [
      {
        key: 'expr',
        label: 'JMESPath 表达式',
        control: 'text',
        required: true,
        placeholder: 'people[?age > \`20\`].name',
        help: '顶层是数组时用 @ 起头，例如 @[*].name'
      }
    ]
  },
  {
    type: 'json-yaml',
    name: 'JSON / YAML 转换',
    cat: '数据格式',
    desc: 'JSON 与 YAML 双向转换',
    fields: [
      {
        key: 'direction',
        label: '方向',
        control: 'select',
        default: 'json2yaml',
        options: [
          { value: 'json2yaml', label: 'JSON → YAML' },
          { value: 'yaml2json', label: 'YAML → JSON' }
        ]
      }
    ]
  },
  {
    type: 'schema-validate',
    name: 'JSON Schema 校验',
    cat: '数据格式',
    desc: '用 Schema 校验上一级输出',
    fields: [
      { key: 'schema', label: 'JSON Schema', control: 'textarea', required: true, placeholder: '{ "type": "object" }' }
    ]
  },
  {
    type: 'json-schema-gen',
    name: 'JSON Schema 生成',
    cat: '数据格式',
    desc: '从当前 JSON 样本反推 Schema',
    fields: [
      {
        key: 'draft',
        label: 'Draft',
        control: 'select',
        default: '2020-12',
        options: [
          { value: '2020-12', label: 'Draft 2020-12' },
          { value: 'draft-07', label: 'Draft-07' }
        ]
      },
      { key: 'strict', label: '严格模式（additionalProperties: false）', control: 'switch', default: false }
    ]
  },
  {
    type: 'csv-json',
    name: 'CSV / JSON 转换',
    cat: '数据格式',
    desc: '表格与 JSON 数组互转',
    fields: [
      {
        key: 'direction',
        label: '方向',
        control: 'select',
        default: 'csv2json',
        options: [
          { value: 'csv2json', label: 'CSV → JSON' },
          { value: 'json2csv', label: 'JSON → CSV' }
        ]
      },
      {
        key: 'separator',
        label: '分隔符',
        control: 'select',
        default: ',',
        options: [
          { value: ',', label: '逗号 ,' },
          { value: ';', label: '分号 ;' },
          { value: '\t', label: '制表符 Tab' }
        ]
      },
      { key: 'header', label: '表头首行', control: 'switch', default: true },
      { key: 'infer', label: '类型推断', control: 'switch', default: false }
    ]
  },
  {
    type: 'sql-format',
    name: 'SQL 格式化压缩',
    cat: '数据格式',
    desc: '按方言重排 SQL 空白与关键字大小写',
    fields: [
      {
        key: 'mode',
        label: '模式',
        control: 'select',
        default: 'format',
        options: [
          { value: 'format', label: '格式化' },
          { value: 'minify', label: '压缩为单行' }
        ]
      },
      { key: 'dialect', label: '方言', control: 'select', default: 'mysql', options: sqlDialects },
      {
        key: 'indent',
        label: '缩进',
        control: 'select',
        default: '2',
        options: [
          { value: '2', label: '2 空格' },
          { value: '4', label: '4 空格' }
        ]
      },
      { key: 'upperKeywords', label: '关键字大写', control: 'switch', default: true }
    ]
  },
  {
    type: 'xml',
    name: 'XML 处理',
    cat: '数据格式',
    desc: '格式化、压缩、与 JSON 互转或 XPath 查询',
    fields: [
      {
        key: 'mode',
        label: '模式',
        control: 'select',
        default: 'format',
        options: [
          { value: 'format', label: '格式化' },
          { value: 'minify', label: '压缩' },
          { value: 'xml2json', label: 'XML → JSON' },
          { value: 'json2xml', label: 'JSON → XML' },
          { value: 'xpath', label: 'XPath 查询' }
        ]
      },
      {
        key: 'indent',
        label: '缩进',
        control: 'select',
        default: '2',
        options: [
          { value: '2', label: '2 空格' },
          { value: '4', label: '4 空格' }
        ]
      },
      { key: 'expr', label: 'XPath 表达式', control: 'text', placeholder: '//catalog/book/title', help: '仅 XPath 模式有效' },
      { key: 'namespaces', label: '命名空间', control: 'text', placeholder: 'ns=http://example.com/ns', help: '前缀=URI，多个用逗号分隔' }
    ]
  },

  // ── Java 开发 ──
  {
    type: 'json2java',
    name: 'JSON 转 Java',
    cat: 'Java 开发',
    desc: '按 JSON 结构生成 POJO',
    fields: [{ key: 'className', label: '类名', control: 'text', default: 'Order', placeholder: 'Order' }]
  },

  // ── 摘要与加解密 ──
  {
    type: 'digest',
    name: 'MD5 / SHA 摘要',
    cat: '摘要与加密',
    desc: '计算 MD5、SHA-256 或 SHA-512 摘要，可与期望值对照',
    fields: [
      { key: 'algo', label: '算法', control: 'select', default: 'SHA-256', options: digestAlgoOptions },
      {
        key: 'inputEncoding',
        label: '输入编码',
        control: 'select',
        default: 'auto',
        options: autoInputEncodingOptions,
        help: AUTO_INPUT_HELP
      },
      { key: 'outputEncoding', label: '输出编码', control: 'select', default: 'hex', options: outputEncodingOptions },
      { key: 'expected', label: '期望摘要（可选）', control: 'text', placeholder: '与结果按 Hex 对照' }
    ]
  },
  {
    type: 'hmac',
    name: 'HMAC 计算与校验',
    cat: '摘要与加密',
    desc: '用密钥计算 HMAC-SHA256 / SHA512，可与期望值对照',
    fields: [
      { key: 'algo', label: '算法', control: 'select', default: 'SHA-256', options: hmacAlgoOptions },
      {
        key: 'keyEncoding',
        label: '密钥编码',
        control: 'select',
        default: 'utf8',
        options: [
          { value: 'utf8', label: 'UTF-8 文本' },
          { value: 'hex', label: 'Hex' }
        ]
      },
      {
        key: 'inputEncoding',
        label: '输入编码',
        control: 'select',
        default: 'auto',
        options: autoInputEncodingOptions,
        help: AUTO_INPUT_HELP
      },
      { key: 'outputEncoding', label: '输出编码', control: 'select', default: 'hex', options: outputEncodingOptions },
      { key: 'expected', label: '期望 HMAC（可选）', control: 'text', placeholder: '与结果按 Hex 对照' },
      { key: 'key', label: '密钥', control: 'secret', required: true, sensitive: true, help: '保存在本机浏览器 localStorage，未确认风险前不会保存' }
    ]
  },
  {
    type: 'aes-gcm',
    name: 'AES-GCM 加解密',
    cat: '摘要与加密',
    desc: 'AES-GCM 加密或解密，密文格式为「密文 || 认证标签」',
    fields: [
      {
        key: 'operation',
        label: '操作',
        control: 'select',
        default: 'encrypt',
        options: [
          { value: 'encrypt', label: '加密' },
          { value: 'decrypt', label: '解密' }
        ]
      },
      { key: 'keyBits', label: '密钥长度', control: 'select', default: '256', options: aesKeyBitsOptions },
      {
        key: 'keyEncoding',
        label: '密钥编码',
        control: 'select',
        default: 'hex',
        options: [
          { value: 'hex', label: 'Hex（64 字符 = 32 字节）' },
          { value: 'base64', label: 'Base64' },
          { value: 'utf8', label: 'UTF-8 文本（须恰好等于密钥长度）' }
        ]
      },
      {
        key: 'inputEncoding',
        label: '输入编码',
        control: 'select',
        default: 'auto',
        options: autoInputEncodingOptions,
        help: AUTO_INPUT_HELP
      },
      { key: 'outputEncoding', label: '输出编码', control: 'select', default: 'hex', options: outputEncodingOptions },
      { key: 'tagLength', label: '认证标签长度', control: 'select', default: '128', options: aesTagBitsOptions },
      { key: 'key', label: '密钥', control: 'secret', required: true, sensitive: true },
      { key: 'iv', label: 'IV（nonce，Hex）', control: 'secret', required: true, sensitive: true, help: '推荐 12 字节；同一密钥下不要重用' },
      { key: 'aad', label: 'AAD（附加认证数据，可选）', control: 'secret', sensitive: true }
    ]
  },
  {
    type: 'sm2',
    name: 'SM2 加解密与签名',
    cat: '摘要与加密',
    desc: '国密 SM2 加密、解密、签名与验签',
    fields: [
      {
        key: 'operation',
        label: '操作',
        control: 'select',
        default: 'encrypt',
        options: [
          { value: 'encrypt', label: '加密（公钥）' },
          { value: 'decrypt', label: '解密（私钥）' },
          { value: 'sign', label: '签名（私钥）' },
          { value: 'verify', label: '验签（公钥）' }
        ]
      },
      { key: 'cipherMode', label: '密文格式', control: 'select', default: '1', options: sm2CipherModeOptions },
      { key: 'encoding', label: '密文编码', control: 'select', default: 'hex', options: outputEncodingOptions },
      { key: 'sigFormat', label: '签名格式', control: 'select', default: 'raw', options: sm2SignatureFormatOptions },
      { key: 'userId', label: 'User ID', control: 'text', default: SM2_DEFAULT_USER_ID },
      { key: 'publicKey', label: '公钥', control: 'textarea', placeholder: '04 开头 130 位 Hex，或 02/03 开头 66 位' },
      { key: 'signature', label: '签名（验签时填写）', control: 'textarea', placeholder: 'raw：128 位 Hex；DER：ASN.1 Hex' },
      {
        key: 'privateKey',
        label: '私钥',
        control: 'secret',
        sensitive: true,
        help: '64 位 Hex，保存在本机浏览器 localStorage'
      }
    ]
  },
  {
    type: 'sm3',
    name: 'SM3 摘要',
    cat: '摘要与加密',
    desc: '国密 SM3 摘要，可与期望值对照',
    fields: [
      {
        key: 'inputEncoding',
        label: '输入编码',
        control: 'select',
        default: 'auto',
        options: autoInputEncodingOptions,
        help: AUTO_INPUT_HELP
      },
      { key: 'outputEncoding', label: '输出编码', control: 'select', default: 'hex', options: outputEncodingOptions },
      { key: 'expected', label: '期望摘要（可选）', control: 'text', placeholder: '与结果按 Hex 对照' }
    ]
  },
  {
    type: 'sm4',
    name: 'SM4 加解密',
    cat: '摘要与加密',
    desc: '国密 SM4 分组加解密（CBC / ECB）',
    fields: [
      {
        key: 'operation',
        label: '操作',
        control: 'select',
        default: 'encrypt',
        options: [
          { value: 'encrypt', label: '加密' },
          { value: 'decrypt', label: '解密' }
        ]
      },
      { key: 'mode', label: '模式', control: 'select', default: 'cbc', options: sm4ModeOptions },
      { key: 'padding', label: '填充', control: 'select', default: 'pkcs#7', options: sm4PaddingOptions },
      {
        key: 'keyEncoding',
        label: '密钥编码',
        control: 'select',
        default: 'utf8',
        options: [
          { value: 'utf8', label: 'UTF-8 文本（恰好 16 字节）' },
          { value: 'hex', label: 'Hex（32 字符）' }
        ]
      },
      {
        key: 'inputEncoding',
        label: '输入编码',
        control: 'select',
        default: 'auto',
        options: autoInputEncodingOptions,
        help: AUTO_INPUT_HELP
      },
      {
        key: 'outputEncoding',
        label: '输出编码',
        control: 'select',
        default: 'auto',
        options: [{ value: 'auto', label: '自动（能还原为文本就输出文本）' }, ...outputEncodingOptions]
      },
      { key: 'key', label: '密钥', control: 'secret', required: true, sensitive: true, help: '16 字节：Hex 32 字符或 16 个 ASCII 字符' },
      { key: 'iv', label: 'IV（CBC 必填，Hex）', control: 'secret', sensitive: true, help: '16 字节，32 个 Hex 字符；ECB 模式不需要' }
    ]
  },

  // ── 文件与图片 ──
  {
    type: 'download',
    name: '下载结果',
    cat: '文件与图片',
    desc: '把当前结果作为文件导出',
    fields: [{ key: 'filename', label: '文件名', control: 'text', default: 'result.txt', placeholder: 'result.txt' }]
  }
]

const byType = new Map<StepType, StepDef>(stepLibrary.map((s) => [s.type, s]))

export function stepDef(type: StepType): StepDef {
  return byType.get(type) ?? stepLibrary[0]!
}

export function hasStep(type: string): type is StepType {
  return byType.has(type as StepType)
}

export const stepTypes: StepType[] = stepLibrary.map((s) => s.type)

/** 敏感字段（值来自密钥存储，不进 config） */
export function secretFieldsOf(type: StepType): StepConfigField[] {
  return stepDef(type).fields.filter((f) => f.sensitive)
}

export function isSensitiveStep(type: StepType): boolean {
  return secretFieldsOf(type).length > 0
}

/** 非敏感字段的默认值，用于新建步骤时把参数预置成可用状态 */
export function defaultConfig(type: StepType, overrides: StepConfig = {}): StepConfig {
  const config: StepConfig = {}
  for (const f of stepDef(type).fields) {
    if (f.sensitive) continue
    if (f.default !== undefined) config[f.key] = f.default
  }
  return { ...config, ...overrides }
}

export function configText(config: StepConfig, key: string, fallback = ''): string {
  const v = config[key]
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return fallback
}

export function configBool(config: StepConfig, key: string, fallback = false): boolean {
  const v = config[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true' || v === '1'
  return fallback
}

export function configNumber(config: StepConfig, key: string, fallback: number): number {
  const n = Number(configText(config, key, String(fallback)))
  return Number.isFinite(n) ? n : fallback
}

let seq = 0

export function newStepId(): string {
  seq += 1
  return `step-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 新建步骤：填默认参数；敏感步骤必须由调用方先取得风险确认 */
export function createStep(type: StepType, overrides: StepConfig = {}): WorkflowStep {
  return { id: newStepId(), type, config: defaultConfig(type, overrides) }
}
