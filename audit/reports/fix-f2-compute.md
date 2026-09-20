# DevKit 修复报告 · 子代理 F2（计算与解析正确性）

- 修复范围：T03 / T20 / T21 / T24 / T26，共 5 个文件
- 环境：devkit（Nuxt 4，dev server `http://localhost:3000` 已运行）；node v24.11.1；js-yaml 4.3.2；Python Playwright
- 复核脚本：`/tmp/f2/t03.test.mjs`、`/tmp/f2/compute.test.mjs`、`/tmp/f2/verify.py`
- 全量类型检查：`/Users/hao/WebstormProjects/web_tools/devkit && ./node_modules/.bin/vue-tsc --noEmit -p tsconfig.json` → 无输出、退出码 0
- 实测 5 个页面均无 `pageerror` / `console.error`

---

## 1. T03 `[高]` YAML→JSON 静默丢精度

### 问题（audit/reports/r2-tools-t01-t14.md:20）
`yaml.load(..., { schema: yaml.JSON_SCHEMA })` 把 `1234567890123456789` 变成 `1234567890123456800`、把未加引号的 `007` 变成 `7`；页面文案（`t03:424`）却承诺 `007` 不会被自动转成数字。属于静默改数据。

### 改动
- `devkit/app/components/tools/t03-json-yaml.vue:251-253`：新增 `YAML_NUM_TEXT` / `YAML_INF_NAN_TEXT` / `JSON_NUM_TEXT`。
- `t03-json-yaml.vue:255-278`：为 `JSON_SCHEMA` 追加自定义 `int`/`float` 隐式类型（`JSON_SCHEMA.extend({ implicit: [...] })`，不修改全局 schema，T24 不受影响）：
  - 是合法 JSON 数字字面量 → 构造 `RawNumber(raw)`，由 `stringifyJson` 按原文输出（大整数 / `0.10` / `1e3` 不再被改写）；
  - 不是合法 JSON 数字字面量（`007`、`+7`、`0x1A`、`0o17`）→ 按原文保留为字符串；
  - `.inf` / `-.inf` / `.nan` → 仍构造真实 Infinity/NaN，走原有 `findNonFinite` 显式报错路径。
- `t03-json-yaml.vue:302-311`：按“字符串保留”“原文输出”两类生成可见提示，经 `run.markOk` 显示在状态栏 `.statusbar__msg`。
- `t03-json-yaml.vue:460`：同步修正文案，与事实一致。

### 验证一：node 复算
```
$ node /tmp/f2/t03.test.mjs
IN : "id: 1234567890123456789"   OUT: { "id": 1234567890123456789 }   rawKept=["1234567890123456789"]
IN : "code: 007"                 OUT: { "code": "007" }               stringKept=["007"]
IN : "flag: +7"                  OUT: { "flag": "+7" }                stringKept=["+7"]
IN : "hex: 0x1A"                 OUT: { "hex": "0x1A" }               stringKept=["0x1A"]
IN : "e: 1e3"                    OUT: { "e": 1e3 }
IN : "z: 0.10"                   OUT: { "z": 0.10 }
IN : "big: 9007199254740993"     OUT: { "big": 9007199254740993 }     rawKept=["9007199254740993"]
IN : "date: 2024-01-01"          OUT: { "date": "2024-01-01" }
IN : "inf: .inf"                 nonFinite={"path":"inf","kind":"Infinity（.inf）"}
IN : "nan: .nan"                 nonFinite={"path":"nan","kind":"NaN"}
```
对比修复前：`JSON_SCHEMA` 下 `007` → `7`、`1234567890123456789` → `1234567890123456800`（见审核报告）。

