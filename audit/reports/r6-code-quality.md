# DevKit 审核 · R6 跨切面代码质量与真实缺陷

审核范围：构建/类型/lint、SSR 安全、composables/utils 正确性、运行时健康、安全、可访问性、性能、文档一致性。
证据均为本机实跑命令输出。基准站点 `http://localhost:3000`（另用 `nuxt build` 产物在 3200 做了生产对照）。
未修改任何 `devkit/**`、`design.pen`、`docs/**`；测试脚本写在 `/tmp`。

## 结论摘要

总体：**工具主体功能健康，但“错误页 / 偏好持久化 / 类型工程 / 少数工具边界算法”存在真实缺陷**。构建（`nuxt build`）成功、41 个工具按路由拆包、SSR 顶层无 `window` 违规、无 `eval/new Function`、localStorage 未存输入正文——这些是符合预期的。最严重 5 条：

1. **【高】错误页/404 页引用未导入的 `getTool`**（`app/error.vue:11`，TS2304）。开发站点 404 页“常用工具”区渲染为 0 项，控制台报 `[NUXT_E1005]`；生产构建（`.output`）404 页整个 `.err` 区不渲染。
2. **【高】偏好设置刷新后失效**：`usePrefs` 把 `loadPrefs` 作为 `useState` 初始化器（`usePrefs.ts:33`），SSR payload 覆盖了客户端 localStorage 读取，且没有像 favorites/recent 那样在 `onMounted` 重新载入。实测写入 `theme:dark, codeFontSize:18` 后 reload，`<html>` 无 `dark`、`--code-font-size` 仍为 13px。
3. **【中】类型工程缺位**：无根 `tsconfig.json`，`npx nuxt typecheck` 直接报 `Cannot find matching tsconfig.json` 退出；项目无 `typecheck` 脚本、未装本地 `vue-tsc`。用全局 vue-tsc 对着 `.nuxt/tsconfig.json` 跑出 **51 个类型错误**，而 `nuxt build` 完全不检查类型、照常成功。
4. **【中】`t24` Properties 解码计数失效**：`ParsePropsResult.unicodeDecoded` 与 `propUnescape` 里的 `res.uCount++` 字段名不一致（`t24-properties-yaml.vue:26/49/70/95`），计数永远为 0，导致“已解码 N 处 `\uXXXX`”提示永不出现（TS2345）。
5. **【中】大整数安全 JSON 有往返破坏与定位错误**（`app/utils/json.ts`）：字符串值 `"@@raw:123@@"` 会被反序列化成数字；语法错误列号按“包裹后”的偏移计算而偏大；新版 V8 错误消息没有 `position N` 时返回 `null`。

正面结论（已实测）：工具组件按路由拆包（生产首页请求中无任何 `tXX-*` 工具 chunk；`jsQR` 160KB、`js-yaml`、`sm-crypto` 均为独立懒加载 chunk）；`t38/t39/t41/t11` 的 debounce 定时器都有 `clearTimeout`；除 `offline.vue` 外的事件监听都有对应移除；`v-html` 仅 DkIcon 的静态图标表；外链带 `rel="noopener noreferrer"`；41 个工具组件均有 `defineProps`。

## 覆盖对照表

| 审核项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 类型检查 | `npx nuxt typecheck` | ❌ 直接失败 | 无根 tsconfig；见 1.1 |
| 备用类型检查 | `npx vue-tsc --noEmit -p .nuxt/tsconfig.json` | ⚠️ 51 errors | `/tmp/r6-vuetsc.log` |
| 生产构建 | `npx nuxt build` | ✅ exit 0，无 warn | `/tmp/r6-build.log` |
| 静态产出 | `.output` 存在、7.9MB；`_nuxt` 1.5MB | ✅ | `du -sh .output` |
| SSR 顶层访问浏览器 API | `grep -rn window/document/...` | ✅ 均在 onMounted/事件回调 | 见 2 |
| utils/json 边界 | node 造用例 | ❌ 3 个真实缺陷 | 见 3.1 |
| utils/bytes 边界 | node 造用例 | ⚠️ 仅低危边界 | 见 3.2 |
| useToolRun 状态机 | 代码走查 + 各工具 stale 门控 | ✅ 未发现“过期仍可复制” | 见 4.1 |
| localStorage 红线 | grep + 代码走查 | ✅ 仅存偏好/收藏/最近/visited | 见 4.3 |
| 运行时健康 | `probe.py` 14 条路由 | ⚠️ 404 页告警/错误 | 见 5 |
| v-html / eval / 外链 | grep | ✅ 无可利用点 | 见 6 |
| 可访问性 | probe a11y + Playwright 键盘 | ❌ 命令面板/开关/下拉 | 见 7 |
| 性能/拆包 | 生产 3200 实测 + chunk 分析 | ✅ 拆包良好；⚠️ 外链字体 | 见 8 |
| README/FOUNDATION 一致性 | 对照代码 | ⚠️ 端口/能力不一致 | 见 9 |

