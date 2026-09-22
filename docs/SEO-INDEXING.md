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
| sitemap | URL 不带尾斜杠（`/favorites`），访问时会 302 | **58 条**（5 固定页 + 8 分类页 + 45 工具页），全部带尾斜杠，与真实 200 地址一致；另有纯文本 `sitemap.txt` 同集合兜底 |
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
   - 脚本会把 sitemap 里的 58 条 URL 一次性推给百度（token 只从环境变量读，不会写进仓库）
   - **API 推送不依赖百度读取 sitemap**：即使资源平台的 sitemap 报错，这条路也能把 URL 送进百度队列，优先用它
3. **手动提交**：普通收录 → 手动提交，把首页和最想被人搜到的工具页贴进去（每天有配额，优先这几个：
   `/tools/json-format/`、`/tools/base64/`、`/tools/timestamp/`、`/tools/md5/`、`/tools/aes/`）

### 2.3 抓取诊断（判断百度看到了什么）

资源平台 → **抓取诊断** → 输入 URL → 看返回的 HTML：预渲染站点应能直接看到标题、正文与 canonical；
若报 robots 拦截 / 超时 / 403，再回头查 CDN 与 COS 静态网站配置。

### 2.4 看结果

- 收录量：百度搜索 `site:www.t502.fun`，或资源平台「索引量」报表
- 抓取频次 / 抓取异常：资源平台「抓取频次」「抓取异常」
- 时间预期：新站首次收录通常 **几天到几周**；sitemap + API 推送 + 外链能明显加快

### 2.5 资源平台报「无法读取此站点地图」（已发现网页 0）怎么排查

**服务端先自证清白**（本仓库现场实测结论，2026-09-21）：

| 检查项 | 实测结果 |
|---|---|
| `https://www.t502.fun/sitemap.xml` | 200 / `application/xml` / 8503 字节 |
| 响应体 | 与本地 `devkit/.output/public/sitemap.xml` **sha256 完全一致**（`9121e4f2…`），gzip 路径解压后同样一致 |
| XML | 结构闭合，58 条 `<loc>`，全部 `https://www.t502.fun` 前缀、带尾斜杠、均 < 256 字节 |
| 各 CDN 节点 | 3 个 IPv4 节点 + IPv6 直连均 200、字节数一致 |
| robots.txt | `Allow: /`，无 `Disallow: /` |
| CDN 侧限制 | 防盗链 / UA 黑白名单 / IP 黑白名单 / IP 限频 **全部 off**，IPv6 与 gzip(xml) 已开 |

结论：**不是服务器或 CDN 拦截**，问题在百度读取环节。按下面顺序做：

1. **当场拿证据**：资源平台 → 抓取诊断 → 抓 `https://www.t502.fun/sitemap.xml`，看百度实际拿到的**状态码与内容**。
   - 拿到 404/403/超时 → 是抓取链路问题，把截图发我，我按 CDN / COS 侧排查
   - 拿到 200 且是完整 XML → 是百度解析或站点归属问题，继续第 2 步
2. **删除后重新提交**：站点管理 → 普通收录 → sitemap → 删掉这条记录，再重新提交一次（触发重读，能清掉首次读取时可能命中的历史缓存响应）。
3. **换纯文本格式兜底**：把提交地址改成 `https://www.t502.fun/sitemap.txt`（每行一个 URL，无 XML 解析环节，百度官方支持文本格式）。
   两个地址内容等价，都已在 `robots.txt` 里声明。
4. **确认站点归属**：站点管理里该站点状态必须是**已验证（拥有者）**；百度官方 FAQ 对 sitemap 读取失败只给两条原因——① 提交的 sitemap 不属于已提交的站点；② sitemap 格式错误。
5. **不要用索引型 sitemap**：百度「普通收录」「死链提交」自 2020 年起不再支持 `sitemapindex` 索引文件，只认单层 `<urlset>`（本站是单层，无需改动）。
6. **同时用 API 推送兜住**（见 2.2 第 2 条）：收录不必等 sitemap 修好。

