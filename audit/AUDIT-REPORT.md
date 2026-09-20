# DevKit 完整审核报告（设计稿 / 代码 / 运行站点）

- 审核日期：2026-09-20
- 审核对象：`design.pen`（Pen 设计稿，70 个顶层画板 / 39 477 节点）、`docs/DevKit-Pen完整页面设计任务书.md`（权威需求）、`devkit/**`（Nuxt 4 实现）、运行站点 `http://localhost:3000`
- 方法：Pen MCP（`pencil` MCP，stdio，只读 `Print/Get`）+ 本地结构化解析 `audit/tools/pen.py`；Playwright 真实浏览器探测 `audit/tools/probe.py` / `crawl.py`；node/python 复算；**7 个并行子代理**分域深审（见附录 A）
- 只读保证：未修改 `devkit/**`、`design.pen`（mtime/size 与审核前一致）、`docs/**`

---

## 一、结论速览

| 维度 | 结论 | 评分 |
|---|---|---|
| **设计稿交付完整度** | 结构完备：41/41 工具主画板 + 106/106 必画变体 + S01–S10 + G01–G08 + R01–R04 + C01–C15 全部存在，`placeholder`/`Generating` 为 0。**但存在 2 类硬伤：① R01/R03 适配稿仍是旧版“24 工具 / 5–6 分类”首页，含已废弃入口“模拟数据生成”；② 多张密码学画板在页面可见区写“演示数据 / 待开发验证”，违反任务书真实性第 2 条** | B+ |
| **需求 → 代码 覆盖率** | 41 个工具页全部存在、路由 200、无空壳；系统页 9 个、组件/composables 齐全。按“设计控件与状态逐项”衡量：T01–T14 ≈ 65%、T15–T26 ≈ 75%、T27–T41 ≈ 80%、S01–S10 结构还原度偏低（页头/工作区/说明区大面积缺失） | B |
| **功能正确性** | 核心算法多数真实且经权威向量核对（SM3 国标向量、SM4 标准 ECB 向量、SM2 raw/DER 验签、AES-GCM 对照 node crypto、MD5/SHA/HMAC、二维码生成→识别回环、颜色对比度公式 5.17/2.85/2.54）。**但存在 1 个必崩页面、多个“假成功/假示例”与生成代码语法错误** | C+ |
| **工程质量与体验** | 构建通过、工具按路由拆包、SSR 无顶层 `window`、无 `eval`、localStorage 不存正文；**但类型检查入口不可用（51 个类型错误）、无 PWA/离线能力、偏好在刷新后失效、分栏比例与只读编辑器复制按钮两处全局性缺陷** | C+ |

> 合计记录 **108 条带定位证据的可复现问题**（P0 阻断 5 / P1 高 20+ / P2 中 40+ / P3 低 30+），明细见 7 份子报告。

---

## 二、P0 阻断问题（已由本人二次复验）

### P0-1 T20 Cron 工具页打开即崩溃，且错误页自身也崩溃
- 现象：访问 `http://localhost:3000/tools/cron`（HTTP 200，SSR 正常），但客户端 hydration 时抛 `TypeError: Cannot read properties of undefined (reading 'm')`，Nuxt 渲染 `<Error>`，紧接着错误页抛 `ReferenceError: getTool is not defined`。
- 根因 1：`devkit/app/components/tools/t20-cron.vue:319`
  `const yearM = get('year').m as {...} | undefined` —— Unix 五字段与 Quartz 六字段都没有 `年` 字段（只有七字段才有，见 `:212`），`get('year')` 返回 `undefined`，再取 `.m` 直接抛错。调用链：`onMounted(execute)`（`:539`）→ `nextRuns()`（`:519`）。
- 根因 2：`devkit/app/error.vue:11` 使用 `getTool()` 但**从未 import**（仅 `import type { NuxtError }`），错误页二次崩溃，`常用工具` 区域永远为空。
- 复验命令与输出：
  ```
  $ python3 audit/tools/probe.py /tools/cron
  pageerrors: ['getTool is not defined']
  console: [Vue warn] Unhandled error during execution of setup function
           at <Error key=1 error= H3Error: Cannot read properties of undefined (reading 'm')>
  ```