---

## 1. 构建 / 类型 / Lint

### 1.1【中】`nuxt typecheck` 无法运行：缺根 tsconfig，且无本地 vue-tsc / typecheck 脚本

命令与输出：
```
$ cd devkit && npx --no-install nuxt typecheck
 ERROR  Cannot find matching tsconfig.json in .../devkit or parent directories
    at readTSConfig (node_modules/pkg-types/dist/index.mjs:64:23)
    at ... @nuxt/cli/dist/typecheck-BXVxFdHw.mjs:107:43
EXIT=1
$ ls tsconfig*.json
ls: tsconfig.json: No such file or directory
```
- `devkit/` 下没有 `tsconfig.json`（只有 Nuxt 生成的 `.nuxt/tsconfig.json`）。
- `package.json:5-11` 的 scripts 中没有 `typecheck`；`devDependencies`（package.json:23-28）没有 `vue-tsc` / `@nuxt/typecheck`。
- 因此 Nuxt 官方类型检查入口在干净仓库不可用。

修复建议：新增根 `tsconfig.json`（`{ "extends": "./.nuxt/tsconfig.json" }`），加 `"typecheck": "nuxt typecheck"` 脚本，并把 `vue-tsc` 固定进 devDependencies。

### 1.2【中】绕过 typecheck 入口后仍有 51 个真实类型错误

命令：`npx --no-install vue-tsc --noEmit -p .nuxt/tsconfig.json`（全局 vue-tsc 5.9.3）。
按文件分布（`grep -E "error TS" /tmp/r6-vuetsc.log`）：

| 文件 | 错误数 |
|---|---|
| app/components/tools/t21-date-diff.vue | 12 |
| app/components/tools/t20-cron.vue | 6 |
| app/components/tools/t18-timestamp.vue | 6 |
| app/components/tools/t19-uuid.vue | 5 |
| app/components/tools/t24-properties-yaml.vue | 4 |
| app/components/tools/t22-json2java.vue | 4 |
| app/components/tools/t40-text-encoding.vue | 3 |
| app/components/tools/t25-stack-trace.vue | 2 |
| app/error.vue | 1 |
| app/composables/useTransfer.ts | 1 |
| 其余 t05/t13/t15/t16/t17/t33/t38 | 各 1 |
| **合计** | **51** |

关键几条（有对应真实缺陷）：
- `app/error.vue(11,39): error TS2304: Cannot find name 'getTool'` → 见 1.3。
- `app/composables/useTransfer.ts(56,86): TS2339: Property 'slug' does not exist on type 'ComputedRef<...>'` → 见 4.2。
- `app/components/tools/t24-properties-yaml.vue(121,59)/(122,63): TS2345 ... Property 'uCount' is missing` → 见 3.3。
- 大量 `TS18048 'map.year' is possibly 'undefined'`（t18/t20/t21）属于把 `RegExpExecArray` 下标当必然存在，运行时通常安全，但说明缺少边界收窄。

> 注：vue-tsc 为 `/Users/hao/node_modules` 下的全局 5.9.3，非项目安装；部分 `Uint8Array<ArrayBufferLike>` 与 `BlobPart` 的报错与该版本的 lib.dom 泛型有关。但 `error.vue`、`useTransfer`、`t24` 三类错误与版本无关。

### 1.3【高】错误页 `app/error.vue:11` 使用了未导入的 `getTool`

```ts
// app/error.vue:10-11
const common = ['json-format', 'sm4', 'timestamp', 'jwt', 'qrcode']
const commonTools = common.map((s) => getTool(s)!).filter(Boolean)
```
- `getTool` 定义在 `app/data/tools.ts:296`，但 Nuxt 只自动导入 `app/composables/**`、`app/utils/**`；`app/data/**` 不在自动导入目录。`.nuxt/imports.d.ts` 中检索不到 `getTool`；其它页面（`pages/tools/[slug].vue:2`、`pages/index.vue:2`）都显式 `import`，唯独 error.vue 没有。
- 取开发服务器实际编译后的 error.vue 模块验证：import 列表里**没有** `getTool`，而 setup 里直接调用：
```
$ curl -s "http://localhost:3000/_nuxt/@fs.../app/error.vue" | grep -o '.\{0,80\}getTool.\{0,160\}'
 const commonTools = common.map((s) => getTool(s)).filter(Boolean);
```
- 生产客户端 chunk 同样只有一次引用、无定义/无 import：
```
$ grep -o "getTool" .output/public/_nuxt/CYl-jWQt.js | wc -l   # => 1
$ grep -o "function getTool..."  .output/public/_nuxt/CYl-jWQt.js  # => 空
```