### 验证二：playwright 真实页面
```
$ python3 /tmp/f2/verify.py   # 节选
T03.status = "成功"
T03.output = {
  "id": 1234567890123456789,
  "code": "007",
  "flag": "+7",
  "hex": "0x1A",
  "e": 1e3,
  "z": 0.10,
  "big": 9007199254740993,
  "date": "2024-01-01"
}
.statusbar__msg = 2 个标量不是 JSON 数字字面量（如 007），已按字符串保留原文，避免 007 等被改写为数字；1 个数值超出 JS 安全范围（如 1234567890123456789），已按原文输出以保留精度
```
原有报错路径未回归：
```
「不兼容示例」→ 失败：YAML 解析失败：unknown tag !<tag:yaml.org,2002:timestamp> (3:30)…
80: http → 失败：无法静默转换：第 1 行的键 "80" 是 数字，JSON 对象的键必须是字符串（共 1 处）
```

---

## 2. T20 `[高]` 周/月英文名 WED、JUL 被误判为 Quartz 扩展符

### 问题（audit/reports/r3-tools-t15-t26.md:194）
`t20-cron.vue:114` 先用 `/[LW#?]/` 扫描整个字段，`WED`、`JUL` 中的 `W`/`L` 被当作 Quartz 扩展符，导致合法名称报错。另 `t20:122` 在 Quartz 模式下对非日/周字段误报“Unix 五字段方言不支持”。

### 改动
- `devkit/app/components/tools/t20-cron.vue:114`：扫描扩展符前先剥离全部合法名称（JAN-DEC / SUN-SAT），再匹配 `[LW#?]`，名称优先级高于扩展符。
- `t20-cron.vue:122-125`：仅当字段确为「日」「周」时才提示 Unix 不支持；其余字段给出“L/W/# 仅适用于日/周”的准确提示。
- 未触碰 `nextRuns` 中的 `get('year')?.m`（该崩溃修复保留，`t20:319`）。

### 验证一：node 复算
```
$ node /tmp/f2/compute.test.mjs
PASS parseCron("* * * * WED", quartz=false)          unix WED dow = [3]（周三）
PASS parseCron("* * * JUL *", quartz=false)          JUL month = [7]
PASS parseCron("0 0 0 ? * WED", quartz=true)         quartz WED dow = [4]（周三）
PASS parseCron("0 0 0 1 JUL ?", quartz=true)
PASS parseCron("0 0 0 ? * MON,WED,FRI", quartz=true)
PASS parseCron("0 0 12 L * ?", quartz=true)
PASS quartz no-year get(year) undefined (no crash)
EXTRA T20 PASS   # L / LW / nW / n#m / nL 合法；Unix 下 L/#/W 仍报错
```

### 验证二：playwright 真实页面
```
T20.default_title   = "Cron 解析与执行预览 · DevKit"   （未崩溃）
T20.default_status  = 成功；未来执行表 10 行
T20.unix_WED_status = 成功；周行 = ["周","WED","0-7","仅周三"]
T20.quartz_WED_status = 成功；周行 = ["周","WED","1-7","仅周三"]
T20.quartz_JUL_status = 成功
Quartz "0 0 12 L * ?" → 成功；未来执行 2026-09-30、2026-10-31、2026-11-30、2026-12-31…
errors = []
```

---

## 3. T21 `[中]` 日历差在起始为月末时输出负数日

### 问题（audit/reports/r3-tools-t15-t26.md:250）
`t21-date-diff.vue:129-144` 的借位固定取“结束月的上个月”天数。`2026-01-31 → 2026-03-01` 输出 `0 年 1 月 -2 日`；`2026-05-31 → 2026-07-01` 偏小；闰年同样错。

### 改动
- `devkit/app/components/tools/t21-date-diff.vue:129-150`：改为“以起始日锚定、先试加整月、超出则回退一个月再补天”的算法（dateutil relativedelta 同口径）：
  - `addMonths` 对日做月末钳制（`Math.min(d, daysInMonth)`）；
  - 估算总月数后，若候选日 > 结束日则递减月数，直到 ≤ 结束日；
  - 余下天数由两个日期的 UTC 日序相减得到，各分量恒非负。
