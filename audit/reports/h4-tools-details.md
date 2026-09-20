# H4 报告：T36 / T37 / T39 / T40 设计细节补齐

- 工作目录：`/Users/hao/WebstormProjects/web_tools`（Nuxt 4 在 `devkit/`，dev server `http://localhost:3000`，保存即 HMR）
- 设计依据（只读）：`python3 audit/tools/pen.py dump <节点ID> 6`
  - T36：`cbuIP`（常用列表）、`i6SIKG`（状态详情）、`sSB8C`（无搜索结果）
  - T37：`PKrN2`（成功）、`gKDNQ`（部分失败）、`b6Hjk`（取消任务）、`mYlnW`（校验不匹配）
  - T39：`VecLb`（生成）、`By8II`（识别成功）、`NEbCs`（未识别到二维码）、`S8CRwC`（内容超出容量）
  - T40：`ujDax`（成功）、`XKmXx`（编码不确定）、`hyJHl`（目标编码无法表示）
- 改动文件（仅这 4 个，未触碰任何其他文件）：
  - `devkit/app/components/tools/t36-http-status.vue`
  - `devkit/app/components/tools/t37-file-digest.vue`
  - `devkit/app/components/tools/t39-qrcode.vue`
  - `devkit/app/components/tools/t40-text-encoding.vue`

---

## 一、T36 HTTP 状态码速查：补齐详情字段（`i6SIKG`）

### 1. 新增字段与数据来源
在 `STATUSES`（63 条）之外新增独立索引 `DETAIL: Record<number, { rfc, causes }>`，**63 条状态码逐条补齐**，另按类别派生展示字段：

| 字段 | 取值方式 | 准确性处理 |
| --- | --- | --- |
| 分类 | 由状态码首位派生（`1xx 信息` … `5xx 服务器错误`） | 与设计 `分类=4xx 客户端错误` 一致 |
| 方向 | 4xx：`客户端 → 服务器（请求侧问题）`；5xx：`服务器 → 客户端（服务端问题）`；1xx/2xx/3xx：`服务器 → 客户端（…）` | 与设计 404 的 `客户端 → 服务器` 一致；详情内加说明「状态码本身都随响应返回，方向表示语义归属」 |
| 是否可缓存 | 按 **RFC 9110 §15.1 原文** 的启发式可缓存列表 `200/203/204/206/300/301/308/404/405/410/414/501`；304 单列「不单独缓存」；其余「默认不缓存（需显式 Cache-Control / Expires，RFC 9111 §3）」 | 见下方「与设计的差异说明」 |
| 是否幂等 | 统一 `取决于请求方法：GET / HEAD / PUT / DELETE / OPTIONS / TRACE 幂等；POST / PATCH 不幂等`（RFC 9110 §9.2.2） | 幂等性是**请求方法**属性而非状态码属性，详情内明确注明，不伪造逐码结论 |
| RFC 参考 | 逐条给出章节，如 `404 → RFC 9110 §15.5.5`、`424 → RFC 4918 §11.4`、`429/431/511 → RFC 6585`、`451 → RFC 7725 §3`、`226 → RFC 3229 §10.4.1`、`208/508 → RFC 5842`、`506 → RFC 2295 §8.1`、`510 → RFC 2774 §7`、`103 → RFC 8297 §2`、`425 → RFC 8470 §5.2`、`422 → RFC 9110 §15.5.21（源自 RFC 4918 §11.2）` | 逐条对照 RFC 原文核对（下载 rfc-editor 文本 grep 章节号） |
| 常见原因 | 每条 2–4 条 | 描述性排查要点，不引用不存在的标准结论 |

模板把上述字段渲染进展开详情（`.t36__facts` 网格 + `含义` + `常见原因` + `相近状态区别` + 一句边界说明），底部提示文案同步更新。

### 2. 与设计的差异说明（准确性优先）
- **404 是否可缓存**：设计写「默认不缓存」，但 **RFC 9110 §15.1 明确把 404 列入可被缓存启发式复用的状态码**（原文：`200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, and 501`）。按任务「数据要准确、对照 RFC 9110/4918」的要求，实现取 `可（启发式缓存，RFC 9110 §15.1）`，并在详情注明「是否真的缓存由 Cache-Control/Expires 决定」。
- **是否幂等**：设计对 404 写「是（GET / HEAD）」，但 RFC 9110 §9.2.2 定义的是**方法**的幂等性；实现如实写成「取决于请求方法」，并在详情里显式说明，避免把方法属性误标为状态码属性。

