# R5 审核报告 · 共享交互 G01–G08 与可复用组件 C01–C15

审核范围：`design.pen` 批次 A4 共享状态 G01–G08（节点 `i8zQUL`）与 C01–C15 组件板；实现侧 `devkit/app/components/`、`composables/useToolRun|useToast|useClipboard|usePrefs|useFavorites|useRecent|usePalette|useTransfer`、`assets/css/main.css`、41 个工具页对共享交互的接入。
基准站点：http://localhost:3000（SSR）。所有结论均带设计节点 ID / 代码 `文件:行号` / 命令实测输出。只读审核，未修改任何 `devkit/**`、`design.pen`、`docs/**`。

---

## 结论摘要

**总体覆盖率**

| 范围 | 设计条目 | 完整落地 | 部分落地 | 未落地 |
|---|---|---|---|---|
| 共享状态 G01–G08 | 8 组 / 24 个状态画板 | 1（G08 隔离预览） | 6（G01/G02/G03/G04/G05/G06） | 1 类（G07 查找/换行/视图开关整体缺失） |
| 组件 C01–C15 | 15 | 1（C15 变量板，43 个变量 100% 一致） | 13 | 0（均由代码实现，但变体/几何偏差多） |
| 红线（任务书 33–45 行 10 条） | 10 | 6 | 2 | 2（红线 6 复制含行号；红线 3 大整数在其中一条链路上暴露为定位错误） |

**最严重问题（按影响）**

1. **[阻断] T20 Cron 页加载即崩溃，且错误页自身也崩溃**：`t20-cron.vue:319` 对默认 Unix 方言（无 `年` 字段）执行 `get('year').m` → TypeError；兜底渲染 `error.vue:11` 又调用未导入的 `getTool` → 二次崩溃。实测 `/tools/cron` 返回 200 但标题是「出错了」，`pageerror=['getTool is not defined']`。
2. **[阻断] SplitPanes 分栏比例计算错误，25 个工具受影响**：左栏同时有 `flex:1` 与内联 `flex-basis`，右栏 `flex:1`，导致 `initial=50` 实际渲染为左栏 74.6%。实测 `container=1140, left=850.5 (74.6%), right=280.5`。
3. **[高] `useToolRun` 存在「假待更新」**：watch 从不比较 `lastSig`（`useToolRun.ts:30` 赋值后从未读取），凡「同步改输入后立即 execute」的路径（载入示例等 20+ 处）成功后立刻被判 stale，复制/下载被禁。实测 t01 点「载入示例」后状态恒为「结果待更新」。
4. **[高] G01 跨工具传递对 7/10 个目标静默失败，且内存载荷不清除**：`transferTargets` 列了 10 个目标（`useTransfer.ts:19-30`），只有 t01/t02/t03 实现接收；`consume()` 全仓从未被调用（仅定义于 `useTransfer.ts:45`），载荷残留在模块内存，后续进入任一接收工具会被意外注入。实测：json-format →「文本差异比较」后目标输入为空；再客户端跳转 json-diff，左侧被自动填入上次的 JSON。
5. **[高] JSON 解析错误行列定位错误**：`utils/json.ts:77` 用 `wrapNumbers(text)` 包裹数字后交给 `JSON.parse`，异常 position 对应的是变长后的文本；`t01-json-format.vue:67` 却按原始文本换算。实测输入 `{"a": 1,}`（9 字符）报「第 1 行第 10 列附近 … position 18」。

---

## 覆盖对照表

### G01–G08 设计项 → 实现 → 结论

