# DevKit 部署到腾讯云 COS（静态托管）· 操作手册

适用：`www.t502.fun`（备案号 鲁ICP备19015025号-2）、腾讯云轻量应用服务器 + 对象存储 COS。
本手册按「点哪个菜单、填什么值」写，照着做即可上线。

---

## 0. 先回答三个高频问题

### Q1：直接扔到 COS 就行了吗？

**是。** 本项目是纯静态站点（零后端、无环境变量、无数据库），`npm run generate` 的产物 `devkit/.output/public`（681 个文件 / 16 MB / 56 个路由的 index.html）丢进 COS 桶根目录就能跑。

但**只上传文件是不够的**，必须再配 4 件事，否则会出现「首页能开、工具页 404」「换域名打不开」：

| 必须配置 | 值 | 不配的后果 |
|---|---|---|
| 静态网站 · 索引文档 | `index.html` | 访问桶域名根路径 404 |
| 静态网站 · 错误文档 | `index.html` | 直接访问未知路径 / 客户端跳转刷新时 404 |
| 静态网站 · 错误文档响应码 | **200** | 深链虽然能渲染，但浏览器/爬虫收到 404 |
| 自定义源站域名 | `www.t502.fun` | 只能用 `xxx.cos.ap-shanghai.myqcloud.com` 这种默认域名，且不能用 HTTPS 自定义域名 |

### Q2：备案会失效吗？

**不会自动失效，但别退掉那台轻量服务器。**

- 腾讯云「备案云资源」只有 CVM / 轻量应用服务器 / Serverless / 负载均衡 / 云开发 / 云托管 —— **COS 不在清单里，不能作为备案接入资源**。
- 但 COS「开启自定义源站域名」会校验 *“请确保输入的域名已备案”* 且 *“接入检查的是网站备案的结果”* —— 也就是说 **COS 反而依赖你已有的备案**。
- 备案仍绑定「主体 + 域名 + 接入商 + 接入资源（轻量服务器）」；实际服务在 COS 属于「接入信息与实际不一致」，日常没人管，但核查/年报/举报时可能被要求整改。
- **红线**：轻量服务器**继续续费、不要退订/过期**（备案要求云资源剩余有效期 ≥ 1 个月，资源失效会「取消接入」→ 备案注销）；对外**只能用自己的已备案域名**，不要用 COS 默认域名做站。

### Q3：要花多少钱？

COS 按量计费：存储 ≈ 16 MB（几乎为 0）、请求费极低、**主要成本是外网下行流量**（约 0.5 元/GB 量级，各地域略有差异）。按每天 1000 次访问、单次 1 MB 估算，一个月几元到十几元。轻量服务器那边保持最低配续费即可，不再承担流量。

---

## 1. 本地生成静态产物

```bash
cd devkit
npm run generate          # 产物目录：devkit/.output/public
```

产物实测（2026-09-20）：

| 项 | 值 |
|---|---|
| 文件总数 / 体积 | 681 个 / 16 MB |
| 预渲染路由 | 115 条（含 `/sitemap.xml`） |
| 路由目录 index.html | 56 个（含 41 个工具页） |
| 根目录文件 | `index.html` `200.html` `404.html` `offline-fallback.html` `sw.js` `manifest.webmanifest` `robots.txt` `sitemap.xml` `pwa-*.png` |
| 字体 | `_nuxt/` 下 404 个 `.woff2`（按 unicode-range 分片，**不进 Service Worker 预缓存**，首屏按需加载后进 `devkit-fonts` 运行时缓存） |

> 产物已包含站点域名与 SEO：canonical / og:url 指向 `https://www.t502.fun`，`robots.txt` 声明 sitemap，`sitemap.xml` 含 56 条 URL。

---

## 2. 创建 COS 存储桶

控制台：**对象存储 COS → 存储桶列表 → 创建存储桶**

| 项 | 建议值 |
|---|---|
| 名称 | 全局唯一，带 APPID 后缀，如 `devkit-1250000000` |
| 地域 | `ap-shanghai`（华东）或离你和用户更近的地域；**绑定自定义域名后地域与备案归属无关** |
| 访问权限 | **公有读私有写**（静态站点最省事）；若只走 CDN/自定义域名也可选私有读写 |
| 版本控制 / 日志 | 关（省钱） |

创建后记下桶名，例：`devkit-1250000000`。

---

## 3. 上传产物

三选一，任选其一即可。

### 方式 A：图形工具 COSBrowser（最直观，推荐首次使用）

