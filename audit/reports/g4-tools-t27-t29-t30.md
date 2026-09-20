# G4 工具修复报告 · T27 / T29 / T30

范围：补全三个 Web 工具的缺失控件、对齐设计推断/换算/对比度规则，并遵守 G04「改参数 → 旧结果待更新、复制禁用」。
仅改动以下文件（未触碰 `app/utils/json.ts`、`useToolRun.ts`、`usePrefs.ts`、`useTransfer.ts`、`Dk*.vue`、`SplitPanes.vue`、`FileDrop.vue`、`CommandPalette.vue`、`app/error.vue`、`design.pen`、`docs/**`）：

- `devkit/app/components/tools/t27-json2ts.vue`
- `devkit/app/components/tools/t29-css-units.vue`
- `devkit/app/components/tools/t30-color.vue`

设计依据（只读提取）：
- `python3 audit/tools/pen.py dump/text <节点ID>`：T27 `Qy9fi / L4CzT / HacG2`，T29 `s2aSl / ceWdh / U3ers`，T30 `AI8xy / MB99A / Tv8mb / XRVJD`。
- 设计注释（`docs/design-backups/before-dedup-*.pen` 内「设计注释 · T2x」）：明确「参数联动 / 待更新 / 复制不含格式名或表头 / 不写入本地存储」等语义。

---

## 结论摘要

| 工具 | 本次补齐（设计已列出的控件） | 规则修正 | G04 |
|---|---|---|---|
| T27 JSON→TS | 日期字段、空数组策略、空对象策略、数组联合类型、「调整字段类型」弹层、导入文件、下载 .ts | 字段 `null → unknown`；空对象 `→ Record<string, unknown>`（可切 `{}`）；空数组 `unknown[] / any[] / 手动指定`；混合数组按首次出现合并为联合类型（可切换取首项）；可选属性 `保持原样 / 全部可选 / 全部必填`（保持原样＝数组内缺失键才可选）；`readonly` | 修改 JSON 或任一参数后旧输出标「待更新」、复制/下载禁用，点「生成类型」或 ⌘⏎ 恢复 |
| T29 CSS 单位 | 小数位 2/3/4、小数处理（去掉多余零/固定位数）、零值单位（0/0px）、逐行勾选、全选/取消、复制表格/复制已勾选、导入文件、下载 .css | 批量语义由「按源单位全量替换」改为「逐行独立识别 + 仅换算勾选行，未勾选行保持原值并显示 —」 | 改基准/输入/勾选后标「待更新」、复制禁用，点「换算」或 ⌘⏎ 恢复 |
| T30 颜色/对比度 | 输入格式（HEX/RGB/HSL）、不透明度（%）、复制全部格式、6 种色值（含 HEX8/HSLA）、建议替代色、恢复上一个有效色、下载 | 对比度按 WCAG 2.1 相对亮度真实计算；4 项门槛结论（AA/AAA 正文与大字）逐项判定；低对比给出保持色相/饱和度的真实替代色 | 改颜色/不透明度/背景后标「待更新」、复制禁用，点「转换」或 ⌘⏎ 恢复 |

三个页面 `probe` 均无 `console.error` / `pageerror` / 失败请求；`npx nuxt typecheck` 输出中不含这三个文件的报错（仅存在与本次无关的 `t35-curl-convert.vue` 既有报错）。

---

## T27｜JSON 转 TypeScript 类型

### 新增控件（与 `Qy9fi / L4CzT / HacG2` 参数面板逐项对应）

- 目标：`interface / type`
- 根类型名：标识符 + 保留字校验（沿用）
- 可选属性：`保持原样 / 全部可选 / 全部必填`
- 只读：`关闭 / readonly`
- 日期字段：`保持 string / 转为 Date`
- 空数组策略：`unknown / any / 手动指定`
- 空对象策略：`Record<string, unknown> / {}`
- 数组联合类型：`联合类型 / 取首项类型`
- 参数面板右侧「调整字段类型」：列出所有推断不确定字段的 JSON 路径（`$.email`、`$.tags`、`$.values`、`$.items[].note`…）、原因、当前自动类型，可逐字段填写覆盖类型；「应用并重新生成」「全部清除」
- 工具条：`生成类型 / 复制 / 下载 .ts`；输入面板：`载入示例 / 导入文件 / 清空`

