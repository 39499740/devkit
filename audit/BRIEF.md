# DevKit 审核 · 子代理通用简报（BRIEF）

## 任务背景
对 `DevKit · 开发者本地工具箱` 做完整审核：文档需求 vs Pen 设计稿 vs 实现代码 vs 运行中的站点（http://localhost:3000）。
你只做**只读审核**，产出报告，**不要修改任何项目源码、不要修改 design.pen、不要执行任何写操作**。

## 目录与关键路径
- 工作目录：`/Users/hao/WebstormProjects/web_tools`
- 设计稿：`design.pen`（纯 JSON，23MB，39477 个节点，70 个顶层画板）
- 需求文档：`docs/DevKit-Pen完整页面设计任务书.md`（权威需求，另有多份历史复查报告 docs/*.md 仅供背景，可能过时）
- 实现代码：`devkit/`（Nuxt 4，SSR 开启）
  - `devkit/app/data/tools.ts` — T01–T41 工具注册表（分类/别名/标签/图标）
  - `devkit/app/pages/` — `index.vue` `category/[id].vue` `favorites.vue` `recent.vue` `settings.vue` `privacy.vue` `help.vue` `offline.vue` `error.vue` `tools/[slug].vue`
  - `devkit/app/components/` — `Dk*.vue` 共享组件 + `TopNav/SideNav/ToolCard/ToolPageLayout/SplitPanes/JsonTree/FileDrop/CommandPalette/SendToMenu/DkToastHost` 等
  - `devkit/app/components/tools/t01..t41-*.vue` — 41 个工具页
  - `devkit/app/composables/` — useToolRun/useToast/useClipboard/usePrefs/useFavorites/useRecent/usePalette/useTransfer
  - `devkit/app/utils/` — bytes.ts / json.ts
  - `devkit/app/assets/css/main.css` — 设计令牌（CSS 变量，明/暗主题）
  - `devkit/FOUNDATION.md` — 组件 API 与开发约定；`devkit/README.md` — 项目说明
- 审核输出目录：`audit/`（已存在）；你的报告写到 `audit/reports/<指定文件名>`

## 可用工具（全部已在本机可用）
1. **设计稿读取（推荐）**：`python3 audit/tools/pen.py <cmd>`
   - `stats` / `frames`（70 个顶层画板）
   - `find "<正则>"` — 按名称查节点（如 `find "^T01 /"`）
   - `dump <节点ID> [深度]` — 打印子树（含 text/fill/fontSize/width/gap/layout 等）
   - `text <节点ID>` — 抽取该子树全部文字
   - `node <节点ID>` — 原始 JSON（截断 20000 字符）
2. **Pen MCP（可选，只读）**：`echo '<js>' | python3 /tmp/penmcp.py run`
   - 只能调用 `Print(Get(id,{depth:n}))` / `GetVariables()` 这类**只读**片段；严禁 Insert/Update/Replace/Copy/Delete/Move/SetVariables/Generate/Export。
   - 另一个入口：`python3 /tmp/penmcp.py state` 打印当前 app 状态（含活动文件）。
3. **运行站点探测**：`python3 audit/tools/probe.py <path> [--shot out.png] [--full] [--dark] [--w 1366] [--h 768]`
   - 输出 JSON：HTTP 状态、console error/warning、pageerror、失败请求、关键元素 rect/颜色/字体、可见文字采样、a11y 基本项、文档尺寸。
4. `curl -s ...`，`node -e ...`，`python3 ...`，`npx ...` 等。
5. 站点有两份实例：**3000（本任务基准）** 与 3100（Pen 内嵌浏览器在用）。以 3000 为准。

## 报告要求（硬性）
- 中文书写，Markdown，写入指定文件。
- 结构建议：`## 结论摘要`（含总体覆盖率与最严重问题 3–5 条）→ `## 覆盖对照表` → `## 设计还原问题`（逐条）→ `## 功能与代码缺陷`（逐条）→ `## 无法验证/存疑项` → `## 修复优先级建议`。
- **每条问题必须带证据**：设计节点 ID、代码 `文件:行号`、或命令输出片段。禁止无证据猜测；无法确认的写到“存疑项”。
- 区分严重度：`阻断 / 高 / 中 / 低 / 建议`。
- 只报真实问题，不要为凑数编造；也不要只写“整体符合预期”。
- 覆盖对照表要能看出“需求项 → 是否实现 → 证据”。

## 时间与深度
- 目标：30 分钟内完成，先广后深。优先覆盖全部条目，再对可疑点深挖。
- 必须实际运行命令验证（例如真的访问页面、真的跑一遍工具的计算逻辑），不要只读注释或文档。
- 报告写完后，在最后一行输出 `DONE: <报告文件绝对路径>`。

## 红线
- 禁止修改 `devkit/**`、`design.pen`、`docs/**`。
- 禁止对 Pen 文档做任何写操作（execute 里只能 Print/Get）。
- 不要在报告里泄露密钥类内容（如遇到硬编码密钥只写位置与类型）。

## 重要更正（务必阅读）
- `.pen` 里文字节点的字段名是 **`content`**（不是 `text`）。`audit/tools/pen.py` 已修正：`dump` / `text` / `node` 现在都会显示 `content`。
- 颜色字段是 `fill`，字体字段是 `fontFamily` / `fontSize` / `fontWeight`，布局字段是 `layout` / `gap` / `padding` / `justifyContent` / `alignItems`，尺寸是 `width` / `height`，变量引用形如 `"$accent"`（用 `audit/raw/design_variables.json` 解析实际值）。
- 若你已用旧版本得到“设计稿没有文字”的结论，请重新运行。
