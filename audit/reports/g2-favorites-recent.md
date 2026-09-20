# G2 · S04 我的收藏 / S05 最近使用 — 设计还原报告

- 工作目录：`/Users/hao/WebstormProjects/web_tools`（Nuxt 4 在 `devkit/`）
- 开发服务器：`http://localhost:3000`（保存即 HMR）
- 设计依据：`design.pen` 节点 `FdLxl`（S04 已收藏）/ `vO8fN`（S04 空收藏）/ `hVwyK`（S05 记录列表）/ `G5GfwW`（S05 空历史）
- 修改文件（仅这 4 个）：
  - `devkit/app/composables/useFavorites.ts`
  - `devkit/app/pages/favorites.vue`
  - `devkit/app/pages/recent.vue`
- 未改动 `useRecent.ts`：其 `grouped`（今天/更早）已满足设计，分组逻辑直接在页面完成，避免无谓改动。

---

## 1. 设计读出（pen.py）

```
python3 audit/tools/pen.py text FdLxl
python3 audit/tools/pen.py dump FdLxl 4
python3 audit/tools/pen.py dump dSZXs 5      # 工作区
python3 audit/tools/pen.py dump c2vwmz 6     # 收藏列表表头/行
python3 audit/tools/pen.py dump ScW7d 5      # 说明区
python3 audit/tools/pen.py text vO8fN        # 空收藏
python3 audit/tools/pen.py text hVwyK
python3 audit/tools/pen.py dump IYHBB 6      # 最近使用工作区
python3 audit/tools/pen.py text G5GfwW       # 空历史
```

提取到的关键结构与文案：

- S04 页头：图标底（`$accent-soft`）+「我的收藏」+ 页面说明；右侧「本地处理」标记 +「已收藏」。
- S04 工具条：`排序` 分段（最近收藏 / 工具名称 / 分类）+ 分隔线 + `仅显示当前可用工具` + 占位 + `共 N 个收藏` + `全部取消收藏`。
- S04 表头列：**工具 / 分类 / 收藏时间 / 操作**；行高 58，列宽 分类 150、收藏时间 150、操作 132；行操作 = 星标取消收藏 + `打开`。
- S04 状态栏：`收藏记录 · 本地存储` … `共 6 个收藏 · 排序：最近收藏`（`$font-mono` 11px）。
- S04 说明区：`使用说明`（2 步）+ `常见问题`（2 问），问题原文「收藏会保存我处理过的内容吗？」「取消收藏会删除历史记录吗？」。
- S05 工具条：`只记录工具名与访问时间` 强调选项 + 分隔 + `分组` 分段（按时间 / 按分类）+ `共 N 条记录` + `清空全部记录`。
- S05 表头列：**工具 / 分类 / 访问时间 / 操作**；分组头 `今天`（含计数气泡）；行操作 = 移除图标按钮。
- S05 状态栏：`最近使用 · 本地存储` … `共 8 条记录 · 最早 10月10日 15:12`。
- S05 说明区：`使用说明`（2 步）+ `常见问题`（2 问），问题原文「会记录我处理的正文或文件名吗？」「清空记录会影响收藏吗？」。

空态（`vO8fN` / `G5GfwW`）文案：主文案 + 提示 + `浏览全部工具` 按钮 + 补充说明；且**空态下工具条与状态栏仍保留**（`清空`按钮 `opacity=0.45`）。

---

## 2. 实现说明

### 2.1 `useFavorites.ts` — 向后兼容地记录收藏时间

红线要求「不得编造时间」。设计含「收藏时间」列，但旧存储只存标识，因此做了**同 key（`devkit.favorites.v1`）双格式兼容**：

- 旧数据 `string[]` → 读入为 `{ id, at: null }`；
- 新数据 `{ v: 2, items: [{ id, at }] }` → 正常读入；
- 写回统一为 v2；`at` 为 `new Date().toISOString()`；
- 旧数据（`at === null`）在表格中显示占位 **`未知时间`**（`title` 注明「旧版收藏未记录时间」），不伪造时间。