### 推断规则修正（实测输出）

输入（载入示例）：
```json
{"id":1000000000000000001,"name":"陈立","createdAt":"2024-01-01T09:00:00Z","active":true,"email":null,"flags":[true,1,0],"tags":[],"meta":{},"scores":[1,"a"],"address":{"city":"杭州","zip":"310000","geo":{"lat":30.2741,"lng":120.1551}}}
```
默认输出（关键行）：
```ts
email: unknown
flags: (boolean | number)[]
tags: unknown[]
meta: Record<string, unknown>
scores: (number | string)[]
```
对照设计：`email 全为 null 按 unknown`、`tags/items → unknown[]`、`meta → Record<string, unknown>`、混合数组按首次出现顺序合并——全部一致。

其余实测：
- 空数组策略 `any` → `tags: any[]`；空对象策略 `{}` → `meta: {}`；数组联合类型 `取首项类型` → `flags: boolean[]`；日期 `转为 Date` → `createdAt: Date`；只读开 → `readonly id: number`。
- 可选属性「保持原样」：`{"items":[{"a":1,"note":"x"},{"a":2}]}` → `a: number`（各元素都有）、`note?: string`（仅部分元素出现，标可选），与 `HacG2` 文案「note 仅出现在部分元素，已标记为可选属性」一致。
- `{"values":[1,"x",true,null]}` → `values: (number | string | boolean | null)[]`，与 `HacG2` 文案一致；字段级 `null` 则为 `unknown`（`Qy9fi`）。
- 空数组「手动指定」：对 `{"tags":[]}` 选择该策略后，在弹层为 `$.tags` 填 `string` → `tags: string[]`；清除后回退 `tags: unknown[]`。

---

## T29｜CSS 单位换算

### 新增控件（与 `s2aSl / ceWdh / U3ers` 对应）

- 根字号 / 父字号（> 0 校验，单位固定 px）
- 小数位：`2 位 / 3 位 / 4 位`
- 小数处理：`去掉多余零 / 固定位数`
- 零值单位：`0 不带单位 / 0px`
- 目标单位：`px / rem / em`（设计画板未画目标单位控件；但设计同时提供了「复制结果 / 下载 .css」，没有目标单位无法产出确定的 CSS，因此补一个明确的目标单位选择，并在说明区写明其作用）
- 逐行输入 + 结果表：列 `原值（含勾选框）/ px（根字号 n）/ rem / em（父字号 n）/ 操作（复制该行）`
- 提示条：`N 行中有 M 行未勾选，将保持原值不参与换算…` + `全选 N 行`
- `复制结果 / 下载 .css / 复制表格 / 复制已勾选`
- 输入面板：`载入示例 / 批量示例 / 导入文件 / 清空`
- 非法基准：结果区显示「缺少有效的换算基准 / 修正根字号（例如 16px）后重新换算，输入内容已保留」+「恢复默认 16px」（`U3ers`）

### 批量语义（与设计一致）

- 每行独立扫描 `数字+单位`；只有勾选的行换算，未勾选行在表中显示 `—` 且 CSS 输出保持原值。
- 状态栏显示 `已换算 / 跳过` 计数；`复制已勾选` 只复制勾选行数值，`复制表格` 复制全部数值，均不含表头与单位说明（设计注释「复制：复制数值，不含表头与单位说明」）。

---

## T30｜颜色转换与对比度

### 新增控件（与 `AI8xy / MB99A / Tv8mb / XRVJD` 对应）