| 设计项 | 设计节点 | 实现 | 结论 |
|---|---|---|---|
| G01 目标菜单（只列兼容目标 + 不兼容行置灰） | `VZOQn` | `SendToMenu.vue:16-18,50-56` | **部分**：只显示兼容目标，设计里的「不兼容」置灰行（SM4/图片压缩）与每项副说明（“按当前文本打开”“作为差异左侧输入”）完全缺失；标题由「发送到兼容工具 · 内容识别为 JSON」退化为「兼容的目标工具」 |
| G01 替换确认 | `NxIkX` | `t01:171-182`、`t02:453-460`、`t03:431-438` | **部分/实际不可达**：3 个接收工具都有确认弹层，但接收页挂载时输入必为空（每工具独立挂载），`replaceAsk` 分支（`t01:20-24`）在真实流程中不会触发，属死代码 |
| G01 已进入目标轻提示 + 撤销 | `cqTLs` | 无 | **未实现**：无「已从「Base64 解码结果」发送 1 行（126 字节）」提示与「撤销」 |
| G01 目标兼容性 | `useTransfer.ts:19-30` | — | **不合格**：10 个目标中 text-diff/base64/url-encode/text-dedup/regex-test/sm3/md5-sha 共 7 个页面无任何接收逻辑（全仓仅 `t01/t02/t03` import `useTransfer`） |
| G02 拖入高亮 | `TFRBq` | `FileDrop.vue:46-58,92-99` | ✅ 拖入高亮/点击选择/键盘可操作 |
| G02 读取中 | `AURm7` | `t37:346-350`；`t12:238`、`t16:203`、`t38:299` | **部分**：t37 有真实分块进度；其余文件工具只显示「读取中…」，无取消 |
| G02 计算进度（不编造百分比） | `UcKkM` | `t37:346-350` | **部分**：只读字节进度，SHA 段无「计算中 62%」态（SHA 走整块内存计算），未编造百分比 ✅ |
| G02 取消完成 | `s0OJy` | `t37:331-341,96-104` | **部分**：t37 可取消且不写部分摘要；但全部取消时被判为失败（见缺陷 D6），其余文件工具无取消 |
| G02 读取失败 + 重试 | `tE8A7` | `t37:157-165` | **部分**：有失败文案，但无设计要求的项内「重试」，只能整批重算或移除 |
| G02 超出当前限制 | `tan8r` | `t37:73-78`、`FileDrop.vue:24-29` | **部分**：有明确上限文案，但 t37 是 toast「已跳过」，不是设计画板的项内「超出当前读取上限，未开始读取」状态 |
| G03 复制成功 | `TRsUU` | `useToast.ts` / `useClipboard.ts:31-32` | **部分**：仅有 toast，无设计里的行内「已复制」态与「复制内容为纯摘要文本，不含行号与单位说明」注记 |
| G03 剪贴板不可用 | `x7KTGF` | `useClipboard.ts:18-37` | **未达标**：只有一句 `toast.error('剪贴板不可用，请在结果框中手动选择并复制')`（实测原文），无「重试授权」按钮、无自动全选结果的手动复制面板；且 `error()` 包装器丢弃 action，无法承载操作按钮（`useToast.ts:37`） |
| G03 下载准备完成 / 下载失败 | `amLL3` / `S4Xf7k` | `utils/bytes.ts:9-18` | **未实现**：`downloadBlob` 直接 `a.click()`，无「已准备 result-sha256.txt（96 B）」确认、无失败捕获与「重试下载」，全仓 grep「下载准备/保存文件/重试下载/下载失败」= 0 命中 |
| G04 编辑前（结果有效） | `tKH2v` | `DkStatusBar.vue:19-20` | ✅ 成功态可复制下载 |
| G04 结果已旧 | `ogroI` | `DkStatusBar.vue:23-24,45-47`、`t12:264` | **部分**：状态栏「待更新」+「重新执行」+ 复制禁用已实现；缺设计里的「以下为修改前的旧结果…」横幅、旧结果标签「SHA-256 · 旧结果（输入 abc）」、旧值灰显、以及「输入已修改：abc → abcd（3 字节 → 4 字节）」差异说明（`useToolRun.ts:21` 只有通用文案） |
| G05 空输入 | `YBa6g` | 多数工具空态 + `DkEditor` placeholder | ✅ |
| G05 示例入口 | `uuExn` | 各工具「载入示例」按钮 | **部分**：单一固定示例，缺设计的示例选择列表（订单对象/嵌套配置/语法错误示例/大整数）与「示例数据 · 只用于测试」标注 |
| G05 载入替换确认 | `yDpMe` | 无 | **未实现**：全仓 0 个替换确认；`t01:122` `@click="input = SAMPLE; execute()"` 静默覆盖未保存输入 |
| G06 算法不支持/能力缺失 | `iy2nr` | 无 | **未实现**：全仓无「当前构建未包含…/能力缺失」文案；t12 只列 MD5/SHA-256/SHA-512，用户参数错误与系统能力缺失都落到「失败」 |
| G06 解析失败（定位字段、保留输入） | `Pl3Np` | `t01:63-69`、`t22:510`、`t03:105` 等 | **部分**：都保留输入、文案区分「解析失败」；但 t01 行列定位错误（见缺陷 D5），且无设计要求的行内错误高亮（仅状态栏，`DkEditor` 的 `error` 未传） |
| G06 任务取消（不是错误） | `AkkM9` | `t37:176-177` | **未达标**：取消被 `run.markFail` 判为红色「失败」（`DkStatusBar.vue:21-22`） |
| G07 横向滚动 | `hTluV` | `DkEditor.vue:229,214`（`wrap=off` → `white-space:pre`） | **部分**：原语可用（组件有 `wrap` prop），但没有任何工具暴露开关，默认全部软换行；`prefs.editorWrap` 从未被消费 |
| G07 自动换行与查找 | `X8miW` | `DkEditor.vue:24` | **未实现**：无换行开关、无「只看输入/只看输出」、无编辑器内查找（grep「查找/Ctrl+F/只看」= 0），无「折行不新增行号」与 ↵ 标记 |
| G07 分栏拖动 | `hTluV` | `SplitPanes.vue` | **部分**：拖动可用，但比例计算错误（见缺陷 D1） |
| G08 源码与隔离预览 | `Hzx75` | `t31-svg.vue:45-70,147-151,261-263` | ✅ 隔离有效：DOMParser 剥离 script/foreignObject/on*/外部 href，`img` data URL 渲染；实测无 XSS、无外部请求 |
| G08 安全提示 / 无法完整还原提示 | `mBf4B` | `t31:265-273,316-321` | **部分**：有剥离清单与说明；缺设计的「隔离预览 / 仅源码」视图切换与置顶安全提示条 |