对外 API 保持兼容：`ids`（改为 `computed`，`settings.vue` / `SideNav.vue` / `index.vue` / `ToolCard.vue` / `ToolPageLayout.vue` 只读取 `.value`），并保留 `isFav` / `toggle` / `clear`；新增 `entries`、`addedAt`、`remove`。

### 2.2 `favorites.vue` — 工作区表格

- 页头：星标图标底 + 标题/说明（说明改为「只保存工具标识与收藏时间」，与 FAQ 及真实存储一致）；右侧「本地处理」链接 + 「已收藏 N」状态 chip（真实计数，非伪造按钮）。
- 工作区工具条：`DkSegmented` 排序（最近收藏 / 工具名称 / 分类）、`DkCheckbox`「仅显示当前可用工具」、`共 N 个收藏`、`全部取消收藏`（空态 `disabled`）。
- 表格：工具（图标+名称+用途）/ 分类（`--cat-*-soft` 标签）/ 收藏时间 / 操作（`DkIconButton` 取消收藏 + `打开` 链接）。
- 「仅显示当前可用工具」是**真实过滤**：关闭后展示目录中已不存在的标识，行显示「无法识别的工具 / 收藏标识：<真实 id>」与「已不可用」；默认开启时状态栏提示「N 个收藏已不可用 · 已隐藏」。
- 状态栏 + 说明区（使用说明 2 步、常见问题 2 问，空/非空文案按设计切换）。
- 空态：`还没有收藏任何工具` + `浏览全部工具` + 搜索补充说明。
- `全部取消收藏` 使用 `DkModal` 二次确认。

### 2.3 `recent.vue` — 工作区表格

- 页头：历史图标底 + 标题/说明；右侧「本地处理」+ 「收藏」（跳 `/favorites`，真实可用入口）。
- 工具条：`只记录工具名与访问时间` 强调选项、`分组` 分段（按时间 / 按分类）、`共 N 条记录`、`清空全部记录`（空态 `disabled`）。
- 分组：
  - 按时间：`今天` / `更早`（复用 `recent.grouped`），分组头带计数；
  - 按分类：按 `categories` 顺序分组，未知条目归入 `已不可用`。
- 表格列：工具 / 分类 / 访问时间 / 操作（单条移除）。访问时间为 `今天 HH:MM` 或 `M月D日 HH:MM`。
- 状态栏：`共 N 条记录 · 最早 …`（无记录时 `0 条记录`）。
- 说明区与空态（`暂无访问记录` + `浏览全部工具` + 偏好设置补充说明）。
- 隐私红线：页面不读取/不展示任何输入正文、密钥、Token 或文件名；存储只含 `{ id, at }`。

### 2.4 视觉与无障碍

- 全部使用既有令牌（`--surface` / `--border` / `--text-*` / `--accent(-soft)` / `--star` / `--cat-*-soft`）与既有组件（`DkButton` / `DkSegmented` / `DkCheckbox` / `DkIconButton` / `DkIcon` / `DkModal`），中文界面，无新依赖，无注释。
- 表格使用 `role="table"/"row"/"columnheader"/"cell"`，按钮均有 `title`/`aria-label`；probe `buttonsNoName=0`、`inputsNoLabel=0`。
- 响应式：≤900px 隐藏分类列，≤680px 隐藏时间列并纵向堆叠说明区；640px 宽无横向溢出。

---

## 3. 自测

### 3.1 probe 空态（真实可达：清空 localStorage 后）

```
python3 audit/tools/probe.py /favorites --shot /tmp/g2-favorites-empty.png --full
python3 audit/tools/probe.py /recent --shot /tmp/g2-recent-empty.png --full
```

两页 `status=200`，`console=[]`，`pageerrors=[]`，`failed_requests=[]`；标题分别为 `我的收藏 · DevKit`、`最近使用 · DevKit`。

### 3.2 交互 + 数据态（Playwright 写入 localStorage 后刷新）

脚本：`/tmp/g2_seed_probe.py`（临时文件，未进入仓库）。结果：

