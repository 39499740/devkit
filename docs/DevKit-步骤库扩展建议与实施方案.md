# DevKit 步骤库扩展建议与实施方案

## 结论

当前步骤库只有 8 种，已经能真实运行同步文本流水线，但还不适合直接把 45 个工具全部步骤化。

按新的优先级，建议将近期目标定为 **8 → 24 种步骤**：

1. 先改造运行器和本地存储，支持异步执行、密钥字段和风险确认。
2. 第一批优先加入 6 种摘要与加解密步骤。
3. 第二批加入 10 种高组合价值的数据转换步骤。

加解密步骤允许把密钥、私钥、IV 等敏感配置保存到 localStorage，但必须在添加步骤前明确告知风险；用户主动勾选确认后才能继续。运行输入、中间结果和输出仍只保存在当前页面内存中，不上传服务器。

---

## 一 当前状态

本地页面已经验证步骤库显示 8 项，并实际运行了以下流程：

```text
Base64 解码 → JSON 格式化 → JSONPath 提取 → JSON 转 Java
```

4 个节点全部成功，页面能够展示每一步的输出体积、耗时和日志。现有流程不是静态设计，而是可以工作的同步文本流水线。

现有步骤如下：

| 步骤 | 类别 | 输入输出 |
| --- | --- | --- |
| Base64 解码 | 编码与文本 | 文本 → 文本 |
| JSON 格式化 | 数据格式 | JSON 文本 → JSON 文本 |
| JSONPath 提取 | 数据格式 | JSON 文本 → JSON 文本 |
| JSON 转 Java | Java 开发 | JSON 文本 → Java 代码 |
| JSON Schema 校验 | 数据格式 | JSON 文本 → 原输入，并给出校验状态 |
| URL 解码 | 编码与文本 | 编码文本 → 文本 |
| JSON / YAML 转换 | 数据格式 | 文本 → 文本 |
| 下载结果 | 文件与图片 | 不改变内容，只记录下载文件名 |

### 现有实现限制

- `app/utils/workflow.ts` 同时维护步骤类型、步骤目录和大 `switch`，继续扩展会成为高冲突文件。
- `StepConfigField` 只有 `key`、`label`、`placeholder`，页面只能渲染单行文本框。
- `runStep` 和 `runWorkflow` 是同步函数，AES、HMAC 等 Web Crypto 能力无法直接接入。
- 步骤之间只传 `string`，没有 `text`、`json`、`bytes`、`image` 等类型契约。
- `useWorkflows.ts` 当前只使用内存状态，刷新后恢复默认流程；这与“密钥保存到 localStorage”的新需求不同。
- 页面现在写着“不写入磁盘、刷新即清除”。加入本地持久化密钥后，这些文案必须同步修改，不能继续保留。

---

## 二 第一优先级 加入摘要与加解密步骤

第一批建议增加 6 种，使步骤库从 8 种增加到 14 种。

| 新增步骤 | 主要模式 | 敏感字段 | 复用来源 |
| --- | --- | --- | --- |
| MD5 / SHA 摘要 | MD5、SHA-256、SHA-512；计算或对照 | 无 | `t12-md5-sha.vue` |
| HMAC 计算与校验 | SHA-256、SHA-512；计算或校验 | 密钥 | `t13-hmac.vue` |
| AES-GCM 加解密 | 加密、解密；128/192/256 位；AAD、Tag | 密钥、IV、AAD | `t14-aes.vue` |
| SM2 加解密与签名 | 加密、解密、签名、验签 | 私钥、公钥、User ID | `t15-sm2.vue` |
| SM3 摘要 | UTF-8 或 Hex 输入；Hex 或 Base64 输出 | 无 | `t16-sm3.vue` |
| SM4 加解密 | CBC、ECB；PKCS#7 或无填充 | 密钥、IV | `t17-sm4.vue` |

推荐步骤类型：

```ts
type StepType =
  | ExistingStepType
  | 'digest'
  | 'hmac'
  | 'aes-gcm'
  | 'sm2'
  | 'sm3'
  | 'sm4'
```

方向或操作方式放在 `config` 里，不建议把 AES 加密、AES 解密拆成两个目录项。这样步骤库不会因为同一种算法的不同模式快速膨胀。

### 为什么加解密必须先改运行器