### C01–C15 设计组件 → 实现 → 结论

| 组件 | 设计本体/变体板 | 代码 | 关键差异（设计值 vs 代码值） |
|---|---|---|---|
| C01 顶部导航 | `PQJ6y` / `G3nZP` | `TopNav.vue` | 内边距设计 `[0,24]` vs `TopNav.vue:94` `0 20px`；搜索框设计 `r8 / stroke $border` vs `:135-136` `--radius-sm(6) / $border-strong`；品牌字距 −0.3 vs `:125` +0.2px |
| C02 侧栏与分类 | `vxMha` / `VAmOT` | `SideNav.vue` | 设计默认折叠（`子列表 · *` 高度=0）、仅展开当前分类 vs `SideNav.vue:8,66` 默认全展开；条目圆角设计 8 vs `--radius-sm=6`；隐私说明卡片（`c29ML` `$surface-subtle/radius10/stroke $border`）在 `SideNav.vue:228-235` 无底/无圆角/无描边 |
| C03 工具卡片 | `I1Bhp` / `ygdCz` | `ToolCard.vue` | 设计 `w320/pad16/gap10/radius10` vs `:49-52` `pad14/gap8/radius8`；图标底设计 32/圆角 7 vs 32/6 |
| C04 搜索与命令面板 | `o7OL6` / `k9Lv8` | `CommandPalette.vue` | 设计面板宽 420 vs `:137` 640px；遮罩色 `:130` 硬编码 `rgba(...)` 未走变量 |
| C05 按钮与图标按钮 | `Pet6k` / `EWi3O` | `DkButton.vue`、`DkIconButton.vue` | 设计主按钮 `h30 / r7 / pad[0,12] / 字12.5` vs `DkButton.vue:46-49` `h32 / r6(--radius-sm) / pad 0 14 / 字13`；设计缺「处理中/聚焦/禁用」变体板部分态，代码有 loading/disabled/focus-visible |
| C06 参数字段 | `x1e6C` / `ZxvS8` | `DkInput.vue`、`DkField.vue`、`DkSelect.vue` | 设计输入 `h30/r7/pad[0,10]/stroke $border` vs `DkInput.vue:37-40` `h32/r6/$border-strong`；错误态设计 `fill $error-soft + stroke $error` + 标签 `$error` vs `:66-68` 仅换边框、`DkField.vue:28` 标签不变色；设计多行文本域（`o0yqW` h66）无对应实现（只有 `<input>`） |
| C07 分段控件与下拉 | `tPt2l` / `LAxbr` | `DkSegmented.vue` | 设计容器 `pad3/gap3/无描边/radius8`、选中 `h28/radius6/stroke $border`、选中字色 `$text-primary` vs `:35-42,63-64` `pad2/gap2/border 1px/radius6`、选中 `h26/radius4/字色 accent` |
| C08 代码编辑器 | `WJkbJ` / `I2CTz` | `DkEditor.vue` | **无语法高亮**（设计 token 分色 `$code-key/$code-string/$code-number/$code-bool/$code-punct` vs textarea 单一 `--text-primary`）；无错误行定位（设计 `OsCMt` 错误行底 `$error-soft` + 行号 `$error` vs `:153-155` 整框变色）；工具条设计 h32 vs 34px |
| C09 结果状态栏 | `yvE1y` / `uzR1p` | `DkStatusBar.vue` | 设计主文案槽是具体结果（`yvE1y` “校验通过”），代码把「成功/失败」放主槽（`:20-28,41`）、具体文案退到次要槽；背景设计统一 `$surface-subtle` vs 代码按状态染 soft 底（`:34`）；**设计变体板只有 成功/错误/警告/信息/加载中，缺任务书 C09 要求的 待更新/未执行**（代码反而有 stale/idle） |
| C10 文件拖入与列表 | `kWQyu` / `iMTIx` | `FileDrop.vue` | 组件本体错位：设计 `kWQyu` 是「文件项」（`r8/pad[10,12]/gap10/图标底30×30 r7`），代码 `FileDrop` 只是拖入区；文件项状态散落在 `t37:324-390`；超限只弹 toast（`FileDrop.vue:27`）而非项内态；**拖入不校验 `accept`**（`:21-37,67`） |
| C11 Toast 与内联提示 | `R4IbS7` / `aF5zK` | `DkToastHost.vue` | 设计 `r9/pad[10,12]/gap10/字12` vs `:55-60` `radius8/pad 9px 12px/字13`；内联提示条（带动作按钮的 `$accent` 文本）无独立组件，仅 toast |
| C12 弹层与确认框 | `CerYs` / `BzEcd` | `DkModal.vue` | 设计 `r12/pad18/gap14` vs `:92,100,110` `r12/pad 14-18` 基本接近；设计「移动底部抽屉」`pM0QN` 无实现；**无焦点陷阱**（`:48-49` 仅 `aria-modal`，Tab 可离开、离开后 Esc 失效）；`danger` 类无 CSS（死类，`:46`） |
| C13 树形视图与差异行 | `MBSI5` / `B6Lakz` | `JsonTree.vue`、`t02-json-diff.vue` | 设计树行 `h28/r6/pad[0,8]/gap6`、类型 chip、值右对齐、「N 项」、工具条（全部展开/折叠/复制 JSON）全缺（`JsonTree.vue` 仅有 ▾/▸ 字符与递归行）；差异行设计「修改」为 `error-soft/ok-soft` 双行堆叠，代码单行 `old→new` 用 `--warn`（`t02:443-447`） |
| C14 说明折叠区 | `M5DyY` / `B1X7fF` | `DkCollapse.vue` | 设计 `r9/pad[12,14]/gap10 + 26×26 图标底 + 折叠摘要 + 展开/收起动作文字` vs `:24-36` `radius8/h44/pad 0 16`，无图标底/摘要/动作文字/展开高亮 |
| C15 颜色、字体、间距变量 | `LYFe2` / `e8RFz` | `main.css` | ✅ **43 个设计变量全部存在且值一致**（明/暗），字体 `Noto Sans SC`/`JetBrains Mono` 一致；代码额外新增 `--accent-hover`、`--code-null`、`--editor-*`、`--diff-*`、`--radius*`、`--shadow-*`、`--topnav-h`、`--sidenav-w`、`--code-font-size`、`--reduce-motion`；设计未把圆角/间距做成变量，代码用 `--radius=8`/`--radius-sm=6` 统一，导致设计 7/8/9/10 被压小 |

