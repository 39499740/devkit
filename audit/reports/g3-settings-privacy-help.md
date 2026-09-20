# G3 · S06 偏好设置 / S07 隐私说明 / S08 帮助与快捷键 — 设计还原报告

- 工作目录：`/Users/hao/WebstormProjects/web_tools`（Nuxt 4 在 `devkit/`）
- 开发服务器：`http://localhost:3000`（保存即 HMR，最终自测均为当前运行版本）
- 设计依据（Pen 节点）：
  - S06 设置项 `Io3lB`、S06 清理确认弹层 `l5gzJ`
  - S07 本地处理与隐私 `zCSiu`
  - S08 帮助与快捷键 `q9n6x`
- 修改文件（仅这 3 个）：
  - `devkit/app/pages/settings.vue`
  - `devkit/app/pages/privacy.vue`
  - `devkit/app/pages/help.vue`
- 未改动任何被点名保护的文件（`json.ts`、`useToolRun.ts`、`usePrefs.ts`、`useTransfer.ts`、`Dk*.vue`、`SplitPanes.vue`、`FileDrop.vue`、`CommandPalette.vue`、`app/error.vue`），也未改 `design.pen` 与 `docs/**`。

---

## 1. 设计读出（pen.py）

```
python3 audit/tools/pen.py text Io3lB   # S06 设置项文案与分组顺序
python3 audit/tools/pen.py text l5gzJ   # S06 清理确认弹层文案
python3 audit/tools/pen.py text zCSiu   # S07 全部区块文案
python3 audit/tools/pen.py text q9n6x   # S08 全部区块文案
python3 audit/tools/pen.py dump Io3lB 11   # 设置体两列 / 分组头 / 行控件
python3 audit/tools/pen.py dump l5gzJ 8    # 弹层结构（清单行 / 提示条 / 底部按钮）
python3 audit/tools/pen.py dump zCSiu 12   # 三条原则 / 数据流向 / 保存范围 / 触发行为 / 边界
python3 audit/tools/pen.py dump q9n6x 12   # 快速上手 / 快捷键表 / 常见疑问 / 反馈 / 说明区
```

关键结构与文案：

- **S06 设置项**：页头（图标底 + 标题 + 说明 + 右侧「本地处理」标记）；工作区 = 设置头（`偏好设置` … `偏好保存在此浏览器 · 上次修改 09:41`）+ 两列设置体 + 状态栏；说明区 = 使用说明（2 步）+ 常见问题（2 问）。
  - 左列分组：`外观`（主题 浅色/深色/跟随系统）、`编辑器`（代码字号 12/13/14 px、默认缩进 2/4 空格/Tab、编辑器自动换行 开关）。
  - 右列分组：`动效与记录`（减少动画、记录最近使用）、`本地数据`（重置偏好 →「重置」按钮、清除本地数据 →「选择清除范围…」按钮，按钮文字 `$error`）。
  - 状态栏：`偏好 · 本地存储` … `未登录 · 不需要账号`（`$font-mono` 11px）。
- **S06 清理确认弹层**：宽度 540；标题「清除本地数据」；说明「将清除以下保存在当前浏览器中的数据，清除后无法恢复：」；三条清单行：偏好设置 / 我的收藏 / 最近使用；警示条「输入内容、密钥与 Token 从不保存，因此不在清除范围内。」；底部「取消 / 确认清除」。**未使用「清空全部数据」等模糊措辞**。
- **S07**：页头 + 工作区 = 三条原则（浏览器本地计算[默认] / 静态资源仍需加载 / 不提供云端历史）→ 数据流向卡片（你的输入 → 浏览器内处理 → 结果与导出，右上「全程不离开你的设备」）→ 保存范围两列（会保存：界面偏好 / 最近使用记录 / 收藏 / 可关闭项；不会保存：输入正文 / 密钥与 IV / Token 与认证头 / 原始文件）→ 触发行为两卡（剪贴板、离线可用性）→ 边界说明两卡（不作过度承诺、性能取决于设备）；说明区「返回并继续处理」+ 三入口。
- **S08**：页头 + 工作区 = 快速上手四卡（检索工具 / 导入文件 / 复制与下载 / 参数与编码）→ 快捷键对照表（操作 / Windows·Linux / macOS）→ 常见疑问两列（字符与字节的区别 / 结果为什么会“待更新”）→ 反馈入口位置 + 离线与缓存；说明区「返回工具继续操作」+ 三入口。

---

## 2. 实现说明

三页均沿用现有令牌与组件：`DkButton / DkSegmented / DkSwitch / DkCheckbox / DkModal / DkIcon`，使用 `--surface / --surface-subtle / --border / --accent / --ok / --warn / --error / --cat-*` 等 CSS 变量；页头结构（32px 图标底 + 21px 标题 + 12.5px 说明 + 「本地处理」胶囊）三页统一。

### 2.1 `settings.vue`（S06）

