# DevKit 审核报告 #4 · 工具 T27–T41（Web / Vue / 接口 / 文件）

审核范围：T27–T41 共 15 个工具页的设计还原、功能正确性、代码缺陷。
基准站点：http://localhost:3000（SSR，单元/交互测试用 Playwright 驱动真实页面；纯计算用 node 复算）。
设计稿：`design.pen` 节点（T27–T41 主画板 + 必画变体，共 52 个画板，见文末清单）。

---

## 结论摘要

- 15 个工具页全部存在、可访问、无 console error / pageerror（实测 `/tools/{slug}` 均 200，控制台干净）。整体“需求项→实现”覆盖率约 **80%**；设计主画板的“参数面板完整度”覆盖较低（T27/T29/T30/T31/T32/T34/T35 均有整块控件缺失），必画变体基本都能复现（T31 视觉变化、T40 目标编码无法表示、T38 格式不支持三个变体实际不可达）。
- 最严重问题（按严重度）：
  1. **【高】T35 生成的 fetch / Axios 代码是语法错误**：header 名含 `-`（如 `Content-Type`）时未加引号。`node --check` 实测 `SyntaxError: Unexpected token '-'`。根因是 `SAFE_KEY` 正则把 `-` 也算作“安全标识符”（`t35-curl-convert.vue:229`）。
  2. **【高】T33 “被篡改签名”示例并未真正篡改**：示例只改了签名段最后一个 base64url 字符 `Y→Z`，该字符的低 2 位是被丢弃的填充位，解码后字节与正确签名完全相同。实测点击“示例：被篡改签名”再验签，页面显示“**签名验证通过（HS256）**”，与本工具文案“验签必然失败”和设计变体“签名不通过”直接矛盾（`t33-jwt.vue:13`）。
  3. **【中】T33 验签结论不随 Token 变化清除**：验签通过后修改/替换 Token，绿色“签名验证通过（HS256）”仍然保留（`t33-jwt.vue:106-146` 的 `decode()` 未重置 `verifyResult`）。
  4. **【中】T27 与设计推断规则不一致 + 策略控件大面积缺失**：设计主画板/变体要求 `null → unknown`、`{} → Record<string, unknown>`，实现输出 `null` 与空 `interface Meta {}`；并缺少“日期字段 / 空数组策略 / 空对象策略 / 数组联合类型 / 调整字段类型”等 5 组控件（`t27-json2ts.vue:111-114, 167-168, 270-303`）。
  5. **【中】T28 缺少设计主画板必需的“静态模板预览”**：右栏只有源码编辑器，没有只读的静态模板渲染区（`t28-vue-sfc.vue:370-394`），而需求原文明确要求“静态模板预览”。

---

## 覆盖对照表（每工具一行）

