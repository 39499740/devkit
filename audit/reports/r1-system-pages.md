# DevKit 审核报告 · 子代理 #1（系统页与适配）

范围：设计稿 S01–S10 + R01–R04 ↔ 实现代码 ↔ 运行站点（http://localhost:3000）。
所有结论均带证据（设计节点 ID / 代码 `文件:行号` / 命令输出）；未确认项集中在“无法验证/存疑项”。

---

## 结论摘要

- **覆盖率**：S01–S10 全部 11 组画板（S02/S03/S04/S05/S06/S10 的双变体均读）与 R01–R04 全部 15 个画板已逐一读取；运行站点探测了 `/`、`/category/format`、`/category/java`、`/favorites`、`/recent`、`/settings`、`/privacy`、`/help`、`/offline`、`/tools/does-not-exist`、`/category/nope`、`/tools/sm4`，并跑了 1440×900 / 1366×768 / 390×844 与 `--dark` 矩阵。功能层（空态真实性、搜索、主题令牌、响应式溢出）基本通过；**设计还原度普遍偏低**（页头/工作区/说明区结构大面积缺失），并有 1 个真实 404 渲染故障。

最严重的 5 条：

1. **【阻断】404 错误页渲染错误分支且初始化失败**：`/tools/does-not-exist`、`/category/nope` 的 `<title>` 是“页面不存在 · DevKit”，但页面 H1 是泛化文案“页面出现了错误”、描述是“工具不存在”，且“常用工具”区域**完全为空**；console 报 `[NUXT_E1005] Error caught during app initialization`，右下角出现 Nuxt 错误浮层。根因：`devkit/app/error.vue:11` 直接调用 `getTool()` 却未从 `~/data/tools` 导入（该模块不在 Nuxt 自动导入范围内）。见 §功能与代码缺陷 F1。
2. **【高】S10“离线”在设计成立、实现不成立**：项目无 service worker / PWA（无 `devkit/public`，`package.json` 无 PWA 依赖，`nuxt.config.ts` 无相关配置），且站点是 SSR；断网后**任何页面都打不开**，`/offline` 自身也不例外。`/offline` 仅用 `localStorage['devkit.visited.v1']`（由 `ToolPageLayout.vue:13-16` 写入的“访问过”记录）近似“已缓存”，与设计稿两栏（已缓存/未缓存 + 重试 + 说明区）差距很大。见 F2。
3. **【高】S04 收藏页未还原设计稿**：设计稿是“工作区”表格（工具/分类/收藏时间/操作、排序、仅显示当前可用、全部取消收藏、状态栏、使用说明 + 常见问题），实现只有标题 + `DkSelect` + 卡片网格 + 空态。缺失分类标签列、收藏时间列、“打开”按钮、“全部取消收藏”、状态栏与整个说明区。见 D3。
4. **【高】R01/R03 适配稿仍沿用旧版 24 工具 / 6 分类**：R01（`tUNVK`）、R03（`A51Nl`）侧栏计数为 `24`，分类为“数据格式/编码与文本/摘要与加密/时间与标识/Java 开发/**Web 开发**”，每类 `4 个工具`，首页是旧版“常用工具/热门标签”；而 S01（`LiwdR`）与实现 `devkit/app/data/tools.ts` 是 **41 工具 / 8 分类**（含 Web / Vue、接口辅助、文件与图片）。三套数据源不一致，需明确以 S01 为准并废弃 R01/R03 的旧目录。见 D1。
5. **【中】系统页“页头 + 工作区 + 说明区”结构几乎整体缺失**：S01–S08 的设计稿统一有页头（图标 + 标题 + 说明 + `本地处理` 徽标 + 上下文标记）、卡片化工作区（面板标题/提示/状态栏）与页尾说明区（使用说明 + 常见问题）。实现只有首页/分类/收藏/最近/设置/隐私/帮助的简化版，正文内容大量缺失。见 D2/D4–D8。

其余通过项：明/暗主题令牌与设计变量逐项一致（`main.css:8-156`）；1366 与 390 均无横向溢出；工具目录 41/8 与 S01 完全一致；无记录时不编造收藏/历史（`index.vue:11-13`）；SSR 首屏包含关键内容；普通页面无 hydration 警告。

---

## 覆盖对照表

| 需求/画面 | 设计稿节点 | 实现位置 | 是否实现 | 证据与结论 |
|---|---|---|---|---|
| S01 首页/全部工具/首次访问 | `LiwdR` / `J8Yrb` | `pages/index.vue` | 部分 | 41/8 目录一致；标题、页头、本地处理徽标、偏好设置入口、搜索卡片规格、首次访问“收藏快捷”空态缺失；分类目录用整卡导致页高 3131 vs 设计 1583 |
| S02 分类列表（摘要与加密/Java） | `h1lFMx` / `CiCUB` | `pages/category/[id].vue` | 部分 | 计数正确；缺设计稿的“工具分组”（摘要/对称/非对称、代码生成/配置转换/日志诊断）、页头徽标与 `本地处理 · 输入不上传`；Java 页多出“相关入口”且仅 Cron |
| S03 全局搜索（国密/无结果） | `nYPOp` / `MuIZ9` | `components/CommandPalette.vue` | 功能通过、还原部分 | 国密 → SM2/SM3/SM4（摘要与加密）实测一致；缺“3 个结果”计数、结果分类标签、匹配说明，空态按钮主次相反 |
| S04 我的收藏（已收藏/空收藏） | `FdLxl` / `vO8fN` | `pages/favorites.vue` | 部分 | 空态真实存在（0 收藏）；缺表格/分类列/收藏时间列/打开按钮/全部取消收藏/状态栏/说明区 |
| S05 最近使用（记录/空历史） | `hVwyK` / `G5GfwW` | `pages/recent.vue` | 部分 | 访问工具后真实产生 1 条记录；缺分组切换（按时间/按分类）、分类列、状态栏、说明区；清空文案“清空全部” vs 设计“清空全部记录” |
| S06 偏好设置（设置项/清理确认） | `Io3lB` / `l5gzJ` | `pages/settings.vue` | 部分 | 弹层与清除可用；缺设计稿的工作区面板标题/提示、动效与记录分组、重置偏好入口、说明区、状态栏；代码字号用 range 12–18 vs 设计分段 12/13/14 |
| S07 本地处理与隐私 | `zCSiu` | `pages/privacy.vue` | 部分 | 6 段说明 vs 设计 9 段 + 数据流向 + 会/不会保存两张表；缺“我们不作过度承诺”“性能取决于设备” |
| S08 帮助与快捷键 | `q9n6x` | `pages/help.vue` | 部分 | 6 主题接近；快捷键表缺 5 项；缺“反馈入口的位置”“离线与缓存”两节 |
| S09 工具不存在/404 | `edecI` | `error.vue` | 否（故障） | 见 F1；另缺设计稿的页头、工作区卡片、“HTTP 404 · 路径”状态、“常用”4 项、说明区 |
| S10 离线（已缓存/首次未缓存） | `S0Kfwk` / `rRK06` | `pages/offline.vue` | 部分/不可达 | 见 F2；`/offline` 返回 200，可从隐私页进入；但“未缓存/重试”栏、说明区缺失，且无真实离线能力 |
| R01 1366 工作屏（6 稿） | `tUNVK` 等 | 全局 | 部分 | 侧栏 236、主区 1130、无溢出；但 R01 稿为旧 24 工具目录 |
| R02 390 移动端（7 稿） | `BCDR3` 等 | `layouts/default.vue` | 部分 | 侧栏 <960 隐藏、抽屉可用、无横向溢出；顶栏 60 vs 设计 56，触控目标偏小；设计稿的分类 chips/收藏网格/最近列表未实现 |
| R03 深色主题（3 稿） | `A51Nl` 等 | `assets/css/main.css` `.dark` | 是（令牌级） | 8 个页面深色令牌与设计 dark 变量逐项一致，无硬编码浅色；但存在首帧闪烁与 R03 旧目录问题 |
| R04 可访问性样板（2 稿） | `C8oVvR` / `ubJHY` | 全局 | 部分 | 焦点环存在但 offset 1px（设计 2px）；开关无可访问名称；弹层无焦点陷阱；对比度与设计一致 |

---

## 设计还原问题

### D1【高】R01/R03 适配稿与 S01/实现三套工具目录不一致（历史遗留问题确认）
- 证据（设计）：`python3 audit/raw/r1/extract.py text tUNVK A51Nl` → 侧栏 `nzqiy/n7u27 '全部工具计数' = '24'`；分类仅 6 个，含 **Web 开发**，每类 `4 个工具`；首页为旧版“常用工具 8 个 / 热门标签 / 查看全部”。
- 证据（S01/实现）：`LiwdR` 页头 `gQRAV '41 个开发工具 · 8 个分类…'`；侧栏 `LdmyO='41'`，8 个分类；`devkit/app/data/tools.ts` 实测 `id: 't…'` 共 **41** 条、`categories` 8 条（`tools.ts:34-43`、`47-…`）。
- 影响：R01/R03 无法作为 1366/深色的验收基线；按此稿实现会与当前站点目录冲突。

### D2【中】S01 首页页头/搜索卡片/“快捷与最近”分区缺失
- 设计（`S01.txt:110-136`）：页头 `l5nj6` 高 56，含图标底 32×32（`AjvH3`）、标题“全部工具”22/700（`RYjz8`）、说明“41 个开发工具 · 8 个分类…”（`gQRAV`）、右侧 `本地处理 · 输入不上传` 标记（`jTHS9`）与“偏好设置”入口（`tOcVI`）；搜索卡片 `NAoCz` 高 **60**，含“只检索工具目录，不检索已处理的输入内容”（`HPyHD`）；随后 `h9cLZ` 为“收藏快捷 + 最近使用”（首次访问为 `0 / 41` + 空态，`J8Yrb:365-376`）。
- 实现：`index.vue:36-42` 标题为“开发者本地工具箱”，无页头图标/说明排版、无本地处理标记、无偏好设置入口；`index.vue:44-48` 搜索高度 **52** 且无检索范围说明；`index.vue:50-77` 只有“推荐工具 / 我的收藏 / 最近使用”卡片，没有“收藏快捷”空态；推荐工具 6 个（`index.vue:15`）vs 设计 4 个（JSON 格式化/JSON 转 Java 类/Base64/时间戳）。
- 附加：分类目录设计为“分类名 14 + 说明 12 + 查看全部 → + 名称 13/用途 11 的行式卡片”（`S01.txt:137-243`），实现用带图标/描述/标签的整卡（`index.vue:88-90`），文档高度实测 **3131**（`home.json metrics.doc.h`）vs 设计 **1583**（`LiwdR height`）。

### D3【高】S04 收藏页缺少“工作区/表格/说明区”
- 设计（`FdLxl`）：页头标题 21 + 说明 + `本地处理` + `已收藏` 标记（`C9Wf4/zgN69/PDAAJ/m9GSXk`）；工作区 `dSZXs`（surface 圆角 12）含排序（最近收藏/工具名称/分类 `cksxh/Rr7Sx/P3w8y`）、“仅显示当前可用工具”（`zAGOg`）、“共 6 个收藏”（`E98DTW`）、“全部取消收藏”（`oLFyg`）、四列表头“工具/分类/收藏时间/操作”（`TvkWh/jwydh/LJDtV/PaXTg`）、每行分类彩色标签（`cSPHM` 用 `$cat-format`）与“打开”按钮（`NrnrY`），底部状态“收藏记录 · 本地存储 / 共 6 个收藏 · 排序：最近收藏”（`wiCgL/B9R4Wd`）；页尾说明区含使用说明 2 条与常见问题 2 条（`ScW7d`）。
- 实现：`favorites.vue:27-55` 仅标题 + 计数 + `DkSelect` + 提示 + `ToolCard` 网格/空态；无表格、无分类标签、无收藏时间、无“打开/取消收藏”行操作、无说明区、无状态栏。
- 空态本身真实（探测 `favorites.json` 文案“0 个工具 / 还没有收藏任何工具”），不编造，见通过项。

### D4【中】S05 最近使用缺少分组切换/分类列/说明区
- 设计（`hVwyK`）：工作区含“只记录工具名与访问时间”强调（`o4HvFX`）、分组分段控件（按时间/按分类 `a6P2V/JD0MP`）、“共 8 条记录”（`zyO8O`）、“清空全部记录”（`sPU9O`）、四列表头（`k89vHI/QVaU0/JdUIU/azNzZ`）、按“今天/更早”分组（`UQYox`）、状态栏（`XKoAf/f72if`）与说明区（`u8iD9Q`）。
- 实现：`recent.vue:19-88` 仅标题 + 计数 + “清空全部” + 两段列表（今天/更早），无分类列、无分组切换、无状态栏、无说明区；“清空全部”（`recent.vue:26`）与设计的“清空全部记录”文案不一致。

### D5【中】S06 偏好设置结构/控件不符
- 设计（`Io3lB`）：单一“工作区”卡（`J0cARR`）含面板标题“偏好设置”与提示“偏好保存在此浏览器 · 上次修改 09:41”（`CGAP1/RJ1vs`），分组“外观/编辑器/动效与记录/本地数据”（`kixCe/pMjYU/v3JOM/caifS`）；代码字号为分段 **12 px / 13 px / 14 px**（`eH7YC/J6MOjS/y24YUA`）；默认缩进为 **2/4/Tab**（`WtLVp/lnYFE/hteOy`）；“重置偏好”独立入口（`s9HQF1`）；清除入口文案“选择清除范围…”（`EGo4L`）；底部状态“未登录 · 不需要账号”（`D4pa5m`）与说明区（`L9cSkQ`）。
- 实现：`settings.vue:50-139` 为 4 张独立卡片；代码字号用 `<input type="range" min=12 max=18>`（`settings.vue:83-92`）而非 12/13/14 分段；无“重置偏好”单独项、无面板提示、无状态栏、无说明区。
- S06 清理弹层（`l5gzJ` 遮罩层）：设计宽 540、正文列出“偏好设置/我的收藏 6 个/最近使用 8 条”三项清单（`aXF32/O86hkr/Mezrx/xhST9/YCTze/hfSir`）；实现 `DkModal` 宽 420（`settings.vue:141`）且只给单句说明（`settings.vue:12-21`）。功能可用，信息密度低。

### D6【中】S07 隐私页内容覆盖不足（并使“DevTools”笔误暴露）
- 设计（`zCSiu`）：工作区 `l5oid` 含“浏览器本地计算（默认）/静态资源仍需加载/不提供云端历史/数据流向（你的输入→浏览器内处理→结果与导出）/会保存在本地的内容（4 项）/不会保存的内容（4 项）/剪贴板由你主动触发/离线可用性以缓存状态为准/我们不作过度承诺/性能取决于你的设备”，页尾还有说明区（`JvcYU`）。
- 实现（`privacy.vue:4-35`）：6 段（计算在浏览器、静态资源、哪些内容本地、输入不持久化、剪贴板、不提供的能力）。缺数据流向、两张“会/不会保存”表、“不作过度承诺”“性能取决于设备”等。
- 另：设计稿页说明 `u0B7Ob` 写的是“了解 **DevTools** 在浏览器内如何处理…”，与产品名 DevKit 不符——**设计稿自身文案错误**（实现写的是 DevKit，反而正确）。

### D7【中】S08 帮助页快捷键表与主题缺失
- 设计（`q9n6x`）快捷键对照共 9 行：打开搜索、执行主操作、复制结果、下载结果、清空当前输入、显示/隐藏密钥、只看输入/只看结果、关闭弹层（`TDJaJ…qfJ2F`）；另有“字符与字节的区别”“结果为什么会‘待更新’”“反馈入口的位置”“离线与缓存”（`PjafA/jYzwz/F20Qw/Pk5Z0`）。
- 实现（`help.vue:42-49`）：6 行，缺“复制结果 / 下载结果 / 清空当前输入 / 显示隐藏密钥 / 只看输入只看结果”；多出设计中不存在的“切换明暗主题”。主题 6 张卡接近，但缺“反馈入口的位置”“离线与缓存”。
- 且设计说反馈按钮位于“顶部导航右侧”，实现 `TopNav.vue` 完全没有反馈按钮（`help.vue:86-92` 只说明走“源码”入口）。

### D8【中】S09 404 结构缺失（叠加 F1 故障）
- 设计（`edecI`）：页头“工具不存在”+说明+`本地处理`（`HMX7J/jOOAA/if9IU`）；工作区状态“HTTP 404 · /t/unknown-tool”（`jOZ3P`）、标题“找不到这个工具”（`gwZ50`）、说明明确写“没有匹配到 DevKit 的 41 个工具”（`VFwOQ`）、搜索框 + `Ctrl/⌘ K`（`F5jAW/UGWvH`）、按钮“返回首页/浏览全部工具”（`yIbcZ/Q7bOFK`）、“常用：JSON 格式化/Base64/SM4/时间戳”（`ggLW0…nDktR`）、说明区（`zJsR4`）。
- 实现：`error.vue` 渲染居中的大号 404 + 标题 + 描述 + 搜索按钮 + 返回首页 + 5 个常用工具 chip，无页头/工作区/路径状态/说明区；“浏览全部工具”按钮缺失；且常用工具实测为空（见 F1）。

### D9【中】S03 命令面板细节
- 设计（`nYPOp`）：输入内容“国密”+“Esc 关闭”（`YAqLv/HJcom`）、分组标题“摘要与加密”与“3 个结果”（`kiCPl/pE0Ho`）、每条含工具名 + 简短描述 + **分类标签**（`xRyxR/OVQYF/X9TwUB`）、底部“匹配到 3 个工具：名称含「SM」且分类为「摘要与加密」”与键位提示（`sJY6r…YOAu1`）。
- 实现：结果项只有图标 + 名称 + 描述（`CommandPalette.vue:91-98`），无“3 个结果”计数、无分类标签、无匹配说明。功能正确（实测 3 条，分组“摘要与加密”）。
- 空态（`MuIZ9`）：设计标题“没有找到与「smtool」匹配的工具”、提示给出可换关键词示例、按钮为“回到全部工具”（主）与“修改关键词”（`P9fEH/oS9BA`）；实现为“没有找到匹配「smtool」的工具”、提示较短、按钮顺序与主次相反（`CommandPalette.vue:101-109`，先“清空关键词”后主按钮）。

### D10【低】外壳尺寸/样式细节偏差
- 顶部栏：设计 `PQJ6y` `gap=28 pad=[0,24]`；实现 `TopNav.vue:92` `gap:16`、`:94` `padding:0 20px`。Logo 设计圆角 8（`m7peZ`），实现 7（`TopNav.vue:118`）。
- 侧栏：设计 `vxMha` `pad=[14,12]`；实现 `SideNav.vue:105` `padding:12px`。设计每行计数 12px（`LdmyO`），实现 11px（`SideNav.vue:135`）。设计分类行无色点、无箭头，且子列表高 0（默认折叠，`S01.txt:36`）；实现加了色点 + chevron 且默认全展开（`SideNav.vue:55-64`）。
- 侧栏底部“纯本地运行”块：设计为 `surface-subtle` 圆角 10 卡片（`c29ML`）；实现为顶部 1px 分隔线的链接（`SideNav.vue:228-235`）。
- 主区：设计 `pad=[26,32] gap=20`（`MmuKx`）；实现 `padding:24px 32px 48px`（`default.vue:84`）。
- 顶栏“源码”：设计为 surface 填充按钮（`DE6Op`），实现带边框并硬编码外链 `https://github.com`（`TopNav.vue:45-54`）——占位/无效目标。

---

## 功能与代码缺陷

### F1【阻断】404 错误页初始化失败、渲染错误分支、常用工具为空
- 复现：`python3 audit/tools/probe.py /tools/does-not-exist` 与 `/category/nope` → `status 404`，`console` 含
  `[NUXT_E1005] Error caught during app initialization. ╰▶ fix: Check your plugins, app:created, and app:beforeMount hooks for unhandled errors.`
- 页面表现（SSR 与客户端一致）：`<title>页面不存在 · DevKit</title>`，但 H1 = “页面出现了错误”、desc = “工具不存在”，“常用工具”标题在、`.err__common-item` **数量为 0**（Playwright：`common items: []`）；截图 `audit/raw/r1/probes/404-tool.png` 右下角可见 Nuxt 错误浮层。
- 根因证据：`devkit/app/error.vue` 只 `import type { NuxtError } from '#app'`（第 1-2 行），第 11 行 `common.map((s) => getTool(s)!)` 使用了未声明的 `getTool`。Vite 转换后的实际模块确认无该导入：
  - `curl 'http://localhost:3000/_nuxt/@fs/.../devkit/app/error.vue' | grep -c getTool` → 1（仅调用处），无 `import { getTool }`；
  - `devkit/.nuxt/imports.d.ts` 中 `getTool` 出现 **0** 次（Nuxt 只自动导入 `composables/`、`utils/`，不含 `data/tools.ts`）。
- 影响：S09 未实现且 404 体验损坏；`error.vue:31` 中 `goHome(); nextTick(() => usePalette().show())` 依赖的组件在初始化失败时也不会执行。
- 修复方向：`error.vue` 顶部 `import { getTool } from '~/data/tools'`（或改用 `getToolById` + id 列表）；同时补 `is404` 判断的 SSR/客户端一致性测试。

### F2【高】离线能力不存在，`/offline` 的“已缓存”是访问记录近似
- 无 service worker / PWA：`ls devkit/public` → 不存在；`devkit/package.json` 无 PWA 插件；`nuxt.config.ts` 无 `pwa`/`routeRules`/`prerender`。站点 `ssr: true`（`nuxt.config.ts:4`），断网时无法加载任何路由，包括 `/offline`。
- `/offline` 读取 `localStorage['devkit.visited.v1']`（`offline.vue:16-23`），该键由 `ToolPageLayout.vue:13-16` 在“打开过工具页”时写入，语义是“访问过”，不是“已缓存”。实测全新会话 `/offline` 文案为“已缓存工具（0）/暂无已缓存记录”。
- 与设计 `S10`（`S0Kfwk/rRK06`）差距：设计有“已缓存·可直接使用（6 项）/未缓存·需要联网（6 项，带重试）”“重新检测”“缓存状态如何决定？”说明区；实现只有单向“已缓存工具列表”，无“未缓存/重试”栏、无说明区，标题为“资源未就绪/当前处于离线状态”（设计为“离线模式 · 已缓存 / 无法加载该工具”）。
- 可达性：`/offline` 返回 200，可从 `/privacy` 的“离线与缓存状态”按钮进入（`privacy.vue:57`），但侧栏/顶栏无入口。

### F3【中】分类页 Java 的“相关入口”逻辑可疑且与设计不符
- `category/[id].vue:31-34`：
  ```ts
  return tools.filter((t) => t.cat !== 'java' && t.tags.some((tag) => ['国密'].includes(tag)) === false && ['t24', 't20'].includes(t.id))
  ```
  因 `t24`（`Properties / YAML 转换`）本身 `cat === 'java'` 被排除，最终只剩 `t20`（Cron 解析）。运行实测 `/category/java` 渲染出“相关入口 / 这些工具同时服务于 Java 工作流： / Cron 解析与执行预览”。设计 `CiCUB` 中 Java 分类没有该区；语义上 Cron 与 Java 工作流关联牵强，条件 `tags.some(...) === false` 也是恒真/无意义判断。建议删除或改为明确的“相关工具”数据源。

### F4【中】无障碍缺口（对齐 R04）
- 开关无可访问名称：`DkSwitch.vue:7-16` 只有 `role="switch"`（第 9 行）+ `aria-checked`（第 10 行），无 `aria-label`/`aria-labelledby`；设置页 3 个开关实测 `aria-label` 均为空，`probe settings.metrics.a11y.buttonsNoName = 3`。Playwright 结果：`[{'name':'','checked':'false'},…]`。
- 弹层无焦点陷阱：`DkModal.vue:19-20` 只把焦点移入面板（`panelRef.value?.focus()`），未限制 Tab 范围。实测打开清除确认后连按 6 次 Tab，焦点逃逸到背景 `.topnav__src`（`inside modal: False`）。设计 R04（`ubJHY`）“确认弹层与焦点回归”要求“焦点进入弹层内部并限制在其中”。
- 焦点环 offset：设计 `C8oVvR` 注释“2px `$accent` 外圈 + 2px 偏移”；实现 `main.css:257-261` 为 `outline: 2px solid var(--accent); outline-offset: 1px`。
- 收藏页排序 `<select>` 无 label（`DkSelect.vue:17` 裸 `<select>`，`favorites.vue:32-41` 未传标签），`probe favorites.a11y.inputsNoLabel = 1`；设计 S04 有可见“排序”标签。
- 移动端触控目标偏小：390 下实测 `topnav__theme-btn 28×26`、`topnav__menu 30×30`、logo 28×28；设计 R02（`BCDR3`）抽屉按钮与图标按钮均为 `40×40`。

### F5【低】深色主题首帧闪烁（FOUC）
- `usePrefs.ts` 只在 `onMounted` 里调用 `applyTheme()`（并 watch `isDark`），SSR 输出 HTML 无 `dark` class（`curl` 确认）。当 `theme=dark` 或系统深色时，首帧按浅色绘制，挂载后才切深色。R03 要求深色主题；建议在 `<head>` 内联脚本按 `localStorage`/`prefers-color-scheme` 预设 `documentElement.classList`。

### F6【低】主题相关代码实现无其它硬编码浅色
- 抽样检查 `devkit/app/components`、`pages`、`layouts` 未发现会破坏深色的硬编码背景（命中的 `#fff` 均为色值工具 t30 的业务输入默认值或 `color:#fff` 于强调底之上）。深色令牌与设计 `variables` 完全一致（`--bg #0f1115 / --surface #161a21 / --text-primary #e9edf3 / --accent #4d8dff` 等，`k_.json` 实测）。

---

## 无法验证 / 存疑项

1. **真实离线行为无法在联网开发栈中验证**：站点为 SSR 且无 SW，无法在“断网”下加载 `/offline` 做端到端验证；F2 的结论来自“无 SW/PWA + 无 public + SSR”的静态证据，以及 `/offline` 以 `devkit.visited.v1` 近似缓存。
2. **F1 中 SSR 已渲染完整模板但 setup 含未声明变量**：现象（H1 走非 404 分支、`commonTools` 为空）与“未声明 `getTool`”的静态证据一致；但为何 SSR 未硬崩溃而是输出空列表，机制未完全定位（客户端 `.err` 元素无对应 Vue 组件实例，判断为 hydration 失败后保留 SSR 标记）。建议修复时一并加 404 的 SSR/CSR 回归测试。
3. **R02/R03 的工具级画板**（JSON 格式化 / SM4 / 图片压缩 / IV 错误等）属于工具页细节，超出本子代理“系统页”范围；仅通过 `/tools/sm4` 探测确认外壳（顶栏 60 / 侧栏 236 / 无 console 错误），未逐项比对工具内部布局。
4. **设计稿 S02 内部自相矛盾**：`h1lFMx` 页头徽标 `yF6ji='7 个工具'`，但侧栏 `i15z5='6'` 且分组 2+3+1=6（`摘要/对称/非对称`）。实现按 6 渲染。此处为设计稿错误，非实现缺陷，已在 D 系列记录。
5. **R04 对比度声明未用工具复算**：实现令牌与设计数值相同（`#12161F/#5A6472/#8B94A3` on `#FFFFFF`），但未独立计算 WCAG 比值。
6. 设计变量 `cat-*-soft` 用 8 位 hex（如 `#2563EB1A`），实现用 `rgba(...,0.1)`，数值等价（10%/15%），未发现可见差异。

---

## 修复优先级建议

| 优先级 | 事项 | 位置 |
|---|---|---|
| P0（阻断） | 修复 404 页：导入 `getTool`，补 SSR/CSR 回归；恢复“常用工具”与 404 专用文案 | `devkit/app/error.vue:11` |
| P1（高） | 明确并统一工具目录基线：以 S01 的 41/8 为准，废弃/重绘 R01、R03 的 24/6 旧稿 | `design.pen` R01/R03 |
| P1（高） | 补齐 S04/S05 工作区（表格列、分类标签、收藏时间、打开/取消、全部取消、分组切换、状态栏、说明区） | `pages/favorites.vue`、`pages/recent.vue` |
| P1（高） | 离线：要么接入 SW/PWA 并实现“已缓存/未缓存 + 重试”，要么把 `/offline` 明确降级为“缓存状态说明页”并修正文案；两种状态需可达 | `pages/offline.vue`、`nuxt.config.ts` |
| P2（中） | S01/S02/S06/S07/S08 的页头 + 工作区 + 说明区结构还原；分类分组与首访空态；设置项分段控件与弹层清单 | 对应页面 |
| P2（中） | 无障碍：`DkSwitch` 加 `aria-label`；`DkModal` 增加焦点陷阱与 `Tab` 循环；`DkSelect` 关联可见标签；焦点环 offset 改 2px；移动端触控目标 ≥40×40 | `DkSwitch.vue`、`DkModal.vue`、`DkSelect.vue`、`main.css`、`TopNav.vue` |
| P2（中） | 修正 Java 分类“相关入口”逻辑或移除 | `pages/category/[id].vue:31-34` |
| P3（低） | 深色首帧闪烁（内联主题脚本）；“源码”外链指向真实仓库或去掉；外壳尺寸/圆角对齐设计 | `usePrefs.ts`、`TopNav.vue`、`SideNav.vue`、`default.vue` |

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/r1-system-pages.md
