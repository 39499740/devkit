# L1 宽屏留白优化报告

范围：仅调整容器最大宽度，解决宽屏（≥1920）页面左右两侧大量留白的问题。
工作目录：`/Users/hao/WebstormProjects/web_tools`；站点：`http://localhost:3000`（Nuxt 4 dev，保存即 HMR）。
所有测量均在真实运行页面上用 Playwright（Chromium headless）完成，无编译错误、无 console error。

---

## 1. 改动清单

仅修改任务允许的文件，未触碰 `Dk*.vue`、`utils/**`、`composables/**`、`components/tools/**`、`design.pen`、`docs/**`。未新增依赖、未写注释、未引入固定宽度。

| 文件:行号 | 页面 | 改动前 | 改动后 | 策略 |
|---|---|---|---|---|
| `devkit/app/components/ToolPageLayout.vue:63` | 全部工具页 `.tool-page` | `max-width: 1140px; margin: 0 auto;` | `width: 100%;`（去掉限宽，工作区吃满可用宽度） | 策略 1 |
| `devkit/app/pages/index.vue:258` | 首页 `.home` | `max-width: 1140px` | `max-width: 1680px` | 策略 2 |
| `devkit/app/pages/index.vue:449` | 首页快捷面板 `.home__quick` | `minmax(0,1fr) minmax(0,562px)`（内部固定 562px） | `repeat(2, minmax(0, 1fr))` | 策略 4 |
| `devkit/app/pages/category/[id].vue:195` | 分类页 `.cat-page` | `max-width: 1140px` | `max-width: 1680px` | 策略 2 |
| `devkit/app/pages/favorites.vue:254` | 我的收藏 `.fav` | `max-width: 1140px` | `max-width: 1680px` | 策略 2 |
| `devkit/app/pages/recent.vue:258` | 最近使用 `.recent` | `max-width: 1140px` | `max-width: 1680px` | 策略 2 |
| `devkit/app/pages/settings.vue:286` | 偏好设置 `.settings` | `max-width: 1100px` | `max-width: 1680px` | 策略 2 |
| `devkit/app/pages/privacy.vue:218` | 隐私 `.privacy` | `max-width: 1100px` | `max-width: 1200px` | 策略 3 |
| `devkit/app/pages/help.vue:227` | 帮助 `.help` | `max-width: 1100px` | `max-width: 1200px` | 策略 3 |
| `devkit/app/pages/offline.vue:313` | 离线 `.offline` | `max-width: 900px` | `max-width: 1200px` | 策略 3 |
| `devkit/app/error.vue:151` | 错误页 `.err` | `max-width: 1100px` | `max-width: 1200px` | 策略 3 |

说明：
- 侧栏 `--sidenav-w: 236px` 与 shell 的 `padding: 24px 32px 48px`（`layouts/default.vue:84`）未改动。
- 工具页工作区内部（`SplitPanes`、`DkEditor`）本身是 flex/fill，去掉外层限宽后两个编辑器自动各占约一半。
- 阅读页内部原有的窄限（`offline` 的 520/620、`error` 的 440/520）是正文行宽控制，保留；被统一的只有页面根容器。
- 未新增任何内部固定宽度，表格/网格仍使用 `flex:1` / `repeat(auto-fill|auto-fit, minmax(...))`。

---

## 2. 验证环境与命令

测量脚本：`audit/tools/l1_wide.py`（Playwright Chromium，light 主题，DPR=1）。
脚本在每次导航前把收藏/最近记录写入 `localStorage`，保证列表/表格页有真实行可量测。

```bash
cd /Users/hao/WebstormProjects/web_tools
python3 audit/tools/l1_wide.py \
  > audit/logs/l1-wide-layout.stdout.txt 2>&1
# 退出码 0；完整 JSON 见 audit/logs/l1-wide-layout.json

# 追加：中间宽度（961/1024/1100/1240/1680/2000/3840）溢出扫描
# 输出见 audit/logs/l1-overflow-sweep.txt
```

溢出判定：`document.documentElement.scrollWidth <= clientWidth + 1`，并逐元素检查 `getBoundingClientRect()` 是否越出视口左右边界。

四组视口：`2560×1400`、`1920×1080`、`1440×900`、`390×844`；页面：首页、分类、收藏、最近、设置、隐私、帮助、离线、工具页 `/tools/json-format`。

---

## 3. 测量结果

### 3.1 容器宽度（px）

| 视口 | shell 内容区(含 32px 内边距) | 工具页 `.tool-page` | 首页 `.home` | 首页网格列数 | 分类网格列数 | 收藏 `.fav` | 收藏工具列 | 设置 `.settings` | 阅读页 `.privacy/.help/.offline` |
|---|---|---|---|---|---|---|---|---|---|
| 2560×1400 | 2324 | **2260** | 1680 | 6 | 6 | 1680 | 1222 | 1680 | 1200 |
| 1920×1080 | 1684 | 1620 | 1620 | 6 | 6 | 1620 | 1162 | 1620 | 1200 |
| 1440×900 | 1204 | 1140 | 1140 | 4 | 4 | 1140 | 682 | 1140 | 1140 |
| 390×844 | 390 | 362 | 362 | 1 | 1 | 362 | 223 | 362 | 362 |