实测后果：
- 开发 3000，`/this-page-does-not-exist`：`document.querySelectorAll('.err__common-item').length === 0`；“常用工具”标题在、列表空；控制台出现 `[NUXT_E1005] Error caught during app initialization` 且 dev 错误覆盖层（`nuxt-error-overlay`）存在。同一份渲染里 `<title>` 是 404 专用文案（`useSeoMeta` 已执行），而正文 `.err__title` 却是通用分支“页面出现了错误”。
- 生产对照（`PORT=3200 node .output/server/index.mjs`）：404 页 `document.querySelector('.err') === null`，即**整个自定义错误区都没渲染出来**，只报 `[NUXT_E1005]`。

修复建议：`app/error.vue` 顶部加 `import { getTool } from '~/data/tools'`，或改用 `getToolById` 与现有导入；回归 `/this-page-does-not-exist` 与 `/tools/does-not-exist`。

### 1.4【低】`as any` 与死代码

- 全仓 `: any / as any / <any>` 命中 82 处（含 `overflow-wrap: anywhere`、`\uXXXX` 文本误报），真实的是 DkSegmented 事件透传模式，例如 `app/pages/settings.vue:64` `@update:model-value="update({ theme: $event as any })"`（t14/t15/t24/t04 同样写法）。`DkSegmented` 的 `value` 是 `string`，这里用 `as any` 绕过了 `Prefs` 联合类型检查，非法值可被写进 `prefs` 与 localStorage。
- `app/composables/useToolRun.ts:12` `let lastSig = ''` 在 `:30`、`:38` 被赋值，但从未被读取 —— 死代码。
- 无 ESLint/Prettier/Biome/EditorConfig 配置（`ls -a | grep -iE "eslint|prettier|editorconfig|biome"` 无输出），所以未使用变量/any 不会被工具拦截。

---

## 2. SSR 安全

用 `grep -rn "window\.\|document\.\|navigator\.\|localStorage\.\|sessionStorage\.\|matchMedia\|crypto\."` 全量排查，逐条确认上下文：

| 位置 | 上下文 | 结论 |
|---|---|---|
| `composables/usePrefs.ts:24/43/58-60` | `loadPrefs`/`persist` 有 `import.meta.server` 守卫；DOM 操作在 `applyTheme`，由 `onMounted` 调用 | ✅ |
| `composables/useRecent.ts:12/37`、`useFavorites.ts:6/28` | `load` 有 server 守卫，写入由 `onMounted`/事件触发 | ✅ |
| `components/ToolPageLayout.vue:13/16` | `onMounted` 内 | ✅ |
| `components/TopNav.vue:8`、`pages/help.vue:6` | `navigator.platform` 在 `onMounted` | ✅ |
| `components/SplitPanes.vue:23` | `window.innerWidth` 在 `pointermove` 回调 | ✅ |
| `pages/offline.vue:10-12/18/32` | `onMounted` / 事件 / 点击回调 | ✅ |
| `components/DkModal.vue:19-23` | `watch(props.open)` 内有 `import.meta.server` 守卫 | ✅ |
| `layouts/default.vue:20-23` | `onMounted` 添加、`onUnmounted` 移除 | ✅ |
| `utils/bytes.ts:3/10`、`useClipboard.ts:12/21`、`t39:108`、`t38:115/185` | 函数体内，含 `import.meta.server` 守卫或仅客户端调用 | ✅ |

**未发现 setup 顶层直接访问浏览器 API 导致 SSR 崩溃的代码。** 这符合 `FOUNDATION.md` 的约定。

`<ClientOnly>`：全仓未使用。由于所有浏览器调用都在 `onMounted`/回调内，且主题/偏好是纯增强，现状可接受；但 `usePrefs` 的持久化缺陷（见 4.3）本质上是“SSR payload 与客户端状态不同步”，不是 `<ClientOnly>` 能直接修的。

---

## 3. composables / utils 正确性与边界

### 3.1【中】`app/utils/json.ts` 大整数安全实现存在 3 个真实缺陷