- AES-GCM 和 HMAC 使用 Web Crypto，是异步操作。
- SM2、SM3、SM4 当前算法主要写在 Vue 组件内部，需要先抽成共享函数。
- 加解密步骤包含密钥、私钥、IV 等敏感配置，需要独立的字段类型和存储策略。
- 解密失败、认证标签错误、密钥长度错误不能只返回空字符串，必须给出明确失败状态。

---

## 三 添加加解密步骤前的风险确认

### 交互原则

用户点击添加 HMAC、AES、SM2 或 SM4 步骤时，不立即加入步骤链，先显示风险确认弹窗。

建议文案：

> 此步骤包含密钥或私钥配置。填写后，这些敏感信息会以明文形式保存到当前网站的 localStorage，关闭浏览器或刷新页面后仍可能保留。任何能够访问本浏览器配置、同源页面脚本或浏览器扩展的程序，都可能读取这些信息。请勿在共享电脑、公共电脑或不受信任的浏览器环境中保存生产密钥。

用户必须勾选：

> 我已了解上述风险，并同意将此步骤的密钥配置保存到本机浏览器 localStorage。

按钮状态：

- 未勾选：`仍不添加` 可点击，`我已知晓并添加` 禁用。
- 已勾选：`我已知晓并添加` 才可点击。
- 用户取消或关闭弹窗：不添加步骤，不创建密钥记录。

### 哪些操作必须触发确认

- 从步骤库添加 HMAC、AES、SM2、SM4。
- 导入包含以上步骤的流程。
- 复制一个包含敏感字段的步骤。
- 从其他工具通过“发送到 → 新建流程”自动追加加解密步骤。

MD5/SHA 和 SM3 没有密钥，不需要风险确认。

### 确认记录

每个敏感步骤保存自己的确认时间，不使用一个永久的全局开关绕过后续提示。

```ts
interface SecretConsent {
  accepted: true
  acceptedAt: number
  noticeVersion: 1
}
```

风险文案发生实质变化时提升 `noticeVersion`，旧确认失效，用户需要重新确认。

---

## 四 localStorage 存储方案

### 存储边界

| 数据 | 是否进入 localStorage | 说明 |
| --- | --- | --- |
| 流程名称、描述、步骤顺序 | 是 | 让自定义流程和步骤配置刷新后仍存在 |
| 非敏感步骤参数 | 是 | 例如缩进、算法、输出编码、方向 |
| 密钥、私钥、IV、AAD | 是 | 用户确认风险后保存；明文存储 |
| 公钥 | 是 | 与同一步骤配置一起保存 |
| 流程输入 | 否 | 只在当前页面内存存在 |
| 每步输出、中间结果、运行日志 | 否 | 刷新或离开页面后清除 |
| 最近运行记录 | 可选 | 只能存状态、耗时和步骤摘要，不得包含输入、输出或密钥 |

### 不把密钥直接放进普通步骤配置

普通流程和敏感数据分开存储。步骤配置只保留 `secretRef`，避免流程导出、日志和调试信息误带出密钥。

```ts
interface WorkflowStep {
  id: string
  type: StepType
  config: Record<string, string | boolean>
  secretRef?: string
  consent?: SecretConsent
}

interface StoredSecret {
  id: string
  workflowId: string
  stepId: string
  fields: Record<string, string>
  createdAt: number
  updatedAt: number
}
```

建议存储键：

```text
devkit-workflows-v2
devkit-workflow-secrets-v1
devkit-workflow-runs-v1
```

### 必须明确的安全事实

- localStorage 不是密钥保险箱，默认没有加密保护。
- 同源脚本可以读取 localStorage；发生 XSS 时密钥可能泄露。
- 浏览器扩展、共享浏览器配置、设备备份或调试工具可能暴露密钥。
- “仅本地存储”不等于“安全存储”。页面不得暗示密钥被系统钥匙串保护。
- 不上传服务器的承诺仍然成立，但“不写入磁盘”和“刷新即清除”不再适用于流程配置及密钥。

### 页面隐私文案需要修改

原文：

```text
数据仅在本次页面内存中传递，离开即清除
不写入磁盘 · 不发送到服务器
```

建议改为：

```text
运行输入和中间结果仅在本次页面内存中传递，不发送到服务器。
流程配置会保存到本机浏览器；加解密步骤中的密钥仅在你确认风险后保存到 localStorage。
```

