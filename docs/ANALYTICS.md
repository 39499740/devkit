# DevKit 访问统计（站长统计）接入说明

结论：**能加**，PV / UV 与「每个页面」的明细都有现成方案。代码侧的接入通道已经写好并默认关闭，
你只需要注册一家统计服务、把 ID 填进构建环境变量、重新部署，就能在后台看到
「总 PV / 独立访客 / 各页面 PV / 入口页 / 停留时长 / 来源 / 设备」。

---

## 1. 代码里已经做了什么

| 位置 | 作用 |
|---|---|
| `devkit/app/plugins/analytics.client.ts` | 只在浏览器端注入第三方脚本；默认不配置就不加载；**只在本站域名下上报** |
| `devkit/app/utils/analytics-host.ts` | 域名白名单的解析与匹配（纯函数，有单测） |
| `devkit/nuxt.config.ts` | 构建开关：`DEVKIT_ANALYTICS`（provider）+ `DEVKIT_ANALYTICS_ID`（站点 ID）+ `DEVKIT_ANALYTICS_HOSTS`（域名白名单） |
| `devkit/app/composables/usePrefs.ts` | 访客偏好 `analytics`（默认开），写入 `devkit.prefs.v1` |
| `devkit/app/pages/settings.vue` | 「偏好设置 → 动效与记录 → 匿名访问统计」开关（未配置统计时不显示） |
| `devkit/app/pages/privacy.vue` | 「访问统计」小节：说明采集范围、可关闭路径 |

埋点行为（这几条是接入时的关键，第三方脚本默认做不到）：

- **单页路由切换补报 PV**：第三方脚本（百度/CNZZ）只统计首次进入的那一次，
  本站在 `router.afterEach` 里手动补报 `/tools/xxx` 这类客户端跳转，避免「PV 只有首页」。
- **只上报 path**：不带 query 与 hash，也不碰输入框内容、密钥、Token、文件。
- **只在白名单域名下上报**：`DEVKIT_ANALYTICS_HOSTS`（默认 `www.t502.fun,t502.fun`）。
  统计服务按埋点 ID 归属站点、**不看访问域名**，于是同一份 HTML 在别的域名下被渲染
  （COS 桶默认域名 `*.cos.<region>.myqcloud.com`、数据万象签名预览链接、镜像站）也会计进本站报表。
  2026-09-22 就出现过：报表里混进 17 条源站地址的 PV。现在这些域名下既不注入脚本也不上报。
- **不重复计数**：进入页面时由第三方脚本自动统计一次，插件记下该 path，路由变化时才补报。
- **尊重用户**：`DNT` / `GPC` 直接退出；开发环境（`npm run dev`）不上报；
  访客在设置里关掉后，不再加载脚本、已加载的也不再补报。

## 2. 接入三步（以百度统计为例）

1. **拿 ID**：到统计服务商注册并新增站点 `www.t502.fun`，复制站点 ID
   （百度统计：管理 → 网站列表 → 代码获取，形如一串数字，对应 `hm.js?<ID>`）。
2. **填配置**：本地复制 `devkit/.env.example` 为 `devkit/.env` 填好，或部署时直接带环境变量：

   ```bash
   COS_BUCKET=<你的桶> DEVKIT_ANALYTICS=baidu DEVKIT_ANALYTICS_ID=1234567 scripts/deploy-cos.sh
   ```

   注意这是**构建期**变量：改完必须重新 `npm run generate` + 重新上传，只改文件不改产物不会生效。
   同期变量 `DEVKIT_ANALYTICS_HOSTS` 控制「哪些域名下才上报」，默认 `www.t502.fun,t502.fun`；
   想临时用别的域名（例如 `dev.example.com`）预览统计效果时，把它加进去即可，留空表示不限制。
3. **看数据**：部署后打开站点 → 统计后台「实时访客」应能看到自己；再点几个工具页，
   等 10 分钟左右看「页面分析 → 页面访问量（PV）」是否逐页出现。

## 3. 可选方案对比

| 方案 | 页面明细 / PV | 接入成本 | 说明 |
|---|---|---|---|
| 百度统计（已适配 `baidu`） | 页面 PV/UV、入口页、停留时长、跳出率、来源、设备 | 注册 + 填 ID | 国内访问稳定，维度最全；需要百度账号 |
| CNZZ 站长统计（已适配 `cnzz`） | 页面 PV/UV、来路、地区 | 注册 + 填 ID | 老牌「站长统计」；脚本地址以控制台给的代码为准，若与本仓库不一致按第 5 节改 |
| 51LA / Umami / Cloudflare Web Analytics | 视服务而定 | 需要再加一个适配项 | 见第 5 节；Umami、CF 需自建或境外服务，国内访问与结算另算 |
| 不装脚本：COS 访问日志 | 每页 PV、来源、UA、状态码 | 开通日志投递（CLS）+ 查询 | 无客户端脚本、零隐私争议，但没有停留时长/屏幕等前端指标，日志有延迟 |

## 4. 已做的验收（沙箱内可离线复跑）

```bash
cd devkit
npm run typecheck
npm test                                       # 含 tests/analytics-host.test.mjs（域名白名单用例）
DEVKIT_ANALYTICS=baidu DEVKIT_ANALYTICS_ID=test-id npm run generate
```

验收口径：

- 静态产物 HTML 里**没有**统计 `<script>` 标签（脚本由客户端注入，保证关掉开关就不加载）；
- 用 Playwright 打开产物，断言首屏不发统计请求之外，跳转到 `/tools/xxx` 后
  `window._hmt` 里出现 `['_trackPageview', '/tools/xxx']`；
- 不带环境变量构建时，页面全程没有任何指向统计域名的请求；
- 域名白名单（单测覆盖）：`www.t502.fun` / 子域放行；`devkit-1252844153.cos.ap-beijing.myqcloud.com`、
  `t502.fun.evil.com`、`localhost` 一律拒绝；白名单留空 = 不限制。

## 5. 想换成别的统计服务

`devkit/app/plugins/analytics.client.ts` 里的 `ADAPTERS` 是张表，加一项即可（脚本地址 + 路由上报函数）：

```ts
la51: {
  src: (cfg) => `https://sdk.51.la/js-sdk-pro.min.js?id=${cfg.siteId}&ck=${cfg.siteId}`,
  trackPageview: (path) => { /* 按服务商文档调用它的上报 API */ }
}
```

## 6. 注意事项

- **隐私承诺**：本站卖点是「输入不出浏览器」。接入第三方统计后 `/privacy` 已把「访问统计」
  单独列出（采集什么、不采集什么、怎么关），同时把原「没有服务端记录」的表述改成
  「除匿名页面访问量外，服务端不记录任何工具输入」。若你决定不接第三方，本页会自动显示「未启用」。
- **数据偏低**：广告拦截插件、浏览器隐私模式会拦掉统计脚本，实际 PV 会低于服务器日志。
- **合规**：统计服务商一般要求实名，部分要求站点备案；各家注册政策可能已调整，
  我这边无法联网核实，注册前请以服务商官网最新说明为准。
- **服务端日志方案**：腾讯云 COS 支持把访问日志投递到日志服务 CLS，可查每页 PV / 来源 / UA，
  完全不依赖前端脚本。若你更看重隐私承诺，这条路线更稳妥（需要开通 CLS 并配置查询）。