> C15 变量逐项比对由脚本完成：`cat-*-soft` 设计用 8 位 hex（`1A`/`26`）等价于代码 `rgba(...,0.1)`/`rgba(...,0.15)`，非差异。

### 红线 10 条落地情况（任务书 33–45 行）

| # | 红线 | 结论 | 证据 |
|---|---|---|---|
| 1 | 状态栏数字从真实示例推导 | ✅ | `t05:104,122`、`DkEditor.vue:33-38` 均由实际字节/行数计算 |
| 2 | 加解密/摘要结果真实计算 | ✅ | `t15/t16/t17` 用 `sm-crypto`；`t13/t14/t33` 用 WebCrypto；`t12:88-100` WebCrypto+spark-md5；无「演示结果/待实现」 |
| 3 | 不静默 trim / 改换行 / 换编码 / 丢大整数精度 | ⚠️ 部分 | 大整数安全解析覆盖好（`utils/json.ts:7-111`，t01/t02/t03/t04/t22/t27/t35/t33 全用 `parseJson`，无裸 `JSON.parse`）；但 `wrapNumbers` 造成解析错误定位错位（缺陷 D5）——这是同一机制的另一面 |
| 4 | 改输入后旧结果待更新、禁复制下载 | ⚠️ 部分 | 机制存在（`useToolRun.ts`、`t12:264`），但「假 stale」（D3）与「失败后旧结果恢复可复制」（D7）两个方向都出问题 |
| 5 | 解码/解析/格式正确/验签成功文案区分 | ✅ | JWT：`t33:145,244,248` 明确「解码成功 ≠ 签名有效」「签名验证通过」「签名不匹配」；解析类工具均用「解析失败」 |
| 6 | 复制内容不含行号/偏移/语法提示/展示换行 | ❌ | `t02-json-diff.vue:332` 复制差异报告带 `1.` `2.` 行号前缀；`t18-timestamp.vue:391-396` 复制带表头行。其余摘要/JWT/Base64 复制为纯值 ✅ |
| 7 | 文件处理提供 名称/大小/移除/进度/取消/失败；不写「上传中」 | ⚠️ 部分 | t37 全有；t05/t12/t16/t38/t40/t41 只有名称/大小/移除/「读取中」，无取消/进度；全仓无「上传中」✅ |
| 8 | 禁用/聚焦/选中/悬停/复制成功/取消态有定义 | ⚠️ 部分 | 组件层齐全（`.dk-btn:disabled`、`:focus-visible`、toast）；但「复制成功」无行内态、「取消」态只在 t37 |
| 9 | 只把工具 ID/非敏感参数放 URL；不传输入/密钥；跨工具仅内存 | ⚠️ 部分 | URL 无 query 参与计算（`useTransfer.ts:69` 只 push 路径）；localStorage 只存偏好/收藏/最近（`usePrefs.ts:19`、`useFavorites`、`useRecent.ts:22`），工具页 grep `localStorage` = 0；但载荷 `consume()` 未调用导致内存残留并错误注入（D4） |
| 10 | 不提前承诺「所有大文件/永不失败/完全安全」；离线区分缓存 | ✅ | 全仓 grep 无此类文案；`t37:349`、`t31` 均给不确定态说明 |

