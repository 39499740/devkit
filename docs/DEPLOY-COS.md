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
| 静态网站 · 错误文档 | `404.html`（**不要填 index.html**） | 未知路径会显示首页内容而不是应用的 404 页 |
| 静态网站 · 错误文档响应码 | `404`（默认，推荐）或 `200` | 只影响未知路径的状态码；真实路由都是实体文件，不受影响 |
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
| 文件总数 / 体积 | 717 个 / 18 MB |
| 预渲染路由 | 132 条（含 `/sitemap.xml`、`/sitemap.txt`） |
| 路由目录 index.html | 64 个（含 45 个工具页） |
| 根目录文件 | `index.html` `200.html` `404.html` `offline-fallback.html` `sw.js` `manifest.webmanifest` `robots.txt` `sitemap.xml` `sitemap.txt` `pwa-*.png` |
| 字体 | `_nuxt/` 下 404 个 `.woff2`（按 unicode-range 分片，**不进 Service Worker 预缓存**，首屏按需加载后进 `devkit-fonts` 运行时缓存） |

> 产物已包含站点域名与 SEO：canonical / og:url 指向 `https://www.t502.fun`，`robots.txt` 声明 sitemap，`sitemap.xml` 含 58 条 URL（另有内容等价的纯文本 `sitemap.txt`，给百度读取失败时兜底）。

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

**安装**（本机 brew 装不了：`/opt/homebrew/Cellar is not writable`，且沙箱不允许写 `/opt/homebrew`，所以直接用官方二进制）：

```bash
cd <仓库根>
mkdir -p .tools && cd .tools
curl -sSL -o coscli https://github.com/tencentyun/coscli/releases/download/v1.0.9/coscli-v1.0.9-darwin-arm64
chmod +x coscli && ./coscli --version        # coscli version v1.0.9
```

> `.tools/` 已在 `.gitignore` 中，不会进版本库。本机已按上面做法装好（sha256 = `cf99d454…c263`，与官方 `sha256sum.log` 一致）。
> Intel Mac 把文件名换成 `coscli-v1.0.9-darwin-amd64`。

**配置密钥**（只需做一次，密钥只写进本机配置文件，不要提交到仓库）：

```bash
# 默认写到 ~/.cos.yaml，交互式依次填 secretId / secretKey / bucket
.tools/coscli config init
```

仓库内已经放好一份模板 `.tools/cos.yaml`（被 gitignore，不会进版本库），打开把两处占位符换掉即可：

```yaml
cos:
  base:
    secretid: REPLACE_WITH_YOUR_SECRET_ID     # ← 换成你的 SecretId
    secretkey: REPLACE_WITH_YOUR_SECRET_KEY   # ← 换成你的 SecretKey
    sessiontoken: ""
    protocol: https
  buckets:
    - name: devkit-0000000000                 # ← 换成真实桶名（含 APPID 后缀）
      alias: devkit
      region: ap-shanghai                     # ← 与建桶地域一致
```

脚本与 coscli 的配置查找顺序：`$COS_CONFIG` → 仓库内 `.tools/cos.yaml` → `~/.cos.yaml`；所以放好模板后不用额外设环境变量也行。密钥建议用只授权该桶读写的**子账号**密钥，并确保 `.tools/` 不进版本库。

**发布**（脚本会先 build 再同步，并设置缓存头）：

```bash
COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh
# 已经构建过、只想同步：SKIP_BUILD=1 COS_BUCKET=... scripts/deploy-cos.sh
```

脚本行为：

- 自动查找 coscli：`$COSCLI` → 仓库内 `.tools/coscli` → PATH；配置：`$COS_CONFIG` → 仓库内 `.tools/cos.yaml` → `~/.cos.yaml`；都缺失时打印可照抄的下一步命令并以退出码 1 结束。
- 同步失败会打印三行排查提示（密钥是否替换、桶名/地域是否正确、密钥是否有读写权限），不会甩一句原始报错。
- `_nuxt/`（文件名带 hash）→ `Cache-Control: public, max-age=31536000, immutable`；其余入口文件（html、sw.js、manifest、robots、sitemap）→ `max-age=300`。
- 两次 `sync` 都带 `-r --delete --force`：递归、删除远端多余文件（避免旧版本残留）、不交互确认。
- 注意 coscli 用 `--meta "Cache-Control:…"` 设置缓存头，**没有** `--cache-control` 这个参数（早先脚本里的写法是错的，已修正）。