同时更新流程列表页、编排页、隐私说明页、导入流程弹窗和设置页的数据清理说明。

---

## 五 密钥字段的界面和生命周期

### 字段表现

- 默认使用密码输入框，不直接显示完整内容。
- 提供“按住查看”，松开后立即恢复掩码。
- 禁止把密钥写入 Toast、运行日志、错误栈、分析事件和 URL。
- 页面显示 `含本地持久化密钥` 标识。
- 显示“上次修改时间”，不显示密钥摘要，避免让用户误以为摘要可以证明密钥未泄露。

### 删除行为

- 删除加解密步骤：同步删除该步骤对应的 `StoredSecret`。
- 删除流程：删除该流程下的全部秘密记录。
- 清空所有流程：同时清空 `devkit-workflows-v2` 和 `devkit-workflow-secrets-v1`。
- 设置页增加单独的“清空已保存密钥”按钮。
- 清空密钥后保留步骤，但将步骤标记为“缺少密钥”，下次运行前要求重新填写。

### 导入和导出

- 默认导出流程时不包含密钥、私钥、IV、AAD。
- 导出的步骤只保留算法、方向、编码等非敏感参数，并标记 `requiresSecret: true`。
- 导入含敏感步骤的流程时，先显示风险确认；确认后导入空的密钥字段。
- 第一版不提供“导出密钥”功能，避免把密钥混入可分享的流程 JSON。

```json
{
  "version": 2,
  "name": "AES 解密后解析 JSON",
  "steps": [
    {
      "type": "aes-gcm",
      "config": {
        "operation": "decrypt",
        "keyBits": 256,
        "inputEncoding": "base64"
      },
      "requiresSecret": true
    },
    {
      "type": "json-format",
      "config": { "indent": 2 }
    }
  ]
}
```

---

## 六 代码改造方案

### 1 拆分步骤目录和执行器

保留 `app/utils/workflow.ts` 作为兼容入口，内部拆为：

```text
app/workflow/types.ts                 数据类型和运行结果
app/workflow/catalog.ts               步骤名称、分类、字段和兼容类型
app/workflow/runner.ts                顺序执行、中断、日志和耗时
app/workflow/storage.ts               流程持久化和版本迁移
app/workflow/secrets.ts               密钥读写、删除和脱敏
app/workflow/executors/*.ts           每种步骤的执行器
app/utils/crypto/*.ts                 工具页和步骤共用的加解密函数
```

工具页面和流程步骤必须调用同一个算法函数，不能在 `workflow.ts` 中复制一份简化实现。

### 2 扩展字段定义

```ts
type FieldControl = 'text' | 'select' | 'switch' | 'textarea' | 'secret'

interface StepConfigField {
  key: string
  label: string
  control: FieldControl
  default?: string | boolean
  required?: boolean
  sensitive?: boolean
  options?: Array<{ value: string; label: string }>
}
```

`secret` 字段只从独立的秘密存储读取，不进入普通 `config`。

### 3 运行器改为异步

```ts
type StepExecutor = (
  input: StepPayload,
  config: StepConfig,
  secrets: Record<string, string>
) => Promise<ExecutorResult>

const executors: Record<StepType, StepExecutor> = {
  digest: runDigest,
  hmac: runHmac,
  'aes-gcm': runAesGcm,
  sm2: runSm2,
  sm3: runSm3,
  sm4: runSm4
}
```

`runStep` 只负责读取执行器、加载秘密、计时、错误转换和生成脱敏日志。

### 4 流程持久化

`useWorkflows.ts` 增加客户端 hydration 和持久化：

1. SSR 或首次渲染使用默认流程，避免直接访问 `window`。
2. 客户端挂载后读取 `devkit-workflows-v2`。
3. 校验版本和数据结构后替换状态。
4. 状态变更后节流写入 localStorage。
5. 写入失败、配额超限或 JSON 损坏时给出明确提示，不得静默丢流程或显示假成功。

### 5 风险确认状态机

```text
点击敏感步骤
  → 打开风险弹窗
  → 未勾选：不能添加
  → 已勾选：创建 stepId 和 consent
  → 添加空密钥步骤
  → 用户填写密钥
  → 保存到 devkit-workflow-secrets-v1
```