---

## 设计还原问题

### R1 [高] C08 代码编辑器缺语法高亮与错误行定位
- 设计：`WJkbJ`/`I2CTz` 的代码行按 token 分色 `$code-key`（键）、`$code-string`（字符串）、`$code-number`（数字）、`$code-bool`、`$code-punct`；错误态 `OsCMt` 给错误行 `$error-soft` 底、行号 `$error`。
- 实现：`DkEditor.vue:114-127` 是纯 `<textarea>`，`:213-227` 单色 `--text-primary`；`:153-155` 仅把整框 `border-color` 换成 `--error`。
- 影响：C08/C13 设计核心（token 分色）完全未实现。

### R2 [高] C02 侧栏默认状态与设计相反
- 设计：`vxMha` 的 9 个「子列表 · *」高度均为 `0`，`VAmOT` 说明「分类默认折叠，仅展开当前分类」。
- 实现：`SideNav.vue:8` `collapsed={}` 初始为空对象、`:66` 判定为「未在 collapsed 中即展开」→ 默认全展开。
- 另：隐私说明卡片 `c29ML`（`$surface-subtle/gap7/pad[11,12]/radius10/stroke $border 1`）在 `SideNav.vue:228-235` 无底/无圆角/无描边。

### R3 [高] C13 树形视图大面积缺实现
- 设计 `T01` 内 `h9YsmT/l7DyLg/D22md`：行高 24、值右对齐、类型 chip、容器「N 项」、工具条（全部展开/全部折叠/复制 JSON）。
- 实现：`JsonTree.vue:61-81` 仅递归行、`▾/▸` 字符、无行盒、无类型标签、数组无索引、缩进画了虚线边框；`t01-json-format.vue` 无任何复制 JSON/展开折叠入口。

### R4 [高] C13 差异行样式不符
- 设计：`L4j5tK`「修改」是 `error-soft`/`ok-soft` 双行堆叠；`sssj4`「新增」整行 `ok-soft`；路径恒 `$code-key`、旧值恒灰。
- 实现：`t02-json-diff.vue:443-447` 单行 `old→new` 用 `--warn`；`:512-553` 整行无软底仅 badge 有底；`:555-587` 路径/旧值按 kind 整体染色。

### R5 [中] C06 字段错误态与多行文本域
- 设计 `ajIwy` 错误输入 `fill $error-soft / stroke $error`，`r2G57V` 标签 `$error`；`o0yqW` 多行文本域 h66。
- 实现 `DkInput.vue:66-68` 只换边框、`DkField.vue:28` 标签不变色；组件只有单行 `<input>`，无多行变体。

### R6 [中] C05/C06/C07 几何系统性偏小
- C05 按钮：设计 `h30/r7` vs `DkButton.vue:46,35` `h32/r6`。
- C06 输入：设计 `h30/r7/pad[0,10]/$border` vs `DkInput.vue:37-40` `h32/r6/pad 0 10/$border-strong`。
- C07 分段：设计容器 `pad3/gap3/无描边/r8`、选中 `h28/r6/$border`、选中字色 `$text-primary` vs `DkSegmented.vue:35-42,63-64` `pad2/gap2/border/radius6`、选中 `h26/r4/accent`。
- 根因：`main.css:84 --radius-sm:6px` 把设计 7/8 统一压小；设计没有圆角变量。

### R7 [中] C04 命令面板宽度与硬编码遮罩
- 设计 `o7OL6` 宽 420 vs `CommandPalette.vue:137` 640px；`:130` 与 `DkModal.vue:80` 的遮罩 `rgba(15,17,21,0.45)` 硬编码，未走变量。
- `TopNav.vue:131-136` 搜索框 400×34 与设计 `PQJ6y` 一致，但圆角/边框色偏差（见 C 表）。

### R8 [中] C09 状态栏主槽语义与背景
- 设计 `yvE1y` 主文案槽是具体结果（“校验通过”），代码把「成功/失败」放主槽、具体文案退次要槽（`DkStatusBar.vue:20-28,41`）；背景设计统一 `$surface-subtle`，代码按状态染 soft 底（`:34`）。
- 设计变体板 `uzR1p` 只画了 成功/错误/警告/信息/加载中，**缺任务书 C09 必需变体 待更新/未执行**——这是设计侧缺口，代码反而补齐了 stale/idle。

### R9 [中] C14 折叠区缺结构化头部
- 设计 `M5DyY`：26×26 图标底 `$surface-subtle` + 标题 + 折叠摘要 + 「展开/收起」动作文字，展开态图标底 `accent-soft`。
- 实现 `DkCollapse.vue:24-36` 仅 chevron + 标题，无摘要/图标底/动作文字/展开高亮。