1. 下载安装 [COSBrowser](https://cloud.tencent.com/document/product/436/11366)，用腾讯云账号登录。
2. 进入桶 → **上传** → **上传文件夹** → 选 `devkit/.output/public` **里面的全部内容**。
   ⚠️ 注意：不要把 `public` 这一层文件夹本身传上去，桶根目录必须直接是 `index.html`、`_nuxt/`。

### 方式 B：命令行 coscli（适合以后每次发版）

```bash
# 安装（macOS）
brew install tencentcloud/tools/coscli
# 初始化：会依次问 secretId / secretKey / bucket（bucket 填 devkit-1250000000）
coscli config init
```

然后在本仓库根目录执行一键脚本（脚本会先 build 再同步，并设置缓存头）：

```bash
COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh
```

脚本行为：`_nuxt/` 同步为 `max-age=31536000, immutable`；其余文件（html、sw.js、manifest、robots、sitemap）`max-age=300`；两次同步都带 `--delete`，会自动删除远端旧文件，避免残留。

### 方式 C：控制台网页上传

**存储桶 → 文件列表 → 上传文件/文件夹**。大文件多时慢，且无法设置 Cache-Control，不推荐。

> 上传完成后自检：桶根目录应能看到 `index.html`、`_nuxt/`、`sw.js`、`sitemap.xml`；`tools/json-format/index.html` 等 56 个目录地址也应存在。

---

## 4. 开启静态网站（关键步骤）

控制台：**存储桶 → 基础配置 → 静态网站 → 编辑**

| 配置项 | 填 | 说明 |
|---|---|---|
| 静态网站状态 | 开启 | |
| 索引文档 | `index.html` | 访问目录时返回它 |
| 错误文档 | `index.html` | 未知路径回退到应用入口（应用里会渲染 404 页） |
| **错误文档响应码** | **200** | 官方推荐的 Vue History 路由方案；不设会返回 404 |

开启后会得到静态网站域名：`devkit-1250000000.cos-website.ap-shanghai.myqcloud.com`（绑定域名时要用）。

---

## 5. 绑定自定义域名 www.t502.fun

控制台：**存储桶 → 域名与传输管理 → 自定义源站域名 → 添加域名**

1. 域名填 `www.t502.fun`（**必须是已备案的网站域名**，COS 会校验；App 备案不行）。
2. 源站类型选 **静态网站源站**。
3. 勾选 **强制 HTTPS**，并上传/选择证书：
   - 没有证书：**SSL 证书控制台 → 申请免费证书**（DV，一年期），签发给 `www.t502.fun`，签发后回来选择它。
4. 保存后按提示去 DNS 添加解析。

### DNS 解析（在域名所在服务商处做）

| 记录类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | `www` | `devkit-1250000000.cos-website.ap-shanghai.myqcloud.com` |

- DNSPod / 腾讯云 DNS：**DNS 解析 DNSPod → 我的域名 → t502.fun → 添加记录**，按上表填。
- 其他服务商同理，本质就是加一条 CNAME。
- 解析生效一般 1–10 分钟；`dig www.t502.fun` 或 `curl -I https://www.t502.fun` 可验证。
- 想同时支持裸域 `t502.fun`，需要另加一条解析（CNAME 不能用于裸域，需 URL 转发或 A 记录，视服务商能力而定）。

---

## 6. 上线前验证清单

```bash
curl -I https://www.t502.fun/                     # 200, content-type: text/html
curl -I https://www.t502.fun/tools/base64         # 200（目录索引或错误文档回退）
curl -I https://www.t502.fun/settings             # 200
curl -I https://www.t502.fun/nope                 # 200（回退到应用内 404 页，而不是 COS 404）
curl -I https://www.t502.fun/sw.js                # 200, application/javascript, 无长缓存
curl -I https://www.t502.fun/sitemap.xml          # 200, application/xml
curl -I https://www.t502.fun/_nuxt/<任意 hash>.js # 200, immutable
```

浏览器里再过一遍：

- [ ] 首页、任意工具页、`/settings`、`/help` 正常
- [ ] 工具页**直接刷新**（不走前端路由）仍正常
- [ ] 随便输一个不存在的地址 → 应用内 404 页面（不是 COS 的 XML 错误页）
- [ ] 地址栏是 `https`，http 自动跳转
- [ ] 页脚显示 `鲁ICP备19015025号-2` 且链接到 `beian.miit.gov.cn`
- [ ] 手机 Chrome / Safari 打开「添加到主屏幕」可安装（PWA）
- [ ] 断网后已访问过的页面还能打开（Service Worker 离线）
- [ ] 字体、图标无 404（打开 DevTools Network 只看 4xx）
- [ ] 未配置公安联网备案的，如果以后再办，记得把公安备案号也加到页脚

---

## 7. 以后怎么发版

```bash
COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh
```

脚本会重新 `npm run generate` 并同步（含 `--delete`）。因为 `sw.js` 是 300 秒短缓存、`_nuxt/` 文件名带 hash 长缓存，发版后用户最多 5 分钟就会拿到新版本。

如果中间挂了 CDN，还需要**刷新 CDN 缓存**（CDN 控制台 → 缓存刷新 → 提交 `/` 与 `/index.html`，或全量刷新）。

---

## 8. 可选增强

- **CDN 加速**：自定义域名换成 CDN 域名，回源到 COS 静态网站源站。缓存规则同上（`_nuxt/*` 长缓存、html/sw.js 短缓存）。国内 CDN 同样要求域名已备案。
- **访问日志**：COS 桶 → 日志管理，可投递到另一个桶，便于看流量来源。
- **成本告警**：费用中心 → 预算与告警，设一个每月 20 元的阈值提醒，防止被刷流量。
- **自动化**：把 `COS_BUCKET` 与密钥放进 CI（GitHub Actions Secrets），push main 自动发布；密钥建议用最小权限的子账号（仅该桶的读写）。

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 首页 404 | 上传时多套了一层 `public/` 目录，或没配索引文档 | 文件列表根目录必须直接有 `index.html` |
| 工具页能开但刷新变 404 | 错误文档未配或响应码不是 200 | 按第 4 步改 |
| 页面样式全丢 | `_nuxt/` 没传全 | 重新整目录同步 |
| 换域名后打不开 | 域名未备案 / CNAME 未生效 / 证书没绑 | 检查解析与证书 |
| 发版后还是旧页面 | `index.html` 被长缓存 | 用脚本同步（300 秒短缓存）或刷新 CDN |
| 字体加载慢或闪烁 | 404 个 woff2 分片按需加载，首次访问才会缓存 | 正常现象；后续访问走 `devkit-fonts` 缓存 |