测试脚本 `/tmp/r6-json-test.mjs`、`/tmp/r6-json-test2.mjs`（`node --experimental-transform-types`）。正常项确认无误：19/20 位整数、`1e21`、`-0`、超长小数、`1E-7`、顶层数字、数组嵌套均保留原文。

**(a) 字符串值被误判为原始数字（往返破坏）** — `json.ts:11-13/61-66`
```
[ string-looks-like-raw ] input={"a":"@@raw:123@@"}
  parsed:    {"a": RawNumber(123)}
  roundtrip: { "a": 123 }        ← 字符串变成数字
```
`wrapNumbers` 用 `@@raw:` 前缀把数字包成字符串，`unwrap` 只看值是否 `startsWith('@@raw:') && endsWith('@@')`，无法区分“原本就是这种字符串”和“新包裹的数字”。用户合法 JSON 会被静默改类型。
建议：改用不可与用户字符串冲突的私有哨兵（如 `\u0000raw:`），或在 `wrapNumbers` 同时收集所有映射位置后按位置精确还原，而不是靠字符串前缀。

**(b) 语法错误列号按“包裹后文本”的偏移计算，报错位置偏大** — `json.ts:75-79,197-209`
`parseJson` 丢给 `JSON.parse` 的是 `wrapNumbers(text)`，但 `jsonErrorPosition(e, text)` 用的是原文，`position` 却来自包裹后文本：
```
[ plain-trailing ] input={"a":1,}
  msg = Expected double-quoted property name in JSON at position 17 (line 1 column 18)
  pos = {"line":1,"column":9}     ← 真实错误在第 8 列；被包裹多出的 9 个字符计入
```
多行且前面有大整数时同样偏移（`trailing-comma-after-bignum` 报 column 2，V8 自己说 column 1）。等于给用户指错位置。
建议：记录每次替换的偏移量并映射回原文，或对原文做同样的位置修正。

**(c) 对新版 V8 短消息返回 `null`** — `json.ts:197-209`
V8 对部分错误不再产生 `position \d+`，而是片段消息：
```
[ error-after-number ] msg=Unexpected token '}', ..."90@@","b":}" is not valid JSON
  pos = null
[ leading-plus ] msg=Unexpected token '+', "{"a":+1}" is not valid JSON
  pos = null
```
此时错误条只剩原始英文消息，没有行列。建议补一段“相对片段定位”或在文本里做 JS 词法定位兜底。

### 3.2【低】`app/utils/bytes.ts` 边界

`/tmp/r6-bytes-test.mjs` 结果（空输入、非法字符、奇数 hex 长度、Base64 URL-safe、全 256 字节往返均正确）：
- `hexToBytes('de ad be ef')` 会**静默去掉所有空白**（`bytes.ts:57`），包括本不该接受的换行；`'0xdeadbeef'` 正确报错。低危，但与“校验合法性”的注释略有出入。
- `formatBytes(-5)` 输出 `-5 B`（`bytes.ts:43-48` 无负值处理）；`formatBytes` 输入为负只可能来自上游 bug，低危。
- `looksLikeText` 把 `b >= 128` 一律算可打印（`bytes.ts:113`），因此非 UTF-8 的二进制（如随机字节）也会被判为“文本”，与 `bytesToText` 的严格 UTF-8 结论可能矛盾。空输入返回 `true`。
- `lineCount('a\n') === 2`（`bytes.ts:27-30`）：末尾换行会多算一行，而空串返回 0；编辑器统计口径需确认。`charCount('👍')=2`（UTF-16 码元）、`codePointCount=1`，两者区分正确。

### 3.3【中】`t24-properties-yaml.vue` 的 `\uXXXX` 解码计数永远为 0

```ts
// t24-properties-yaml.vue:25-27
interface ParsePropsResult { entries; errors; unicodeDecoded: number; dupKeys }
// :49   propUnescape(s, decode, res: { errors: string[]; uCount: number })
// :70     res.uCount++
// :95   const res: ParsePropsResult = { ..., unicodeDecoded: 0, ... }
// :121-122 propUnescape(keyRaw/valueRaw, decodeUnicode.value, res)   ← 传的是 ParsePropsResult
// :424-425 if (parsed.unicodeDecoded > 0) notes.push(`已按选项解码 ${parsed.unicodeDecoded} 处 ...`)
```
- `propUnescape` 递增的是 `res.uCount`，但实际对象只有 `unicodeDecoded`，即 `undefined++`，`unicodeDecoded` 永远是 0，`:425` 的提示永不出现。
- 同一处在类型检查里报 `TS2345 ... Property 'uCount' is missing in type 'ParsePropsResult'`（`/tmp/r6-vuetsc.log`），属真实字段错配而非误报。
- 修复：把接口/`propUnescape` 形参与初始化统一为 `unicodeDecoded`（并让 `uCount++` 改成 `res.unicodeDecoded++`）。