### R10 [低] C03/C11 细节
- C03 设计 `pad16/gap10/radius10` vs `ToolCard.vue:49-52` `pad14/gap8/radius8`。
- C11 设计 `r9/pad[10,12]/字12` vs `DkToastHost.vue:55-60` `r8/pad 9px 12px/字13`。

---

## 功能与代码缺陷

### D1 [阻断] SplitPanes 分栏比例错误（影响 25 个工具）
- `SplitPanes.vue:66` `.split__pane { flex: 1 }`（= `1 1 0%`），左栏 `:38` 内联 `flex-basis: leftPct%`，右栏 `:53` 无 basis。剩余空间在两个 grow=1 的子项间平分，左栏 ≈ `(1+x)/2`。
- 实测 `/tools/json-format`：容器 1140，左 850.5（**74.6%**），右 280.5，而非 `initial=50`。用户拖动时比例同样失真。

### D2 [阻断] T20 Cron 崩溃 + 错误页自身崩溃
- `t20-cron.vue:24` 默认 `dialect='unix'`；`:212` 仅在 7 字段（quartz）时追加 `年` 字段；`:319` `const yearM = get('year').m …` 对 unix 必然 `undefined.m`。`:539-540` `onMounted → execute()` 触发。
- 兜底渲染 `error.vue:11` `getTool(s)` 未 import（`[slug].vue:2` 才 import），二次抛错。
- 实测：`/tools/cron` HTTP 200、`title=出错了 · DevKit`、`pageerror=['getTool is not defined']`、console `[Vue warn] … H3Error: Cannot read properties of undefined (reading 'm')`。`/tools/nope-xyz` 也报 `[NUXT_E1005] Error caught during app initialization`。

### D3 [高] useToolRun「假待更新」
- `useToolRun.ts:15-24` watch 回调拿到 `sig` 却不用、也不与 `lastSig` 比较；`:30` `lastSig` 赋值后全仓无读取。
- 凡「同步改输入 → 立即 execute」都在同一次 flush 内先 markOk、随后 watch 命中置 stale。`t01:122`、`t22:652`、`t25:333`、`t27:297` 等 4 处显式，另有 20+ 个 `loadSample` 内调用 `execute()`。
- 实测 t01 点「载入示例」：状态栏 =「结果待更新 / 输入或参数已修改，结果待更新 / 重新执行」，结果编辑器复制按钮 disabled。

### D4 [高] G01 跨工具传递：7/10 目标静默失败 + 载荷不清除
- `useTransfer.ts:19-30` 目标表 vs 全仓仅 `t01/t02/t03` import `useTransfer`；`compatibleTargets`（`:55-57`）按 kind 过滤但无法过滤「未实现接收」的目标。
- `consume()`（`:45-49`）从未被调用（grep 仅定义处命中）；`deliver()`（`:66-70`）只 `router.push`。
- 实测：json-format 发送 →「文本差异比较」→ `/tools/text-diff` 左侧输入为空、状态「未执行」；随后客户端点击侧栏进入 `/tools/json-diff`，左侧被自动填入上次的 `{"leak": 999}`（非用户本意）。
- 另缺 `cqTLs` 的已进入目标提示与撤销；`SendToMenu.vue:50-56` 缺设计的不兼容置灰行与副说明。

### D5 [高] JSON 解析错误行列定位错误
- `utils/json.ts:48` 把每个数字替换为 `"@@raw:…@@"`（每个数字至少 +10 字符），`:77` 用它喂 `JSON.parse`；异常 position 基于变长文本，而 `t01:67` 用 `jsonErrorPosition(e, input.value)` 按原始文本换算。
- 实测输入 `{"a": 1,}`（9 字符）：状态栏「第 1 行第 10 列附近 … position 18 (line 1 column 19)」。同类问题存在于任何使用 `jsonErrorPosition` + `parseJson` 的工具（t22:510、t27 等）。

### D6 [高] G06 任务取消被判为「失败」
- `t37-file-digest.vue:176-177`：全部取消时 `run.markFail(...)` → `DkStatusBar.vue:21-22` 渲染红色「失败」。
- 取消项无「重新读取」入口，只能整批重算或移除（`:331-341`）。设计 `AkkM9` 明确「这是主动取消，不是错误」。

### D7 [高] 失败后旧结果恢复可复制
- `markFail`（`useToolRun.ts:34-40`）把状态切成 `error`，而各工具的复制禁用条件普遍只判断 `status==='stale'`（如 `t12:264`、`t13:190`、`t14:359`、`t19:333`）。用户改输入触发 stale（复制被禁）→ 再点执行且执行失败 → 状态变 error，旧结果重新可复制，但已不对应当前输入。
- 属红线 4 的反向漏洞。建议禁用条件包含 `stale || error`。

