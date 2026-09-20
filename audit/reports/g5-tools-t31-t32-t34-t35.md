# G5 报告：T31 / T32 / T34 / T35 缺失控件与设计对齐

- 工作目录：`/Users/hao/WebstormProjects/web_tools`（Nuxt 4 在 `devkit/`，dev server `http://localhost:3000`，保存即 HMR）
- 设计依据：`audit/tools/pen.py dump/text` 读取 `design.pen`
  - T31：`CcBGd`（成功）、`ZUMYv`（不安全内容被阻止）、`al4QE`（优化视觉提示）
  - T32：`LYj5N`（成功）、`kf47C`（CSS）、`t7KlH5`（JS）、`tenYQ`（语法错误）
  - T34：`mSgym`（成功）
  - T35：`ndB0M`（curl→fetch）、`E6e87`（fetch→curl）、`sZOGq`（shell 表达式）、`Pu4BY`（multipart）
- 改动文件（仅这 4 个，未触碰任何其他文件）：
  - `devkit/app/components/tools/t31-svg.vue`
  - `devkit/app/components/tools/t32-html-format.vue`
  - `devkit/app/components/tools/t34-url-params.vue`
  - `devkit/app/components/tools/t35-curl-convert.vue`
- 说明：`vue-tsc` 在整仓范围内因 `vue-router/volar/sfc-route-blocks` 导出缺失（`ERR_PACKAGE_PATH_NOT_EXPORTED`）无法运行，与本轮改动无关；改用 dev server 编译 + probe 页面无 console/pageerror 作为 SFC 编译校验，并用独立 `tsc` 校验 T35 的 TypeScript 目标代码。

---

## 一、T31 SVG 预览与优化（`CcBGd` / `ZUMYv` / `al4QE`）

### 1. 不安全内容改为「阻断预览 + 仅查看源码」（核心，以前相反）
- 新增 `scanUnsafe(root, source)`：用 DOMParser 解析后扫描 `<script>`、`<foreignObject>`、`on*` 事件属性、非 `#`/`data:` 的 `href`/`xlink:href`。
- 只要命中任一项：`blocked = true`，**不再生成任何预览 `img`**，源码保持原样；右侧显示阻断卡片（红色，列出每处不安全内容的类别与行号、`仅查看源码` 按钮、`未执行任何脚本与网络请求`），顶部横幅提示并可「定位第 N 行」（选中源码编辑器中对应行）。
- 仅当扫描结果为空时才生成 `img data:image/svg+xml` 预览，并标注「预览已隔离 / 不执行脚本 / 不加载远程资源」。
- 防护未放宽：仍然只走 `<img>` 上下文，绝不用 `v-html`/`iframe`；优化输出始终是纯文本处理，不执行任何内容。
- 实测：含 `onload` + `<script>` + 远程 `href` + `onclick` 的示例 → `blockedDiv=1, img=0`，横幅「检测到 4 处不安全内容：预览已阻断，源码保持原样，不执行、不加载任何外部资源。」

### 2. 补齐设计选项（原只有 5 个布尔项，且无精度控制）
参数面板按设计改为 4 组：`压缩空白(开启/关闭)`、`保留 viewBox(是/否)`、`删除 title/desc(否/是)`、`小数位(2/3/4，必要时追加 6)`。
- 新增「保留 viewBox」：关闭时移除根 `viewBox`，并作为真实视觉变化进入提示。
- 新增「小数位」：对几何属性（`x/y/cx/cy/r/rx/ry/width/height/stroke-width/...`）、`d`/`points`/`stroke-dasharray` 中的数字取整；`1.500 → 1.5` 只是去尾零、**不算精度损失**，`12.345678 → 12.35` 才算，并记录首个例子。
- 删除了与设计不符的「去掉可省略的引号」（独立 .svg 是 XML，必须带引号）与「精简数值属性」（被更通用的「小数位」取代）；按设计示例保留注释（设计主画板没有删注释选项）。

### 3.「优化改变视觉」提示真实可达（`al4QE`）
- `optimizeSvg` 返回真实的变化清单；只有当取整确实改变数值、或确实移除了 `viewBox` 时才显示黄色警告横幅，文案带上真实例子（实测「把 12.345678 → 12.35 等坐标取整为 2 位小数」）。
- 提供快捷按钮「保留 6 位小数」：点击后 `decimals=6`，警告随即消失（实测 `warn 1 → 0`，且 `6 位` 选项出现）。
- 不再把「优化后变大」误报成视觉变化；`grewBy` 单独在状态栏/统计卡片提示。
- 仅空白压缩时显示「优化完成 · 视觉未改变」（实测普通示例）。