### 3.4【低】`useToolRun` 状态机

代码走查 + 抽查 6 个“点按钮执行”的工具（t02/t12/t20/t25/t39）：
- stale 转换逻辑正确：`markOk/markFail` 后 `armed=true`，签名变化时 `ok/error → stale`；
- 抽查的复制入口都用 `run.status.value !== 'ok'` 或 `=== 'stale'` 门控，`DkEditor` 的 `:stale` 也确实禁用复制/下载（`DkEditor.vue:81/89`）；
- **未发现**“结果已过期但仍可复制”或“失败后 status 显示成功”的确定路径。
- 但 `useToolRun` 不建模 `running`：`RunStatus` 只有 `idle|ok|error|stale`（`useToolRun.ts:1`），与 `FOUNDATION.md:103` 声称的 `running` 不一致；t12 只能手写 `:status="busy ? 'running' : run.status.value"`（`t12-md5-sha.vue:209`）。异步 execute 期间没有统一 loading 态，存在竞态隐患（低）。`lastSig` 死代码见 1.4。

### 3.5【中】持久化：偏好刷新后失效（重点）

`usePrefs`（`app/composables/usePrefs.ts`）：
```ts
21  function loadPrefs(): Prefs {
22    if (import.meta.server) return { ...defaultPrefs }
24    const raw = localStorage.getItem(STORAGE_KEY) ...
33  const prefs = useState<Prefs>('devkit-prefs', loadPrefs)
...
63  onMounted(() => { ...applyTheme() })   // 没有再 load()
```
- SSR 首次渲染时 `loadPrefs` 返回默认值并写入 Nuxt payload；客户端 hydration 时 `useState` 直接采用 payload 中的默认值，**不会调用初始化器**，且全组件没有 `onMounted` 重新读取 localStorage（对比 `useFavorites.ts:19-24`、`useRecent.ts:28-33` 都有 `loaded` 标志 + `onMounted` 重载）。
- 实测（`/tmp/r6-prefs.py`）：设置 `{theme:'dark', codeFontSize:18, reduceMotion:true}` 后 reload：
```json
{"dark": false, "reduceMotion": false, "cssFont": "13px",
 "stored": "{\"theme\":\"dark\",\"codeFontSize\":18,...}",
 "renderedFontLabel": "... | 13px | ..."}
```
localStorage 里存着 dark/18px，但页面回到浅色/13px。**用户设置无法跨刷新生效**（会话内改动能生效）。
- 修复：像 favorites 那样在 `onMounted` 里 `prefs.value = loadPrefs()`（并置 `loaded` 标志），或改成客户端插件在 `app:beforeMount` 前读取。

### 3.6【低】localStorage 写入无异常兜底

- `usePrefs.ts:43`、`useFavorites.ts:28`、`useRecent.ts:37` 的 `setItem` 无 `try/catch`；读取侧都包了，但写入侧在“隐私模式/存储被禁用/配额超限”时会抛异常并打断 `update()/toggle()/record()`。收藏/最近元素有限，配额风险低；但隐私模式抛错是确定的。
- 建议统一包一层 `safeSet`。

### 3.7【中】`offline.vue`：重试按钮是空操作，且监听未清理

```ts
// pages/offline.vue:9-13
onMounted(() => {
  online.value = navigator.onLine
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
})            // ← 没有 onUnmounted 移除，每次进入 /offline 泄漏 2 个监听
// :31-35
function retry() { if (navigator.onLine) location.reload() }
// 模板 :54  <DkButton :disabled="online" @click="retry">重试加载</DkButton>
```
- 按钮仅在 `!online`（离线）时可点，但 `retry()` 只在 `navigator.onLine === true` 时 reload —— 即**唯一能点到它的状态下它什么都不做**，功能上是死按钮。
- 对比：`layouts/default.vue`、`SendToMenu.vue`、各工具页都成对 add/remove；`offline.vue` 是唯一漏网（`grep -rn addEventListener/removeEventListener` 佐证）。
- 修复：`onUnmounted` 移除两个监听；重试逻辑改为无条件 `location.reload()`（或加“恢复网络后重试”的明确交互）。

---

## 4. 运行时健康（probe.py）