| 工具 | 页面 | 主画板控件覆盖 | 必画变体覆盖 | 关键缺口 / 证据 |
|---|---|---|---|---|
| T27 JSON→TS | `/tools/json2ts` | 部分（约 55%） | 空数组 ✅ / 联合类型 ✅ | 缺 日期字段/空数组策略/空对象策略/数组联合策略/调整字段类型/导入文件；`null→null`（设计为 `unknown`）、`{}→空 interface`（设计为 `Record<string,unknown>`）。`t27-json2ts.vue:270-303`；实测输出见下 |
| T28 Vue SFC | `/tools/vue-sfc` | 部分（约 75%） | props/emits ✅ / 名称非法 ✅ | **缺静态模板预览**；组件名规则允许 `_` 与小写首字母（设计要求 PascalCase、不允许下划线）；无“建议名称”。`t28-vue-sfc.vue:47-57, 370-394` |
| T29 CSS 单位 | `/tools/css-units` | 部分（约 65%） | 批量值 ✅ / 基准非法 ✅ | 缺 小数位(2/3/4)/小数处理/零值单位/逐行勾选/复制表格/导入文件；“只改用户选择的值”被实现为“只转某一源单位”，与设计“按行勾选”语义不同。`t29-css-units.vue:105-119` |
| T30 颜色对比度 | `/tools/color` | 部分（约 75%） | 透明 ✅ / 低对比 ✅ / 无效 ✅ | 缺 输入格式选择/“复制全部格式”/建议替代色/“恢复上一个有效色”。对比度公式独立复算一致（5.17 / 2.85 / 2.54 / alpha 合成 3.95） |
| T31 SVG | `/tools/svg` | 部分（约 60%） | 不安全：行为不同 / 视觉提示：不可达 | 实现“剥离后仍预览”，设计为“**阻断预览，仅查看源码**”；无 保留 viewBox / 小数位(取整) 选项，无 标签数/空白统计；“优化改变视觉”变体（坐标取整、合并空 `<g>`）不可能触发。`t31-svg.vue:20-24, 45-77, 147-151` |
| T32 HTML/CSS/JS 格式化 | `/tools/html-format` | 部分（约 60%） | HTML/CSS/JS/语法错误 ✅ | 缺 换行/属性换行/保留空行 选项、导入文件；无真实解析器（自实现状态机，见“存疑项”）。三种语言 + 错误定位实测正确（含 `"}"`、`url("a}b")`、模板串、正则） |
| T33 JWT | `/tools/jwt` | 部分（约 80%） | 仅解码 ✅ / 签名不通过 ⚠️（示例假） / 过期但有效 ⚠️（无合并结论） / 格式错误 ✅ | 验签面板默认折叠；**篡改示例验签通过（高）**；无 RS256/ES256（明确提示不支持）；过期与签名无合并结论。`t33-jwt.vue:13, 182, 207-210, 228-249` |
| T34 URL 参数 | `/tools/url-params` | 部分（约 65%） | 重复参数 ✅ / 无效 URL ✅ | 缺 重复键合并 / 编码(自动·不编码) / 按键排序；**无效 URL 时旧解析结果仍显示**（实测）。`t34-url-params.vue:70-74, 159` |
| T35 curl/fetch/axios | `/tools/curl-convert` | 部分（约 50%） | fetch→curl ✅ / shell 表达式 ⚠️ / multipart ⚠️ | **生成代码语法错误（高）**；缺 凭证处理(保留占位/移除)、缩进、目标语言、方向预设；shell 表达式为“警告后继续生成”而非设计“解析中断”；`-F` 被丢弃而非转运行时参数。`t35-curl-convert.vue:229, 350-352, 602, 635` |
| T36 HTTP 状态码 | `/tools/http-status` | 部分（约 70%） | 详情 ✅ / 无结果 ✅ | 数据 60 条，对照 IANA 缺 **424 Failed Dependency**（305/306 已废弃/unused 可忽略）；详情页缺 方向/可缓存/幂等/RFC 参考/常见原因/示例。`t36-http-status.vue:19-89` |
| T37 文件摘要 | `/tools/file-digest` | 好（约 85%） | 部分失败 ✅ / 取消 ✅ / 不匹配 ✅ | 无“仅重试失败项”；清单导出为 `.txt`（设计写 CSV）；多文件投递中有一个超限会**整批被拒**（`FileDrop.vue:22-29`）。摘要实测与 node 一致 |
| T38 图片压缩 | `/tools/image-compress` | 好（约 80%） | 结果更大 ✅ / 透明转 JPEG ✅ / 格式不支持：不可达 | 目标格式无“保持原格式”/无可选的不支持格式；“格式不支持”变体不可达；**无“移除文件”按钮**（`clearFile` 是死代码，`t38-image-compress.vue:129`）；无 EXIF 元数据/朝向损失提示 |
| T39 二维码 | `/tools/qrcode` | 好（约 80%） | 生成 ✅ / 识别成功 ✅ / 未识别 ✅ / 超容量 ✅ | 缺 前景/背景色、字符/字节统计、导入图片的文件名/大小、移除；**生成→jsQR 识别回环实测通过**（256×256 PNG 还原为 `https://example.com/devkit`）；超容量给出中文提示 |
| T40 文本编码/换行 | `/tools/text-encoding` | 好（约 80%） | 编码不确定 ⚠️ / 目标编码无法表示 ❌不可达 | 目标编码仅 UTF-8/UTF-16LE/BE，GBK 输出禁用 ⇒ **“目标编码无法表示字符”变体不可达**（设计变体必需）；不确定编码只有提示，无设计中的“两种编码并列解读”。GBK 源解码、UTF-8 BOM、CRLF 统计实测正确 |
| T41 文件/Base64 | `/tools/file-base64` | 好（约 82%） | 无效 Base64 ⚠️ / 类型不匹配 ✅ / 二进制 ✅ | 无效 Base64 无“第 N 行第 M 列”定位（仅通用文案）；文件→Base64 无进度/取消（大文件仅提示卡顿）；50MB 上限、Data URL MIME 不可信提示到位 |

