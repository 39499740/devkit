# G1 · S01 首页 / S02 分类页 设计还原报告

- 子代理：G1（首页 / 分类页）
- 工作目录：`/Users/hao/WebstormProjects/web_tools`
- 开发服务器：`http://localhost:3000`（Nuxt 4 dev，HMR）
- 修改文件（仅这三个）：
  - `devkit/app/pages/index.vue`（重写）
  - `devkit/app/pages/category/[id].vue`（重写）
  - `devkit/app/components/ToolCard.vue`（新增 `variant` 变体，默认行为不变）

## 1. 设计依据（pen.py 读取的真实节点）

| 画板 | 节点 | 内容 |
| --- | --- | --- |
| S01 主画板 `LiwdR` | `l5nj6` 页头 | 标题组：`全部工具` / `41 个开发工具 · 8 个分类 · 解析、转换与加解密都在你的浏览器里完成`；右侧 `本地处理 · 输入不上传` + `偏好设置` |
| S01 | `NAoCz` 搜索卡片 | 占位 `搜索工具名称、缩写或别名，例如 国密 / sm4 / base64`；`⌘K / Ctrl K`；`只检索工具目录，不检索已处理的输入内容` |
| S01 | `h9cLZ` 快捷与最近 | `收藏快捷`（计数 `n / 41`）+ `最近使用`（`清空记录`、条目含时间） |
| S01 | `joSqu` 分类目录 | 8 个分类，每类 4 列横向卡片（高 70）：图标 28 + 名称 13/600 + 一句用途 11/secondary + 星标；`查看全部 →` |
| S01 首访 `J8Yrb` | `q2BmnO` / `hOSzX` / `PhTOQ` | 页头右侧改为 `首次访问` 徽标；`收藏快捷` 空态文案 `还没有收藏的工具。点击任意工具卡片右上角的星标，即可加入收藏。`；右侧改为 `推荐工具`（JSON 格式化/最常用、JSON 转 Java 类/Java 工程、Base64 编解码/编码入门、时间戳转换/零参数） |
| S02 `h1lFMx`（摘要与加密） | 页头 / `W6eN0W` / `Qnr5S` | 图标底 `cat-crypto-soft`、标题 `摘要与加密` + 数量标签、说明 `对消息计算摘要、做完整性校验，或按算法做对称 / 非对称加解密；全部在本机完成`；右侧 `本地处理 · 输入不上传` + `全部工具`；分类内搜索 `在「摘要与加密」内搜索工具` + `分类切换保留左侧导航与当前筛选`；子分组：摘要(2)/对称(3)/非对称(1) |
| S02 `CiCUB`（Java 开发） | 页头 / `N41J0` / `Cbf9j` | 标题 `Java 开发` + 数量标签、说明 `面向 JVM 工程的代码与配置转换：从 JSON 生成类、整理配置与堆栈、转换依赖声明`；子分组：代码生成与转义(2)/配置转换(2)/日志与诊断(1) |

顶部导航与左侧导航是共享组件实例（`TopNav`/`SideNav`），两个页面均未重建。

## 2. S01 首页实现

1. **页头**（`index.vue`）
   - 图标（`grid`，`accent-soft` 底、`accent` 色）+ 标题 `全部工具` + 说明，说明用真实数据拼装：
     `{{ toolCount }} 个开发工具 · {{ categories.length }} 个分类 · 解析、转换与加解密都在你的浏览器里完成` → 实际渲染 `41 个开发工具 · 8 个分类 · …`。
   - 右侧徽标 `本地处理 · 输入不上传`；非首访显示 `偏好设置`（`/settings`），首访按 `J8Yrb` 显示 `首次访问`（`accent-soft`）。
2. **搜索卡片**（真实可用，非摆设）
   - 结构与文案照 `NAoCz`：搜索框（占位 `搜索工具名称、缩写或别名，例如 国密 / sm4 / base64`）+ `⌘K / Ctrl K` + `只检索工具目录，不检索已处理的输入内容`。
   - 规则复用 `app/data/tools.ts` 的 `searchTools()`——与命令面板 `CommandPalette.vue` 完全同一套评分/匹配规则。
   - 交互：**就地过滤**工具卡片（输入即时出结果，`搜索结果 · N 个匹配`，隐藏快捷与分类目录）；**回车打开首个命中**（`router.push('/tools/<slug>')`）；`⌘K / Ctrl K` 按钮打开命令面板；空结果给出可点击提示文案。