- 页头 + `本地处理` 胶囊（链接 `/privacy`）。
- 工作区两列 `grid`（>900px 两列，以下单列），分组头带图标 + 浅底，行分隔线，与设计的分组顺序、标题、说明逐条对齐。
- 控件按设计：主题与缩进用 `DkSegmented`；**代码字号改为设计的三档分段（12/13/14 px）**（原实现是 12–18 滑杆）；自动换行、减少动画、记录最近使用用 `DkSwitch`。
- `重置偏好` 直接调用 `usePrefs().reset()`（设计该行只给「重置」按钮），`localStorage` 即时写回并 toast。
- `清除本地数据` 打开 540px `DkModal`：逐条列出三类范围的真实内容，并用 `DkCheckbox` 让用户**选择清除范围**（按钮文案「选择清除范围…」），未选任何范围时「确认清除」禁用；清除项执行后分别调用 `reset() / fav.clear() / recent.clear()`。
- 状态栏 `偏好 · 本地存储` … `未登录 · 不需要账号`；说明区使用说明 2 步 + 常见问题 2 问，文案取自设计。

### 2.2 `privacy.vue`（S07）

- 按设计完整补齐：三条原则、数据流向（含 `↗` 箭头步骤）、保存范围两列、触发行为两卡、边界说明两卡；底部「返回并继续处理」+ `返回全部工具` / `帮助与快捷键` / `查看离线说明` 三个真实路由入口。
- 覆盖任务要求的全部话术点：浏览器本地计算、静态资源仍需加载、可保存的偏好类型（界面偏好/最近使用/收藏/可关闭项）、输入不默认持久化（输入正文/密钥与 IV/Token/原始文件）、剪贴板与下载由用户主动触发、不提供云端历史、离线可用性以缓存状态为准。
- 「剪贴板」卡片按任务要求补入下载：「只有点击复制或下载时才会写入剪贴板、保存文件…」。
- 工具总数用 `toolCount`（`~/data/tools`）动态渲染，实际为 41，与设计「全部 41 个工具」一致，不写死。

### 2.3 `help.vue`（S08）

- 快速上手四卡，每卡都有可点击入口：检索工具 → 打开命令面板；导入文件 → `/tools/file-digest`；复制与下载 → `/tools/base64`；参数与编码 → `/tools/hmac`。
- 快捷键表按设计给 Windows/Linux 与 macOS 两列，并补入真实实现的动作；底部说明哪些操作目前只有按钮入口。
- 常见疑问两列（字符与字节 / 待更新）各 4 行，列头带「打开工具」链接（`/tools/unicode-bytes`、`/tools/json-format`）。
- 反馈区如实描述顶栏「源码」入口，不编造邮箱 / 仓库地址；离线卡片内联链接 `/offline`。
- 说明区「返回工具继续操作」+ `返回全部工具` / `偏好设置` / `隐私说明` 三个真实入口。

---

## 3. 真实性红线处理（重要）

1. **「上次修改 09:41」不渲染**：`usePrefs` 未存 `lastModified`（且不允许改它），因此没有伪造时间；设置头提示改为真实的「偏好保存在此浏览器 · 修改即写入本地」。
2. **收藏时间**：`useFavorites` 当前已是 v2（`{ v: 2, items: [{ id, at }] }`，旧的 `string[]` 读入为 `at: null`）。弹层因此展示真实动态文案，例如实测：
   - `3 个收藏的工具标识与收藏时间（其中 1 条为旧版记录，没有时间）`
   - `2 条工具名称与访问时间`
   旧数据没有时间时明确说明，不伪造；`privacy.vue` 收藏行同步改为「工具标识与收藏时间，不含输入」。
3. **快捷键表只列真实实现**：`Ctrl/⌘ K`（`layouts/default.vue`）、`Esc`（`CommandPalette`/`DkModal`）、`↑/↓`、`Enter`（`CommandPalette`）均已实现；`Ctrl/⌘ + Enter` 仅 16/41 个工具实现，故动作写作「在支持的工具中执行主操作」并在表下注明「只在部分工具中可用」。
   - 设计里的 `Ctrl+Shift+C / Ctrl+S / Ctrl+Shift+Backspace / Alt+V / Ctrl+I / Ctrl+O` 在代码中**未实现**，不列入快捷键表，改在脚注说明这些操作目前通过界面按钮完成。
4. **不引入邮箱 / 仓库链接**：反馈卡只描述顶栏已有的「源码」外链（当前指向 github.com），并说明本站无工单系统、不会显示提交成功。
5. **S06 页头的「收藏」按钮未实现**：`/settings` 不是工具页，`useFavorites` 存的是工具 id，给设置页做收藏属伪造状态；该处只保留设计同样存在的「本地处理」标记。
6. **「DevTools」笔误纠正**：S07 页面说明设计原文为「了解 DevTools …」，实现改为「了解 DevKit 在浏览器内如何处理你的输入、偏好与文件。」

---

## 4. 自测（命令与关键输出）

### 4.1 probe（light + dark，1440×900）