### 4. 补齐设计统计（`字节/标签数/空白字符/title·desc`）
- 右侧「优化前后」卡片展示四组真实统计：字节 `291 → 257 -34 · -12%`、标签数 `4 → 4 节点未删除`、空白字符 `33 → 23 已压缩`、`title/desc` 保留/已删除；并给出「优化完成 · 视觉未改变」或「精度已降低 · 请对比后再下载」结论。
- 预览头显示 `48 × 48 · viewBox 0 0 24 24` 等真实尺寸信息（来自解析后的根节点属性）。

### 5. 其他
- 保留 `FileDrop` 导入 `.svg`（≤5MB）、行级 diff、复制/下载、⌘/Ctrl+Enter 优化。
- G04：`sig` 含源码与全部选项；编辑源码后进入 stale，点「格式化并优化」重跑；解析失败保留输入并给出 parsererror/根元素提示。

---

## 二、T32 HTML / CSS / JS 格式化（`LYj5N` / `kf47C` / `t7KlH5` / `tenYQ`）

### 1. 补齐选项（保守实现，绝不改坏源码）
- `换行 LF / CRLF`：对所有语言输出行尾生效（实测输出含 24 处 `\r\n`）。
- `属性换行 保持 / 每行一个`：新增 `parseTag()` 按引号安全的属性切分器，仅对 HTML 生效；选择「每行一个」时开标签逐属性成行并缩进一级。CSS/JS 无属性概念，选项**置灰**并附 title 说明（宁可不做假的实现）。
- `保留空行 是 / 否`：HTML 按文本段中的连续空行保留；CSS/JS 在状态机里跟踪连续换行，遇下一条输出行时补空行。该选项只增加空白行，不改变语义，无破坏风险。
- `导入文件`：新增隐藏 `input[type=file]` + 按钮，按扩展名自动切换语言（`.css→CSS`、`.js/.mjs/.cjs→JS`、`.html/.htm→HTML`），内容只在浏览器内存中处理。

### 2. 语法错误定位（`tenYQ`）
- 保留原状态机的精确行号报错，新增顶部错误横幅：`第 N 行…（格式化已停止，未输出部分结果）` + 「定位第 N 行」。
- `locateLine()` 通过组件 `$el` 找到输入 textarea，计算该行字符区间并 `setSelectionRange` + 滚动居中；实测 `<div><section><p></div>` → 选中第 1 行 `[0,23]`。
- 失败时输出清空、输入保留，并给出修正方向；G04：`sig` 含全部选项，改选项后进入 stale，需重新点「格式化」（与设计文案「改选项后需重新格式化」一致）。

### 3. 状态与说明
- 状态栏 meta 在成功时按语言显示「标签配对正确 / 括号配对正确」。
- 说明区更新：新增通用选项说明、导入文件、错误定位、属性换行仅 HTML 生效等。

---

## 三、T34 URL 参数编辑（`mSgym`）

### 1. 参数面板三组选项
- `重复键 保留 / 合并`：默认保留为独立行；选「合并」后同名非空键用逗号连接值（实测 `tag=vue%2Cfrontend`），空 key 行保持独立。
- `编码 自动 / 不编码`：自动时仅对参数 key/value 做 `encodeURIComponent`（UTF-8）；不编码时原样拼接并同时把路径/Fragment 解码展示（实测 `q=中文`）。是否编码始终由用户显式选择。
- `排序 保持原序 / 按键排序`：稳定按键排序，同键多条维持原相对顺序（实测 `empty,page,q,tag,tag`）。

### 2. 工具栏动作（对齐设计 `应用修改/复制 URL/还原` + ⌘⏎ 应用）
- `应用修改`：把当前合成结果写回 URL 输入框并重新解析。
- `复制 URL`：复制当前选项下的合成 URL。
- `还原`：放弃行内编辑，按当前 URL 输入重新解析。
- 参数面板右侧显示真实统计：`重复键 N · 空值 N · 已解析 N 个参数`。

### 3. 其他
- 保持既有结构信息卡、逐行勾选/增删/上下移；无效 URL 时清空 `base/rows`（保留 fix-f3 的陈旧数据修复），只显示失败与修正方向，输入保留。
- 合成预览改为单一「当前选项」输出，避免设计之外的重复预览，并新增「重复键与编码规则」折叠说明。

---