3. **快捷与最近**（`h9cLZ` / `J8Yrb`）
   - 左：`收藏快捷`，计数 `收藏数 / 41`，最多展示 4 个收藏；无收藏时按设计显示空态文案。
   - 右：有历史时 `最近使用`（最多 4 条，时间由已存的 `at` 计算：`刚刚` / `N 分钟前` / `今天 HH:mm` / `昨天 HH:mm` / `M 月 D 日`，`清空记录` 走 `recent.clear()` + toast）；首访时按设计切换为 `推荐工具`（4 条 + 推荐理由）。
   - 无历史且无收藏时不会编造时间或记录。
4. **分类目录**（`joSqu`）
   - 8 个分类，分类头：色标 + 分类名 + `N 个工具 · 分类说明`(来自 `categories[].desc`) + `查看全部 →`（`/category/<key>`）。
   - 卡片使用 `ToolCard` 新增的 `variant="row"`：横排 70 高、4 列，与画板卡片结构一致（图标 + 名称 + 一句用途 + 星标）。

## 3. S02 分类页实现

1. **页头**
   - 分类色图标底（每类映射一个已有 `DkIcon`）、标题 + 数量标签（真实 `toolsOfCategory(key).length`）、用途说明（设计给定的 crypto/java 文案，其余分类回退到 `categories[].desc`，不编造）。
   - 右侧 `本地处理 · 输入不上传` + `全部工具`（返回 `/`）。
2. **分类内搜索**
   - 结构与文案照 `W6eN0W`/`N41J0`：`在「<分类名>」内搜索工具` + `分类切换保留左侧导航与当前筛选`；输入过滤复用同一套 `searchTools()` 再按分类收敛；有结果展示扁平网格，无结果显示空态 + `清空搜索`。
3. **子分组**（补齐审计 `r1-system-pages.md` 指出的 S02 缺失项）
   - crypto：`摘要（单向，不可逆）`(t12,t16) / `对称加密（同一密钥加解密）`(t14,t17,t13) / `非对称加密（公私钥）`(t15)；
   - java：`代码生成与转义`(t22,t23) / `配置转换`(t24,t26) / `日志与诊断`(t25)。
   - 分组头含分组名/说明/计数，卡片行间距 12；搜索态自动隐藏分组、回到扁平结果。
4. **分类切换与高亮**
   - 移除了原先与左侧导航重复的分类胶囊条：画板 S02 无该结构，且去掉后当前分类只由共享 `SideNav` 高亮一处，满足「只高亮当前入口」。
   - 左侧导航为布局级共享组件，跨分类/工具路由不重建、展开状态不丢失；切换分类时 `query` 通过 `watch(key, …)` 重置。
   - 移除了 Java 页原先与设计不符且逻辑牵强的「相关入口（仅 Cron）」硬编码区。
5. **卡片**：分类页使用 `ToolCard` 默认竖向卡片（图标 + 名称 + 用途 + 标签行），与 S02 `Ld2sS` 结构一致。

`ToolCard.vue` 变更：仅新增 `variant?: 'grid' | 'row'` 与横排样式，默认 `grid` 分支保持原结构/样式，现有使用方（`category/[id].vue`）行为不变。

## 4. 数据真实性

- 41 个工具 / 8 个分类全部来自 `app/data/tools.ts`，未新增硬编码工具。
- 首页统计、分类计数、分组计数均由数据实时计算，未写死。
- 最近使用时间由本地已存储的 `at` 计算；收藏与最近记录读取既有 `useFavorites` / `useRecent`（`useFavorites` 已由并行改动升级为 v1/v2 兼容并记录收藏时间）。
- 首访判定 = 无收藏且无历史，判定为真才显示 `推荐工具`，不伪造使用记录或时间。
- 未实现收藏时间列（首页收藏快捷按设计只显示工具名，不显示时间）。

## 5. 自测（命令 + 关键输出）

### 5.1 静态探测（console/pageerror/溢出）

```bash
python3 audit/tools/probe.py /
python3 audit/tools/probe.py /category/format
python3 audit/tools/probe.py /category/java
python3 audit/tools/probe.py / --w 390 --h 844
python3 audit/tools/probe.py /category/format --w 390 --h 844
python3 audit/tools/probe.py /category/java --w 390 --h 844
python3 audit/tools/probe.py / --dark
python3 audit/tools/probe.py /category/crypto --dark
```

结果矩阵（`docW` = `document.documentElement.scrollWidth`）：