> 图例：✅ 覆盖；⚠️ 覆盖但行为/文案与设计有偏差；❌ 不可达/未实现。

### 设计画板清单（T27–T41，共 52 个，已逐板抽取文案比对）

`Qy9fi L4CzT HacG2`(T27) · `oVrIm bfarF KEd1s`(T28) · `s2aSl ceWdh U3ers`(T29) · `AI8xy MB99A Tv8mb XRVJD`(T30) · `CcBGd ZUMYv al4QE`(T31) · `LYj5N kf47C t7KlH5 tenYQ`(T32) · `j3ZCW Ikqy7 WQTLy eq3hl ThLDw`(T33) · `mSgym q2Piem G7Y0I`(T34) · `ndB0M E6e87 sZOGq Pu4BY`(T35) · `cbuIP i6SIKG sSB8C`(T36) · `PKrN2 gKDNQ b6Hjk mYlnW`(T37) · `d1oFew LaXL4 E41nL ePiYS`(T38) · `VecLb By8II NEbCs S8CRwC`(T39) · `ujDax XKmXx hyJHl`(T40) · `J9ZAV sH0Uy ikF0h Uh3jn`(T41)（提取方法：`python3 /tmp/pen_ui.py`，只读 `Print/Get`）。

---

## 设计还原问题

### R1【中】T27 参数面板缺 5 组控件，推断规则与设计不符
- 设计要求（`Qy9fi`/`L4CzT`/`HacG2`）：`目标`、`根类型名`、`可选属性(保持原样/全部可选/全部必填)`、`只读(关闭/readonly)`、`日期字段(保持 string/转为 Date)`、`空数组策略(unknown/any/手动指定)`、`空对象策略(Record<string, unknown>/{})`、`数组联合类型(联合类型/取首项类型)`、`调整字段类型`、`推断不确定`横幅、`导入文件`。
- 实现（`t27-json2ts.vue:270-303`）只有：`interface/type`、`根类型名`、`可选属性(全部必填/含 null 标可选)`、`readonly`、载入示例、生成类型。缺日期策略、空数组/空对象策略、数组联合策略、调整字段类型、导入文件。
- 规则差异（实测）：
  - 设计 `email: null` 期望 `email: unknown`；实现输出 `balance: null`（`t27-json2ts.vue:111-114`）。
  - 设计 `meta: {}` 期望 `meta: Record<string, unknown>`；实现输出空接口：
    ```
    export interface Meta {

    }
    ```
    （`t27-json2ts.vue:167-168` 对空对象走 `registerInterface`，生成空 interface）。
- 覆盖到的：`tags:[] → unknown[]`、混合数组 `(number | string)[]`、嵌套对象独立 interface、大整数 `number`、日期样字符串保持 `string` 且给出提示。这些实测正确。

