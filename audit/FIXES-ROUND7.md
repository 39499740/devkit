# 第七轮：页脚随内容上移（用户反馈修复）

日期：2026-09-20

## 1. 现象与根因

**现象**：在内容不足一屏的页面（如 /favorites、/offline、/settings），页脚「© 2026 DevKit · 鲁ICP备19015025号-2 …」会紧贴内容下方浮在屏幕中部，而不是停在视口底部。

**根因**：`.shell__content` 是纵向 flex 容器，内含 `<slot />` 与 `.shell__foot`（页脚）。`<slot />` 直接作为 flex 子项时按内容高度参与布局，没有 `flex: 1`，因此页脚紧随内容之后，剩余空白被留在容器外（下方）。

## 2. 修复

`devkit/app/layouts/default.vue`：

- `<slot />` 外层包一层 `.shell__content-inner { flex: 1; min-width: 0 }`，由它吃掉剩余空间，页脚自然被推到视口底部；内容超过一屏时正常随滚动下移。
- `.shell__content` 补 `display: flex; flex-direction: column`，底部内边距 48px → 24px（页脚与内容间距交由 flex 剩余空间承担）。
- 移动端断点内边距 40px → 24px，保持一致。

## 3. 验证

| 页面 | 页面高度 | 页脚底边距视口底部 |
| --- | --- | --- |
| /favorites | 900 | 876（24px） |
| /offline | 900 | 876 |
| /settings | 900 | 876 |
| /tools/json-format | 900 | 876 |
| /tools/http-status（长页） | 2910 | 随文档流，滚动到底可见 |
| /help（长页） | 1262 | 随文档流 |

- 59 条路由 × 1440×900 / 390×844 全量爬取：仅 3 条预期 404 路由有 404 控制台记录，0 页面错误、0 横向溢出。
- `npx nuxt typecheck`：0 错误。
- `npm run generate`：预渲染 115 条路由，PWA 预缓存 274 项（0 个 woff2，字体走 `devkit-fonts` 运行时 CacheFirst）。