## 四、T35 curl / fetch / Axios 转换（`ndB0M` / `E6e87` / `sZOGq` / `Pu4BY`）

### 1. 方向预设（对齐设计三选项）
- 用 `方向 curl → fetch / fetch → curl / curl → Axios` 取代原来的源/目标两个下拉与交换按钮；`sourceFmt/targetFmt` 由预设派生。

### 2. 目标语言 JavaScript / TypeScript
- fetch 目标改为设计中的 async 函数形态：`async function request() { const res = await fetch(...) ; return res }`。
- TypeScript 目标追加类型标注：fetch `async function request(): Promise<Response>` + `const res: Response`；Axios `import type { AxiosResponse } from 'axios'` + `const res: AxiosResponse = await axios(...)`。
- 目标为 curl（bash）时该选项置灰并说明原因（与 `E6e87` 设计里 `目标语言 opacity=0.45` 一致）。

### 3. 凭证处理（默认脱敏，核心安全项）
- 凭证类 header 集合：`authorization / proxy-authorization / cookie / x-api-key / x-auth-token / x-access-token / api-key / auth-token / x-csrf-token / x-xsrf-token`。
- `保留占位`（默认）：值替换为 `<REDACTED>`，保留 scheme（`Bearer <REDACTED>` / `Basic <REDACTED>`）；中间预览与生成代码均使用脱敏后的值，**默认不会输出原值**。
- `移除`：从输出中删除该 header（实测输出不再含 `Authorization`）。
- `-u/--user` 转出的 `Authorization: Basic <base64>` 同样被脱敏（实测 `dXNlcjpwYXNz` 不再出现）。

### 4. 缩进 2 / 4 空格
- 应用于生成代码的层级缩进、curl 续行缩进，以及 axios `data` 对象的缩进（实测 4 空格时 `headers` 内层为 8 空格）。

### 5. 代码生成合法性（保持 fix-f3 的 D1 修复）
- 保留 `SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/`，`Content-Type` 等含连字符的键仍统一 `jsQuote`。
- 实测生成结果：`node --check` 通过 fetch/axios 的 JS 目标，`bash -n` 通过 curl 目标，`tsc` 通过 fetch/axios 的 TS 目标。

### 6. 其他
- 新增设计中的「中间预览」摘要条（method / URL / header 数 / body 类型）。
- 方向切换后点「载入示例」即载入对应方向的示例；`sig` 含方向/目标语言/凭证/缩进，改选项进入 stale，G04 生效。
- 失败保留输入并提示「输入已保留，请修正后重新转换」。

---

## 五、设计对齐与真实性说明（未实现项 / 取舍）

- T31：按设计只保留 4 组优化选项；未保留原「去掉属性引号」选项（XML 必须带引号，且设计无此项）。「合并空 `<g>`」未实现——空的 `<g>` 不渲染任何内容，删除它并不会改变视觉，若实现也不会作为「改变视觉」提示；因此视觉变化提示只由真实取整与移除 `viewBox` 触发，避免虚构原因。
- T32：「属性换行」在 CSS/JS 下明确置灰，不做语义不明的假实现；「保留空行」只增删空行、不改语义。
- T34：合并/排序/编码都作用在「输出合成」上，编辑表仍保留原始行，便于还原。
- T35：`-F/--form` multipart 文件引用与「不支持 shell 表达式即中断」属于设计变体，但不在本轮必做（凭证/缩进/目标语言/方向预设）范围内；现状仍是**明确警告并提示人工处理**，不猜内容、不伪造运行时行为（未读取本地文件）。`--data-binary @file`、`$(...)` 同样进入警告清单。

---

## 六、自测命令与关键输出

完整日志：`/tmp/g5/verify.log`（脚本：`/tmp/g5/t31_test.py`、`t32_test.py`、`t32_crlf.py`、`t34_test.py`、`t35_test.py`、`final_interact.py`）。

### 1) 四个页面 probe（无 error / pageerror / 失败请求）
```
$ python3 audit/tools/probe.py /tools/svg
svg           status=200 console=[] pageerrors=[] failed=[]
$ python3 audit/tools/probe.py /tools/html-format
html-format   status=200 console=[] pageerrors=[] failed=[]
$ python3 audit/tools/probe.py /tools/url-params
url-params    status=200 console=[] pageerrors=[] failed=[]
$ python3 audit/tools/probe.py /tools/curl-convert
curl-convert  status=200 console=[] pageerrors=[] failed=[]
```