- 输入格式：`HEX / RGB / HSL`（切换会把当前颜色改写成所选写法；解析本身兼容全部写法）
- 颜色 + 不透明度（%）+ 背景色 + 合成背景色
- 色值格式：`HEX / HEX8 / RGB / RGBA / HSL / HSLA`，逐行可复制 + `复制全部 / 复制全部格式`
- 对比度与预览：`Aa` + 正文示例，比值与四项门槛结论（通过/未达 AA 正文、AA 大字、AAA 正文、AAA 大字）
- 建议替代色：低对比时按「保持色相/饱和度、调整亮度并用同一公式实算」给出候选（含比值、复制、采用）；`Tv8mb` 的「采用建议色 #xxx」入口
- 恢复上一个有效色：前景/背景/合成背景解析失败时提供 `恢复上一个有效色 #xxxxxx`（`XRVJD`）
- 透明色提示条 + 「改为不透明」（`MB99A`）；下载

### 对比度真实性（独立 node 复算，见下）

- `#2563eb / #ffffff = 5.1686`，页面 5.17；
- `#9ca3af / #ffffff = 2.5388`，页面 2.54；
- `#2563eb @60%` 合成 `#7ca1f3`，对白 `2.5457`，页面 2.55 且 HEX（合成）＝`#7ca1f3`、HEX8＝`#2563eb99`、RGBA＝`rgba(37, 99, 235, 0.6)`、HSLA＝`hsla(221, 83%, 53%, 0.6)`，与 `MB99A` 一致。
- 建议色：`#9ca3af/#fff` 下页面给 `#6e7789 = 4.50:1`、`#525966 = 7.05:1`，node 独立复算完全一致。

---

## G04 行为（三个工具一致）

- 主操作按钮 + 快捷键：T27 `生成类型 / ⌘⏎`、T29 `换算 / ⌘⏎`、T30 `转换 / ⌘⏎`。
- 修改输入或任一参数后不静默沿用旧结果：`useToolRun` 将状态置为 `stale`（「输入或参数已修改，结果待更新」），复制/下载/复制表格等按钮 `disabled`；重新执行成功后恢复 `ok`。
- 未修改 `useToolRun.ts`，直接沿用 `run.markOk / markFail / markIdle`。

---

## 自测记录

### 1. 页面探针（无控制台错误）

```
$ python3 audit/tools/probe.py /tools/json2ts
status 200 console [] pageerrors [] failed []
$ python3 audit/tools/probe.py /tools/css-units
status 200 console [] pageerrors [] failed []
$ python3 audit/tools/probe.py /tools/color
status 200 console [] pageerrors [] failed []
```
截图：`audit/evidence/g4-json2ts.png`、`g4-css-units.png`、`g4-color.png`。

### 2. Playwright 交互复算

T27（`/tmp/g4_t27f.py`）：
```
default ok
all controls ok
optionality+null union ok
manual override ok
stale ok
PAGE ERRORS: []
T27 FINAL OK
```

T29（`/tmp/g4_t29.py` 等）：
```
default rows: [['16px','16px','1rem','0.8em'], ['32px','32px','2rem','1.6em'],
               ['1.5rem','24px','1.5rem','1.2em'], ['0.5em','10px','0.63rem','0.5em']]
after uncheck row1: ['32px','—','—','—']
fixed 3: ['16px','16.000px','1.000rem','0.800em']
zero unitless: 0em | 0 | 0 | 0      zero 0px: 0em | 0px | 0rem | 0em
stale on param change: True   复制结果 disabled on stale: True
invalid root msg: True True   after restore error gone: True
CSS(target rem): 'padding: 1rem;\nmargin: 1.5rem;'
TABLE: '16px\t16px\t1rem\t0.8em\n1.5rem\t24px\t1.5rem\t1.2em'
CHECKED ONLY: '16px\t16px\t1rem\t0.8em'
batch: rows 12, warning '3 行未勾选', 全选 12 行 → '已换算 12 行 / 12 个数值，跳过 0 行'
```