```
1440_              status=200 docW=1440 console=0 pageerr=0 failed=0 btnNoName=0
1440_category_format status=200 docW=1440 console=0 pageerr=0 failed=0 btnNoName=0
1440_category_java status=200 docW=1440 console=0 pageerr=0 failed=0 btnNoName=0
390_               status=200 docW= 390 console=0 pageerr=0 failed=0 btnNoName=0
390_category_format status=200 docW= 390 console=0 pageerr=0 failed=0 btnNoName=0
390_category_java  status=200 docW= 390 console=0 pageerr=0 failed=0 btnNoName=0
dark /             status=200 console=0 pageerr=0  (--bg #0f1115 / --surface #161a21)
dark /category/crypto status=200 console=0 pageerr=0
```

1440 与 390 宽度下 `scrollWidth` 分别等于视口宽，无横向溢出；无 `console error`、无 `pageerror`、无失败请求。

### 5.2 Playwright 交互（真实可用性）

```bash
python3 /tmp/g1_interact.py   # 搜索 / 回车 / 命令面板 / 分类搜索 / 高亮
python3 /tmp/g1_groups.py     # 分组与搜索互斥 / 390 溢出
python3 /tmp/g1_state.py      # 收藏·最近有数据时的首页与卡片变体
```

关键输出：

```
home_search_guomi: { meta: "3 个匹配", names: ["SM2 加解密与签名","SM3 摘要","SM4 加解密"] }
enter_url:        "http://localhost:3000/tools/sm2"
home_search_sm4:  ["SM4 加解密"]
after_clear_has_dir: true
palette_open:     true
crypto_h1:        "摘要与加密"
crypto_desc:      "对消息计算摘要、做完整性校验，或按算法做对称 / 非对称加解密；全部在本机完成"
crypto_count:     "6 个工具"
crypto_sm:        ["SM2 加解密与签名","SM3 摘要","SM4 加解密"]
sidenav_on:       ["摘要与加密"]          # 只高亮当前分类
console_errors:   []
groups_before:    ["摘要（单向，不可逆）","对称加密（同一密钥加解密）","非对称加密（公私钥）"]
counts_before:    ["2 个","3 个","1 个"]   # 2+3+1=6，与侧栏一致
groups_after_search: false                # 搜索时隐藏分组
groups_after_clear:  true
empty_visible:    true                    # 无匹配空态
w390 /category/{crypto,java}: 390 / 390   # 无横向溢出
fav_count:        "4 / 41"
recent_items:     ["JSON 格式化10 分钟前","Base64 编解码3 分钟前","时间戳转换今天 11:39","SM2 加解密与签名9 月 18 日"]
home_row_cards:   ["tool-card tool-card--row"]
cat_card_classes: ["tool-card tool-card--grid"]
```

### 5.3 类型检查

```bash
cd devkit && npm run typecheck
# 仅剩 1 个既有错误（非本次文件）：
# app/components/tools/t27-json2ts.vue(667,22): error TS2322 ...
# index.vue / category/[id].vue / ToolCard.vue 无 TS 报错
```

## 6. 已知差异与说明

1. **设计稿 S02 自身矛盾**：`h1lFMx` 页头标签写 `7 个工具`，但侧栏与分组 2+3+1 均为 6。实现按数据渲染 `6 个工具`，与审计 `r1-system-pages.md` 第 144 行结论一致（不沿用设计稿笔误）。
2. **首访页头不含 `偏好设置`**：严格照 `J8Yrb` 首访变体，首访时右侧为 `首次访问` 徽标；产生收藏/历史后自动出现 `偏好设置` 入口。`/settings` 仍可经 `/help` 到达。
3. **未保留 S02 分类胶囊条**：为贴合 `h1lFMx`/`CiCUB` 结构并满足「只高亮当前入口」，分类切换交由共享左侧导航；桌面端侧栏分类行是「展开/折叠」而非跳转（共享组件 `SideNav.vue` 行为，不在本次允许改动文件内），分类入口另经首页每个分类的 `查看全部 →` 或抽屉导航到达。
4. **首页「最近使用」时间只展示已存储的访问时间**；旧版仅存标识、未存时间的收藏不会显示收藏时间。
5. 未新增依赖、未加注释、未改动 `design.pen`、`docs/**` 及其余组件/页面。

## 7. 结论

S01 首页与 S02 分类页的页头、搜索卡片、快捷与最近、分类目录/子分组、分类内搜索均按 Pen 节点还原；搜索复用全局同一套规则且真实可用；1440/390/深浅色下无 console error、无横向溢出；数据全部来自 `app/data/tools.ts`。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/g1-home-category.md
