export interface ToolMeta {
  /** T 编号，如 t01 */
  id: string
  /** 路由 slug，如 json-format */
  slug: string
  name: string
  /** 窄容器（侧栏、搜索）里的短名，缺省用 name */
  short?: string
  /** 分类 key */
  cat: CategoryKey
  /** 一句用途说明 */
  desc: string
  /** 搜索别名（中英文、缩写） */
  alias: string[]
  /** 特性标签 */
  tags: string[]
  icon: string
  /** 标记为新增：目录 / 列表里显示「新」徽标（随发版轮换：只标本次发版新增，随下次发版摘除） */
  isNew?: boolean
}

export type CategoryKey =
  | 'format'
  | 'text'
  | 'crypto'
  | 'time'
  | 'java'
  | 'web'
  | 'api'
  | 'file'

export interface CategoryMeta {
  key: CategoryKey
  name: string
  desc: string
}

export const categories: CategoryMeta[] = [
  { key: 'format', name: '数据格式', desc: 'JSON、YAML、CSV 等结构化数据的格式化、校验与转换。' },
  { key: 'text', name: '编码与文本', desc: 'Base64、URL、Unicode 等编码转换与文本批量处理。' },
  { key: 'crypto', name: '摘要与加密', desc: 'MD5、SHA、HMAC、AES 与国密 SM2/SM3/SM4，全部本地计算。' },
  { key: 'time', name: '时间与标识', desc: '时间戳、UUID、Cron 与日期时间差计算。' },
  { key: 'java', name: 'Java 开发', desc: 'JSON 转 Java、转义、配置转换、堆栈整理与依赖声明转换。' },
  { key: 'web', name: 'Web / Vue', desc: 'TypeScript 类型、Vue 组件模板、CSS 单位、颜色与前端格式化。' },
  { key: 'api', name: '接口辅助', desc: 'JWT、URL 参数、请求代码转换与 HTTP 状态码速查。' },
  { key: 'file', name: '文件与图片', desc: '文件摘要、图片压缩、二维码与文件编码转换。' }
]