- 影响：T20 整页不可用（设计主画板 `N9xCsh`/`wkqXY`/`Xuzy5`/`yKSz6` 全部无法验收）。

### P0-2 404 错误页分支判断失效 + 初始化失败
- 现象：`/tools/does-not-exist`、`/category/nope`、`/nope` 的 H1 都是**“页面出现了错误”**（应为 S09 设计的“工具不存在或链接已失效”），描述位显示 `statusMessage`（“工具不存在”），`常用工具` 区域为空白，控制台报 `[NUXT_E1005] Error caught during app initialization`；生产构建下整块 `.err` 不渲染。
- 根因：`error.vue:6` `const is404 = computed(() => props.error?.statusCode === 404)` 与实际传入值类型不一致（页面能渲染出 `404`，但严格等值判断为 false），叠加 P0-1 的未导入 `getTool`。
- 复验命令与输出：
  ```
  $ python3 /tmp/t404.py
  MAIN: '404\n\n页面出现了错误\n\n工具不存在\n\n搜索工具（⌘K）\n返回首页\n\n常用工具'
  H1: ['页面出现了错误']      # 设计 S09 要求：工具不存在或链接已失效
  ```
- 影响：设计稿 S09（`edecI`）未落地；同时是全站唯一兜底页，任何错误都会退化成错误的文案与空列表。

### P0-3 `useToolRun` “假待更新”：正常操作后结果被判为过期、复制被禁用
- 现象：T01 点「载入示例」后状态栏显示 **“结果待更新｜输入或参数已修改”**，结果复制按钮被禁用；T15/T16/T17/T22–T26 同样复现，T15 的“签名成功”状态甚至**永不可达**（`t15-sm2.vue:229` 在 execute 内回写签名输入）。
- 根因：`devkit/app/composables/useToolRun.ts:12,30` 的 `lastSig` 只赋值、**从未读取**；watch 回调（`:15-24`）只判断 `armed && status∈{ok,error}`。同一次事件里“改写入参 + execute()”时，watch 在 flush 阶段晚于 `markOk()` 执行，于是把刚成功的结果改判为 stale。
- 复验命令与输出：
  ```
  $ python3 /tmp/stale.py
  initial:        ['未执行', '未执行']
  after example:  ['结果待更新 | 输入或参数已修改，结果待更新 | 重新执行', ...]
  copy disabled:  [False, True]     # 结果侧复制按钮 disabled
  ```
- 影响范围：所有提供「载入示例 / 交换 / 输出转输入」的工具（20+ 处），直接违反任务书 G04 与 00 节真实性第 4 条的本意。

### P0-4 SplitPanes 分栏比例错误（约 25 个工具版面失真）
- 现象：`<SplitPanes :initial="50">` 实际渲染左栏 **74.6%**、右栏 24.6%。
- 根因：`devkit/app/components/SplitPanes.vue` 左栏同时带 `flex:1`（`.split__pane`）与内联 `flex-basis: 50%`，右栏 `flex:1`（basis 0%）→ flex 剩余空间再分配，左栏变成 50% + 剩余的一半。
- 复验命令与输出：
  ```
  $ python3 /tmp/split.py
  split__pane split__left  : w=851  flex='1 1 50%'
  split__handle            : w=9
  split__pane split__right : w=281  flex='1 1 0%'
  # 容器 1140 → 左 74.6% / 右 24.6%
  ```
- 影响：所有左右工作台工具的“设计 1:1 分栏”全部不还原，拖动手柄的可用范围也被压缩。

### P0-5 只读结果编辑器的「复制」永久禁用（无法复制任何结果）
- 现象：`/tools/json-format` 结果面板复制按钮恒为 `disabled`。
- 根因：`devkit/app/components/DkEditor.vue:81` `:disabled="!modelValue || stale || readonly"`，而所有结果编辑器都传 `readonly`（如 `t01-json-format.vue:148-155`）。工具页自身没有其他复制入口（`t01-json-format.vue` 全文无“复制/copy/download”）。
- 复验命令与输出：
  ```
  $ python3 /tmp/split.py   # 结果页按钮
  [{'t':'复制','dis':True}, {'t':'复制','dis':True}]
  ```