`python3 audit/tools/probe.py` 跑 14 条路由（结果存 `/tmp/r6-probe/`）：
- 正常路由 `/`、`/tools/json-format`、`/tools/aes`、`/tools/svg`、`/tools/html-format`、`/settings`、`/favorites`、`/recent`、`/help`、`/privacy`、`/offline`、`/category/format`：**console error 0、pageerror 0、failed_requests 0**，`status 200`。
- 失败请求：`failed_requests` 全为空 —— 无字体/图标/favicon 404（字体来自 Google，网络可达；离线场景见 8.2）。
- `/tools/does-not-exist`、`/this-page-does-not-exist`：`status 404`，console 出现 `[NUXT_E1005] Error caught during app initialization`（见 1.3），并伴随两条 warning：
  - `[Vue Router warn]: No match found for location with path "..."`（404 路由的预期警告）；
  - `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.` —— 仅出现在错误页，来自 Nuxt dev 错误覆盖层/Nuxt 内部，**非项目业务代码直接产生**，列存疑项。

内存/定时器泄漏：
- `setInterval` 全仓 0 处；`setTimeout`/`requestAnimationFrame` 的 t38/t39/t41/t11 均有 `clearTimeout`（`t38:222-223`、`t39:75-76`、`t41:178-179`、`t11:131/138/151`）。
- `useToast.ts:27` 的定时器不随页面卸载清理，但 toast 本身是短生命周期 + 全局状态，风险低。
- 唯一确定的监听泄漏是 `offline.vue`（见 3.7）。

---

## 5. 安全性

- `v-html`：全仓仅 1 处 `app/components/DkIcon.vue:158`，`html` 来自常量表 `icons[props.name] ?? icons.help`（`DkIcon.vue:144`），`props.name` 由静态 `data/tools.ts` 提供 —— **不可控输入，无可利用点**。
- `innerHTML/outerHTML/srcdoc/document.write/eval/new Function`：全仓 0 处（grep 无输出）。
- SVG 工具（`t31-svg.vue`）：`DOMParser` + 清洗 `script`/`foreignObject`/`on*`/外部 `href`（`:45-77`），再以 `<img :src="previewUrl">`（`:262`）渲染，属于浏览器“安全静态模式”，不会执行脚本或加载远程资源。设计合理。
- 外链：`TopNav.vue:45-50` 的 GitHub 链接带 `rel="noopener noreferrer"`，OK。
- 未发现硬编码密钥/Token（若后续出现，仅登记位置与类型，不泄露内容）。
- 结论：**无可直接利用的 XSS/代码执行点**。

---

## 6. 可访问性

`probe.py` 的 a11y 统计（正常页 `buttonsNoName=0`、`imgNoAlt=0`，仅下列例外）+ Playwright 键盘实测。

### 6.1【中】命令面板：Esc 不可靠 + 无焦点陷阱

`app/components/CommandPalette.vue:70-76` 把 `@keydown="onKeydown"` 绑在 `<input>` 上，而 `:67` 声明了 `aria-modal="true"`、`role="dialog"`。实测（`/tmp/r6-palette.py`）：
```
open: True
Esc with input focus closes: True
focus escaped palette after 3 Tabs; active= router-link-active router-link-exact-active topnav__brand
Esc while on button closes: False     ← 焦点在结果按钮上时，Escape 完全无效
```
- 无焦点陷阱：3 次 Tab 焦点就跑到背景 TopNav；
- 关闭后焦点未回到触发按钮（无 `lastFocus` 逻辑，对比 `DkModal.vue:19/25` 有做）；
- 结果项无 `role="listbox"/"option"`、无 `aria-activedescendant`、输入框只有 placeholder 无 `aria-label`。
- 修复：把 keydown 提升到 dialog 容器（或 `window`，open 时挂载）、加焦点陷阱与 `aria-label`、关闭时 restore focus。

### 6.2【中】`DkSwitch` 无无障碍名称

`app/components/DkSwitch.vue:7-15`：`<button role="switch" :aria-checked>` 内部只有一个装饰 `<span>`，没有文本/`aria-label`。`/settings` 页实测 `buttonsNoName: 3`，正是 3 个开关（减少动画、自动换行、记录最近使用）。修复：给 DkSwitch 加 `label`/`aria-label` prop，或在调用处用 `aria-labelledby` 指向可见 label。

### 6.3【中】`DkSelect` 无 label

`app/components/DkSelect.vue:17` 直接渲染 `<select>`，无 `aria-label`。`/favorites` 实测 1 个无标签输入：`{"tag":"SELECT","cls":"dk-select__el"}`。全局多处 DkSelect 都依赖外部 DkField，未包 DkField 的场景（如 favorites 的筛选）就没有可访问名。修复：DkSelect 增加 `aria-label`/`label` prop 并透传。