export const tools: ToolMeta[] = [
  {
    id: 't01', slug: 'json-format', name: 'JSON 格式化', cat: 'format', icon: 'braces',
    desc: '格式化、压缩并校验 JSON，支持缩进选择与树形视图。',
    alias: ['json', 'format', 'beautify', 'minify', '格式化', '压缩', '校验'],
    tags: ['大整数安全']
  },
  {
    id: 't02', slug: 'json-diff', name: 'JSON 差异比较', cat: 'format', icon: 'diff',
    desc: '结构化比较两个 JSON，标注新增、删除与修改。',
    alias: ['json', 'diff', 'compare', '差异', '对比', '比较'],
    tags: ['结构化差异']
  },
  {
    id: 't03', slug: 'json-yaml', name: 'JSON / YAML 转换', cat: 'format', icon: 'file-code',
    desc: 'JSON 与 YAML 双向转换，保留中文、布尔与数组。',
    alias: ['json', 'yaml', 'yml', '转换', '配置'],
    tags: ['双向转换']
  },
  {
    id: 't04', slug: 'csv-json', name: 'CSV / JSON 转换', cat: 'format', icon: 'table',
    desc: 'CSV 与 JSON 互转，支持分隔符、表头与引号规则。',
    alias: ['csv', 'json', '表格', 'excel', '转换', 'tsv'],
    tags: ['表格预览']
  },
  {
    id: 't42', slug: 'sql-format', name: 'SQL 格式化', cat: 'format', icon: 'database',
    desc: '格式化、压缩与美化 SQL · 支持 MySQL / PostgreSQL / SQLite 方言',
    alias: ['sql', 'format', 'beautify', 'minify', 'mysql', 'postgres', 'postgresql', 'sqlite', '格式化', '压缩', '美化', '方言'],
    tags: ['多方言']
  },
  {
    id: 't43', slug: 'xml-toolbox', name: 'XML 工具箱', cat: 'format', icon: 'code-xml',
    desc: '格式化、压缩、XML ↔ JSON 转换与 XPath 查询',
    alias: ['xml', 'xpath', '节点', '格式化', '压缩', '转换', '查询', '文档'],
    tags: ['XPath 1.0']
  },
  {
    id: 't44', slug: 'jsonpath-query', name: 'JSONPath / JMESPath 查询', short: 'JSONPath 查询', cat: 'format', icon: 'list-filter',
    desc: '用 JSONPath 或 JMESPath 从 JSON 中提取数据，并导出匹配路径',
    alias: ['jsonpath', 'jmespath', 'query', 'filter', '查询', '过滤', '提取', '路径', '表达式'],
    tags: ['JSONPath / JMESPath']
  },
  {
    id: 't45', slug: 'json-schema', name: 'JSON Schema', cat: 'format', icon: 'file-code',
    desc: '从 JSON 生成 Schema，或用 Schema 校验 JSON 并定位错误路径',
    alias: ['json', 'schema', 'jsonschema', 'validate', '校验', '生成', 'draft', 'draft-07', '错误路径'],
    tags: ['Draft 2020-12']
  },
  {
    id: 't05', slug: 'base64', name: 'Base64 编解码', cat: 'text', icon: 'binary',
    desc: '文本与文件的 Base64 / Base64URL 编码和解码。',
    alias: ['base64', 'b64', 'base64url', '编码', '解码', 'encrypt64'],
    tags: ['支持文件']
  },
  {
    id: 't06', slug: 'url-encode', name: 'URL 编解码', cat: 'text', icon: 'link',
    desc: '完整 URI 与组件模式的 URL 编码和解码。',
    alias: ['url', 'uri', 'encode', 'decode', '百分号', '编码', '解码', 'urlencode'],
    tags: []
  },
  {
    id: 't07', slug: 'unicode-bytes', name: 'Unicode / 字节编码转换', cat: 'text', icon: 'languages',
    desc: 'Unicode 转义、UTF-8 文本与 Hex 字节互转，区分字符与字节。',
    alias: ['unicode', 'utf8', 'utf-8', 'hex', '字节', '编码', '转义', '\\u'],
    tags: ['字符与字节区分']
  },
  {
    id: 't08', slug: 'text-dedup', name: '文本去重与整理', cat: 'text', icon: 'list-checks',
    desc: '逐行去重、去除空行与整理排序，可选是否处理空格。',
    alias: ['去重', 'dedup', 'unique', '重复', '整理', '空行'],
    tags: []
  },
  {
    id: 't09', slug: 'case-convert', name: '命名风格转换', cat: 'text', icon: 'type',
    desc: 'camelCase、snake_case、kebab-case 等命名风格批量互转。',
    alias: ['命名', 'case', 'camel', 'snake', 'kebab', 'pascal', '大小写', '转换'],
    tags: ['批量处理']
  },
  {
    id: 't10', slug: 'text-diff', name: '文本差异比较', cat: 'text', icon: 'file-diff',
    desc: '逐行与行内差异比较，支持同步滚动与忽略空白。',
    alias: ['diff', '差异', '对比', '比较', '文本比较'],
    tags: ['行内差异']
  },
  {
    id: 't11', slug: 'regex-test', name: '正则表达式测试', cat: 'text', icon: 'regex',
    desc: 'JavaScript 正则匹配测试、捕获组与替换预览。',
    alias: ['regex', 'regexp', '正则', 'regular', 'expression', '匹配', '测试'],
    tags: ['JavaScript 引擎']
  },
  {
    id: 't12', slug: 'md5-sha', name: 'MD5 / SHA 摘要', cat: 'crypto', icon: 'hash',
    desc: '计算文本或文件的 MD5、SHA-256、SHA-512 摘要并对照期望值。',
    alias: ['md5', 'sha', 'sha256', 'sha512', '摘要', '哈希', 'hash', 'digest', '校验'],
    tags: ['支持文件']
  },
  {
    id: 't13', slug: 'hmac', name: 'HMAC 计算与校验', cat: 'crypto', icon: 'key-round',
    desc: 'HMAC-SHA256/SHA512 计算与期望值对照，密钥编码可选。',
    alias: ['hmac', '签名', 'mac', '密钥', 'sha256'],
    tags: []
  },
  {
    id: 't14', slug: 'aes', name: 'AES 加解密', cat: 'crypto', icon: 'lock',
    desc: 'AES-GCM 本地加解密，密钥与 IV 编码、AAD 与认证标签可配。',
    alias: ['aes', 'gcm', '加密', '解密', 'encrypt', 'decrypt', '对称'],
    tags: ['WebCrypto']
  },
  {
    id: 't15', slug: 'sm2', name: 'SM2 加解密与签名', cat: 'crypto', icon: 'shield',
    desc: '国密 SM2 加解密与签名验签，公私钥与密文格式可选。',
    alias: ['sm2', '国密', 'gm', '签名', '验签', '非对称', '加密', '解密'],
    tags: ['国密']
  },
  {
    id: 't16', slug: 'sm3', name: 'SM3 摘要', cat: 'crypto', icon: 'fingerprint',
    desc: '国密 SM3 摘要计算，支持文本与文件、Hex 与 Base64 输出。',
    alias: ['sm3', '国密', 'gm', '摘要', '哈希', 'hash'],
    tags: ['国密']
  },
  {
    id: 't17', slug: 'sm4', name: 'SM4 加解密', cat: 'crypto', icon: 'shield-check',
    desc: '国密 SM4 CBC/ECB 加解密，PKCS#7 与 NoPadding 可选。',
    alias: ['sm4', '国密', 'gm', '加密', '解密', 'cbc', 'ecb', '对称'],
    tags: ['国密']
  },
  {
    id: 't18', slug: 'timestamp', name: '时间戳转换', cat: 'time', icon: 'clock',
    desc: '秒/毫秒时间戳与可读时间双向转换，支持时区与 ISO8601。',
    alias: ['时间戳', 'timestamp', 'unix', 'epoch', '毫秒', '秒', '时间', 'iso8601'],
    tags: []
  },
  {
    id: 't19', slug: 'uuid', name: 'UUID 生成与解析', cat: 'time', icon: 'id-card',
    desc: '批量生成 UUID v4 / v7，解析版本与格式信息。',
    alias: ['uuid', 'guid', '生成', 'v4', 'v7', '唯一', '标识'],
    tags: ['v4 / v7']
  },
  {
    id: 't20', slug: 'cron', name: 'Cron 解析与执行预览', cat: 'time', icon: 'timer',
    desc: 'Unix 五字段与 Quartz 方言解析、字段解释与未来执行预览。',
    alias: ['cron', 'crontab', '定时', '任务', '调度', 'quartz', '表达式'],
    tags: ['Unix / Quartz']
  },
  {
    id: 't21', slug: 'date-diff', name: '日期时间差计算', cat: 'time', icon: 'calendar',
    desc: '计算两个时刻的实际经过时长与日历年月日差，支持跨时区。',
    alias: ['日期', '时间差', '相差', 'duration', '天数', '计算'],
    tags: []
  },
  {
    id: 't22', slug: 'json2java', name: 'JSON 转 Java 类', cat: 'java', icon: 'coffee',
    desc: '从 JSON 生成 POJO 或 record，支持 Lombok / Jackson 注解。',
    alias: ['java', 'pojo', 'record', '实体类', '生成', 'json', '类'],
    tags: ['POJO / record']
  },
  {
    id: 't23', slug: 'java-escape', name: 'Java 字符串转义', cat: 'java', icon: 'quote',
    desc: '原文与 Java 字符串字面量互转，处理引号、换行与反斜杠。',
    alias: ['java', '转义', 'escape', 'unescape', '字符串', '字面量'],
    tags: []
  },
  {
    id: 't24', slug: 'properties-yaml', name: 'Properties / YAML 转换', cat: 'java', icon: 'file-cog',
    desc: 'properties 与 YAML 配置互转，处理 Unicode 转义与点路径嵌套。',
    alias: ['properties', 'yaml', 'yml', '配置', 'spring', '转换', 'boot'],
    tags: []
  },
  {
    id: 't25', slug: 'stack-trace', name: 'Java 异常堆栈整理', cat: 'java', icon: 'bug',
    desc: '解析异常链与 Caused by，折叠框架调用、突出业务包。',
    alias: ['异常', '堆栈', 'stacktrace', 'exception', '日志', 'caused by'],
    tags: []
  },
  {
    id: 't26', slug: 'maven-gradle', name: 'Maven / Gradle 依赖转换', cat: 'java', icon: 'package',
    desc: 'Maven XML 与 Gradle Groovy / Kotlin 依赖声明互转。',
    alias: ['maven', 'gradle', '依赖', 'dependency', 'pom', 'kts', '转换'],
    tags: []
  },
  {
    id: 't27', slug: 'json2ts', name: 'JSON 转 TypeScript 类型', cat: 'web', icon: 'file-type',
    desc: '从 JSON 推断生成 TypeScript interface / type 定义。',
    alias: ['typescript', 'ts', 'interface', 'type', '类型', 'json', '前端'],
    tags: []
  },
  {
    id: 't28', slug: 'vue-sfc', name: 'Vue 单文件组件模板', cat: 'web', icon: 'component',
    desc: '按表单配置生成 .vue 单文件组件模板源码。',
    alias: ['vue', 'sfc', '组件', 'component', '模板', 'template', 'setup'],
    tags: ['Composition API']
  },
  {
    id: 't29', slug: 'css-units', name: 'CSS 单位换算', cat: 'web', icon: 'ruler',
    desc: 'px / rem / em 互转，根字号与父字号分别可设。',
    alias: ['css', 'px', 'rem', 'em', '单位', '换算', '像素'],
    tags: []
  },
  {
    id: 't30', slug: 'color', name: '颜色转换与对比度', cat: 'web', icon: 'palette',
    desc: 'HEX / RGB / HSL 转换与前景背景对比度等级计算。',
    alias: ['颜色', 'color', 'hex', 'rgb', 'hsl', '对比度', 'contrast', '取色'],
    tags: ['对比度等级']
  },
  {
    id: 't31', slug: 'svg', name: 'SVG 预览与优化', cat: 'web', icon: 'svg',
    desc: 'SVG 源码安全预览、体积优化与前后差异对比。',
    alias: ['svg', '矢量', '图标', 'icon', '预览', '优化', 'minify'],
    tags: ['安全预览']
  },
  {
    id: 't32', slug: 'html-format', name: 'HTML / CSS / JS 格式化', cat: 'web', icon: 'code-2',
    desc: 'HTML、CSS、JavaScript 源码格式化与缩进配置。',
    alias: ['html', 'css', 'js', 'javascript', '格式化', 'format', 'beautify', '美化'],
    tags: []
  },
  {
    id: 't33', slug: 'jwt', name: 'JWT 解析与验签', cat: 'api', icon: 'key',
    desc: '解码 JWT Header / Payload 并本地验签，解释时间字段。',
    alias: ['jwt', 'token', 'json web token', '令牌', '验签', '解码', 'auth'],
    tags: ['本地验签']
  },
  {
    id: 't34', slug: 'url-params', name: 'URL 参数编辑', cat: 'api', icon: 'url',
    desc: '结构化编辑 URL 的 query 参数，支持重复键与编码预览。',
    alias: ['url', 'query', '参数', 'parameter', '编辑', '链接'],
    tags: []
  },
  {
    id: 't35', slug: 'curl-convert', name: 'curl / fetch / Axios 转换', cat: 'api', icon: 'terminal',
    desc: 'curl、fetch、Axios 请求代码互转，仅转换不执行。',
    alias: ['curl', 'fetch', 'axios', '请求', 'request', 'http', '转换', '命令'],
    tags: []
  },
  {
    id: 't36', slug: 'http-status', name: 'HTTP 状态码速查', cat: 'api', icon: 'activity',
    desc: 'HTTP 状态码分类速查，含用途说明与相近状态区别。',
    alias: ['http', '状态码', 'status', 'code', '404', '500', '速查'],
    tags: ['离线知识']
  },
  {
    id: 't37', slug: 'file-digest', name: '文件摘要与批量校验', cat: 'file', icon: 'file-check',
    desc: '多文件摘要计算与期望值批量校验，支持导出清单。',
    alias: ['文件', '摘要', '校验', 'md5', 'sha256', '批量', 'hash', 'checksum'],
    tags: ['多文件']
  },
  {
    id: 't38', slug: 'image-compress', name: '图片压缩与格式转换', cat: 'file', icon: 'image',
    desc: '本地压缩图片并转换格式，支持质量与尺寸约束。',
    alias: ['图片', '压缩', 'image', 'webp', 'jpeg', 'png', '转换', '转webp'],
    tags: ['本地处理']
  },
  {
    id: 't39', slug: 'qrcode', name: '二维码生成与识别', cat: 'file', icon: 'qr-code',
    desc: '文本或 URL 生成二维码 PNG / SVG，本地识别图片中的二维码。',
    alias: ['二维码', 'qrcode', 'qr', '生成', '识别', '扫码'],
    tags: ['生成 / 识别']
  },
  {
    id: 't40', slug: 'text-encoding', name: '文本文件编码转换', cat: 'file', icon: 'file-text',
    desc: '文本文件编码识别与转换，UTF-8 BOM 与换行符处理。',
    alias: ['编码', 'encoding', 'gbk', 'utf8', 'bom', '换行', 'crlf', 'lf'],
    tags: []
  },
  {
    id: 't41', slug: 'file-base64', name: '文件 / Base64 转换', cat: 'file', icon: 'file-binary',
    desc: '文件转 Base64 / Data URL，或反向导出为文件。',
    alias: ['base64', 'data url', '文件', 'file', '转换', '内嵌'],
    tags: []
  }
]

export const toolCount = tools.length

export function getTool(slug: string): ToolMeta | undefined {
  return tools.find((t) => t.slug === slug)
}

export function getToolById(id: string): ToolMeta | undefined {
  return tools.find((t) => t.id === id)
}

export function getCategory(key: CategoryKey): CategoryMeta {
  return categories.find((c) => c.key === key)!
}

export function toolsOfCategory(key: CategoryKey): ToolMeta[] {
  return tools.filter((t) => t.cat === key)
}

/** 全局搜索：匹配名称、别名、分类，大小写不敏感 */
export function searchTools(query: string): ToolMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { t: ToolMeta; s: number }[] = []
  for (const t of tools) {
    const name = t.name.toLowerCase()
    let s = 0
    if (name === q) s = 100
    else if (name.startsWith(q)) s = 80
    else if (name.includes(q)) s = 60
    else if (t.alias.some((a) => a.toLowerCase() === q)) s = 70
    else if (t.alias.some((a) => a.toLowerCase().startsWith(q))) s = 50
    else if (t.alias.some((a) => a.toLowerCase().includes(q))) s = 40
    else if (t.tags.some((a) => a.toLowerCase().includes(q))) s = 20
    if (s > 0) scored.push({ t, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.map((x) => x.t)
}