T30（`/tmp/g4_t30.py`、`/tmp/g4_t30b.py`）：
```
default ratio: 5.17   grades: 通过 AA 正文 / 通过 AA 大字 / 未达 AAA 正文 / 通过 AAA 大字
low ratio: 2.54       suggestions: #6e7789 4.50:1  |  #525966 7.05:1
alpha ratio: 2.55     formats: HEX（合成）#7ca1f3 / HEX8 #2563eb99 / RGBA rgba(37, 99, 235, 0.6) …
copy all: 'HEX（合成） #7ca1f3\nHEX8 #2563eb99\nRGB rgb(37, 99, 235)\nRGBA rgba(37, 99, 235, 0.6)\nHSL hsl(221, 83%, 53%)\nHSLA hsla(221, 83%, 53%, 0.6)'
invalid → 恢复上一个有效色 #2563eb ok；切换 RGB → rgba(37, 99, 235, 0.6)
低对比「采用」后 ratio 2.54 → 4.50
PAGE ERRORS: []
```

### 3. 独立复算（node，与组件实现无关的第二份实现）

```
$ node /tmp/g4_verify.mjs
blue #2563eb / #fff : 5.1686
gray #9ca3af / #fff : 2.5388
gray #999999 / #fff : 2.8490
composite #2563eb@60% -> #7ca1f3 ratio vs #fff: 2.5457
suggest 4.5: { hex: '#6e7789', ratio: 4.5036 }
suggest 7.0: { hex: '#525966', ratio: 7.0480 }
```
T29 复算（node）与页面表格逐格一致：`16px→1rem/0.8em`、`32px→2rem/1.6em`、`1.5rem→24px/1.2em`、`0.5em→10px/0.63rem`。

### 4. 类型检查

```
$ cd devkit && npx nuxt typecheck
$ grep -nE "t27-json2ts|t29-css-units|t30-color" /tmp/g4_typecheck.log
no errors in my files
```
（日志中仅剩本次未触碰的 `t35-curl-convert.vue` 既有报错。）

---

## 真实性说明 / 与设计稿的取舍

1. **未伪造数据**：所有色值、比值、换算、计数均由当前输入实算；无网络请求、无本地存储写入（页面提示「只在浏览器内存中处理」）。
2. **建议替代色与设计示例 hex 不同但真实**：设计 `Tv8mb` 画的是预设 `#6B7280 (4.83:1)`、`#4B5563 (7.56:1)`；本实现保持原色相/饱和度、二分调整亮度到「刚好达到门槛」，得到 `#6e7789 (4.50:1)`、`#525966 (7.05:1)`。两者都满足 AA/AAA 门槛；本实现不是抄设计里的固定值，而是现场计算，故允许具体 hex 不同。
3. **T30 四项门槛逐项实算**：设计 `MB99A`（2.55:1）画板把「通过 AA 正文/大字」也标为通过，与 2.55 < 3 的 WCAG 事实冲突；本实现按公式输出「未达」，以真实性优先。
4. **T29 目标单位**：设计画板未画该控件，但工具条有「下载 .css / 复制结果」；为让输出确定且真实，补了 `目标单位 (px/rem/em)`，并在说明区明确它只影响勾选行的 CSS 改写，不影响 `复制表格/复制已勾选` 的数值。
5. **T29 勾选状态**：改动输入不会自动改变已勾选行（设计注释「勾选状态由你控制，工具不会自动改变它」）；勾选本身属于参数变化，会触发「待更新」，需重新「换算」（设计注释「改基准或勾选后旧结果标为待更新」）。
6. **T27 手动指定**：空数组的「手动指定」填的是元素类型（会补 `[]`）；其它字段填完整类型。该语义在弹层与说明区均有提示，避免歧义。

## 未涉及 / 限制

- 未引入任何新依赖；沿用现有设计令牌（`--warn`、`--warn-soft`、`--surface-subtle`、`--radius` 等）与既有组件（`DkButton / DkInput / DkSelect / DkSegmented / DkCheckbox / DkIcon / DkIconButton / DkField / DkModal / DkEditor / DkStatusBar / SplitPanes`）。
- T27 的 JSON 行列定位仍依赖既有 `jsonErrorPosition`（本次未改动 `json.ts`），部分 V8 新错误消息仍可能只给通用文案；不属于本次授权范围。
- T29 每行含多个数值时会拆成多行展示，但勾选粒度仍为「行」（与设计一致）。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/g4-tools-t27-t29-t30.md