### 方式 C：控制台网页上传

**存储桶 → 文件列表 → 上传文件/文件夹**。大文件多时慢，且无法设置 Cache-Control，不推荐。

> 上传完成后自检：桶根目录应能看到 `index.html`、`_nuxt/`、`sw.js`、`sitemap.xml`、`sitemap.txt`；`tools/json-format/index.html` 等 64 个目录地址也应存在。
> 一键核对（状态码 / Content-Type / XML 结构 / 与本地产物一致）：`node scripts/check-indexing-files.mjs`

---

## 4. 开启静态网站（关键步骤）

控制台：**存储桶 → 基础配置 → 静态网站 → 编辑**；等价地，也可以不登录控制台，直接跑仓库里的脚本（见下）。

| 配置项 | 填 | 说明 |
|---|---|---|
| 静态网站状态 | 开启 | |
| 索引文档 | `index.html` | 访问根路径或目录时返回它 |
| 错误文档 | **`404.html`** | 未知路径回退到「SPA 外壳」，由前端渲染应用自己的 404 页 |
| 错误文档响应码 | `404`（默认）或 `200` | 实测默认即 404；未知路径本就该 404，语义更对。想与腾讯云对纯 SPA 的建议一致就选 200 |

> ⚠️ **错误文档不要填 `index.html`**：`index.html` 是预渲染好的首页，用它兜底时访问 `/不存在的路径` 会原样显示首页（实测 `h1 = 全部工具`）；填 `404.html`（Nuxt 生成的纯 SPA 外壳，体积 ~9.5 KB）才会渲染出「工具不存在或链接已失效」。

**用脚本配置（等价于上面三项，无需控制台）**：

```bash
python3 scripts/cos-set-website.py                 # 索引 index.html + 错误文档 404.html
python3 scripts/cos-set-website.py --error 200.html
```

脚本按 COS 签名算法 v5 调 `PUT Bucket website`，密钥从 `.tools/cos.yaml`（或 `~/.cos.yaml`）读取、不会打印，执行后还会 GET 回读一次确认。

配置完成会得到静态网站域名：`devkit-1250000000.cos-website.ap-shanghai.myqcloud.com`（本机实际桶：`devkit-1252844153`，地域 `ap-beijing`）。

