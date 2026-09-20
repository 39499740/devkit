# DevKit 修复报告 · 子代理 F3（Web/接口/文件工具与离线页）

范围（仅修改以下文件）：
- `devkit/app/components/tools/t34-url-params.vue`
- `devkit/app/components/tools/t35-curl-convert.vue`
- `devkit/app/components/tools/t36-http-status.vue`
- `devkit/app/components/tools/t38-image-compress.vue`
- `devkit/app/pages/offline.vue`

依据：`audit/reports/r4-tools-t27-t41.md`（D1/D6/D9/D10）、`audit/reports/r1-system-pages.md`（F2）、`audit/reports/r6-code-quality.md`（3.7）。
验证环境：`http://localhost:3000`（开发服务器 HMR），Node v24.11.1，Playwright 1.56.1。
自测脚本：`/tmp/f3-e2e.mjs`（真实页面驱动），生成代码用 `node --check` 语法校验。

---

## 1【T35｜高】生成的 fetch/Axios 代码语法错误（header/params 键含 `-` 未加引号）

### 问题
`SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/`（原 `t35-curl-convert.vue:229`）把连字符视为安全标识符，生成 `Content-Type: ...` 这类非法 JS，`node --check` 报 `SyntaxError: Unexpected token '-'`。三处调用点：`genFetch` headers、`genAxios` headers、`genAxios` params。

### 改动
`devkit/app/components/tools/t35-curl-convert.vue:229`：按合法 JS 标识符规则改为
```ts
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
```
`$` 属合法标识符字符，补入；连字符、数字开头等一律走 `jsQuote` 加引号。三处调用点（`:602` fetch headers、`:635` axios headers、`:640` axios params）共用该常量，无需分别改动。

### 验证
命令：`node /tmp/f3-e2e.mjs`（Playwright 打开 `/tools/curl-convert`，载入示例/切换目标格式/点击转换后读出右侧编辑器文本，再 `node --check`）。

目标 fetch（curl 示例 → fetch）：
```js
fetch('https://api.example.com/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
  },
  body: JSON.stringify({"name":"devkit","role":"admin"})
})
```
```
node --check /tmp/f3-fetch.js => OK (exit 0)
```

目标 Axios（curl 示例 → axios）：
```js
axios({
  url: 'https://api.example.com/users',
  method: 'post',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
  },
  data: { "name": "devkit", "role": "admin" }
})
```
```
node --check /tmp/f3-axios.js => OK (exit 0)
```

axios params 键含连字符（source=axios, target=axios）：
```js
axios({
  url: 'https://api.example.com/list?user-id=7&X-Trace-Id=abc',
  method: 'get',
  params: {
    'user-id': '7',
    'X-Trace-Id': 'abc',
  },
})
```
```
node --check /tmp/f3-axios-params.js => OK (exit 0)
```
合法标识符 `Authorization` 仍不加引号（输出美观且合法）。三处调用点全部覆盖。

---

## 2【T34｜中】无效 URL 时旧解析结果仍显示（陈旧数据）

### 问题
`parse()` 的 `catch` 只调用 `run.markFail`，未清空 `base`/`rows`；模板 `v-if="base"` 继续渲染上一次的有效结构（`r4` D6）。

### 改动
`devkit/app/components/tools/t34-url-params.vue:71-72`：`catch` 内先清空状态，再报错（保留输入）。
```ts
} catch (e) {
  base.value = null
  rows.value = []
  run.markFail(...)
}
```

### 验证
命令：`node /tmp/f3-e2e.mjs`（T34 段）。
```
cards after sample: 3
cards after invalid URL: 0
input preserved: "not a url"
idle/error text: "URL 解析失败：输入内容已保留，请按上方提示修正后自动重新解析。"
status text: "失败无效 URL：Failed to construct 'URL': Invalid URL。请输入完整地址（含协议，如 https://api.example.com/path?q=1），本工具只编辑 URL，不发起请求。"
```
结构信息 / 参数表 / 合成预览三张卡（`.t34__card`）由 3 → 0，输入保留，错误与修正方向可见。

---

## 3【T36｜低】缺 424 Failed Dependency；校对 305/306 废弃说明

### 问题
数据 60 条，对照 IANA 缺 `424 Failed Dependency`。核对源文件后确认 **305、306 也完全不存在**（不是说明写错，而是根本没有条目），因此一并补全并给出准确的废弃/unused 说明。

### 改动
`devkit/app/components/tools/t36-http-status.vue`
- `:44` 新增 `305 Use Proxy`（cn「使用代理（已废弃）」）：说明 RFC 7231 起标记为 deprecated（响应内带内配置代理存在安全隐患），RFC 9110 沿用；服务器不应再生成。
- `:45` 新增 `306`（name `(Unused)`，cn「未使用（保留）」）：说明早期草案曾称 Switch Proxy 但未进入标准，RFC 9110 明确不再使用。
- `:72` 新增 `424 Failed Dependency`（cn「依赖失败」，RFC 4918 WebDAV）：前置操作失败导致本次连带失败，典型为 PROPPATCH 中某属性失败、其余属性一并 424；`related` 关联 423 / 507。

### 验证
命令：`node /tmp/f3-e2e.mjs`（T36 段，真实页面搜索）。
```
count text: 命中 63 / 63
search 424: ["Failed Dependency"] ["依赖失败"]
search 305: ["Use Proxy"] ["使用代理（已废弃）"]
search 306: ["(Unused)"] ["未使用（保留）"]
424 detail: "用途WebDAV 扩展（RFC 4918）：当前操作依赖的前一个操作失败，本次请求因此也无法完成。典型场景是 PROPPATCH 中某个属性修改失败时，其余属性修改一并返回 424。相近状态区别423423 是资源被锁定；424 是前置操作失败导致的连带失败507507 是服务器存储空间不足"
```
总数 60 → 63，搜索与详情均命中。