```json
{
 "legacy_fav_rows": 2,
 "legacy_fav_unknown_time": 2,
 "legacy_fav_status": "收藏记录 · 本地存储\n1 个收藏已不可用 · 已隐藏\n共 3 个收藏 · 排序：最近收藏",
 "all_fav_rows_after_uncheck": 3,
 "unknown_row_text": ["无法识别的工具"],
 "fav_store_after_remove": "{\"v\":2,\"items\":[{\"id\":\"t05\",\"at\":null},{\"id\":\"legacy-unknown-id\",\"at\":null}]}",
 "v2_fav_rows": 3,
 "v2_fav_times": ["12:58", "昨天 13:08", "9月10日"],
 "v2_fav_names_by_name": ["JSON 格式化", "JSON 转 Java 类", "MD5 / SHA 摘要"],
 "v2_fav_cats_by_cat": ["数据格式", "摘要与加密", "Java 开发"],
 "fav_empty_after_clear": "还没有收藏任何工具",
 "fav_store_after_clear": "{\"v\":2,\"items\":[]}",
 "recent_groups_time": ["今天", "更早"],
 "recent_group_counts": ["2", "1"],
 "recent_rows": 3,
 "recent_times": ["12:08", "11:08", "9月18日 13:08"],
 "recent_status": "最近使用 · 本地存储\n共 3 条记录 · 最早 9月18日 13:08",
 "recent_groups_cat": ["编码与文本", "时间与标识", "Java 开发"],
 "recent_rows_before_after_remove": [3, 2],
 "recent_empty_after_clear": "暂无访问记录",
 "console_and_errors": []
}
```

验证点：

- 旧 `string[]` 收藏被读入（2 行）且「收藏时间」显示 `未知时间`（2 处），不伪造时间；
- 关闭过滤后出现 1 条真实未知标识行；
- 单条移除后 `localStorage` 变为 v2 格式（向后兼容写回）；
- v2 时间列按今天/昨天/更早格式渲染；按名称、按分类排序生效；
- 全部取消收藏 / 清空全部记录经确认后生效，两页进入真实空态；
- 最近使用 `今天/更早` 与 `按分类` 分组、单条移除、清空全部均正常；
- 全过程 `console_and_errors: []`。

截图：`/tmp/g2-favorites-empty.png`、`/tmp/g2-recent-empty.png`、`/tmp/g2-fav-v2.png`、`/tmp/g2-fav-legacy-all.png`、`/tmp/g2-recent-data.png`、`/tmp/g2-recent-cat.png`。

### 3.3 暗色 / 窄屏

```
python3 audit/tools/probe.py /favorites --dark
python3 audit/tools/probe.py /recent --dark
python3 audit/tools/probe.py /favorites --w 640 --h 900
python3 audit/tools/probe.py /recent --w 640 --h 900
```

四项均 `status=200`、`console=[]`、`pageerrors=[]`；640px 下 `doc.w=640`（无横向溢出）。

### 3.4 类型检查

```
cd devkit && npx nuxi typecheck
```

我的 4 个文件无类型错误。仓库中存在 1 个与本任务无关的既有错误：
`app/components/tools/t27-json2ts.vue(659,22): error TS2322`（未改动该文件）。

---

## 4. 真实性说明与边界

- 收藏时间：仅对**新收藏**写入真实 `at`；历史收藏保持 `null` 并显示 `未知时间`，不补造时间。
- 「仅显示当前可用工具」不是装饰：它按当前工具目录真实过滤；被隐藏的不可用收藏在状态栏如实标出数量。
- 最近使用不读取、不展示任何输入正文 / 密钥 / Token / 文件名；存储结构只有 `{ id, at }`。
- 空态为真实首次访问状态（清空 localStorage 即可复现），非加载失败。
- 未改动的文件：`app/utils/json.ts`、`useToolRun.ts`、`usePrefs.ts`、`useTransfer.ts`、`Dk*.vue`、`SplitPanes.vue`、`FileDrop.vue`、`CommandPalette.vue`、`app/error.vue`、`design.pen`、`docs/**`。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/g2-favorites-recent.md