> ⚠️ **默认域名不能当站点用**：腾讯云自 2024-01 起对 COS 默认域名（`*.cos.<region>.myqcloud.com` 与 `*.cos-website.<region>.myqcloud.com`）访问 HTML 等文件强制下载 —— 实测响应头带 `Content-Disposition: attachment` 与 `x-cos-force-download: true`，浏览器会直接下载页面而不是渲染（Playwright 实测报 `Download is starting`）。**必须绑定自定义域名**（第 5 节）才能正常浏览；HTTPS 自定义域名同样是 Service Worker / PWA 的前置条件（非安全源不注册 SW）。

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
curl -I https://www.t502.fun/                     # 200, text/html
curl -I https://www.t502.fun/tools/base64         # 302 → /tools/base64/（COS 目录重定向，浏览器自动跟随）
curl -I https://www.t502.fun/tools/base64/        # 200, text/html
curl -I https://www.t502.fun/nope                 # 404 + 404.html 外壳，前端渲染应用内 404 页
curl -I https://www.t502.fun/sw.js                # 200, application/javascript, max-age=300
curl -I https://www.t502.fun/sitemap.xml          # 200, application/xml
curl -I https://www.t502.fun/_nuxt/<hash>.js      # 200, immutable
curl -I -H "Accept: text/html" https://www.t502.fun/   # 响应头里不应再出现 Content-Disposition: attachment
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
COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh          # 构建 + 同步
SKIP_BUILD=1 COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh   # 只同步已有产物
```

脚本会重新 `npm run generate` 并同步（含 `-r --delete --force`），**并在最后自动刷新 CDN 缓存**（`PURGE=0` 可跳过）。
缓存策略：`_nuxt/` 文件名带 hash → 1 年 `immutable`；入口文件（html / sw.js / manifest / robots / sitemap）→ 1 小时。
HTML 从 300 秒提到 1 小时是为了少回源（回源流量也计费），代价是发版必须刷新缓存，所以第 3 步默认自动执行。

如果中间挂了 CDN，也可以手动刷新：CDN 控制台 → 缓存刷新 → 提交 `/`（目录刷新）与 `/_nuxt/`，或全量刷新。

> **实测告警（2026-09-20）**：本站在 CDN 后面的 HTML 并不跟随源站的 `max-age=300`——发版后实测根路径仍返回 `x-cache-lookup: Cache Hit`、`age=6518` 的旧 `index.html`，而 `_nuxt/` 已被 `--delete` 同步删掉旧分片，旧 HTML 会引用到不存在的资源。**每次发版后必须刷新缓存**，或把 CDN 规则里的 HTML 缓存改成「遵循源站」。
>
> 用项目自带的密钥就能调 CDN 刷新接口（该密钥也具备 CDN 权限，实测可用）：
>
> ```bash
> node scripts/cdn-purge.mjs                                  # 默认刷新 / 与 /_nuxt/（delete 模式）
> FLUSH_TYPE=flush node scripts/cdn-purge.mjs https://www.t502.fun/   # 只改了内容时
> ```
>
> 脚本走 `cdn.tencentcloudapi.com` 的 `PurgePathCache`（TC3-HMAC-SHA256 签名），密钥读 `.tools/cos.yaml`；
> `delete` 适合旧文件已被删除（`--delete` 同步后），只改内容用 `flush`；目录路径必须以 `/` 结尾。

---

## 8. 可选增强

- **CDN 加速**：自定义域名换成 CDN 域名，回源到 COS 静态网站源站。缓存规则同上（`_nuxt/*` 长缓存、html/sw.js 1 小时）。
- **访问日志**：COS 桶 → 日志管理，可投递到另一个桶，便于看流量来源（当前未开启，`GET ?logging` 为空）。
- **成本告警**：先跑 `node scripts/cos-usage-report.mjs --days 7`，把「直连源站」的量级摸清，再按第 10 节把直连掐掉；
  费用中心 → 预算与告警可另设每月阈值提醒，防止被刷流量。
- **自动化**：把 `COS_BUCKET` 与密钥放进 CI（GitHub Actions Secrets），push main 自动发布；密钥建议用最小权限的子账号（仅该桶的读写）。

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 首页 404 | 上传时多套了一层 `public/` 目录，或没配索引文档 | 文件列表根目录必须直接有 `index.html` |
| 工具页能开但刷新变 404 | 错误文档未配或响应码不是 200 | 按第 4 步改 |
| 页面样式全丢 | `_nuxt/` 没传全 | 重新整目录同步 |
| 换域名后打不开 | 域名未备案 / CNAME 未生效 / 证书没绑 | 检查解析与证书 |
| 发版后还是旧页面 | `index.html` 现在缓存 1 小时 | `scripts/deploy-cos.sh` 已自动刷新 CDN；手动补刷用 `node scripts/cdn-purge.mjs` |
| 账单里出现「COS 外网下行流量」 | 有人绕过 CDN 直连源站域名 | `node scripts/cos-usage-report.mjs --days 7` 确认，按第 10 节收紧读权限 |
| 统计报表里混进源站域名的 PV | 埋点按站点 ID 归属、与访问域名无关 | 已用 `DEVKIT_ANALYTICS_HOSTS` 限制在 `www.t502.fun`，见 docs/ANALYTICS.md |
| 字体加载慢或闪烁 | 404 个 woff2 分片按需加载，首次访问才会缓存 | 正常现象；后续访问走 `devkit-fonts` 缓存 |

---

## 10. 源站域名防直连（省 COS 外网下行流量）

**问题**：桶是**公有读**（`python3 scripts/cos-set-acl.py --check` 会打印 `AllUsers READ`），
任何人都能直接访问 `devkit-1252844153.cos.ap-beijing.myqcloud.com/...` 绕过 CDN 下载。
腾讯云口径里，这种「直接用浏览器通过 COS 域名访问资源」的流量走 **COS 外网下行流量** 计费项，
单价高于 CDN 流量，而且完全不受 CDN 缓存与防盗链约束。

**2026-09-22 实测**（`node scripts/cos-usage-report.mjs --days 7 --hourly`）：

| 日期 | 直连下载 | COS 请求 | CDN 回源请求 | 直连占比 | CDN 命中率 |
|---|---|---|---|---|---|
| 2026-09-20 | 185 MB | 12,137 | 189 | 98.4% | 57.0% |
| 2026-09-21 | 110 MB | 20,734 | 3,579 | 82.7% | 48.2% |

**判据**：`COS 收到的请求数 ≫ CDN 回源请求数` ⇒ 多出来的就是绕过 CDN 的直连请求；
逐小时曲线的峰点与百度统计里的机器访问时刻一致（01/02/03/05/06/07 点）。

**每天自动体检**：`scripts/cos-usage-daily.sh` + `scripts/launchd/com.dsh.cos-usage.plist`（每天 09:30），
超阈值时退出码 1、日志落在 `.tools/logs/cos-usage-<日期>.log`。

```bash
cp scripts/launchd/com.dsh.cos-usage.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dsh.cos-usage.plist
```

**治本步骤（顺序不能反；2026-09-22 已在本桶执行完毕）**：

1. **先在 CDN 侧开「私有存储桶访问」**（腾讯云**不叫「回源鉴权」**，按这个词是搜不到的）：
   `CDN 控制台 → 域名管理 → www.t502.fun → 管理 → 基础配置 → 源站信息 → 主源站 → 编辑`
   → 勾选 **私有存储桶访问** → 点旁边的 **「添加授权服务」** → 弹窗里勾「我同意以上授权」→ 确定 → 保存。
   该弹窗会把一次**只读**授权写进**桶策略（Bucket Policy）**：

   ```json
   {"Effect":"Allow",
    "Principal":{"qcs":["qcs::cam::uin/<主账号UIN>:service/cdn"]},
    "Action":["name/cos:GetObject","name/cos:HeadObject","name/cos:OptionsObject"],
    "Resource":["qcs::cos:ap-beijing:uid/1252844153:devkit-1252844153/*"]}
   ```

   保存后用 API 复核：`Origin.CosPrivateAccess` 应为 `on`，域名状态先 `processing`、约 3 分钟后回到 `online`。
2. **等状态回到 `online` 再动权限**：`processing` 期间切私有读，回源可能被拒。
3. **验证站点仍正常**：`python3 scripts/cos-set-acl.py --verify`（CDN 首页应 200），
   再在浏览器打开首页与任意工具页确认。
4. **把桶切成私有读**：`python3 scripts/cos-set-acl.py --private --yes`
5. **复验（三条都要过）**：
   - 源站匿名访问应 **403**：`curl -o /dev/null -w '%{http_code}' https://devkit-1252844153.cos.ap-beijing.myqcloud.com/index.html`
   - CDN 首页 200，且**冷路径**（随便造一个 `/__authcheck-<随机数>`）应 404 —— 返回 403/5xx 说明回源被拒；
   - 强刷一个文件逼回源：`node scripts/cdn-purge.mjs https://www.t502.fun/sw.js`，等 20 秒取该文件应 200。
6. **回滚**：`python3 scripts/cos-set-acl.py --public-read --yes`（瞬时恢复，站点即刻可用）。

> ⚠️ **两个实测坑（2026-09-22）**：
> ① COS v5 签名的 `PUT /?acl` **只能签 `host`** —— 把 `x-cos-acl` 也放进 `q-header-list` 会被判
> `SignatureDoesNotMatch`（`scripts/cos-set-acl.py` 的 `put_acl` 已按此修正）。
> ② 切私有读后源站**不是立刻**变 403，有几秒传播延迟，别据此判定失败。
>
> ⚠️ **同样挂了 CDN 的裸域 `t502.fun`**：它的 `CosPrivateAccess` **仍是 off**。该域当前没有 DNS 记录、
> 不承载访问，所以暂无影响；**但以后一旦给它加解析，回源会因私有读被拒（403）** —— 要么同样开一次
> 「私有存储桶访问」，要么删掉这个 CDN 域名。
>
> 切私有读后，COS 控制台的「预览/复制链接」、`coscli cp` 下载、数据万象预览都需要签名 ——
> 这是预期的，那些正是直连流量的来源。