### 6.4【低】`DkSegmented` 语义与键盘

`app/components/DkSegmented.vue:16-29` 使用 `role="tablist"` + `role="tab"`，但没有 `tabpanel`、没有方向键导航、没有 roving tabindex，且所有 tab 都在 Tab 序列里。用作设置项时语义不准确（更适合 `radiogroup/radio`）。同时无 `focus-visible` 自定义（全局 `main.css:257 :focus-visible` 提供兜底，可接受）。

### 6.5【低】`DkModal`

`DkModal.vue` 有 `role="dialog" aria-modal="true"`、`tabindex="-1"`、打开时 focus 面板、关闭 restore、Escape（`:30-32`，绑定在 panel 上，panel 聚焦时有效），但没有焦点陷阱，Tab 可离开面板到背景。与 6.1 同类。

其余：`imgNoAlt=0`；`/tools/svg` 仅有 1 个隐藏 `input[type=file].filedrop__input` 无标签（FileDrop 装饰性，低危）；landmark `footer` 全站缺失（各页面无 `<footer>`，低）。

---

## 7. 性能

### 7.1【正】工具按路由拆包，首页不加载工具代码

- 生产构建产物 `.output/public/_nuxt` 共约 1.5MB；`t01..t41` 各有独立 chunk（`du -sh .output`、`ls .output/server/chunks/build/t*`）。
- 生产预览（3200）首页资源实测（`/tmp/r6-perf2.py`）：
```json
{"transferTotal": 437351, "jsCount": 21, "toolChunks": [],
 "topJs":[{"n":"CYl-jWQt.js","s":92672},{"n":"C4F3HEhw.js","s":91977}, ...],
 "navTiming":{"domContentLoaded":723,"load":1228}}
```
`toolChunks: []` 证明首页没有把 41 个工具全量打包。`jsQR`（160KB raw/57KB gzip）、`js-yaml`（42KB）、`sm-crypto`（38KB）经 chunk 签名确认是独立懒加载文件，只在对应工具页加载。首页 JS gzip 约 67KB，可控。

### 7.2【中】外链 Google Fonts 与“纯静态/离线/隐私”定位冲突

`devkit/nuxt.config.ts:20-25`：
```ts
link: [{ rel: 'stylesheet',
  href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC...&family=JetBrains+Mono...&display=swap' }]
```
- 生产首页实测外部请求包含 `fonts.googleapis.com` 与多个 `fonts.gstatic.com/.../notosanssc/...woff2` 中文子集，`fontsBytes` 记录到 124KB+，且是渲染阻塞样式表。
- `README.md` 宣称“纯静态部署，无账号、无云端历史”，`pages/index.vue` 文案称“支持静态部署、离线使用”，但离线时字体回退、无预缓存；同时每次访问向第三方域名发起请求（IP/UA 暴露），与隐私页的“输入不出浏览器”不冲突，但与“全部本地/离线”的营销口径不一致。
- 建议：自托管字体子集（只保留用到的字重）或使用系统字体栈，并在 `nuxt.config` 加 `preconnect`。

### 7.3【低】重复依赖

`npm ls --depth=0`：直接声明 `vue-router@^4.5.1`（实际 4.6.4），而 `node_modules/nuxt/node_modules/vue-router` 是 **5.3.1**（Nuxt 4.5.2 内置）。两套 vue-router 并存；`npx vue-tsc` 时出现的 `vue-router/volar/sfc-route-blocks is not defined by exports` 警告即来自内置 5.3.1。低危，但会增加产物体积与工具链噪音。

---

## 8. 一致性（README / FOUNDATION / data/tools.ts）

### 8.1【低】开发端口说法不一致
- `README.md:11`：`npm run dev   # 开发（默认 3000 端口）`
- `FOUNDATION.md:160-161`：`dev server 已运行在 http://localhost:3100`，并用 3100 做验证命令。
- 本次基准是 3000（`curl -o /dev/null -w '%{http_code}' http://localhost:3000/` → 200），3100 是 Pen 内嵌实例。两文档对“默认端口”描述冲突，易误导开发者。建议 FOUNDATION 注明“本任务环境实例在 3100，Nuxt 默认 3000”。

### 8.2【低】`useToolRun` 状态与 FOUNDATION 不符
`FOUNDATION.md:103` 写 `status: idle|ok|error|stale|running`，但 `useToolRun.ts:1` 无 `running`；真正支持 `running` 的是 `DkStatusBar.vue:2`，需要各工具手写 busy 分支（如 `t12:209`）。建议二选一：要么在 `useToolRun` 增加 `running`，要么把 FOUNDATION 改成手动传入。