### R2【中】T28 缺“静态模板预览”整块
- 设计要求（`oVrIm`）：`源码 · UserFormCard.vue` 与 `静态模板预览 / 只读 / 不执行脚本 · 不加载外部资源 / 预览 props：title = 用户信息 · submitting = false`。需求原文：“静态模板预览，不运行任意源码”。
- 实现右栏只有 `DkEditor` 源码输出（`t28-vue-sfc.vue:370-394`），全文件 grep 无“预览”组件/区域。
- 组件名规则偏差：设计 `KEd1s` 明确“只能包含字母与数字，不能以数字开头，也不允许连字符、下划线或空格”；实现 `isValidIdent`（`t28-vue-sfc.vue:47-48`）允许 `_` 和小写首字母（如 `user_form` 通过校验，仅对单词名给黄色建议）。设计还展示“使用建议名称 UserFormCard”，实现只给错误文案。

### R3【中】T29 缺小数位/逐行勾选，批量语义与设计不同
- 设计要求（`s2aSl`/`ceWdh`/`U3ers`）：`小数位(2/3/4 位)`、`小数处理(去掉多余零/固定位数)`、`零值单位`、逐行勾选（“12 行中有 3 行未勾选，将保持原值”）、`复制表格`、`导入文件`。
- 实现（`t29-css-units.vue`）：单值换算 + `批量文本`，批量以“只转 rem→px 等某一源单位”的方式全量替换（`convertBatch`，:105-114），没有逐行勾选、没有小数位选项（`fmtNum` 固定 4 位截断）、没有“复制表格”。
- 基准字号非法路径正确：`根字号必须大于 0（当前 0）`，输入保留（实测）。

### R4【中】T31 “不安全内容”行为与设计相反，且“优化改变视觉”不可达
- 设计要求（`ZUMYv`）：检测到 `<script>`/`on*`/远程 href 时 **“预览已阻断 / 移除后才能预览 / 仅查看源码 / 定位第 N 行”**。
- 实现（`t31-svg.vue:45-77, 147-151`）：`sanitizeSvg` 静默剥离脚本、`on*`、外部 `href` 后**照常渲染**预览，并列出“已移除 …”。实测不安全示例：`已移除： 1 个 script 元素、2 个 on* 事件属性、1 个外部 href 链接`，`<img src="data:image/svg+xml,…">` 仍渲染。
- 设计要求（`al4QE`）的“优化可能改变视觉”变体：坐标 `12.345678 → 12.35`、合并空 `<g>`。实现的优化只有压缩空白、去注释、`1.500→1.5`（去尾零，不损失精度）、去引号，**永远不会改变渲染精度**，因此该变体与“精度已降低 · 请对比后再下载”警示无法出现。
- 设计主画板还要求 `保留 viewBox(是/否)`、`小数位(2/3/4/6)`、`标签数/空白字符` 统计；实现只有 `t31-svg.vue:20-24` 的 5 个布尔选项和字节数/行级 diff。

### R5【低】T32 缺换行/属性换行/保留空行选项与“导入文件”
- 设计要求（`LYj5N`/`kf47C`/`t7KlH5`/`tenYQ`）：`语言`、`缩进(2/4)`、`换行`、`属性换行(保持/每行一个)`、`保留空行(是/否)`、`导入文件`、状态“标签配对正确/括号配对正确”、错误“定位第 6 行”。
- 实现只有 `语言` + `缩进(2/4/Tab)`（`t32-html-format.vue:562-591`）；错误定位以纯文本给出（实测“第 1 行：<p> 未闭合（在第 1 行的 </div> 之前）”）。

### R6【低】T34 缺“重复键合并/编码/排序”三组选项
- 设计要求 `mSgym`：`重复键(保留/合并)`、`编码(自动/不编码)`、`排序(保持原序/按键排序)`、`应用修改/复制 URL/还原`。实现为实时预览，且没有合并/不编码/按键排序选项（`t34-url-params.vue` 全文无对应开关）；排序仅靠上/下移按钮。