- 影响：32 个使用 `DkEditor` 的工具中，21 个含 `readonly` 结果编辑器 → 复制/下载能力实际不可用，违反任务书 G03 与“复制内容不含行号”的前置条件。

---

## 三、P1 高危问题（按类型）

### A. 真实性与“假成功”（违反任务书 00 节真实性红线）
| # | 问题 | 位置 | 证据 |
|---|---|---|---|
| A1 | **T33 “被篡改签名”示例并未被篡改，点“验签”显示“签名验证通过（HS256）”** —— 只把签名段最后一个 base64url 字符 `Y→Z`，其低 2 位是填充位，解码后字节完全相同 | `t33-jwt.vue:13`（`SAMPLE_TAMPERED`） | 与设计变体 `WQTLy`「签名不通过」直接矛盾 |
| A2 | **T13 内置“RFC 4231 Test Case 1”标签造假**：用 40 字节 ASCII 数字当密钥，真实 TC1（key=0x0b×20）应为 `b0344c61…cff7` | `t13-hmac.vue:21-23,85-92,202-206` | node crypto 复算 |
| A3 | **T15 SM2 公钥无曲线点校验**：格式合法但不在曲线上的公钥被接受并报“SM2 加密成功”，该密文永不可解；设计 `XXObg` 要求直接报错 | `t15-sm2.vue:48-60` | 只校验前缀/长度 |
| A4 | **T15 空明文 C3 篡改仍报“C3 校验通过”**：`out==='' && hex.length===192` 把 sm-crypto 的校验失败当成功 | `t15-sm2.vue:179-183` | 伪造“校验通过” |
| A5 | **设计稿自身在多张密码学画板写“演示数据 / 待开发验证 / 待实现验证”**（任务书明确禁止），却与总索引 `c4K4r` 的“数据 ✓”矛盾 | `I92uFI`(T14)、`y2Dwo`/`nWK56`/`Q9BlV`(T15)、`DEUUC`(T17)、`WQTLy`(T33) | 子报告 #7 |
| A6 | **T03 YAML→JSON 静默丢精度**：`1234567890123456789 → …800`、`007 → 7`，而页面文案 `t03-json-yaml.vue:424` 明确承诺“`007` 等不会被自动转成数字” | `t03-json-yaml.vue` + `JSON_SCHEMA` | node 复算 |
| A7 | **大整数安全 JSON 的哨兵串冲突**：JSON 字符串值 `"@@raw:123@@"` 会被还原成数字 `123`（静默改数据） | `utils/json.ts:77` unwrap | 代码可证 |

### B. 计算与生成错误
| # | 问题 | 位置 |
|---|---|---|
| B1 | **T35 生成的 fetch/Axios 代码语法错误**：header 名含 `-`（如 `Content-Type`）未加引号，`node --check` 报 `SyntaxError: Unexpected token '-'` | `t35-curl-convert.vue:229`（`SAFE_KEY` 误含 `-`） |
| B2 | **T26 classifier 顺序双向颠倒**：Maven→Gradle 输出 `g:a:classifier:version`，Gradle→Maven 把 `g:a:1.0:sources` 解析成 `version=sources` | `t26-maven-gradle.vue:89-97,166-171` |
| B3 | **T21 日历差在“月末起始”时输出负数日** | `t21-date-diff.vue:129-144` |
| B4 | **T20 周/月英文名 `WED`/`JUL` 被误判为 Quartz 扩展符** | `t20-cron.vue:114-122` |
| B5 | **T24 Properties `\uXXXX` 解码计数永远为 0**（字段名 `unicodeDecoded` vs `uCount` 不一致） | `t24-properties-yaml.vue:26/49/70/95` |
| B6 | **T24 YAML→Properties 静默丢空对象/空数组；Properties 值尾空白被 `trim()` 吃掉** | `t24-properties-yaml.vue:149-238,347-354` |
| B7 | **T18 毫秒溢出错误文案错误**；T25 把方法名算进类名 `fqcn` | `t18-timestamp.vue`、`t25-stack-trace.vue` |
| B8 | **T01 语法错误行列定位偏移**：`jsonErrorPosition` 用的是包装（`@@raw:`）后的 position，而输入文本是原文 | `utils/json.ts:77,199-205` |