> 可复跑自检（无需密钥，任一时刻可执行，退出码非 0 即有问题）：
> ```bash
> node scripts/check-indexing-files.mjs                  # 检查 https://www.t502.fun
> node scripts/check-indexing-files.mjs https://预览域名  # 换站点
> ```

---

## 3. 发版时的固定动作

```bash
COS_BUCKET=devkit-1252844153 scripts/deploy-cos.sh   # 构建 + 同步
node scripts/cdn-purge.mjs                            # 刷新 CDN（必须，见 DEPLOY-COS.md 第 7 节）
node scripts/check-indexing-files.mjs                 # 核对线上 robots/sitemap.xml/sitemap.txt/favicon 与本地一致
BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs      # 把 sitemap 推给百度
node scripts/indexnow-push.mjs                        # 把 sitemap 推给 Bing / Yandex / Seznam / Naver（见第 8 节）
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
- **资源平台 sitemap 报「无法读取此站点地图」**：先跑 `node scripts/check-indexing-files.mjs` 证明服务端无问题，再按 2.5 节用「抓取诊断」取证 + 换 `sitemap.txt`
- **GSC 报「DNS 错误」**：`t502.fun` 裸域在 DNSPod **没有任何 A/AAAA/CNAME 记录**（DoH 复核为 NODATA，只有 SOA），Googlebot 因此解析不到；不要在 Search Console 里为裸域另建资源，只提交 `https://www.t502.fun`。**判断 DNS 是否真有问题必须走 DoH**（`https://dns.google/resolve?name=…&type=A`）——本机 `dig` 会被代理 fake-ip 劫持到 `198.18.x.x`，据此 `curl` 得到的 SSL 报错是假象，不是裸域真的配了服务
- **favicon 不能只留 PNG**：浏览器与部分爬虫会默认探测 `/favicon.ico`，缺失就是白拿一条 404。现由 `devkit/public/favicon.ico`（48/32/16 三尺寸 ICO）+ 首页 `rel="icon"` 声明提供，`scripts/check-indexing-files.mjs` 第 5 项会守住它
- **IndexNow key 文件不能删**：`devkit/public/<key>.txt` 是 Bing / Yandex / Seznam / Naver 校验站点归属的凭据（文件名即 key、内容也是 key）。删掉或改内容，`scripts/indexnow-push.mjs` 会在自检阶段直接报 403 并退出

---

## 7. Google 侧（Search Console）

Google 不读百度资源平台的任何设置，需要单独做一次，步骤如下（含需要人工完成的边界）：

1. **验证站点**：https://search.google.com/search-console → 添加资源 → 选**网址前缀** → 填 `https://www.t502.fun`
   - **HTML 标记**：把 Google 给的 `<meta name="google-site-verification" content="…">` 发我，我按 `DEVKIT_GSC_VERIFY` 环境变量的方式加到 `nuxt.config.ts` 并部署（与百度统计同一套「环境变量开关」做法）
   - **DNS (TXT)**：在 DNSPod 加一条 TXT 记录（需你操作）
   - **Google Analytics / Tag Manager**：若已有可直接验证
2. **提交 sitemap**：Search Console → Sitemap → 填 `sitemap.xml`（Google 也接受 `sitemap.txt`，但优先 XML）
3. **看结果**：Search Console → 索引 → 网页；「已发现」「已编入索引」分开看，首次通常 3 天到 2 周
4. **和百度不冲突**：canonical、robots、sitemap 三者对两家搜索引擎是同一套标准，无需为 Google 改任何页面

> 说明：登录 Google 账号、收验证码属于实名/账号操作，需你本人完成；验证串（meta / TXT 值）拿到后发我，代码与部署侧我来做。

### 7.1 Sitemap 报「无法抓取」怎么排查（2026-09-21 现场结论）

先在 Googlebot UA 下自证服务端无罪：