### R7【中】T35 缺“凭证处理/缩进/目标语言/方向预设”
- 设计要求 `ndB0M`：“凭证类 header 默认替换为占位符，需要保留时必须显式选择”；并有 `凭证处理(保留占位/移除)`、`缩进(2/4)`、`目标语言`、`方向(curl→fetch / fetch→curl / curl→Axios)` 三选项。
- 实现只有 `源格式`+`目标格式`+交换按钮（`t35-curl-convert.vue:729-734`），**完全不做凭证脱敏**，`Authorization: Bearer test-token` 原样进入输出（实测）。
- `-F/--form`（multipart）设计要求生成“文件路径转为运行时参数”的 fetch 代码（`Pu4BY`）；实现只警告“暂不支持转换”并输出一个不含表单字段的 GET（`t35-curl-convert.vue:350-352`）。
- shell 表达式（`sZOGq`）设计要求“解析中断 · 第 3 行 / 未生成输出 / 下一步”；实现只把警告追加到状态栏，仍生成含 `$API_URL` 的 fetch 代码（实测）。

### R8【低】T36 详情信息少于设计
- 设计要求 `i6SIKG`：详情含 `分类/方向/是否可缓存/是否幂等/参考 RFC/相关状态码/常见原因/示例请求响应/排查顺序`。实现仅渲染“用途”和“相近状态区别”（`t36-http-status.vue:178-192`）。

### R9【低】T39/T41 细节控件缺失
- T39 设计要求前景/背景色、字符数/UTF-8 字节数统计、识别来源图片的文件名与大小；实现只有 尺寸/纠错 与识别结果文本（`t39-qrcode.vue`）。
- T41 设计要求无效 Base64“定位到第 N 行第 M 列”“建议扩展名”“类型来源/取消”；实现只有通用错误文案（`t41-file-base64.vue:144-149`），类型不匹配与二进制预览已实现。

---

## 功能与代码缺陷

### D1【高】T35 生成的 fetch / Axios 代码语法错误（header 名含连字符未加引号）
- 位置：`devkit/app/components/tools/t35-curl-convert.vue:229`（`const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/`），用于 `:602`（fetch headers）、`:635`（axios headers）、`:640`（axios params）。
- 复现：打开 `/tools/curl-convert` → 载入示例 → 目标 `fetch` → 转换。输出：
  ```js
  fetch('https://api.example.com/users', {
    method: 'POST',
    headers: {
      Content-Type: 'application/json',      // ← 非法 JS
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({"name":"devkit","role":"admin"})
  })
  ```
- 证据：`node --check` 复算
  ```
  SyntaxError: Unexpected token '-'
      at wrapSafe (node:internal/modules/cjs/loader:1692:18)
  ```
- 影响：凡 header 名带 `-`（Content-Type、X-Request-Id、Accept-Language…）或 axios params 键带 `-`，生成代码一律不可运行。修正方向：`SAFE_KEY` 去掉 `-`（JS 标识符不允许连字符），或统一对非标识符键用 `jsQuote`。

### D2【高】T33 “被篡改签名”示例并未篡改，验签显示通过
- 位置：`devkit/app/components/tools/t33-jwt.vue:13`（`SAMPLE_TAMPERED` 仅把签名段末位 `Y` 改为 `Z`）；比较逻辑 `:228-249`（逐字节比对）。
- 原因：HS256 签名是 32 字节，base64url 编码 43 字符；末位字符只有低 2 位参与、其余为填充位，`Y`→`Z` 解码结果完全相同。
- 复算证据：
  ```
  node -e "…Buffer.from(a,'base64url').equals(Buffer.from(b,'base64url'))"
  → len 32 32 equal bytes? true
  → a 89572176  b 89572176
  ```
- 页面实测（Playwright）：点击「示例：被篡改签名」→ 点击「验证签名」→ 结果框 `签名验证通过（HS256）`。而该页“关于本工具”文案写“验签必然失败”，设计变体 `WQTLy` 要求“签名比对 · 不匹配 · 不通过”。
- 影响：演示“签名不通过”失败，甚至给用户“改一个字符签名仍然有效”的错误暗示（虽然只是末位填充位，但用户无法分辨）。修正方向：改 Payload 中一个字符（或改签名段中段字符）重签，确保字节不同。