关键结论：
- **2560 工具页正文宽度 = 2260px = shell 内容区 2324 − 2×32px 内边距**，即正文已吃满可用宽度（改动前被 1140px 锁死，两侧各浪费约 560px）。
- 首页/分类网格列数随宽度递增：**4（1440）→ 6（1920、2560）**，不再靠拉大卡片留白。
- 收藏/最近为表格型列表：工具列随容器伸缩（682 → 1162 → 1222），分类/时间/操作列保持固定语义宽度，整表填满 1680。
- 阅读页在 2560/1920 统一收敛到 1200px，避免长行不可读；1440 及以下按可用宽度（1140/362）呈现。

### 3.2 横向溢出检查（`scrollWidth <= clientWidth + 1`）

| 视口 | 首页 | 分类 | 收藏 | 最近 | 设置 | 隐私 | 帮助 | 离线 | 工具页 | 溢出元素数 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2560×1400 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| 1920×1080 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| 1440×900 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| 390×844 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |

附加中间宽度扫描（`audit/logs/l1-overflow-sweep.txt`）：

```
BAD: none
checked widths: [961, 1024, 1100, 1240, 1680, 2000, 3840] pages:
['home', 'category', 'favorites', 'recent', 'settings', 'privacy', 'help', 'offline', 'tool']
```

覆盖 `≤960` 断点、`1240`（help 断点）、`1680`、`2000`、`3840`，全部零溢出、零越界元素。

### 3.3 console 错误

四组视口 × 9 个页面，`consoleErrors` 均为空（无编译错误、无 hydration 报错、无资源 404）。

---

## 4. 截图证据

目录：`audit/evidence/l1/`（脚本自动生成）

| 文件 | 视口 | 内容 |
|---|---|---|
| `l1-2560-tool-json-format.png` | 2560×1400 | 工具页：两个编辑器各占约一半，吃满工作区 |
| `l1-2560-home.png` | 2560×1400 | 首页：分类网格 6 列，快捷面板左右均衡 |
| `l1-2560-favorites.png` | 2560×1400 | 收藏页：表格填满 1680，工具列吸收余量 |
| `l1-1920-tool-json-format.png` | 1920×1080 | 工具页 1920 对照 |
| `l1-1440-tool-json-format.png` | 1440×900 | 回归对照：与改动前一致（1140） |
| `l1-1440-home.png` | 1440×900 | 首页回归对照（4 列） |
| `l1-390-tool-json-format.png` | 390×844 | 移动端：编辑器纵向堆叠，无横向溢出 |

---

## 5. 回归评估

- **1440**：shell 可用内容宽正好 1140，改动前后各容器宽度完全相同（首页/分类/收藏/最近/工具页 = 1140）；设置/隐私/帮助/离线在 1440 由 1100/900 放宽到 1140，方向是减少留白、行宽仍在可读区间，属于策略 3 的预期结果。
- **≤960（含 390）**：所有页面宽度 = 视口 − 内边距（390 → 362），网格降到 1 列，无横向溢出，无破版。
- 未触动共享组件与工具实现，未新增依赖，视觉令牌与间距未改。

## 6. 命令原始输出（关键片段）

```text
$ python3 audit/tools/l1_wide.py
=== 2560x1400 ===
  tool       doc=2560/2560 over=False overCount=0  shellContent=2324 toolPage=2260 toolBody=2260  errs=0
  home       doc=2560/2560 over=False overCount=0  home=1680 gridCols=6 quick=1680            errs=0
  category   doc=2560/2560 over=False overCount=0  cat=1680 gridCols=6                       errs=0
  favorites  doc=2560/2560 over=False overCount=0  fav=1680 ws=1680 toolCol=1222 catCol=150   errs=0
  recent     doc=2560/2560 over=False overCount=0  recent=1680 ws=1680                       errs=0
  settings   doc=2560/2560 over=False overCount=0  settings=1680 panelBody=1678              errs=0
  privacy    doc=2560/2560 over=False overCount=0  privacy=1200                              errs=0
  help       doc=2560/2560 over=False overCount=0  help=1200                                 errs=0
  offline    doc=2560/2560 over=False overCount=0  offline=1200                              errs=0
=== 1920x1080 ===
  tool       shellContent=1684 toolPage=1620 ...  home=1620 gridCols=6 ... privacy/help/offline=1200
=== 1440x900 ===
  tool       shellContent=1204 toolPage=1140 ...  home=1140 gridCols=4 ... all pages=1140
=== 390x844 ===
  tool       shellContent=390  toolPage=362  ...  home=362 gridCols=1 ... all pages=362
```

（完整记录：`audit/logs/l1-wide-layout.json`、`audit/logs/l1-wide-layout.stdout.txt`。）