### 8.3【低】`data/tools.ts` 注释与实现不符
`app/data/tools.ts:312` 注释“全局搜索：匹配名称、别名、分类”，但 `searchTools` 只查 `name`/`alias`/`tags`，从不查 `categories`。实测：
```
searchTools('数据格式') => (none)
searchTools('国密')     => sm2,sm3,sm4
searchTools('json')    => json-format,json-diff,json-yaml,json2java,json2ts,csv-json,jwt
```
CommandPalette/help 的文案只承诺“名称/英文/缩写/别名”，所以是注释失真（低）。顺带 `t05` 的 alias 含 `'encrypt64'`（`tools.ts:73`），与 Base64 功能无对应关系，疑为笔误。

### 8.4【低】`getCategory` 非空断言
`app/data/tools.ts:304-306` `categories.find((c) => c.key === key)!`。key 目前来自 `ToolMeta.cat` 联合类型，安全；但一旦有历史存档/手改数据带非法 cat，`getCategory` 会在渲染时抛错（`CommandPalette.vue:83` 直接调用）。建议返回兜底对象或报错。

### 8.5【信息】README 与实现一致的部分
- “41 个工具”：`tools.length === 41`（node 实测）。
- “结果待更新（stale）模式”“剪贴板降级”“跨工具内存传递”“明暗主题”等在代码中均有对应实现（useToolRun/useClipboard/useTransfer/usePrefs）。
- `FOUNDATION.md` 描述的 DkEditor/DkField(secret)/FileDrop/SplitPanes/DkStatusBar API 与代码基本吻合（`DkField.vue:7-43` 有 `secret` 与 `revealed` 插槽）。

---

## 9. 无法验证 / 存疑项

1. **错误覆盖层的 iframe sandbox 警告**（`An iframe which has both allow-scripts and allow-same-origin...`）：只在 404/错误页出现，来源指向 Nuxt dev 错误覆盖层而非业务代码，未定位到项目内 iframe，故不判定为项目缺陷。
2. **`jsonErrorPosition` 的“正确列号”**：V8 自身对短输入也只给片段消息，无法作为唯一真值；但 `{"a":1,}` 的真实错误列（第 8 列）可由人工确定，已据此判定偏移。
3. **类型检查版本差异**：51 个错误中约 8–10 条（`Uint8Array<ArrayBufferLike>` vs `BlobPart`）可能与所用全局 vue-tsc 5.9.3/lib.dom 有关，未逐条在项目锁定版本下复现；标为存疑，其余错误与版本无关。
4. **`t40` GBK 输出**：工具说明明确“GBK 仅可作源编码、不支持输出”，与实现一致，不构成缺陷。
5. **SSR 生产 404 文案差异**：开发与生产 404 页 `is404` 分支表现不一致（head/正文不同步），已计入 1.3，但根因（setup 抛错后 Nuxt 的降级渲染）未完全追到 Nuxt 内部实现。

---

## 10. 修复优先级建议

**P0（立即，影响可见功能/正确性）**
1. `app/error.vue` 导入 `getTool`（或改用已导入的 `getToolById`），回归 404 页。
2. `usePrefs` 在 `onMounted` 重新 `loadPrefs()`，让主题/字号/缩进/换行真正跨刷新持久化。

**P1（本迭代）**
3. 新增根 `tsconfig.json` + `typecheck` 脚本 + 本地 `vue-tsc`；在 CI 前置 `npm run typecheck`（当前 build 不拦截 51 个错误）。
4. 修 `t24` 的 `unicodeDecoded/uCount` 字段错配。
5. 修 `json.ts`：字符串哨兵冲突、错误列偏移、短消息定位兜底。
6. `offline.vue`：修死按钮 + `onUnmounted` 移除监听。
7. 可访问性：命令面板焦点陷阱/Esc/aria、`DkSwitch` 可访问名、`DkSelect` label。

**P2（排期）**
8. `useTransfer.ts:56` `from?.slug` → `from.value?.slug`（消除 TS2339 与潜在误过滤）。
9. 自托管/内联字体，或在文档中弱化“完全离线”表述。
10. 清理 `as any`、`lastSig` 死代码；补 ESLint；`detectDuplicateKeys` 路径显示真实键名。
11. 统一 `README`/`FOUNDATION` 端口与 `running` 状态描述；修 `tools.ts` 搜索注释与 `t05` alias。

---

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/r6-code-quality.md