### D3【中】T33 验签结论不随 Token 变化清除，存在“过期/换 Token 仍显示通过”的误导
- 位置：`t33-jwt.vue:106-146`（`decode()`，watch token 触发）未清空 `verifyResult`；`verifyResult` 仅在 `verify()` 开始（`t33-jwt.vue:193`）或 `loadSample()`（`:263`）重置。
- 复现：载入有效示例 → 验签通过（绿框“签名验证通过（HS256）”）→ 把 Token 换成 `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhIn0.`（alg=none）→ 绿色“签名验证通过（HS256）”仍在，只有状态栏提示变了。
- 影响：用户可能把新 Token 误读为已验签通过。

### D4【中】T27 空对象生成空 interface；`null` 与设计 `unknown` 不一致
- `{}`：`t27-json2ts.vue:167-168` 走 `registerInterface`，实测输出
  ```
  export interface Meta {

  }
  ```
  （设计 `L4CzT` 期望 `meta: Record<string, unknown>`；空 interface 在 TS 中还会被 lint 规则（no-empty-interface）报错）。
- `null`：`t27-json2ts.vue:111-114` 返回字符串 `'null'`，实测 `balance: null`；设计 `Qy9fi` 的 `email: null` 期望 `unknown`，且设计文案写“null 与空数组无法确定类型时输出 unknown”。
- 附带：设计要求的“空数组策略/空对象策略/调整字段类型”控件缺失，用户无法在 UI 内纠正。

### D5【中】T27 等 JSON 工具的“行/列定位”在常见语法错误下失效
- 位置：`devkit/app/utils/json.ts:197-209` 的 `jsonErrorPosition` 只匹配旧版 V8 的 `position (\d+)` 或 `line N column M`。
- 复现：`/tools/json2ts` 输入 `{"a":}` → 报错 `Unexpected token '}', "{"a":}" is not valid JSON`（无行列）；`{"a": 1,\n}` 这类才会带 `at position 10 (line 3 column 1)`。
- 证据（Chromium 实测 `JSON.parse` 两条消息）：
  ```
  Unexpected token '}', "{"a":}" is not valid JSON
  Expected double-quoted property name in JSON at position 10 (line 3 column 1)
  ```
- 影响：T27（以及所有复用 `parseJson` + `jsonErrorPosition` 的工具）在常见错误上给不出“第 N 行第 M 列”，与“具体修正方向”要求不符。

### D6【中】T34 无效 URL 时保留旧的解析结果（陈旧数据）
- 位置：`t34-url-params.vue:57-75`，`parse()` 的 `catch` 只 `markFail`，未清空 `base`/`rows`；模板 `:159 v-if="base"` 继续渲染旧结构。
- 复现：载入示例（`https://api.example.com/search?...`）→ 改成 `not a url` → 顶部报“无效 URL”，但下方“结构信息 / 参数表 / 合成预览”仍显示上一次的 `https://api.example.com/search…`（实测）。
- 影响：错误输入下界面看起来仍在展示有效结果，且“复制编码结果”按钮虽因 error 被禁用，预览文本仍具误导性。

### D7【中】T40 “目标编码无法表示字符”变体不可达（仅支持 UTF 系目标编码）
- 位置：`t40-text-encoding.vue:7`（`type TargetEnc = 'utf-8' | 'utf-16le' | 'utf-16be'`）、`:65-69`（targetOptions）。
- 复现：页面“目标编码”只有 UTF-8 / UTF-16LE / UTF-16BE 三项，GBK 输出被显式禁用（“GBK 输出不支持，已禁用”）。因此设计 `hyJHl` 的“目标编码无法表示某些字符 / 🎉 U+1F389 / 改用 UTF-8 / 替换为 ?”整块无法出现。
- 影响：必画变体缺失；同时“无法表示字符时明确提示”这一需求项无法验证。
- 已正确实现：GBK 源解码（实测 13 字符正确）、UTF-8 BOM 检测、CRLF 统计（3 处）、孤立代理项提示。