### 3. 自测（抽查 200 / 301 / 404 / 424 / 503）
命令：Playwright 打开 `/tools/http-status`，逐个搜索并展开 5 个状态码，读取 `.t36__detail` 文本。
关键输出（节选）：
```
--- 404 ---
分类 4xx 客户端错误
方向 客户端 → 服务器（请求侧问题）
是否可缓存 可（启发式缓存，RFC 9110 §15.1）
是否幂等 取决于请求方法：GET / HEAD / PUT / DELETE / OPTIONS / TRACE 幂等；POST / PATCH 不幂等
RFC 参考 RFC 9110 §15.5.5
常见原因 1. 请求路径拼写错误，或结尾斜杠、大小写不一致 … 4. 静态资源未随本次发布同步，指纹文件名已变化
--- 424 ---
RFC 参考 RFC 4918 §11.4
常见原因 1. WebDAV 中前置操作失败… 2. PROPPATCH 中某个属性修改失败，其余属性一并返回 424
--- 503 ---
是否可缓存 默认不缓存（需显式 Cache-Control / Expires 等，RFC 9111 §3）
RFC 参考 RFC 9110 §15.6.4
pageerrors: []
MISSING: none
```
完整性校验（源码级）：`statuses: 63 / details: 63 / missing: [] / extra: [] / empty rfc|causes: []`。

---

## 二、T37 文件摘要与批量校验：导出改为 CSV

### 1. 改动
- 删除原先的 `# 注释 + 文本清单`（`digest-manifest.txt`），改为 `buildManifestCsv()`：
  - 列（前 4 列为设计指定的核心列，为如实覆盖部分失败/取消/校验不匹配追加后 3 列）：
    `文件名, 大小(字节), 算法, 摘要, 状态, 对照结果, 备注`
  - 每个「成功文件 × 每个已选算法」一行；失败/取消/未完成文件按真实状态单行输出，失败原因写入 `备注`。
  - **RFC 4180 转义**：`csvCell()` 对含 `,` / `"` / CR / LF 的字段整体加引号，内部 `"` 翻倍；行尾 `\r\n`。
  - 前置 UTF-8 BOM，便于表格软件识别中文表头。
  - 文件名 `digest-manifest.csv`，MIME `text/csv;charset=utf-8`。
- 按钮文案改为「导出摘要清单」；`summarize()`（完成/失败/取消统计）**未改动**。
- 使用说明同步更新，明确「失败与取消按实际状态标注，不伪造结果」。

### 2. 自测：真实导出 → node 解析
命令（要点）：Playwright 上传 `a,b"c.txt`（3B）与 `plain.txt`（5B），给第一个文件填错误期望值 `00` 触发「不一致」，点击导出并捕获下载；再用 node 以 RFC4180 解析。

关键输出：
```
match badges: ['不一致', '不一致']          # 第一个文件的 MD5 / SHA-256 各一个对照标记
suggested_filename: digest-manifest.csv
has UTF-8 BOM: True
uses CRLF: True
header: ["文件名","大小(字节)","算法","摘要","状态","对照结果","备注"]
comma+quote filename row: ["a,b\"c.txt","3","MD5","900150983cd24fb0d6963f7d28e17f72","完成","不一致",""]
ASSERT header: true
ASSERT comma+quote filename parsed exactly: true
ASSERT mismatch verdict present: true
ASSERT CRLF line endings: true
```
换行字段转义（从组件源码抽取真实 `csvCell` 后在 node 中执行）：
```
csvCell newline -> "\"line1\nline2\""     # 含换行 → 加引号且换行保留
csvCell quote   -> "\"a\"\"b\""           # 引号翻倍
csvCell comma   -> "\"a,b\""              # 逗号 → 加引号
ASSERT newline quoted+preserved: true / quote doubled: true / comma quoted: true / plain unquoted: true
```
取消统计未破坏（上传 48MB 文件后立即取消）：
```
cancelled badge shown: 1
statusbar: 失败 | 1 个文件已取消，没有可用的计算结果 | MD5 | SHA-256 | 单文件上限 512.00 MB
badges: ['已取消']
export disabled: True
pageerrors: []
```
说明：磁盘文件名通常不含换行，换行转义通过对 `csvCell` 的真实源码单测覆盖；逗号/引号转义由真实导出文件解析证明。

---

## 三、T39 二维码生成与识别：识别来源文件信息 + 回环

### 1. 改动（`VecLb` / `By8II` / `NEbCs`）
- 新增 `ScanSource { name, size, width, height, kind }`，文件识别时记录来源并在结果上方显示来源条：
  `文件名 · 文件大小 · 像素尺寸 · 读取状态`；识别成功的结果说明也写入来源。设计 `By8II` 的「ticket-qr.png · 512×512 · 18.4 KB」形式。
- 新增「识别当前预览」按钮：直接把生成 canvas 的像素交给 jsQR，点击后切到识别页显示结果，做真实的**生成 → 识别回环**（画布来源明确标注为「当前生成预览（画布，非文件）」，不伪装成文件）。
- 生成侧不再做任何容量推算：状态栏只显示真实的 `内容 N 字符 / M 字节（UTF-8）`；超限仍以库的真实报错文案呈现。识别失败时来源文件信息仍保留。

