# 第四轮：移动端回归修复 + R02/R04 设计画板复核

日期：2026-09-20

## 1. 390 移动端横向溢出（真实缺陷，已修）

用 `audit/tools/crawl.py 390 844 light` 巡检 59 条路由，发现 **4 条溢出**（此前只测过 1440，属回归盲区）：

| 路由 | 原因 | 修复 |
|---|---|---|
| `/tools/does-not-exist`、`/category/nope`、`/nope` | 404 页 `.err__workspace`（flex 容器）内的 `.err__empty` 因固定 440px 的搜索框/分隔线把 min-content 顶到 480px，flex 未允许收缩 | `.err__workspace` 与 `.err__empty` 加 `min-width: 0`；`.err__search`、`.err__divider` 由 `width:440px; max-width:100%` 改为 `width:100%; max-width:440px`（`app/error.vue`） |
| `/tools/cron` | 选项行（时区/起始时间输入固定 210px）与两张结果表（`min-width` 超出）把页面撑到 411px | 选项行加 `flex-wrap: wrap`、输入加 `max-width:100%; min-width:0`；两张表包进 `.t20__scroll { overflow-x: auto }`（表格自身横向滚动），并把 `v-else` 改为 `v-if="!fireList.length"` 以配合新的包裹层（`app/components/tools/t20-cron.vue`） |

修复后复测：**59 路由 / 390px 全部无横向溢出、0 pageerror**；截图复核 T20 移动端（选项行换行、表格内滚动）与收藏页（表格自动收起「分类/收藏时间」列）均可读可用。1440 复测同样无溢出、0 pageerror。

## 2. R02 / R04 设计画板逐张复核

- **R02 移动端（7 张）**：`BCDR3` 首页、`NHpsS` 搜索弹层、`OsDZg` JSON 格式化、`ee1Ih` SM4 加解密、`l2SKJo` 图片压缩、`FguCb` 导航抽屉展开、`N316Hq` SM4 IV 错误 —— 逐张截图检查：布局无塌陷、无溢出、无文字截断。
- **R04 可访问性样板（2 张）**：`C8oVvR` 键盘聚焦与错误、`ubJHY` 提示与焦点回归 —— 均为规范说明板，内容完整。
- 索引 `c4K4r` 的 R02、R04「视觉」列由 △ 改为 ✓，并追加第四/五轮记录（`design.pen` 已落盘，节点数 39 741）。

至此设计交付索引中 R01–R04 四组适配稿的「视觉」列全部为 ✓。

## 3. 环境说明

- 回归过程中开发服务器（原 IPv6 `[::1]:3000` 进程）在多次 `nuxt build` 之后退出，已重启一个新的 dev server（devkit 目录、端口 3000），`http://localhost:3000` 恢复正常并完成上述全部复测。
- 生产构建产物（`.output`）已随本轮 `nuxt build` 更新。

## 4. 仍未做

- **全部交互的运行验证**：剪贴板权限拒绝、下载失败、大文件读取性能与取消、跨浏览器差异等，需要真实浏览器权限/多浏览器环境，属首轮即标注的存疑项。
- 开发模式 404 路由仍会出现 Nuxt dev 错误浮层（Nuxt 开发行为，生产构建无）。
- 首帧主题脚本与 `usePrefs` 属两处同源逻辑，后续新增偏好项需同步维护。
