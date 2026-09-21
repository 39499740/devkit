# DevKit 品牌标识方案（2026-09-21）

状态：**2026-09-21 已采用方案 A 并落地**——`devkit/public/pwa-*.png` 四张图标、`TopNav.vue` 内联 SVG、`design.pen` 顶部导航 `Logo 图形`、`README.md` 与 `devkit/FOUNDATION.md` 的品牌说明均已更新。

目标：给站点一个能自解释的品牌标识——既贴合「开发者工具箱」，又不把品牌绑死在开发者这一个职业上，便于以后扩展成各行各业都能用的工具箱。

## 方案 A（推荐）：工具箱

- 构成：实心圆角箱体 + 盖缝 + 中间分格 + 描边提手；24×24 网格，线宽 2.4，圆头圆角。
- 语义：箱体＝收纳容器（不限行业）；提手＝随身携带，对应纯本地处理、离线可用、可安装为桌面应用；盖缝 + 分格＝箱内分格收纳，对应「各类工具各就各位」。
- 与现状的差别：不再画折线 M（无语义），也不画扳手 / 齿轮 / 花括号等绑定职业的符号。
- 尺寸策略：16px 下细节自然退化为「箱体 + 提手 + 一条盖缝」，仍可辨识；32px 以上保留分格细节。只维护一套图形，不做两套资产。

## 方案 B（备选）：六角螺母

- 构成：实心六边形 + 中心圆孔（evenodd 挖空），缩放最干净，抽象度最高。
- 取舍：16px 最清晰，但语义偏五金 / 工程，与「工具箱」这一产品隐喻隔了一层。

## 现状（对照）

- 线上图标是蓝底 + 白色折线，形状读作「M」；`design.pen` 里 `m7peZ` / `pqSvV` 的品牌 Logo 其实指定的是 Lucide `braces`（花括号），实现时被换成自绘折线且未记录，因此现状图形没有文档化语义。

## 资产清单（本目录）

- `mark.svg`：标识本体（24 网格，`currentColor`，可随明暗主题变色）。
- `app-icon.svg`：512 圆角方块版本（圆角 115，底色 `#2563EB`）。
- `pwa-192.png` / `pwa-512.png`：普通 PWA 图标，图形占 62.5%。
- `pwa-maskable-192.png` / `pwa-maskable-512.png`：maskable 版本，满幅蓝底、图形收到 72%（安全区，圆形裁切不切图形）。
- `proposal.png`：方案书（尺寸实测、16px 点采样放大、标签页与顶栏场景、备选对照）。

## 落地步骤（确认方案后执行）

1. `cp docs/logo-proposal-20260921/pwa-*.png devkit/public/`，保持文件名不变（`rel=icon`、`apple-touch-icon`、manifest 四张图标、`og:image` 都引用这些文件名，无需改 `nuxt.config.ts`）。
2. `devkit/app/components/TopNav.vue` 内联 SVG 换成 `mark.svg` 的路径，容器仍是 28×28、圆角 7、`var(--accent)`。
3. `design.pen` 顶部导航的 `Logo 图形` 节点从 Lucide `braces` 换成新标识，保持设计稿与实现一致。
4. 在 `README.md` / `devkit/FOUNDATION.md` 里补一句标识语义，避免以后又被当成无意义图形替换。
5. 验收：`npm run typecheck` + `npm run generate`，线上 `sw.js` / `index.html` 的 sha256 与本地一致，标签页与安装图标肉眼复核。

## 可复跑生成脚本

- `audit/tmp/logo_build.mjs`：生成 `mark.svg`、`app-icon.svg`、四张 PWA PNG 与 `proposal.png`（依赖 `rsvg-convert`、ImageMagick）。
- `audit/tmp/logo_render.mjs` / `audit/tmp/logo_context.mjs`：候选方案对比表与场景对照图生成器（接受候选 JSON）。