### 2. 自测
```
GEN statusbar: 成功 | QR Code 256×256，纠错级别 M，由输入内容真实生成 | 256 × 256 | 纠错 M | 内容 26 字符 / 26 字节（UTF-8）
ROUNDTRIP source: 当前生成预览（画布，非文件） | 256×256 | 读取完成 · 已识别
ROUNDTRIP text  : https://example.com/devkit
ROUNDTRIP status: 成功 | 回环识别成功，内容与输入逐字符一致 | jsQR 本地识别
FILE source: t39-ticket-qr.png | 3.1 KB | 512×512 | 读取完成 · 已识别
FILE result: https://devkit.example/e/BASE64-2f8a41
FILE note  : 来源：t39-ticket-qr.png · 3.1 KB · 512×512；识别出的内容为 38 个字符。…
pageerrors: []
```
（上传用的 PNG 由 devkit 自带 `qrcode` 在 node 中真实生成：`qrcode.toFile('/tmp/t39-ticket-qr.png', 'https://devkit.example/e/BASE64-2f8a41', …)`。）

---

## 四、T40 文本编码转换：ISO-8859-1 让「无法表示」真实可达

### 1. 改动（`hyJHl`）
- `TargetEnc` 增加 `'iso-8859-1'`，目标编码下拉新增 `ISO-8859-1（Latin-1，仅 0x00–0xFF）`；用 **charCode 逐码元编码**（`encodeLatin1`），不依赖 `TextEncoder` 不支持的能力。
- 新增 `scanUnrepresentable()`：逐码点扫描 `> U+00FF` 的字符，给出**真实位置（行 / 列，按码点计数，emoji 记 1 列）、字符本身、码点（U+XXXX）与类型（emoji / 汉字 / 中文标点 / 全角字符 / …）**；`\r\n` 与 `\r` 都按换行处理。
- 处于「无法表示」且未替换时：显示红色提示条与逐条列表，统计栏显示「已阻止」，**下载禁用**，**原输入完整保留**（左侧解码预览不变，未静默替换或丢弃）。
- 提供两个真实动作：「改用 UTF-8」；「替换为 ? 后导出」——只有用户显式确认后，才把无法表示的码点替换为 `?`（0x3F）并允许导出；切换目标编码 / 换行 / 文件会重置替换态。
- ISO-8859-1 没有标准 BOM：BOM 复选框对其禁用并显示原因。
- 帮助文案明确：GBK / GB18030 / Shift_JIS / Big5 **没有可靠的浏览器本地编码器，不作为目标编码（不做假的“支持”）**，仅可作源读取。

### 2. 自测（中文 + emoji）
样本字节：`b'AB\n\xe4\xb8\xad\xe6\x96\x87\xf0\x9f\x8e\x89\n'`（第 2 行：`中文🎉`）
```
TARGET options: ['UTF-8','UTF-16LE','UTF-16BE','ISO-8859-1（Latin-1，仅 0x00–0xFF）']
UNREP panel: 目标编码 ISO-8859-1 无法表示 3 个字符 | 改用 UTF-8 | 替换为 ? 后导出 |
  第 2 行 · 第 1 列：中 （U+4E2D，汉字） |
  第 2 行 · 第 2 列：文 （U+6587，汉字） |
  第 2 行 · 第 3 列：🎉 （U+1F389，emoji） |
  原输入已完整保留，未做任何静默替换或丢弃；导出已被阻止。
blocked download disabled: True
stats: … 输出 已阻止（存在无法表示的字符）
after replace download disabled: False
status: 成功 | 已将 3 个无法表示的字符替换为 ?（经你确认） | utf-8 | → iso-8859-1
after switch to UTF-8, unrep present: 0 / download disabled: False
out bytes: b'AB\n???\n'
ASSERT no >=0x80 bytes: True / ASSERT three ?: True
pageerrors: []
```
即：emoji 🎉 被定位为「第 2 行第 3 列」，中文被逐字定位；替换后导出的字节里已无任何 `>=0x80` 的字节，三个码点各写成一个 `?`。

---

## 五、总体验证

- 四个页面 probe（默认 1440×900，light）：
```
http-status   status=200 console=0 pageerrors=0 failed=0
file-digest   status=200 console=0 pageerrors=0 failed=0
qrcode        status=200 console=0 pageerrors=0 failed=0
text-encoding status=200 console=0 pageerrors=0 failed=0
```
- `npx nuxt typecheck` 退出码 0；仅有仓库既有的 `vue-router/volar/sfc-route-blocks` 插件解析告警（`ERR_PACKAGE_PATH_NOT_EXPORTED`，与本轮改动无关）。
- 未新增依赖；未改动 `design.pen`、`docs/**`，也未触碰 `json.ts`、`useToolRun.ts`、`usePrefs.ts`、`useTransfer.ts`、`DkModal.vue`、`SplitPanes.vue`、`FileDrop.vue`、`CommandPalette.vue` 等受限文件。

## 六、未做 / 不可达
- T39 摄像头实时扫码、T40 目标编码写 GBK/Shift_JIS/Big5：浏览器无可靠本地编码器/摄像头默认不申请，保持现有「明确标注不支持」，未伪造能力。
- T37 取消路径的「部分文件已完成 + 部分取消」组合在有成功结果时导出按钮才可用；本轮已验证「全部取消」（导出禁用）与「完成 + 不一致」（CSV 正确），未强制构造「部分完成部分失败」的错误注入（无真实失败来源，不为测试伪造错误）。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/h4-tools-details.md