重复步骤、导入流程和“发送到流程”必须复用同一个确认入口，不能各写一套绕过逻辑。

---

## 七 加解密步骤的最小验收

| 步骤 | 必测内容 |
| --- | --- |
| MD5 / SHA | UTF-8、Hex、空文本、三种算法、Hex/Base64、期望值相符与不符 |
| HMAC | SHA-256、SHA-512、UTF-8/Hex 密钥、Hex/Base64 输出、错误密钥 |
| AES-GCM | 128/192/256 位、随机和手填 IV、AAD、96/112/128 位 Tag、错误 Tag、错误密钥 |
| SM2 | C1C3C2/C1C2C3、Hex/Base64、加解密、签名验签、RAW/DER、User ID |
| SM3 | UTF-8、Hex、Hex/Base64 输出、期望值校验 |
| SM4 | CBC/ECB、PKCS#7/无填充、UTF-8/Hex/Base64、错误密钥或 IV |

算法测试使用官方或公开标准测试向量，不能只验证“加密后再用自己解密能成功”。

### 风险确认和存储回归

- 未勾选风险确认时无法添加敏感步骤。
- 取消弹窗后步骤数和 localStorage 都不变化。
- 确认后可以添加，且保存 `acceptedAt` 和 `noticeVersion`。
- 密钥刷新页面后仍能恢复。
- 删除步骤、删除流程、清空密钥都会清除对应秘密记录。
- 导出流程不包含密钥、私钥、IV 和 AAD。
- 日志、Toast、错误对象、分析事件和 URL 中不出现密钥。
- localStorage JSON 损坏时不崩页，并提示用户清理或恢复。
- 配额超限时明确提示“密钥未保存”，不能显示假成功。
- 从旧版内存流程迁移时，不生成假的风险确认记录。

---

## 八 第二优先级 数据转换步骤

加解密 6 种上线后，再加入以下 10 种，使步骤库从 14 种增加到 24 种。

| 新增步骤 | 典型参数 | 复用来源 |
| --- | --- | --- |
| Base64 编码 | 字符集、Base64URL | t05 |
| URL 编码 | URI 或组件模式 | t06 |
| JSON 压缩 | 压缩或格式化、缩进 | t01 |
| JMESPath 提取 | 表达式 | t44、`utils/jmespath.ts` |
| JSON Schema 生成 | Draft、严格模式 | t45、`utils/jsonschema.ts` |
| CSV / JSON 转换 | 方向、分隔符、表头、类型推断 | t04 |
| 文本去重整理 | 去空行、Trim、排序、大小写 | t08 |
| 正则提取替换 | 表达式、flags、模式、replacement | t11 |
| SQL 格式化压缩 | 方言、模式、缩进、关键字大小写 | t42、`utils/sql.ts` |
| XML 处理 | 格式化、压缩、XML/JSON、XPath | t43、`utils/xml.ts` |

后续再根据真实使用情况考虑 JSON 转 TypeScript、Java 字符串转义、Properties/YAML、请求代码转换等步骤。

---

## 九 暂缓加入的工具

| 工具类型 | 暂缓原因 | 前置能力 |
| --- | --- | --- |
| JSON 差异、文本差异 | 需要两个独立输入 | 命名输入、变量引用或第二输入端口 |
| 文件摘要、文件 Base64、文件编码 | 当前只传字符串，文件名、MIME、原始字节会丢失 | `bytes` payload、文件元数据、异步读取 |
| 图片压缩、二维码生成识别 | 输出是 Blob 或图片，不是文本 | `image` payload、预览、下载和内存释放 |
| Cron、日期差、颜色对比、HTTP 状态码 | 更像查询或多输入计算，线性变换收益低 | 变量、多输入或专用参数节点 |
| Vue 模板、UUID 生成器 | 可以没有上游输入，现有流程把空输入视为不可运行 | source step 和允许空输入的节点语义 |

---

## 十 推荐实施顺序

### 批次 A 存储和执行框架

- 拆出 `catalog`、`executors`、`runner`、`storage`、`secrets`。
- 将运行器改为 `async`。
- 增加 `secret` 字段、风险确认弹窗和 localStorage 持久化。
- 保持现有 8 个步骤行为不变，原有流程测试全部继续通过。

### 批次 B 摘要与加解密

