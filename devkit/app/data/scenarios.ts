/**
 * 场景注册表：按「用户要解决什么」组织的任务入口，首页「你现在要解决什么」区块从这里渲染。
 * 场景页固定在 app/pages/scenarios/{slug}.vue，只做解释与引导，不接收真实输入。
 * 卡片文案与对应场景页的一句话描述、输入/产出说明保持一致（问题、输入、结果、步骤）。
 */
export interface ScenarioMeta {
  /** 路由 slug，场景页为 /scenarios/{slug} */
  slug: string
  /** 场景名，与场景页 h1 一致 */
  name: string
  /** 用户的问题（一句话） */
  problem: string
  /** 输入是什么 */
  input: string
  /** 能得到什么结果 */
  output: string
  /** 需要几步 / 怎么跑 */
  steps: string
  /** 与场景页页头一致的图标名（DkIcon） */
  icon: string
}

export const scenarios: ScenarioMeta[] = [
  {
    slug: 'api-response',
    name: '接口响应排查',
    problem: '响应经过 URL 或 Base64 编码，想取字段并确认结构是否正确。',
    input: 'URL 编码或 Base64 的响应体文本',
    output: '还原并格式化后的 JSON、JSONPath 提取结果与 Schema 校验结论，可复制',
    steps: '流程 3–4 步',
    icon: 'workflow'
  },
  {
    slug: 'config-migration',
    name: '配置格式迁移',
    problem: '要把 JSON 配置转成 YAML，担心字段或类型被静默改写。',
    input: 'JSON 配置文本（对象 / 数组 / 任意嵌套）',
    output: '2 空格缩进 YAML，可整体复制或下载 config.yaml，附核对提示',
    steps: '流程 3 步',
    icon: 'file-code'
  },
  {
    slug: 'crypto-debug',
    name: '加密数据调试',
    problem: 'AES / SM4 响应密文解不开，或 HMAC / SM2 验签结果不清楚。',
    input: '密文（Base64 / Hex）与密钥、IV、签名等参数',
    output: '区分「解码成功、解密成功、验签通过」的明确结论，错误参数明确失败',
    steps: '单项工具执行',
    icon: 'lock'
  }
]

export const scenarioCount = scenarios.length

export function scenarioPath(s: ScenarioMeta): string {
  return `/scenarios/${s.slug}`
}

export function getScenario(slug: string): ScenarioMeta | undefined {
  return scenarios.find((s) => s.slug === slug)
}