### D8【中】FileDrop 多文件投递时“一个超限 → 整批拒绝”
- 位置：`devkit/app/components/FileDrop.vue:22-29`：找到第一个超限文件即 `emit('reject', …)` 并 `return`，不投递其余文件。
- 影响：T37 支持多文件且单文件上限 512MB，用户一次拖入 3 个文件、其中 1 个超限时，**其余合法文件也不会被处理**；这违反 T37 设计变体“部分失败/失败不影响其他文件”的精神。T37 自身 `onFiles` 的逐文件跳过逻辑（`t37-file-digest.vue:64-73`）因此不可达。

### D9【中】T38 无“移除文件”，`clearFile` 是死代码
- 位置：`t38-image-compress.vue:129` 定义了 `clearFile()`，但模板中从未引用（`grep -n clearFile` 仅命中定义行）；页面也没有其它移除入口。
- 影响：用户载入图片后无法清空/更换为“无文件”状态，只能再拖一张。设计/G02 文件工作台要求“移除”。
- 同时：T38 未提示“EXIF 元数据（含 GPS）在 canvas 重编码后丢失”“动图 GIF 转换后只保留首帧/丢失动画”，仅在 `hasAlpha` 时提示“检测到透明区域”。

### D10【低】T36 状态码数据缺 424
- 位置：`t36-http-status.vue:19-89` 共 60 条。对照 IANA 注册表：缺 `305`（Use Proxy，已废弃）、`306`（unused）、**`424 Failed Dependency`（WebDAV，有效）**。其余 4xx/5xx 集合完整。
- 复算：
  ```
  top-level count 60
  missing vs IANA: [305, 306, 424]
  extra: []
  ```

### D11【低】T41 无效 Base64 无位置定位
- 位置：`t41-file-base64.vue:144-149`，`base64ToBytes` 只返回“Base64 中包含非法字符”；设计 `sH0Uy` 要求“第 1 行第 27 列 ‘%’”。实测输入 `not!!base64@@` → `Base64 中包含非法字符（支持标准与 URL-safe 字母表，允许空白）`。

### D12【低】T39 识别结果不显示来源文件信息
- 位置：`t39-qrcode.vue:98-130`，`scanMeta` 只有“图片 W×H，识别成功”。设计 `By8II` 要求来源文件名/大小/读取完成，以及内容类型/编码模式/纠错等级。

### 已验证正确、无缺陷的点（避免误报）
- **T29 换算**：32px→2rem、1.5em→30px（父 20）、2rem→1.6em（根 16/父 20）均正确；批量 `1.5rem→24px`、`1.25rem→20px`、`0.5rem→8px` 正确；根字号 0 报错且保留输入。
- **T30 对比度**：node 独立复算一致 —— `#2563eb/#fff = 5.17`、`#999/#fff = 2.85`、`#9ca3af/#fff = 2.54`、`rgba(0,0,0,.5)` 合成 `#808080` 对白 `3.95`；透明色以合成背景计算并注明。
- **T31 清洗**：实测不安全示例移除了 1 script、2 个 `on*`、1 个外部 href；预览走 `<img src="data:image/svg+xml,…">`，不执行脚本、不加载远程资源，无 XSS 向量。
- **T32 格式化**：三种语言样例 + 语法错误均正确；对 `const s="}"`、模板串 `${}`、正则 `/a\/b/g`、`content:"}"`、`url("a}b.png")`、`<pre>` 内容原样保留等难例实测正确。
- **T33 验签（用正确密钥）**：node 生成的 HS256 token 验签通过；错误密钥 → `签名不匹配`；alg=none → 拒绝验签并提示；格式错误（2 段）→ `JWT 结构错误…当前为 2 段`；解码成功状态栏始终提示“解码成功 ≠ 签名有效”。过期 token 的时间字段标注“已过期”。
- **T37 摘要**：三个测试文件 MD5/SHA-256 与 node `crypto` 输出逐字符一致；期望值不一致显示“不一致”；逐项进度、取消、移除齐全。
- **T39 回环**：生成页 canvas 导出 PNG（256×256，3420 B）→ 识别页 jsQR 解码回 `https://example.com/devkit`（26 字符）；5000 字符输入给出“内容超出二维码容量，请缩短或降低纠错级别”。
- **T41**：`tiny.png` → Base64 裸串；`data:image/jpeg;base64,<PNG>` → 检出“声明的类型与文件头不符（文件头检测：PNG，声明：JPEG）”；二进制内容以 hex 展示并可导出。
- 全部 15 页无 `console.error` / `pageerror`。