- MD5/SHA、HMAC、AES-GCM、SM2、SM3、SM4。
- 完成密钥保存、清理、脱敏和不随流程导出的回归测试。
- 步骤库达到 14 种。

### 批次 C 数据处理

- Base64 编码、URL 编码、JSON 压缩、JMESPath、Schema 生成。
- SQL、XML、CSV/JSON、文本去重、正则提取替换。
- 步骤库达到 24 种。

### 批次 D 后续能力

- 根据真实流程使用情况决定是否建设多输入、`bytes`、`image` 和 source step。
- 不以“把所有工具都加入”为目标。

---

## 十一 建议新增的预设流程

| 流程名 | 步骤链 | 用途 |
| --- | --- | --- |
| AES 响应解密 | Base64 解码 → AES-GCM 解密 → JSON 格式化 | 解密接口响应并查看结构 |
| 国密报文处理 | SM4 解密 → SM3 摘要 → JSON 格式化 | 处理国密接口报文 |
| 请求签名生成 | JSON 压缩 → HMAC → Base64 编码 | 生成接口请求签名 |
| SM2 签名验证 | URL 解码 → SM2 验签 → 下载结果 | 验证签名并保留结果 |
| CSV 接口数据清洗 | CSV→JSON → JMESPath → JSON 格式化 → 下载 | 从表格筛选字段并生成接口数据 |
| XML 接口数据转换 | XML→JSON → JSON Schema 生成 → 下载 | 把 XML 响应转为结构化契约 |

---

## 十二 成功标准

- 用户未确认风险时，任何入口都不能添加或导入敏感步骤。
- 页面准确说明密钥会以明文保存到 localStorage，不使用“安全保存”等误导性文案。
- 密钥可以持久化，也可以按步骤、流程或全局彻底清除。
- 密钥不会进入流程导出、日志、Toast、分析事件、URL 或剪贴板操作。
- 加解密步骤使用标准测试向量验证，不把自我往返测试当作唯一证据。
- 运行输入和中间结果仍不持久化、不上传。
- 第一阶段步骤库达到 14 种，第二阶段达到 24 种，并至少提供 4 条真实可运行的加解密预设流程。

---

## 十三 实施记录（2026-09-22）

批次 A / B / C 全部落地：步骤库 **8 → 24 种**，密钥、风险确认与持久化按本文档的方案实现，并有真实测试证据。

### 交付物
- 代码结构：`app/workflow/`（types / catalog / runner / storage / secrets / presets / selection / executors{index,text,crypto}）+ `app/utils/crypto/`（encoding / digest / hmac / aesgcm / sm3 / sm4 / sm2）+ 兼容入口 `app/utils/workflow.ts`。
- 工具页与流程步骤共用同一份实现：`utils/crypto/*`（t12–t17）、`utils/csv.ts`（t04）、`utils/text.ts`（t08）、`utils/regex.ts`（t11，`execRegex` 自包含以便 `toString()` 注入 Worker）。
- 存储键：`devkit-workflows-v2`（流程 + 非敏感参数）、`devkit-workflow-secrets-v1`（密钥 / 私钥 / IV / AAD，明文）、`devkit-workflow-runs-v1`（仅状态、耗时、步骤摘要）。
- 风险确认：`useSecretConsent()` + `DkRiskConsent.vue` 是唯一入口——步骤库添加、复制步骤、导入流程、预设流程、「发送到 → 新建流程」全部经过它，`noticeVersion = 1`。
- 预设流程 6 条（其中 4 条含密钥），全部在测试里端到端执行。

