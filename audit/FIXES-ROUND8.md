# 第八轮：页脚常驻视口底部（用户反馈修复 + 移动端表格挤压）

日期：2026-09-20

## 1. 现象与根因

**现象**：内容超过一屏时，页脚落在文档末尾，必须滚动到底才看得到；用户要求页脚「固定在底部」。

**根因**：上一轮只解决了「短页页脚上浮」，做法是让内容区吃掉剩余空间（`.shell__content-inner { flex: 1 }`），页脚仍在**文档流**里——长页时它自然被推到文档末尾。

## 2. 修复

`devkit/app/layouts/default.vue`：

- `.shell__foot` 改为 `position: sticky; bottom: 0; z-index: 5`，页脚始终贴在视口底部；滚动到底时它正好落到文档末尾，不会遮挡最后一行内容。
- 为了滚动时彻底遮住身后内容，页脚用不透明背景 `background: var(--bg)`（尝试过 92% 半透明 + backdrop-blur，透出的表格行与备案号文字互相干扰，已放弃），上方加一道 `box-shadow` 表示悬浮。
- `.shell__content` 的底部内边距（桌面 24px / 移动 24px）移到页脚自身（`padding: 16px 0 24px`），这样页脚在文档末尾的自然位置与 sticky 位置重合，滚动到底不会出现 24px 跳变。
- 移动端（≤960px）页脚压缩为一行：`gap: 4px; padding: 12px 0 16px; font-size: 11.5px`，链接加 4px 垂直内边距保证可点。

## 3. 顺带修复：帮助页快捷键表格在 390px 下被挤成每行一两个字

`devkit/app/pages/help.vue`：表格外新增 `.kbd__scroll { overflow-x: auto }`，并在 `max-width: 620px` 内给 `.kbd__table` 设 `min-width: 560px`。390px 下表格改为横向滚动，首列宽度从「1 个字」恢复到 178px，页面无横向溢出。

## 4. 验证

- 57 条路由 × 1440×900 / 390×844，分别在滚动顶部与中间测量：页脚底边 = 视口底边（0 处不符）。
- 短页（/favorites、/settings）与长页（/tools/http-status 2910px、/help 1262px）在滚动顶部 / 中间 / 底部，页脚底边恒为视口底边。
- 59 条路由全量巡检：仅 3 条预期 404 路由有 404 控制台记录，0 页面错误、0 横向溢出。
- `npx nuxt typecheck`：0 错误；`npm run generate`：115 条路由、PWA 预缓存 274 项；产物 CSS 已含 `position:sticky;bottom:0`。
- 深色 / 浅色、桌面 / 移动截图核对：页脚为底部一条栏，正文从它下方穿过。