---

## 无法验证 / 存疑项

1. **T32 “真实解析器”**：实现为自研状态机（`t32-html-format.vue:19` 注释“逻辑已用 node --check 验证”），非成熟解析器。本轮只覆盖了常见与若干净例，无法证明对全部合法 HTML/CSS/JS 都不改语义（例如 HTML `<svg><title>` 内嵌、CSS `@supports` 嵌套、JS 比较运算符后紧跟正则歧义 `/` 等）。列为风险，未发现具体反例。
2. **T31 预览隔离边界**：剥离 `<script>/foreignObject/on*/外部 href` 已实现，但未剥离 `<style>` 内的 `@import`/`url()` 与 `<use>` 以外的其它外部引用（如 `<feImage href>` 属 href 已处理）。因预览是 `<img>` 上下文、浏览器不加载 SVG 子资源，实际风险低，未构造出可利用向量。
3. **T38 EXIF 朝向**：`createImageBitmap(f)` 未显式传 `imageOrientation`，不同浏览器默认值曾不一致；本轮无带 Orientation 标签的样本图片，无法确认是否反转。列为存疑。
4. **T39 识别容错**：只用了默认 `jsQR` 调用，未验证低分辨率/倾斜图片；设计 `NEbCs` 的“未识别”路径已实现。
5. **T40 编码猜测**：非 UTF-8 时一律猜测 GB18030（`t40-text-encoding.vue:113-115`），未做统计式猜测；设计 `XKmXx` 的“两种编码并列解读”缺失，属实现取舍。
6. **设计主画板与注册表标题**：设计 T28 名为“Vue 单文件组件模板生成”，`tools.ts:209` 为“Vue 单文件组件模板”；T40 设计为“文本文件编码与换行转换”，`tools.ts:281` 为“文本文件编码转换”。是否算问题取决于命名规范，未计入缺陷。

---

## 修复优先级建议

**P0（阻断级，先修）**
1. T35 `SAFE_KEY` 去掉 `-`，或对非标识符键统一 `jsQuote`（D1）。补一条生成代码的 `node --check` 自测。
2. T33 重做“被篡改签名”示例，确保签名字节真实不同；并给“篡改/错误密钥”路径加自动化断言（D2）。

**P1（高，影响正确性/误导）**
3. T33 `decode()`/token 变化时清空 `verifyResult`（D3）；为“过期但签名有效”增加合并结论文案。
4. T27 空对象输出 `Record<string, unknown>`；`null` 至少对齐设计 `unknown`（或明确“按 null 输出”并在 UI 暴露空数组/空对象策略）（D4、R1）；修 `jsonErrorPosition` 兼容新 V8 消息（D5）。
5. T34 无效 URL 时清空 `base`/`rows`（D6）。

**P2（中，补齐设计与 G02）**
6. T31 增加“保留 viewBox/小数位”选项并让“精度降低”变体可达；或按设计改为“检测到不安全内容即阻断预览”（R4）。
7. T40 增加 GBK/其它目标编码（或至少实现设计中的“无法表示字符”提示路径）（D7）。
8. T28 补静态模板预览（R2）；T29 补小数位/逐行勾选（R3）；T35 补凭证处理与 multipart 运行时参数（R7）。
9. FileDrop 改为“跳过超限文件、继续投递其余文件”（D8）；T38 暴露“移除文件”并提示 EXIF/动图损失（D9）。

**P3（低，体验与数据）**
10. T36 补 424（D10）；T41 无效 Base64 定位（D11）；T39 显示来源图片信息（D12）；T32 补换行/空行选项（R5）；T36 详情补幂等/缓存/RFC（R8）；T27/T29/T32 补“导入文件”入口。

---

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/r4-tools-t27-t41.md
