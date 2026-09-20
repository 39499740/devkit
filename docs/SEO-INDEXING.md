# 让百度收录 DevKit（www.t502.fun）

站点现状：纯静态预渲染（Nuxt generate → 腾讯云 COS + CDN），HTTPS 正常，备案号 鲁ICP备19015025号-2，
百度统计已接入（客户端注入，不影响爬虫）。本手册按「点哪、填什么」写。

---

## 1. 收录的前提：本次已修好并上线的 5 个硬伤

| 项 | 之前 | 现在 |
|---|---|---|
| canonical | **56 个页面全指向首页**（等于告诉百度"所有页都规范到首页"，工具页会被丢弃） | 逐页生成，如 `https://www.t502.fun/tools/base64/` |
| meta description | 56 个页面完全相同（首页那段） | 逐页唯一：工具页由工具说明生成，分类页由分类说明生成 |
| 私有页 | 收藏 / 最近使用 / 设置都在 sitemap 里，内容却是空的 | 三个页面加 `noindex,follow`，并从 sitemap 移除 |
| sitemap | URL 不带尾斜杠（`/favorites`），访问时会 302 | 53 条，全部带尾斜杠，与真实 200 地址一致 |
| 404 | 已正确返回 404 状态码（不是 200 伪 404） | 保持 |

另外两条本来就 ok：全站预渲染 HTML（百度爬虫不执行 JS 也能读到正文）、移动端自适应。

> 校验方式（任何时候可复跑）：`curl -s https://www.t502.fun/tools/base64/ | grep canonical`

---

## 2. 百度搜索资源平台（ziyuan.baidu.com）操作步骤

### 2.1 添加并验证站点

1. 用百度账号登录 https://ziyuan.baidu.com → 用户中心 → **站点管理 → 添加网站**，填 `https://www.t502.fun`
   （裸域 `t502.fun` 目前 http/https 都不通，**只填 www**）
2. 选一种验证方式（前两种我都能代做，说一声即可）：
   - **文件验证**：平台下载 `baidu_verify_code-XXXX.html` → 放到 `devkit/public/` → 我重新部署
   - **HTML 标签验证**：把平台给的 `<meta>` 加到 `nuxt.config.ts` 的 `app.head.meta` → 我重新部署
   - **CNAME 验证**：在 DNSPod 加一条解析（会动 DNS，最麻烦）
3. 站点属性里把 **ICP 备案号 `鲁ICP备19015025号-2`** 填上（有备案对百度更友好）

### 2.2 提交链接（三种一起用，收录最快）

1. **sitemap**：站点管理 → 普通收录 → sitemap → 填 `https://www.t502.fun/sitemap.xml`
2. **API 主动推送**（推荐，每次发版跑一次）：
   - 普通收录 → API 提交 → 复制该站点的 token
   - ```bash
     BAIDU_PUSH_TOKEN=你的token node scripts/baidu-push.mjs
     ```
   - 脚本会把 sitemap 里的 53 条 URL 一次性推给百度（token 只从环境变量读，不会写进仓库）
3. **手动提交**：普通收录 → 手动提交，把首页和最想被人搜到的工具页贴进去（每天有配额，优先这几个：
   `/tools/json-format/`、`/tools/base64/`、`/tools/timestamp/`、`/tools/md5/`、`/tools/aes/`）

### 2.3 抓取诊断（判断百度看到了什么）

资源平台 → **抓取诊断** → 输入 URL → 看返回的 HTML：预渲染站点应能直接看到标题、正文与 canonical；
若报 robots 拦截 / 超时 / 403，再回头查 CDN 与 COS 静态网站配置。

### 2.4 看结果

- 收录量：百度搜索 `site:www.t502.fun`，或资源平台「索引量」报表
- 抓取频次 / 抓取异常：资源平台「抓取频次」「抓取异常」
- 时间预期：新站首次收录通常 **几天到几周**；sitemap + API 推送 + 外链能明显加快

---

## 3. 发版时的固定动作

```bash
COS_BUCKET=devkit-1252844153 scripts/deploy-cos.sh   # 构建 + 同步
node scripts/cdn-purge.mjs                            # 刷新 CDN（必须，见 DEPLOY-COS.md 第 7 节）
BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs      # 把 sitemap 推给百度
```

不刷 CDN 的后果：百度抓到的是旧 HTML（旧 canonical、旧描述），收录结果会滞后甚至错误。

---

## 4. 还能加分的（按性价比排序，需要时再做）

1. **工具页互相内链**：如 Base64 ↔ URL 编码 ↔ 摘要页互链，爬虫与用户都受益
2. **结构化数据**：给工具页加 `SoftwareApplication` / `FAQPage` 的 JSON-LD（百度对 FAQ 富媒体结果有展示位）
3. **外链**：GitHub 仓库 README、掘金/知乎/少数派发文带链接，是最快的收录催化剂
4. **内容页**：每个工具页补一段「什么时候用它 / 和相邻工具的区别」的说明文字，避免被判为薄页

---

## 5. 关键词策略：「在线」类长尾词怎么加才不挨罚

「在线 JSON 格式化」「在线 base64 编码」这类词确实是这类工具站的主要流量来源，所以每个页面标题都带上**一次**「在线」是正确做法。但关键词堆砌会被判低质，规则如下：

| 位置 | 做法 | 现在的实现 |
|---|---|---|
| title | 「在线 + 工具名 + 差异点」，全站模板一致，**「在线」只出现 1 次** | 工具页：`在线JSON 格式化 - 免登录 · DevKit`；分类页：`在线摘要与加密工具 - DevKit`；首页：`在线开发者工具箱 - JSON、编码、加密、时间戳 | DevKit` |
| meta description | 「在线」自然出现 1 次，随后是具体能力与差异点（本地处理、免注册、可离线） | 工具页描述由工具说明 + 统一后缀生成，逐页不同 |
| 页面可见文本 | 页头标记写「在线可用 · 输入不出浏览器」，与 title 呼应 | `ToolPageLayout` |
| H1 | **保持工具本名**（`JSON 格式化`），不要写成「在线JSON格式化工具在线使用」 | 未改 |
| `meta keywords` | **不要加**。百度早已声明该标签不参与排序，写了只会增加堆砌风险 | 未加 |
| sitemap / canonical | 不受关键词影响，保持「一页一 URL、带尾斜杠」 | 已做 |

判断标准：title 里「在线」≤1 次，description ≤1 次，页面正文自然出现即可；同一页面的 title 不要重复关键词（例如「在线JSON格式化在线工具免费在线用」）。

---

## 6. 已知坑

- **CDN 不跟随源站缓存**：发版后不刷缓存，百度抓到旧 HTML（本次已用 `scripts/cdn-purge.mjs` 处理）
- **百度统计「未检测到代码」**：统计脚本是客户端注入，百度爬虫看不到 hm.js，属官方认可的"正常现象"，与收录无关
- **裸域不可用**：所有 canonical / sitemap / 平台提交统一用 `https://www.t502.fun`，不要混用 t502.fun
- **sitemap 里的 URL 必须与真实 200 地址一致**（带尾斜杠），否则百度对重定向 URL 的处理会打折扣
