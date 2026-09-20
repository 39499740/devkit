# H2 报告：首帧 FOUC / 字体自托管 / PWA 离线缓存

范围：`devkit/`。仅改动分配给我的文件；未触碰 design.pen、docs/**、app/utils/json.ts、useToolRun.ts、usePrefs.ts、useTransfer.ts、DkModal.vue、SplitPanes.vue、FileDrop.vue、CommandPalette.vue 等。

改动文件：

- `devkit/nuxt.config.ts`
- `devkit/package.json`、`devkit/package-lock.json`（新增依赖）
- `devkit/app/assets/css/main.css`
- `devkit/app/pages/offline.vue`
- `devkit/public/offline-fallback.html`（新增）
- `devkit/public/pwa-192.png`、`pwa-512.png`、`pwa-maskable-192.png`、`pwa-maskable-512.png`（新增，PIL 生成）

依赖新增：`@fontsource/noto-sans-sc@^5.3.0`、`@fontsource/jetbrains-mono@^5.3.0`、`@vite-pwa/nuxt@^1.1.1`（含 vite-plugin-pwa 1.3.0 / workbox-build 7.4.1）。

设计依据（只读）：`python3 audit/tools/pen.py dump S0Kfwk 8`、`text S0Kfwk`、`text rRK06`、`node Uu5ew`、`node b1AezB`（S10a 已缓存 / S10b 首次未缓存，以及两条设计注释：「可离线使用」必须在缓存就绪后才显示；不得声称所有工具均已缓存）。

---

## 任务 A：深色主题首帧闪烁（FOUC）

### 做法

`nuxt.config.ts` 的 `app.head.script` 注入一段内联脚本（`tagPriority: 'critical'`），渲染在样式表之前。脚本：

- 只读同一个 `localStorage` key `devkit.prefs.v1`，与 `usePrefs` 完全一致；
- `theme === 'dark'` → 加 `dark`；`theme === 'light'` → 不加；否则（含默认 `system`）跟随 `matchMedia('(prefers-color-scheme: dark)')`；
- 设置 `--code-font-size`（仅当为合法正数）；
- `reduceMotion` 为真时给 `<html>` 加 `reduce-motion`，并在 `body` 可用时同步加上（与 `usePrefs` 的 `body.classList.toggle('reduce-motion')` 目标一致）；
- `localStorage` 不可用、读取抛错、JSON 损坏、`p` 非对象，全部各自 try/catch 兜底，不阻塞页面。

为让首帧就生效的 `html.reduce-motion` 与 `usePrefs` 写入的 `body.reduce-motion` 语义一致，`main.css` 的减少动效规则选择器扩展为同时匹配 `body.reduce-motion` 与 `html.reduce-motion`（单一事实来源仍是同一份 prefs）。

一致性：内联脚本与 `usePrefs` 使用同一个 key、同一套判断、同一个 DOM 目标（`html.dark`、`--code-font-size`、reduce-motion），`usePrefs` 在 `onMounted` 会再执行一次 `applyTheme()`，结果相同，不存在两套真相。

### 验证（生产构建 + Playwright，端口 3200）

首帧检查方式：`context.add_init_script` 在 document_start 写入 prefs，并用 `requestAnimationFrame` 在第一帧记录 `documentElement` 的真实 class 与 CSS 变量。

```
A1 dark first-frame: {'dark': True, 'size': '15px', 'rm': True}
A1 dark after-hydrate: {'dark': True, 'bodyRm': True, 'size': '15px', 'bg': 'rgb(15, 17, 21)'}
A2 light(OS dark) first-frame: {'dark': False}
A2 light after-hydrate dark= False
A3 system(OS dark, no prefs) dark= True
```

`A1`：深色用户首帧即 `dark`、字号 15px、reduce-motion 生效；水合后一致，body 背景 `rgb(15,17,21)`（`--bg` 深色值）。
`A2`：prefs 为 light 且系统为 dark 时，首帧与水合后都不带 `dark`，浅色用户不闪深色。
`A3`：无 prefs 且系统 dark 时首帧即深色，与 `usePrefs` 默认 `system` 行为一致。

HTML 顺序（`curl /`）证明脚本在样式之前：

```
1 <script type="importmap"> ...
2 <script> (function(){var e=document.documentElement; ...   # prefsBoot
3 <link rel="stylesheet" href="/_nuxt/entry.XXXXXXXX.css" ...  # 样式在其后
```

另用 `curl http://[::1]:3000/`（开发服务器）确认 dev 下同样注入且顺序正确、无 Google Fonts。

---

## 任务 B：字体自托管

### 做法

- 删除 `nuxt.config.ts` 中指向 `fonts.googleapis.com` 的 `<link>`。
- 新增 `css` 数组，按 400/500/600/700 与 Mono 400/500/600 引入 `@fontsource` 的 CSS（`main.css` 中未再使用 `@import`）。
- 在 `nuxt.config.ts` 加了一个内联 Vite 插件 `devkit-fontsource-woff2-only`（`enforce: 'pre'`），在 `@font-face` 的 `src` 中去掉 `url(...woff) format('woff')` 回退，只保留 woff2。

### 为什么用 Vite 插件而不是 `main.css` 的 `@import`

初版按任务书建议在 `main.css` 顶部 `@import '@fontsource/.../400.css'`。实测 Vite 对 CSS `@import` 采用“读取内联”方式，不会经过自定义 `transform` 钩子，导致 407 个 `.woff` 回退文件被打包（产物体积翻倍）。改为在 `nuxt.config` 的 `css` 数组引入后，字体 CSS 作为独立模块经过 `transform`，woff 回退被正确剔除。

### 体积与取舍（真实测量）

```
noto-sans-sc woff2 文件数: 392
noto-sans-sc woff2 体积:   9.29 MB
jetbrains-mono woff2 体积: 0.11 MB
entry css (含全部 @font-face): 0.42 MB
.output/public 总体积:     12 MB
输出中 .woff 文件数:       0
```

- Noto Sans SC 4 个字重的完整 unicode-range 子集，仅 woff2 就有 **9.29 MB**（若保留 woff 回退约再多 12 MB，总约 21 MB）。这确实超过了任务书举例的 8 MB 阈值。
- 取舍：只输出 woff2。woff2 自 2016 年起被所有支持 Service Worker 的现代浏览器支持，而本项目离线能力本身就依赖 Service Worker，因此 woff 回退在本项目里没有实际受众；去掉它不牺牲任何可离线浏览器的可视效果。
- 未做进一步子集裁剪，因为不引入额外依赖就无法安全地削减 CJK 字形；为保证「中文字形正常显示」且离线可用，保留了完整子集，如实报告体积。
- JetBrains Mono 只取 latin/latin-ext/greek/cyrillic，体积可忽略。

### 验证

```
B1 body font-family: "Noto Sans SC", -apple-system, "system-ui", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
B1 --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace
B1 document.fonts.check(Chinese)= True
B1 google-font requests= []
B1 woff2 requests (count)= 41
```

- 页面请求列表中 **没有任何** `fonts.googleapis.com` / `fonts.gstatic.com` 请求；`curl` 的 HTML 中同样为 0。
- `document.fonts.load('16px "Noto Sans SC"', '中文测试')` 后 `document.fonts.check(..., '中')` 返回 `True`，说明中文字形子集已实际加载。
- 构建产物中 `.woff` 数量为 0，只剩 woff2。

---

## 任务 C：PWA / 离线缓存（对应设计 S10）

### 配置

`nuxt.config.ts` 注册 `@vite-pwa/nuxt`：

- `registerType: 'autoUpdate'`；`devOptions.enabled: false`（开发服务器不注册 SW，符合要求）。
- manifest：`name/short_name = DevKit`、`theme_color/background_color = #F4F5F7`、`display: standalone`、`lang: zh-CN`，图标 192/512 与两张 `purpose: maskable`。
- 图标用 `python3 + PIL` 生成（无前端绘图依赖）：蓝底 `#2563EB` 圆角方块 + 与站内 TopNav 相同的白色几何折线标识；maskable 版本满幅背景并把标识收进安全区。
- Workbox：预缓存 `js/css/html/woff2/png/svg/ico/webmanifest`（`maximumFileSizeToCacheInBytes` 4MB）；导航请求用 `NetworkFirst`（4s 超时）缓存到 `devkit-pages`，未命中且离线时用 `precacheFallback` 返回 `public/offline-fallback.html`。

`public/offline-fallback.html` 是自包含的静态回退页（内联 CSS/JS、无外链），文案对应设计 S10b：「无法加载该页面 / 首次访问需要网络，当前无法加载」，并提供真实的重试（`location.reload()`）与网络状态显示。

### 过程中发现并修复的三个真实障碍

1. **`@vite-pwa/nuxt` 默认 `workbox.navigateFallback = '/'`**：SSR 构建没有预缓存的 `/`，生成的 `createHandlerBoundToURL('/')` 在运行时找不到预缓存条目，会把所有导航打挂。已设 `navigateFallback: ''` 关闭它，改由 `NetworkFirst + precacheFallback` 处理导航。
2. **模块的 manifest transform 会把 `offline.html` 改写成 `offline`**，导致 Workbox 去 fetch 不存在的无扩展名 URL（404，SW 安装失败）。已提供自己的 `manifestTransforms`（保留原 URL），并让回退文件名为 `offline-fallback.html`。
3. **Workbox 预缓存默认 `cleanURLs`**：即使 manifest 里是 `offline.html`，它也会同时响应 `/offline`，从而遮蔽 Nuxt 的 `/offline` 页面（实测 `/offline` 被静态回退内容顶替）。改名 `offline-fallback.html` 后不再与任何真实路由冲突，`/offline` 恢复为可用的 Vue 页面。

### `offline.vue` 的真实状态展示

所有结论都来自运行时真实探测（`navigator.serviceWorker`、`getRegistration()`、`caches.keys()`、逐个 `caches.open()` 统计）：

- 四种状态：`unsupported`（无 SW）/ `unregistered`（未注册，如开发服务器）/ `uncached`（已注册但尚未接管）/ `controlled`（已接管）。
- `controlled` 时展示：`Service Worker：已注册（activated）`、`当前页面接管：是`、`预缓存条目：N`、`Cache Storage：X 个缓存`，并按 Cache Storage 中真实存在的导航 URL 把工具拆成「已缓存 · 可离线打开」与「未缓存 · 需要联网」两列（对应设计 S10a/S10b）。
- 未接管时明确写「首次访问尚未缓存」，只说明真实范围，不承诺「所有工具离线可用」，并有纯说明文案：「DevKit 不会声称所有工具都可离线使用」。
- 「重新检测」做了真实动作：`registration.update()` + 对本站图标发 `HEAD` 探测 + 重新读取 Cache Storage，并打印检测结果与时间。

### 验证（生产构建，`node .output/server/index.mjs`，端口 3200）

> 注意：单独使用 Playwright `context.set_offline(True)` 并不能真正阻断 Service Worker 的网络请求（实测 SW 仍能拿到线上响应）。因此真离线阶段先在浏览器内 `pkill` 掉 Nitro 服务器（确认 `server reachable after kill = False`）再做导航。

`npm run build` 成功，产物包含 `sw.js`、`workbox-*.js`、`manifest.webmanifest`。

预热（在线）：

```
C1 controller (1st load)= http://127.0.0.1:3200/sw.js
C1 controller (2nd load)= http://127.0.0.1:3200/sw.js
C2 /tools/base64 navigation cached= True
C3 /offline cached= True
C3 precache entries= 562
C3 /offline ONLINE title/state snippet: 离线与缓存状态 · DevKit ... 离线缓存已接管 ...
```

真离线（杀掉服务器后）：

```
C4 server reachable after kill= False
C5 OFFLINE visited /tools/base64 renders Base64= True
C6 OFFLINE unvisited /tools/sm2 fallback= True | title: 当前离线 · DevKit
C7 OFFLINE /offline renders= True
C7 controller still present= True
```

聚焦检查 `/offline`（已接管时）真实状态块：

```
离线缓存已接管 | Service Worker 已接管本页面，已缓存的资源与页面可在断网时继续打开。 |
离线缓存已就绪 | 已预缓存 562 项脚本、样式、字体与图标；已访问过的页面导航也保存在本机。未缓存的页面仍需联网一次。 |
Service Worker：已注册（activated） | 当前页面接管：是 | 预缓存条目：562 | Cache Storage：2 个缓存 |
已缓存 · 可离线打开（1） | Base64 编解码 | 可离线
```

HTML 级证明（无外链）：`grep -c fonts.googleapis /tmp/h2_home.html` = 0；`grep -c devkit.prefs.v1` = 1。

---

## 已知边界与如实说明

- 首次访问会预缓存 562 项（其中约 400 个字体分片、约 10 MB）。这是完整中文子集 + 离线可用的代价；已在体积小节说明。
- 预缓存的是「构建产物」；已访问页面的 HTML 由 `NetworkFirst` 运行时缓存，因此**只有在线打开过的页面**才能离线打开，从未访问过的页面离线时进入静态回退页。这与设计 S10b 一致，未承诺「所有工具离线可用」。
- Playwright 的 `set_offline` 对 Service Worker 网络不生效，本报告的离线结论以「停掉服务器」为真离线依据。
- 静态回退页 `offline-fallback.html` 直接访问路径为 `/offline-fallback.html`（它预缓存后经 `cleanURLs` 也会响应 `/offline-fallback`），它不是 Nuxt 路由，不会遮蔽任何页面。
- 未做人工像素级字形目检；中文字形以 `document.fonts.check` 与页面中文实际渲染为证据。
- 遇到一次依赖安装告警（1 个 transitive critical，来自构建链的 glob 旧版本），不影响本次实现，未处理。

## 复现命令

```bash
cd devkit
npm install @fontsource/noto-sans-sc@^5.3.0 @fontsource/jetbrains-mono@^5.3.0 @vite-pwa/nuxt@^1.1.1
npm run build
PORT=3200 HOST=127.0.0.1 node .output/server/index.mjs
# Playwright: 先写入 devkit.prefs.v1 检查首帧 class；两次访问确认 controller；
# 访问 /tools/base64 后停掉服务器，再导航 /tools/base64 与 /tools/sm2
```

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/h2-offline-fonts-fouc.md