### C. 全局能力与工程
| # | 问题 | 位置/证据 |
|---|---|---|
| C1 | **偏好设置刷新后失效**：`usePrefs` 用 `useState` 初始化器读取 localStorage，被 SSR payload 覆盖，且没有 `onMounted` 重载。实测设 `theme=dark, codeFontSize=18` 后 reload：`<html>` 无 `dark`、`--code-font-size` 仍 13px | `usePrefs.ts:33` |
| C2 | **G01 跨工具传递对 7/10 目标静默失败**，且 `consume()` 全仓从未调用 → 载荷残留内存，之后进入任一接收工具会被意外注入 | `useTransfer.ts:19-30,45` |
| C3 | **类型检查入口不可用**：无根 `tsconfig.json`，`nuxt typecheck` 直接失败；绕过入口后 `vue-tsc` 报 **51 个类型错误**，而 `nuxt build` 不检查类型照常成功 | `devkit/` |
| C4 | **无 service worker / PWA**：断网后任何页面都打不开，`/offline` 只是用 `localStorage['devkit.visited.v1']` 近似“已缓存”，且“重试”按钮是空操作、监听未清理 | `pages/offline.vue`、`nuxt.config.ts` |
| C5 | **只读编辑器复制禁用（P0-5）** 的连带有：多处“复制内容含行号/表头”（红线 6） | 子报告 #5 |
| C6 | **无障碍缺口**：命令面板 Esc 不可靠且无焦点陷阱、`DkSwitch` 无无障碍名、`DkSelect` 无 label、移动端触控目标偏小 | `CommandPalette.vue`、`DkSwitch.vue`、`DkSelect.vue` |
| C7 | **外链 Google Fonts** 与“纯静态 / 离线 / 隐私”定位冲突（首屏也要联网取字体） | `nuxt.config.ts` head |
| C8 | **文档与实现不符**：`FOUNDATION.md` 声称 `RunStatus` 含 `running`（实际无）、`DkModal` 用 `:open.sync`（实际 `:open`+`@close`）、组件清单漏 `DkSwitch`/`SendToMenu`；开发端口 3000/3100 说法不一 | `devkit/FOUNDATION.md`、`README.md` |

---

## 四、设计还原度问题（设计有、代码缺）

### 4.1 系统页 S01–S10（子报告 #1）
- **S01 首页**：缺页头（图标+标题+说明+`本地处理`徽标）、首页搜索卡片、“快捷与最近”分区结构；卡片字段/密度与设计有差。
- **S04 我的收藏**：设计是“工作区表格”（工具/分类/收藏时间/操作 + 排序 + 全部取消收藏 + 状态栏 + 说明区/FAQ），实现仅标题 + `DkSelect` + 卡片网格 + 空态。
- **S05 最近使用**：缺今天/更早**分组切换**、分类列、说明区。
- **S06 偏好设置**：设置项结构/分段控件/清理确认弹层清单与设计不符。
- **S07 隐私**：内容覆盖不足，并暴露“DevTools”笔误。
- **S08 帮助**：快捷键表与主题缺失。
- **S09 404**：结构缺失（叠加 P0-2）。
- **S10 离线**：设计的两态（已缓存可处理 / 首次未缓存 + 重试）在实现中均不存在。
- **R01/R03 适配稿**：仍是旧版「24 工具 / 5–6 分类」首页（含废弃入口“模拟数据生成”，节点 `U438d`/`pzqCt`），JSON/SM4 适配稿也用旧样例（文本重合度 0.45），与 S01（41 工具/8 分类）和代码三者不一致——历史文档 `docs/DevKit-Pen重复设计检查.md:31` 已提出，**未修复**。