---

## 4【T38｜中】`clearFile` 死代码、无「移除文件」入口

### 问题
`clearFile()`（`:129`）已实现但模板从未引用，用户载入图片后无法回到无文件状态（`r4` D9）。

### 改动
`devkit/app/components/tools/t38-image-compress.vue:267`：在工具栏「重新转换」前接入幽灵按钮（与 T41 的 `variant="ghost"`「移除」一致），仅在有文件时显示：
```html
<DkButton v-if="file" size="sm" variant="ghost" @click="clearFile">移除</DkButton>
```
`clearFile` 复用现有逻辑：清空 file/bitmap/orig/result/hasAlpha、回收 objectUrl、`run.markIdle()`。

### 验证
命令：`node /tmp/f3-e2e.mjs`（T38 段，上传 `/tmp/f3-test.png` 后点击「移除」）。
```
after upload: remove buttons = 1 panels = 2
after remove: panels = 0 empty-state = 1
```
移除后原图/结果双面板消失，回到「选择图片后自动转换…」空态。

---

## 5【offline.vue｜中】重试空操作、监听未清理、文案与真实能力不符

### 问题
- `retry()` 仅在 `navigator.onLine === true` 时 `location.reload()`，而按钮 `:disabled="online"`，唯一可点击的离线状态下什么都不做（死按钮）。
- `online`/`offline` 监听无 `onUnmounted` 移除（唯一泄漏点，`r6` 3.7）。
- 无 PWA/SW（`devkit/public` 不存在、`nuxt.config.ts`/`package.json` 无相关配置），站点为 SSR；原文案「已缓存的工具可以继续本地使用…离线时仍可打开」与真实能力不符。

### 改动
`devkit/app/pages/offline.vue`
- `:31-41`：`onMounted` 注册命名处理函数 `onOnline`/`onOffline`，新增 `onUnmounted` 成对移除两个监听。
- `:50-80`：`retry()` 改为真实检测：重读 `navigator.onLine` + 重新读取 `localStorage['devkit.visited.v1']` + 对本站发一次 `HEAD` 请求（`cache:'no-store'`，`AbortController` 4s 超时），并把实测结论写入 `lastProbe`/`lastChecked`；`online` 以实测可达性为准。
- `:99`：按钮去掉 `:disabled="online"`，改为 `:loading="checking"`，文案「重新检测」，任何状态下都可点击。
- `:93-97,105-107`：文案改为不撒谎的表述——明确「没有 Service Worker 预缓存，不承诺任何工具断网可用」；`localStorage` 访问记录仅说明「访问过的工具，其静态资源可能仍保留在本机浏览器缓存中」，列表标题由「已缓存工具」改为「访问过的工具」。

### 验证
命令：`node /tmp/f3-e2e.mjs`（offline 段，含监听计数埋点与 `context.setOffline(true)` 断网）。
```
event counters after /offline mount: {"add":2,"remove":0}
list title: 访问过的工具（4）
page copy (excerpt): 资源未就绪当前网络可用。……DevKit 不做离线预缓存，也不承诺任何工具在断网时可用；下面列出的只是你访问过的工具，其静态资源可能仍保留在本机浏览器缓存中。重新检测
probe (online): 12:38:29 PM 检测结果：可访问本站（navigator.onLine=true）
probe (offline simulated): 12:38:31 PM 检测结果：无法访问本站（navigator.onLine=false，Failed to fetch）
title when offline: 当前处于离线状态
event counters after leaving /offline: {"add":2,"remove":2}
```
重试在联网/断网两种真实状态下分别给出「可访问本站」「无法访问本站」的实测结果；进入页面累计 +2 个监听、离开后累计 -2，无泄漏。

---

## 回归检查

- 全流程 Playwright 跑完 5 个页面，`console.error` / `pageerror` 均为 `(none)`。
- 类型检查（`/Users/hao/node_modules/.bin/vue-tsc --noEmit -p .nuxt/tsconfig.json`）共 49 个错误；本次改动文件中仅 `t38-image-compress.vue(122,50) TS2532`，为改动前既有错误（原审核报告已记录 t38 各 1 个错误，行号因新增一行由 121 顺移为 122，即 `detectAlpha` 的 `data[i]`），未引入新错误；t34/t35/t36/offline.vue 均无错误。
- 未改动 `app/utils/json.ts`、composables、`Dk*.vue`、`SplitPanes.vue`、`error.vue`、`FileDrop.vue`、其他页面、`design.pen`、`docs/**`。

## 未修复 / 说明项（不在本次范围或不宜改动）

- T35 从 axios 源生成 axios 时，`params` 既被 `urlWithParams` 合并进 URL 又输出 `params: {...}`（重复），属既有行为，与本次 D1 无关，未改动以避免扩大影响面。
- T36 详情仍只有「用途 / 相近状态区别」，设计要求的「方向/可缓存/幂等/RFC 参考/常见原因」等属 `r4` R8 的覆盖缺口，本次任务只要求补 424 与校对 305/306。
- offline.vue 仍是「说明页」而非真正的 PWA 离线缓存（接入 SW/PWA 超出本文件范围且需改 `nuxt.config.ts`）；本次只保证文案与现状一致、重试真实、监听不泄漏。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/fix-f3-web-file.md