| 检查项 | 实测结果 |
|---|---|
| `https://www.t502.fun/sitemap.xml` | 200 / `application/xml` / 8503 字节 / HTTP/2 |
| `https://www.t502.fun/sitemap.txt` | 200 / `text/plain` / 2129 字节 |
| 压缩与协议 | `Accept-Encoding: gzip` 正常（600 字节），`br` 询问回落 gzip，无异常 |
| TLS | TLSv1.3 + 完整证书链（TrustAsia DV → Certum，`Verify return code: 0`），SAN 含 `www.t502.fun` 与 `t502.fun` |
| robots.txt | `Allow: /`，git 历史里从未出现过 `Disallow: /`，且声明了两个 sitemap |
| 境外可达性 | 第三方境外节点（r.jina.ai）能完整取回 XML 内容 |

结论：**文件本身没有问题**，「无法抓取」出在 Google 的读取环节。按下面顺序处理：

1. **在 GSC 里当场做 Google 侧实测**：Search Console →「网址检查」→ 输入 `https://www.t502.fun/sitemap.xml` → **测试实际网址**。这是 Google 自己发起的抓取，是唯一权威判据：
   - 显示「已成功抓取」→ 是 sitemap 记录里的陈旧失败状态，走第 2 步重提即可
   - 显示超时 / 无法连接 → 才是跨境链路问题，此时开 CDN「全球加速」才有意义（Google 的抓取器在境外）
2. **删除后重新提交**：Sitemap → 删掉 `sitemap.xml`、`sitemap.txt` 两条记录 → 重新提交 `sitemap.xml`。GSC 的失败状态不会自动回填，必须触发一次新读取。
3. **确认提交归属**：sitemap 要提交在已验证的 `https://www.t502.fun`（网址前缀）或网域资源下，且与 `robots.txt` 中声明的地址一致。
4. **不要空等**：收录不依赖 sitemap —— 抓取统计里页面已有 77% 的 200。

---

## 8. IndexNow（Bing / Yandex / Seznam / Naver，不需要账号）

百度与 Google 之外的引擎里，Bing、Yandex、Seznam、Naver 都参与 **IndexNow** 协议：站点放一个校验 key 文件，POST 一次 URL 列表即可，双方都不需要注册账号。这是免账号通道里见效最快的一条。

### 8.1 一次性准备（已由仓库完成）

| 项 | 值 |
|---|---|
| key 文件 | `devkit/public/b4fd0b63a852e6bbe42a73720f6174c0.txt`（**文件名 = key，内容 = key**） |
| 线上地址 | `https://www.t502.fun/b4fd0b63a852e6bbe42a73720f6174c0.txt` |
| 推送脚本 | `scripts/indexnow-push.mjs`（读 sitemap → 自检 key → 分批提交，可复跑） |

> key 文件必须留在 `devkit/public/` 并随每次发版同步；`.txt` 不在 PWA 预缓存 glob（`js/css/html/png/svg/ico/webmanifest`）里，所以新增它不会改变 `sw.js`。

### 8.2 每次发版后跑一次

```bash
node scripts/indexnow-push.mjs            # 推送线上 sitemap.xml 的全部 URL
node scripts/indexnow-push.mjs --dry-run  # 先看要提交什么，不发请求
```

状态码对照：`200` 全部接受 / `202` 已接受（key 校验待完成）都算成功；`400` 格式错；`403` key 校验失败（key 文件访问不到或内容不符）；`422` URL 不属于该 host；`429` 提交过于频繁。

> 协议要求**同一 URL 每天不要重复提交**，发版后跑一次即可，别放进高频定时任务。排障时可用 `INDEXNOW_ENDPOINT=https://www.bing.com/indexnow` 只打 Bing。

### 8.3 怎么确认这些引擎收没收录

`site:` 在 Bing 上经常被忽略并回退到无关结果（2026-09-22 实测 `site:www.t502.fun` 返回的是美股新闻），别只看 site:。用「站点独有文案 + 引号」配合 RSS 通道更可靠：

```bash
curl -s "https://cn.bing.com/search?q=%22在线开发者工具箱%22&format=rss" | grep -o '<title>[^<]*</title>'
# 出现自己的标题才算收录；出现无关结果即未收录
```

360 是唯一直接给收录数的引擎：打开 `https://www.so.com/s?q=site%3Awww.t502.fun`，结果页头部的站点信息卡会写「该网站约 N 个网页被360搜索收录」。