### 与本文档的偏差（实测后必要的修正）
1. **「国密报文处理」顺序改为 SM4 解密 → JSON 格式化 → SM3 摘要**：SM3 输出是摘要文本而不是 JSON，按原文顺序第三步必然失败。
2. **JMESPath 步骤表达式以 `@` 起头**：本仓库的 JMESPath 子集不支持裸 `[*]`，顶层数组要写 `@[*].name`（已写进步骤参数的 help）。
3. **步骤间载荷扩为 `{ kind, text, bytes? }`**：加解密需要二进制链路（如「Base64 解码 → AES-GCM 解密」），只传字符串会让二进制中间结果卡在 UTF-8 解码上。
4. **新增 `inputEncoding: auto` 语义**：上一步输出二进制时直接取其字节，否则按 UTF-8 文本；手动粘贴 Hex / Base64 必须显式选编码（写在字段 help 里）。
5. **`npm run typecheck` 改为 `node scripts/typecheck.mjs`（口径修正见复核记录）**：Nuxt 4.5 会无条件往生成的 tsconfig 写入 `vueCompilerOptions.plugins = ['vue-router/volar/sfc-route-blocks']`，而本机 vue-router 4.6 已不再导出该子路径，vue-tsc 每次都会打印 `[Vue] Resolve plugin path failed` 与 ERR_PACKAGE_PATH_NOT_EXPORTED 堆栈。**实测该解析失败在本机是非致命告警**：`npx nuxt typecheck` 与直接 `npx vue-tsc -b --noEmit` 都不会因此改变退出码（干净代码 exit 0，注入类型错误 exit 2），不存在「必崩」。脚本的价值是**消除告警噪音**——在 `nuxt prepare` 之后清空该插件列表再跑 `vue-tsc -b --noEmit`，输出里只剩真实类型错误；vue-router 恢复导出该子路径后可整体删除。

### 验收证据（2026-09-22）
- `npm run typecheck` exit 0；`npm run generate` 预渲染 134 条路由成功。
- `npm test` **293/293**（新增 crypto 43、workflow-storage 60、workflow 82）；`npm run test:dom` **55/55**（含 XML 步骤与 `regexWorkerSource()` 在真实 Worker 里的执行）。
- 加解密对照公开标准向量：NIST / McGrew-Viega AES-GCM 4 组、RFC 4231 HMAC、GB/T 32905 SM3、GB/T 32907 SM4；期望值另用 `node:crypto` 独立复核，不以自我往返为唯一证据。
- 自动化浏览器用例（可复算）：`tests/workflow.browser.mjs` 13 条在真实 Chromium（ego-browser）里执行流程编排与 XML 步骤，含 `regexWorkerSource()` 在真 Worker 中运行。
- 手工浏览器实测（ego-browser，390 / 1280 双视口，**无自动化留档**）：未勾选风险确认时无法添加、取消后步骤数与 localStorage 都不变；确认后写入 `acceptedAt` 与 `noticeVersion`；密钥刷新后恢复（掩码显示 + 上次修改时间）；「运行全部」在真实输入下端到端跑通，缺 IV 的 AES 步骤给出可读失败说明。

### 复核记录（2026-09-22，独立复算）

- `npm test` 293/293、`npm run test:dom` 55/55、`npm run typecheck` exit 0、`npm run generate` 134 路由，全部原样复现。
- 加解密不采信仓库自证：把 `app/utils/crypto/*` 与 `node:crypto` 做随机输入差分（MD5 / SHA-256 / SHA-512、HMAC-SHA256/512、AES-GCM 128/192/256 × tag 96/112/128、SM4 ECB/CBC PKCS#7）共 148 项全一致；SM2 的固定密钥对 / 签名 / 密文另用 OpenSSL 3.6 独立验证（私钥推导公钥一致、验签 `Verified OK`、篡改报文失败、密文解出原文）；SM3 对照 GB/T 32905 标准向量。
- 类型检查有效性：临时注入一个类型错误文件后重跑 `npm run typecheck` 得到 exit 2 并报出该文件，确认该门禁不是空跑。
- 导出与密钥边界：`sanitizeStep` / `exportWorkflow` 按 `f.sensitive` 剔除敏感字段，`useWorkflows.addStep` 再校验 `isCurrentConsent`（UI 漏判也加不进去），「发送到 → 新建流程」对敏感步骤只带输入、不自动加步骤。
- 线上状态：`www.t502.fun` 的 `/privacy/` 无本次新增文案（「处理流程的数据边界」「localStorage 不是密钥保险箱」），`/workflows/index.html` 与本地 `.output/public` 的 sha256 不一致 → 线上仍是 `03a6e63` 的 8 步版本。
- 交付文件计数订正：本轮为 **19 个已跟踪文件改动 + 29 个新代码/测试/脚本文件**（另有 1 个未跟踪的方案文档即本文件），不是「12 个新文件」。
- 既有测试断言 `stepLibrary.length === 24` 与字段 `control` 白名单，新增步骤时 catalog / executors 任一遗漏都会被这条用例挡住。