### 2) T31 XSS 阻断（含 `onload`/`script` 的 SVG）
```
unsafe  -> {"blockedDiv":1,"img":0,"banner":"检测到 4 处不安全内容：预览已阻断，源码保持原样，不执行、不加载任何外部资源。\n定位第 2 行"}
precise -> {"warn":"本次优化把 12.345678 → 12.35 等坐标取整为 2 位小数：可能改变渲染结果，请对比预览后再下载。\n保留 6 位小数","img":1}
normal  -> {"img":1,"warn":0,"errorBanner":0,"stats":"字节 291 → 257 -34 · -12% / 标签数 4 → 4 节点未删除 / 空白字符 33 → 23 已压缩 / title·desc 保留 可访问性完整"}
点击「保留 6 位小数」后 warn 1 → 0，且出现「6 位」选项
```

### 3) T32 选项与错误定位
```
HTML 示例 -> "<!DOCTYPE html>\n<html lang=\"zh\">\n  <head>..."
属性换行=每行一个 -> ["      id=\"app\"", "      class=\"main\""]
保留空行=是 -> "<div>\n\n  <p>a</p>\n\n</div>\n"
CRLF（经剪贴板核验模型值）-> {"has_crlf":true,"crlf_count":24}
语法错误 -> banner "第 1 行：<p> 未闭合（在第 1 行的 </div> 之前）（格式化已停止，未输出部分结果）\n定位第 1 行"，output 为空
点击「定位第 1 行」-> textarea 选区 [0,23]
```

### 4) T34 选项
```
auto       -> https://api.example.com/search?q=%E4%B8%AD%E6%96%87&page=2&tag=vue&tag=frontend&empty=#results
merge      -> ...?q=%E4%B8%AD%E6%96%87&page=2&tag=vue%2Cfrontend&empty=#results
merge+sort -> ...?empty=&page=2&q=%E4%B8%AD%E6%96%87&tag=vue%2Cfrontend#results
不编码     -> ...?empty=&page=2&q=中文&tag=vue&tag=frontend#results
无效 URL   -> cards=0，status=失败，输入保留
```

### 5) T35 生成 + 语法校验
```
fetch(JS) ->
  async function request() {
    const res = await fetch('https://api.example.com/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer <REDACTED>',
      },
      body: JSON.stringify({"name":"devkit","role":"admin"})
    })
    return res
  }
凭证处理=移除 -> 输出中不再包含 Authorization
fetch(TS) -> async function request(): Promise<Response> { const res: Response = await fetch(...) }
curl      -> curl '...' \ -X POST \ -H 'Content-Type: application/json' \ -H 'Authorization: Bearer <REDACTED>' \ --data-raw '...'
Axios(TS) -> import type { AxiosResponse } from 'axios' ; const res: AxiosResponse = await axios({...})
Axios(JS,4空格) -> axios({\n    url: ...,\n    headers: {\n        'Content-Type': ...

$ node --check t35_fetch.mjs   # OK
$ node --check t35_axios.mjs   # OK
$ bash -n     t35_curl.sh      # OK
$ tsc -p tsconfig.json         # OK（fetch.ts + axios.ts）
```

### 6) 其他交互核验
```
T31「仅查看源码」/「定位第 2 行」点击无 pageerror
T35 目标为 curl 时「目标语言」选项置灰（.t35__opt--off 数量 = 1）
pageerror 全程为空
```

---

## 七、结论

- T31 已从「剥离后仍预览」改为设计要求的「检测到不安全内容即阻断预览、仅可查看/定位源码」，并补齐 `保留 viewBox`、`小数位(2/3/4/6)`、标签数/空白统计；「优化改变视觉」提示只在真实发生取整或移除 viewBox 时出现，且可用「保留 6 位小数」一键恢复。
- T32 补齐 `换行 / 属性换行 / 保留空行`、`导入文件` 与语法错误「定位第 N 行」；不能可靠实现的属性换行在 CSS/JS 下置灰而非假实现。
- T34 补齐 `重复键合并 / 编码(自动·不编码) / 按键排序` 与 `应用修改 / 复制 URL / 还原`，并保留无效 URL 清空陈旧结果的修复。
- T35 补齐 `方向预设 / 目标语言 / 凭证处理(默认脱敏) / 缩进`，生成代码继续通过 `node --check`（JS）、`bash -n`（curl）、`tsc`（TS）校验。
- G04 待更新模式与失败保留输入、给出修正方向均已落实。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/g5-tools-t31-t32-t34-t35.md