### 4.2 工具页 T01–T41（子报告 #2/#3/#4）
- 覆盖较好的：T02、T05、T06、T12、T16、T19、T22、T23、T37、T39（含二维码生成→识别回环实测通过）、T41。
- 缺控件较多的（主画板参数面板完整度 50–70%）：**T27**（缺 5 组推断策略控件，`null→unknown`、`{}→Record<string,unknown>` 未按设计）、**T28**（缺只读静态模板预览）、**T29**（缺小数位/逐行勾选）、**T30**（缺格式选择/复制全部/建议替代色）、**T31**（“不安全内容被阻止”行为与设计相反：设计要求阻断预览，实现为剥离后仍预览；`al4QE` 优化视觉变体不可达）、**T32**（缺换行/属性换行/保留空行/导入文件，且无真实解析器）、**T33**（缺 RS256/ES256 明确不支持提示与合并结论）、**T34**（缺重复键合并/编码/排序；无效 URL 仍显示旧结果）、**T35**（缺凭证处理/缩进/目标语言/方向预设）。
- 必画变体在实现中**不可达**的：T31 不安全预览、T38 格式不支持、T40 目标编码无法表示字符。
- 缺失能力：T15 仅 Hex 密钥（设计要 PEM/Base64）、T17 缺 Base64 密钥、T18 缺输出格式选择与 time→ts 批量、T25 缺“仅复制堆栈”、T26 缺 scope 映射确认 UI。

### 4.3 共享交互与组件（子报告 #5）
- G01–G08 中 6 组“部分落地”、G07（长内容查找/换行/视图开关）整体缺失。
- C01–C15：13 个组件有实现但变体/几何偏差多；C08 代码编辑器缺语法高亮与错误行定位；C02 侧栏默认折叠状态与设计相反。
- 明/暗主题变量与设计 `variables`（43 个）**逐项一致**，这是还原度最高的部分。

---

## 五、覆盖矩阵摘要（需求 → 设计 → 代码）

| 范围 | 需求/设计 | 设计稿 | 代码 | 结论 |
|---|---|---|---|---|
| 工具主画板 | 41 | **41** | 41 组件（168–966 行） | ✅ |
| 工具必画变体 | 106 | **106（缺 0）** | 变体状态多数可复现，部分不可达 | ⚠️ |
| S01–S10 | 10 页 + 变体 | 17 张 | 9 个页面（`/offline` 语义不符） | ⚠️ |
| G01–G08 | 8 组 | 25 张 | 1 完整 / 6 部分 / 1 缺失 | ⚠️ |
| R01–R04 | 4 组 | 18 张 | 1366/390 无横向溢出；R01/R03 内容为旧版 | ⚠️ |
| C01–C15 | 15 + 变体 | 15 张 | 全部有组件 | ✅/⚠️ |
| 分类与工具目录 | 8 分类 / 41 工具 | S01 = 41/8 ✅ | `data/tools.ts` = 41/8 ✅ | ✅ |
| 命名一致性 | 任务书名称 | — | T11/T26/T28/T40 缺词 | ⚠️ |

---

## 六、已实测正确 / 正面结论（避免误报）

- 设计令牌：`main.css` 的明/暗变量与 `design.pen` 的 43 个变量逐项一致；顶部栏 60px、侧栏 236px、主区 24px 与设计一致。
- 密码学：SM3 国标向量通过；SM4 标准 ECB 向量通过；SM2 示例解密与 raw/DER 验签通过；AES-GCM 与 `node crypto` 逐字节一致；MD5/SHA/HMAC 自洽。
- 41 个工具路由全部 200，无失败请求；工具组件按路由拆包（生产首页不加载任何 `tXX-*` chunk）。
- SSR 无顶层浏览器 API 访问；无 `eval`/`new Function`；`v-html` 仅用于静态图标表；外链带 `rel="noopener noreferrer"`；localStorage 不保存输入正文/密钥。
- 1366×768 与 390×844 无横向溢出；无记录时不编造收藏/历史。
- 设计稿：`placeholder:true` = 0、无 `Generating`、无空壳画板、行号槽与行数一致（无截断迹象）。

---

## 七、存疑 / 无法完全验证

- 剪贴板权限拒绝、下载失败等路径依赖真实浏览器权限，部分只能代码级判断（子报告 #5 已标注）。
- 大文件（>50MB）性能与取消语义、图片压缩质量主观差异、`TextDecoder` 对 GBK 等编码的支持差异，需真机多浏览器复核。
- T32 的 HTML/CSS/JS 格式化使用自实现状态机而非成熟解析器，未做全面语法覆盖测试（存在隐患，非已确认 bug）。
- 生产构建下的行为仅抽样对照（子报告 #6 在 3200 端口跑过 `.output`）。