- 调用方原有的“起止交换 + `calNegative` 符号”逻辑未改，因此交换后显示负号、量值对称。

### 验证一：node 复算
```
$ node /tmp/f2/compute.test.mjs
PASS 2026-01-31 -> 2026-03-01   {y:0,m:1,d:1}   （修复前 -2 日）
PASS 2026-01-30 -> 2026-03-01   {y:0,m:1,d:1}   （修复前 -1 日）
PASS 2024-01-31 -> 2024-03-01   {y:0,m:1,d:1}   （闰年，修复前 -1 日）
PASS 2026-05-31 -> 2026-07-01   {y:0,m:1,d:1}   （修复前偏小 d:0）
PASS 2026-01-31 -> 2026-02-27   {y:0,m:0,d:27}
PASS 2026-02-28 -> 2026-03-31   {y:0,m:1,d:3}
PASS same date                  {y:0,m:0,d:0}
PASS swap 2026-03-01/2026-03-02 → cal={0,0,1}, calNegative=true
PASS swap 2026-01-31/2026-03-01 → cal={0,1,1}, calNegative=true
PASS DST span 2026-03-07/2026-03-09 → cal={0,0,2}
PASS no negative components over 2020-2030 sweep（跨月末/闰年扫描，无负分量）
```

### 验证二：playwright 真实页面
```
$ python3 /tmp/f2/verify.py   # 节选
T21 start=2026-01-31T00:00 end=2026-03-01T00:00 → 日历差 "0 年 1 月 1 日"（无负号）
T21 点击交换 → "−0 年 1 月 1 日"
T21 跨夏令时示例（纽约 2026-03-07 01:00 → 2026-03-09 01:00）：
    总毫秒 "169,200,000 ms" / 日历差 "0 年 0 月 2 日"（47 小时，未被 DST 影响）
status = 成功
```

---

## 4. T24 `[中]` unicode 解码计数恒为 0；值尾部空白被 trim

### 问题（audit/reports/r3-tools-t15-t26.md:266）
- `propUnescape` 的参数类型声明为 `uCount`，实际写 `res.uCount++`，而结果对象字段是 `unicodeDecoded`，于是计数既为 `undefined++`（NaN）又永远读回 0（`t24:26/49/70/95`）。
- `t24:122` 对值调用 `.trim()`，吃掉了 `java.util.Properties` 应保留的尾部空白。

### 改动
- `devkit/app/components/tools/t24-properties-yaml.vue:49`：参数类型改为 `{ errors: string[]; unicodeDecoded: number }`。
- `t24-properties-yaml.vue:70`：`res.unicodeDecoded++`。
- `t24-properties-yaml.vue:122`：删除值上的 `.trim()`（键仍 trim；分隔符后的前导空白已在 119 行跳过）。
- `t24-properties-yaml.vue:590`：文案改为“键两侧空白 trim，值只去除分隔符后的前导空白，尾部空白保留”。

### 验证一：node 复算
```
$ node /tmp/f2/compute.test.mjs
PASS unicodeDecoded count (decode on)   got=2
PASS decoded value                      got="Java 开发"
PASS unicodeDecoded count (decode off)  got=0（输出仍为 \u5f00\u53d1）
PASS trailing whitespace preserved      'a=value   ' → "value   "
PASS leading whitespace after separator stripped
PASS separators/comment                 a= / : / 空白 / # / ! 均正确
```

### 验证二：playwright 真实页面
```
$ python3 /tmp/f2/verify.py   # 节选
输入：app.title=Java \u5f00\u53d1\nnote=x
T24.status = 成功
T24.note   = "已按选项解码 2 处 \uXXXX 转义"   （修复前此条不出现）
T24.output = app:
               title: "Java 开发"
             note: "x   "                        （尾部空白保留）
```

---