### D8 [高] G05 载入示例无替换确认
- 设计 `yDpMe` 要求非空输入时弹「载入示例将替换当前内容…」，空输入直接载入。
- 实现：全仓 grep「替换并载入/示例将替换」= 0；`t01:122`、`t08:92`、`t09:121`、`t25:333`、`t27:297` 等直接覆盖。运行实测有输入时 modal 数 = 0。

### D9 [高] G07 缺换行开关、只看输入/输出、编辑器查找；prefs 未接线
- `DkEditor.vue:24` 默认 `wrap:true`，`:229` `[wrap=off]{white-space:pre}` 原语存在；全仓 `:wrap` 仅 t18:456、t41:291 且均为 `true`。
- `usePrefs.ts:5` 定义 `editorWrap`，仅 `settings.vue:99` 消费；而该处文案还写「关闭后长行横向滚动，可在工具内临时切换」——工具内切换并不存在，属误导文案。
- 查找：`DkEditor` 无搜索框、无 Ctrl+F；「只看输入/只看输出」grep = 0。设计 `X8miW` 要求「3 / 7 命中」「↵」与「折行不新增行号」。

### D10 [高] 只读结果编辑器「复制」永久禁用
- `DkEditor.vue:81` `:disabled="!modelValue || stale || readonly"`。所有以 `readonly` 展示结果的编辑器（t01 等 21 个工具）自身「复制」按钮永远禁用，即使状态为 ok。
- 实测 t01 载入示例后结果编辑器复制按钮 `disabled=true`（该场景同时受 D3 影响；单独在成功态下 `readonly` 仍使其禁用）。

### D11 [中] G07 软换行时行号与文本错位
- `DkEditor.vue:32` 行号 = 逻辑行数，`:209-212` 每个 gutter 项固定 `height = font-size*1.6`，不感知视觉折行；textarea 软换行后内容高度 > gutter 高度。
- 实测（400 字符长行 + 1 行）：`textarea.scrollHeight=103` vs `gutter.scrollHeight=62`（另一用例 270 vs 166）。设计 `X8miW` 要求「折行不新增行号」且行号仍与其逻辑行对齐。