---

## 八、修复优先级路线图

| 优先级 | 事项 | 位置 |
|---|---|---|
| **P0-1** | 修 `get('year')` 空引用 → T20 恢复可用；补回归用例 | `t20-cron.vue:319` |
| **P0-2** | `error.vue` 导入 `getTool`；修正 404 判定；恢复 S09 文案与常用工具 | `error.vue:6,11` |
| **P0-3** | `useToolRun` 用 `lastSig === sig` 短路；补“载入示例→成功”回归 | `useToolRun.ts:15-24,30` |
| **P0-4** | SplitPanes 左栏去掉 `flex:1`（改 `flex: 0 0 auto` 或只保留 basis），补 50/50 断言 | `SplitPanes.vue` |
| **P0-5** | `DkEditor` 复制只由 `stale` 与空值门控，`readonly` 不禁止复制 | `DkEditor.vue:81` |
| **P1** | 删除/修正“假示例、假标签、假成功”（T33/T13/T15/T03/A7） | 见第三节 A 表 |
| **P1** | 修 T35 生成代码引号、T26 classifier、T21 负日、T24 计数、T01 定位 | 见第三节 B 表 |
| **P1** | 设计稿：废弃或重绘 R01/R03 旧版首页；清理画板内“演示数据/待验证”文案 | `design.pen` |
| **P2** | 补 S04/S05/S06/S07/S08 页头+工作区+说明区；补 T27/T29/T30/T31/T32/T34/T35 缺失控件 | 页面/工具组件 |
| **P2** | `usePrefs` 客户端重载；`useTransfer` 接收端与 `consume()`；无障碍修复 | 对应文件 |
| **P3** | 类型工程（tsconfig + vue-tsc + typecheck 脚本）；PWA/离线或明确降级文案；字体本地化；文档与端口一致性 | 工程配置 |

---

## 附录 A：子报告索引（均含逐条证据）

| 文件 | 范围 | 主要产出 |
|---|---|---|
| `audit/reports/r1-system-pages.md` | S01–S10 + R01–R04 | 16 条（含 404 阻断、离线能力缺失、S04 结构缺失） |
| `audit/reports/r2-tools-t01-t14.md` | T01–T14 | 覆盖率 ≈65%；useToolRun/DkEditor/T13/T03/T01 定位等 |
| `audit/reports/r3-tools-t15-t26.md` | T15–T26 | SM2/SM3/SM4 向量核对；T20 崩溃、T26 classifier、T15 假成功等 22 条 |
| `audit/reports/r4-tools-t27-t41.md` | T27–T41 | 覆盖率 ≈80%；T35 语法错误、T33 假篡改等 21 条 |
| `audit/reports/r5-shared-and-components.md` | G01–G08 + C01–C15 + 真实性红线 | 27 条（SplitPanes、复制禁用、传递失效、红线 6） |
| `audit/reports/r6-code-quality.md` | 构建/类型/SSR/安全/性能/一致性 | 22 条（51 类型错误、偏好失效、json.ts 缺陷） |
| `audit/reports/r7-docs-coverage.md` | 需求→设计→代码覆盖矩阵 | 209 张画板清点、缺词清单、历史报告结论复核 |

## 附录 B：本轮审核工具与原始数据

- `audit/tools/pen.py`：`.pen` 只读结构化查询（`frames/find/dump/text/stats`；注意文字字段是 `content`）
- `audit/tools/probe.py`：单页探测（状态/console/pageerror/布局 rect/CSS 变量/文字采样/a11y/截图）
- `audit/tools/crawl.py`：59 条路由全站巡检
- `audit/raw/design_inventory.json`、`design_variables.json`、`screens.json`、`crawl_1440_light.json`
- `audit/logs/r1..r7.log`：7 个子代理完整执行日志
- 全站巡检结论：59 条路由中仅 4 条被标记，其中 3 条为 404 页的预期告警，**真实异常只有 `/tools/cron` 一条**（即 P0-1）