## 5. T26 `[高]` classifier 顺序双向颠倒；不支持的 Gradle 声明被静默丢弃

### 问题（audit/reports/r3-tools-t15-t26.md:228, 239）
- Maven→Gradle 输出 `g:a:classifier:version`，Gradle→Maven 把 `g:a:1.0:sources` 解析成 `version=sources / classifier=1.0`（`t26:89-97, 166-171`）。Gradle 紧凑坐标规范顺序是 `group:name:version:classifier`。
- `t26:132-133` 对不匹配 `GRADLE_LINE_RE` 的行直接 `continue`，混排时 map 形式等声明被静默丢弃。

### 改动
- `devkit/app/components/tools/t26-maven-gradle.vue:91,94`：Maven→Gradle 统一为 `${g}:${a}:${version}:${classifier}`（含缺 version 占位场景）。
- `t26-maven-gradle.vue:177-180`：Gradle→Maven 4 段坐标解析为 `version=parts[2]`、`classifier=parts[3]`。
- `t26-maven-gradle.vue:116-120`：新增 `GRADLE_DECL_RE`（已知 configuration 前缀）。
- `t26-maven-gradle.vue:136-142`：`GRADLE_LINE_RE` 不匹配但形似依赖声明的行，`matched++` 并写入「需人工处理清单」，给出可见提示，不再静默丢弃。
- `t26-maven-gradle.vue:161`、`386-387`：错误文案与用法说明同步为 `g:a:version[:classifier]`。

### 验证一：node 复算
```
$ node /tmp/f2/compute.test.mjs
PASS maven->gradle with classifier            "g:a:1.0:sources"
PASS maven->gradle missing version+classifier "g:a:${version}:sources"
PASS gradle->maven 4 parts  {g:"g",a:"a",v:"1.0",c:"sources"}   （修复前 v=sources,c=1.0）
PASS gradle->maven 3 parts  {g:"g",a:"a",v:"2.0",c:null}
PASS mixed deps count = 2；mixed manual count = 2
PASS manual lists map form / version catalog
```

### 验证二：playwright 真实页面
```
$ T26 Maven → Gradle
输入 classifier=sources, version=33.1.0-jre
输出：implementation 'com.google.guava:guava:33.1.0-jre:sources'   （顺序正确）

$ T26 Gradle → Maven，混排：
implementation 'g:a:1.0:sources'
implementation group: 'x', name: 'y', version: 'z'
testImplementation 'j:k:2.0'
状态栏 msg = "已转换 2 条依赖；另有 1 条需人工处理（见下方清单）"
输出 <dependency> g/a <version>1.0</version> <classifier>sources</classifier>
人工清单 = ['不支持的依赖声明（已跳过）："implementation group: \'x\', name: \'y\', version: \'z\'"；仅支持字符串坐标 g:a:version[:classifier] 或 project(...)']

仅含不支持声明时：失败："1 条声明全部需要人工处理，没有可自动转换的内容（见下方清单）"
```

---

## 回归范围
- 5 个页面真实加载 / 交互，`pageerror` 与 `console.error` 均为空。
- T20 原有崩溃修复（`get('year')?.m`）保留，Unix/Quartz 两种方言均正常出 10 次执行。
- T03 原有非字符串键、YAML 标签、`.inf/.nan` 显式报错路径保留。
- T24 `yaml.JSON_SCHEMA` 未被 T03 的 `extend` 影响（`extend` 返回新 Schema）。
- 类型检查 `vue-tsc --noEmit` 通过（无输出、退出码 0）。

## 未在本次范围内（未改动）
- T24「YAML→Properties 静默丢弃空对象/空数组」（E7，`t24:347-354`）：不在本子代理的 5 项任务清单内，且涉及“值类型策略”交互设计，未改动。
- T26「scope→configuration 映射无确认 UI」（D6）：不在任务清单内，未改动。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/fix-f2-compute.md