### D12 [中] G02 FileDrop 拖入不校验 accept
- `FileDrop.vue:21-32` 只校验 `maxSize`；`accept` 仅绑到 `<input>`（`:67`），`onDrop → emitFiles`（`:34-37`）不检查类型。t31（`accept=".svg,image/svg+xml"`）、t38（image/*）等可拖入任意文件，再由各工具自行兜底，行为不一致。
- 另 `maxSize` 只报第一个超限文件并吞掉其余；组件无取消/失败/进度态（这些散落在 t37，见 C10）。

### D13 [中] G03 剪贴板失败与下载反馈未达设计
- `useClipboard.ts:18-37`：失败仅 `toast.error('剪贴板不可用，请在结果框中手动选择并复制')`（实测），无「重试授权」动作、无自动全选的手动复制面板；`useToast.ts:37` 的 `error()` 包装器丢弃 `action`，即使想加也加不上。
- 下载：`utils/bytes.ts:9-18` 无 try/catch、无准备确认；设计 `amLL3`/`S4Xf7k` 的「保存文件/取消」「重试下载」均无。

### D14 [中] G06 缺「能力缺失/算法不支持」类
- 设计 `iy2nr` 要求「当前构建未包含 SHA-3-256 实现 / 这不是你的输入有问题 / 改用 SHA-256」。实现中 `t12-md5-sha.vue:8-10` 只暴露可用算法，能力缺失与用户参数错误都归入通用「摘要计算失败」（`:115-116`），文案不区分。

### D15 [中] DkModal 无焦点陷阱、danger 死类
- `DkModal.vue:48-52` 只有 `role=dialog/aria-modal`，无 Tab 循环；Esc 监听挂在 panel 上（`:52`），焦点 Tab 离开 panel 后 Esc 失效。设计 R04 要求「Tab 顺序遵循视觉顺序，模态框关闭后焦点回到触发入口」（回焦 `:25` 已实现 ✅）。
- `:46` 的 `dk-modal__panel--danger` 无对应 CSS 规则，`danger` 仅多一个警告图标（`:56`）。

### D16 [中] 红线 6：复制内容含行号/表头
- `t02-json-diff.vue:332` 复制差异报告为 `1. [修改] path …`，含行号前缀。
- `t18-timestamp.vue:391-396` 复制 TSV 含表头行。
- 设计 G03 注记与红线 6 要求复制内容不含行号/展示性换行；建议改为无编号纯文本或明确区分为「导出报告」。

### D17 [低] 偏差点
- `SendToMenu.vue:66-72` 按钮 `h24/字12/无底色` vs 设计 `VZOQn` `h30/字13/$accent-soft`；菜单项设计 h40、两行（名称+说明），代码 h30 单行（`:102-113`）。
- `useToolRun` 的 `markFail` 在 t12 等工具中不清空旧输出（`:34-40`），与 D7 叠加。
- 5 个工具（t18/t19/t20/t21/t41）使用 `DkStatusBar` 但未传 `:retry`，stale 时状态栏无「重新执行」按钮（t20 另有 D2）。grep `DkStatusBar` 40 文件、`:retry=` 35 文件。
- `t39-qrcode.vue:15` 预填 `DEFAULT_TEXT` 且 `:72` `onMounted → generate()`，首屏即带输入并显示「成功」，与 G05 空输入/示例入口模式不一致（结果本身是真实计算，非伪造）。
- `t21:411-421`、`t18:391` 复制内容带单位/时区注记，与红线 6「不含单位说明」字面冲突（多字段摘要场景可接受，列为建议）。

---

## 无法验证/存疑项

1. **剪贴板真实权限拒绝路径**：headless Chromium 默认允许 `navigator.clipboard`，我通过 `addInitScript` 同时让 `navigator.clipboard.writeText` reject 且 `document.execCommand=()=>false` 复现了失败 branch，确认走 `toast.error` 且无手动面板。真实浏览器「权限弹窗被拒」路径的中间态（`NotAllowedError`）未能实机触发，但代码分支一致。
2. **下载失败反馈**：无法稳定构造浏览器拒绝下载的场景，结论基于 `utils/bytes.ts` 无 try/catch、无文案（grep 0）判定为“未实现”，非负向实测。
3. **t20 崩溃根因**：`get('year').m` 由静态推导 + 报错栈确认（默认 unix 无 year 字段），未逐行断点；但 `/tools/cron` 必崩已实测，`/tools/cron?` 任意 query 不影响。
4. **`/tools/nope-xyz` 的 `[NUXT_E1005]`**：`error.vue:11` 缺 import 已确认，但 Nuxt 在 404 场景能先输出 title，是否每次 404 都触发该警告取决于 SSR/CSR 路径，未穷举。
5. **设计交付完整性**：`pen.py text/dump` 对部分 G 帧返回空（引用节点），本报告 G01/G02/G04/G08 设计值由自写遍历脚本读取，未依赖 `pen.py text`。
6. **`audit/tools/probe.py` 无法覆盖多步交互**（如 G05 替换确认、G01 连续跳转），相关结论用自写 Playwright 脚本实测，命令与输出已在上文引用。

---

## 修复优先级建议

**P0（阻断，先修）**
1. `t20-cron.vue:319` 改 `get('year')?.m` 并对无 year 字段返回 undefined；同时 `error.vue:11` 补 `import { getTool } from '~/data/tools'`，避免错误页二次崩溃。补回归：`/tools/cron` 与任意 404 页无 pageerror。
2. `SplitPanes.vue`：左栏改为 `flex: 0 0 <pct>%` 或右栏同步分配剩余，验证 `initial=50` 时 `left/container ≈ 0.5`（影响 25 个工具）。

**P1（高，功能正确性/红线）**
3. `useToolRun.ts`：watch 内比较 `getSignature() !== lastSig` 才置 stale；修复载入示例后立即 stale。
4. `useTransfer.ts`：接收工具改为 `consume()`；`transferTargets` 收敛为真实实现接收的 slug；`SendToMenu` 的兼容判断改为「实现能力」清单，避免 7 个死目标；补 `cqTLs` 的进入提示与撤销。
5. `utils/json.ts` + `jsonErrorPosition`：改为对原文定位（记录被替换数字的映射，或解析失败时对原文再 parse 取位置），修复 D5。
6. `DkEditor.vue:81` 复制禁用去掉 `|| readonly`；`DkEditor` 接入 `prefs.editorWrap` 并暴露换行开关、只看输入/输出、编辑器查找；`settings.vue:99` 文案同步。
7. G05 载入示例统一走「非空则确认」弹层；G06 取消态改用独立 `cancelled` 状态而非 `markFail`；`t37` 失败项补「重试」；复杂执行提供真实取消。
8. 各工具复制/下载禁用条件统一为 `stale || error`（D7）；`markFail` 时明确旧输出失效。

**P2（中，设计还原与组件一致性）**
9. 组件几何对齐：按钮 30/7、输入 30/7、分段 28/6、折叠 9、toast 9、卡片 10/16 —— 引入 `--radius-md:7` 之类语义变量替代 `--radius-sm=6` 的一刀切。
10. `DkModal` 加焦点陷阱与 `danger` 样式；`FileDrop` 拖入校验 `accept` 并把文件项状态（读取/进度/失败/取消/超限）沉淀成组件；`JsonTree` 按设计补行盒/类型 chip/工具条；`DkCollapse` 补图标底+摘要+动作文字；`DkStatusBar` 主槽改为具体文案。
11. 红线 6：去掉 `t02:332` 行号前缀与 `t18` 表头（或明确标注为「导出报告」）。
12. 下载补「准备/失败/重试」反馈（新建 `useDownload`），剪贴板失败补手动复制面板 + 重试授权，`useToast.error` 支持 action。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/r5-shared-and-components.md
