# 第三轮：404 结构 / 无障碍 / 工具细节 / 字体·FOUC·PWA

日期：2026-09-20 ｜ 4 个并行子代理（H1–H4）+ 本人复核与收尾修正

## 0. 结果

| 项 | 结果 |
|---|---|
| S09 404 | 按设计画板 `edecI` 重建为空状态工作区（页头 + HTTP 404 卡 + 搜索 + 返回/浏览 + 常用工具 + 次级入口） |
| 无障碍 | DkSegmented 改 radiogroup/radio + 方向键 + Home/End + roving tabindex；DkSelect/`DkIconButton` 补可访问名与 ≥40×40 触控目标；设置页 3 个分段控件带标签 |
| 字体 | 去掉 Google Fonts 外链，改自托管 `@fontsource/noto-sans-sc` + `@fontsource/jetbrains-mono`（仅 woff2，9.4MB 产物） |
| FOUC | head 内联脚本在首帧应用主题/字号/减少动画（与 `usePrefs` 同一 localStorage key 与同一 DOM 目标） |
| PWA / 离线 | `@vite-pwa/nuxt`：manifest + 4 个图标 + SW；预缓存 158 项（js/css/html/图标，**不含字体**），字体走 `devkit-fonts` 按需缓存；导航 NetworkFirst + `offline-fallback.html`；`/offline` 显示真实状态 |
| 工具细节 | T36 详情字段（方向/可缓存/幂等/RFC/常见原因）、T37 导出改 CSV、T39 识别显示来源文件、T40 新增真实 ISO-8859-1 使「目标编码无法表示字符」可达 |
| 设计稿 | 交付索引 `c4K4r` 的 R01/R03「视觉」列改 ✓ 并追加第四轮记录；批次索引 `OZuxZ` 改名标注非权威（已写入 design.pen） |

## 1. 验证证据

- `npm run typecheck` → **0 errors**
- `nuxt build` 成功：总体积 6.86 MB（gzip 1.43 MB）
- 开发站点巡检 59 路由 × 明/暗 → **0 pageerror**（仅 404 路由自身预期日志）
- 生产构建 PWA 实测（:3210）：
  - `navigator.serviceWorker` 注册并 activated，`controller = true`
  - 缓存：`workbox-precache` **158 项 / woff2 = 0**、`devkit-fonts` 41、`devkit-pages` 导航缓存
  - 断网后访问已访问页面 → 正常渲染（标题正确）；未访问页面也可由预缓存 JS 渲染
  - 生产 `/offline` 显示「离线缓存已接管 · 已预缓存 158 项 · Cache Storage 3 个缓存」，并分别列出「已缓存 · 可离线打开」与「未缓存 · 需要联网」清单
  - HTML 中已无 `fonts.googleapis.com / fonts.gstatic.com`
- 开发 `/offline` 诚实显示「离线缓存尚未注册（开发服务器默认不注册；生产首次加载后注册）」，不再是空操作按钮
- 404 页截图复核：页头 + 空状态 + 搜索 + 常用工具 + 「仍然找不到？」次级入口，深色与浅色均正常

## 2. 本人收尾修正（在子代理之后）

1. **字体移出预缓存**：H2 原配置把 `woff2` 纳入 `globPatterns`，会导致首次 SW 安装预缓存 **9.4 MB** 字体。已改为从预缓存移除，并新增 `CacheFirst` 规则缓存 `*.woff2`；预缓存降至 158 项（≈1.65 MB 脚本/样式/图标），字体按需缓存。
2. **offline.vue 文案**：原写「已预缓存 … 字体与图标」，与新配置不符；改为「已预缓存 N 项脚本、样式与图标；字体与其它资源在首次显示时按需缓存…」。

## 3. 报告索引

- 子报告：`audit/reports/h1-404.md`、`h2-offline-fonts-fouc.md`、`h3-a11y.md`、`h4-tools-details.md`
- 设计稿：`audit/design-fix.md`（含索引整理）

## 4. 仍未做 / 已知限制

- **R02（390 移动端）与 R04（可访问性样板）设计画板**未逐张截图复核（索引中仍为 △）。
- 设计稿只读缓存：Pen 对本地文件的自动保存只写备份，本轮索引改动已同法写入 `design.pen`（节点数 39 741）。
- 开发模式下 Nuxt 的错误浮层（iframe）仍会在 404 路由出现——这是 Nuxt dev 行为，生产构建不存在。
- 深色首帧脚本与 `usePrefs` 逻辑保持同源，但若未来新增偏好项需同步更新两处（已在 h2 报告中提示）。
- 桌面端拖拽文件、剪贴板权限拒绝等路径仍依赖真实浏览器权限，属首轮已标注的“存疑项”。