```
python3 audit/tools/probe.py /settings
python3 audit/tools/probe.py /settings --dark
python3 audit/tools/probe.py /privacy
python3 audit/tools/probe.py /privacy --dark
python3 audit/tools/probe.py /help
python3 audit/tools/probe.py /help --dark
```

汇总（最终一轮）：

```
settings/light status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=偏好设置 · DevKit
settings/dark  status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=偏好设置 · DevKit
privacy/light  status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=本地处理与隐私 · DevKit
privacy/dark   status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=本地处理与隐私 · DevKit
help/light     status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=帮助与快捷键 · DevKit
help/dark      status=200 consoleErr=0 pageErr=0 failedReq=0 docW=1440 title=帮助与快捷键 · DevKit
```

`docW=1440` = 视口宽，无横向溢出；`a11y.inputsNoLabel=0`、`buttonsNoName=0`。

### 4.2 交互验证（Playwright，脚本 `/tmp/g3/interact.py`）

```
python3 /tmp/g3/interact.py
```

关键输出（预置 `devkit.favorites.v1` v2 数据 + `devkit.recent.v1` 后）：

```json
{
 "settings": {
  "modal_body": "将清除以下保存在当前浏览器中的数据，清除后无法恢复：\n\n偏好设置\n主题、代码字号、自动换行、默认缩进、减少动画\n我的收藏\n3 个收藏的工具标识与收藏时间（其中 1 条为旧版记录，没有时间）\n最近使用\n2 条工具名称与访问时间\n输入内容、密钥与 Token 从不保存，因此不在清除范围内。",
  "modal_open": true, "checkbox_count": 3,
  "fav_after": "{\"v\":2,\"items\":[]}", "recent_after": "[]", "modal_open_after": false,
  "dark_class": true, "prefs_theme": "dark", "code_font_var": "14px",
  "console_errors": []
 },
 "help": {
  "palette_open_via_button": true, "palette_closed_esc": true, "palette_open_via_ctrlk": true,
  "link_hrefs": ["/tools/file-digest","/tools/base64","/tools/hmac","/tools/unicode-bytes",
                 "/tools/json-format","/","/settings","/privacy"],
  "console_errors": []
 }
}
```

结论：清理弹层范围为真实三类、勾选后确认能真正清空对应 `localStorage`；设置项即时写回（`theme=dark`、`--code-font-size=14px`）；帮助页四个入口按钮/链接、`Ctrl/⌘ K` 与 `Esc` 均按预期工作。

### 4.3 多宽度深色溢出扫描（脚本 `/tmp/g3/overflow.py`，390/768/1024/1440）

```
python3 /tmp/g3/overflow.py
overflow bad: []   # 12 组（3 页 × 4 宽度）全部 scrollW==clientW，且 console error 为 0
```

### 4.4 深色对比度（WCAG 相对亮度比）

| 选择器 | 页 | 颜色 / 背景 | 对比度 |
| --- | --- | --- | --- |
| `.panel__title` | settings | rgb(233,237,243) / rgb(22,26,33) | 14.85 |
| `.row__desc` | settings | rgb(159,169,184) / rgb(22,26,33) | 7.34 |
| `.panel__hint` | settings | rgb(108,118,134) / rgb(22,26,33) | 3.80 |
| `.card__body` | privacy | rgb(159,169,184) / rgb(27,32,41) | 6.88 |
| `.scope__desc` | privacy | rgb(159,169,184) / rgb(27,32,41) | 6.88 |
| `.card__body` | help | rgb(159,169,184) / rgb(27,32,41) | 6.88 |
| `.faq__desc` | help | rgb(159,169,184) / rgb(27,32,41) | 6.88 |
| `.kbd__table thead th` | help | rgb(108,118,134) / rgb(27,32,41) | 3.56 |

正文均 ≥6.8:1；`--text-tertiary` 的小号辅助文字为 3.56–3.80:1，属设计既定的三级文字色（与全站一致，非本次新引入），肉眼在深色下可读，未出现“看不见”的情况。

---

## 5. 已知取舍

- 代码字号按设计只提供 12/13/14 三档。若历史 `localStorage` 里存了 12–18 中的其他值（旧滑杆遗留），样式仍会应用该值，但三档分段都不会高亮；用户点任一档或「重置偏好」即可回到设计取值范围。
- 说明区在窄屏改为单列/纵排（`@media` 900/620px），桌面 1440 与设计一致。
- 未新增任何依赖，未使用行内注释。

---

## 6. 交付

- `devkit/app/pages/settings.vue`（S06：分组设置项 + 可选择范围的清理弹层 + 使用说明/FAQ）
- `devkit/app/pages/privacy.vue`（S07：三条原则 + 数据流向 + 保存/不保存 + 触发行为 + 边界 + 返回入口）
- `devkit/app/pages/help.vue`（S08：快速上手可点击入口 + 真实快捷键双列表 + 字符/字节与待更新 + 反馈与离线 + 返回入口）

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/g3-settings-privacy-help.md
