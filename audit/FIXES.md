# DevKit 修复报告（对应 audit/AUDIT-REPORT.md）

日期：2026-09-20 ｜ 范围：只修缺陷，不新增设计稿缺失功能 ｜ 全部改动均经实测验证

## 0. 结果一览

| 项 | 修复前 | 修复后 |
|---|---|---|
| P0 阻断缺陷 | 5 | **0** |
| 全站路由巡检（59 条 × 明/暗） | 1 条真实 pageerror（/tools/cron） | **0 条**（仅 404 路由本身的预期告警） |
| 类型检查 | 入口不可用；绕过入口 51 个错误 | `npm run typecheck` **可运行且 0 错误** |
| 修改文件 | — | 33 个源码文件 + 新增 tsconfig.json / app/types/shims.d.ts |

修改文件清单见文末。

---

## 1. P0 阻断缺陷（全部已修 + 已验证）

### P0-1 T20 Cron 打开即崩 —— `get('year')` 空引用
- 改动：`devkit/app/components/tools/t20-cron.vue:319` → `get('year')?.m`
- 验证：`/tools/cron` 现渲染正常，状态栏「成功 · 表达式有效 · 未来 10 次执行已按 Asia/Shanghai 计算」，无 pageerror。

### P0-2 404 错误页初始化失败、分支判断失效
- 改动：`devkit/app/error.vue` 补 `import { getTool } from '~/data/tools'`；新增 `statusCode` 计算属性（`Number(error?.statusCode ?? 500)`）并据此判断 404；`goSearch()` 改为先 `palette.show()` 再 `clearError`。
- 验证：`/tools/does-not-exist` → H1「工具不存在或链接已失效」、描述为 404 专用文案、「常用工具」正常列出 5 个工具；点击「搜索工具（⌘K）」跳回首页并打开命令面板。

### P0-3 `useToolRun` 假待更新
- 改动：`devkit/app/composables/useToolRun.ts` `lastSig` 初始化为当前签名，watch 回调增加 `if (sig === lastSig) return`。
- 验证：T01「载入示例」后状态为「成功」，结果复制/下载按钮 `disabled=false`；真实改输入仍会正确转为「待更新」。

### P0-4 SplitPanes 分栏比例错误
- 改动：`devkit/app/components/SplitPanes.vue` → `.split__pane{flex:1 1 0}` + 新增 `.split__left{flex:0 0 auto}`；移动端改为 `flex:1 1 auto`。
- 验证：1440 下容器 1140px → 左 570 / 右 561（≈50/50），拖动手柄正常。

### P0-5 只读结果编辑器「复制」永久禁用
- 改动：`devkit/app/components/DkEditor.vue:81` 复制按钮改为 `:disabled="!modelValue || stale"`（readonly 不再禁用复制）。
- 验证：T01 结果面板复制按钮 `disabled=false`。

---

## 2. 真实性与“假成功”（子代理 F1 + 复核）

| 问题 | 改动 | 验证 |
|---|---|---|
| T13 预设假标「RFC 4231 TC1」 | `t13-hmac.vue`：期望值与示例改为真 TC1（key=0x0b×20、data=`Hi There`、SHA-256 `b0344c61…cff7`），密钥编码自动切 Hex | node crypto 复算一致；页面「载入示例」→ 徽标「与期望一致」 |
| T15 SM2 公钥不校验曲线点 → 假成功 | `t15-sm2.vue`：`pubErr` 增加 `sm2.verifyPublicKey()` 曲线点校验 | 离曲线点被拦截并报错；合法压缩/非压缩公钥回归通过 |
| T15 空明文 C3 校验失败被当成功 | `t15-sm2.vue`：新增独立 C3 复核（SM3(x2‖y2)），失败走 `markFail` | 篡改 C3 → 「解密失败：C3 校验未通过」；合法空明文 → 正常 |
| T33「被篡改签名」示例实际未篡改 | `t33-jwt.vue`：改为篡改 Payload（`sub: devkit-demo → devkit-admin`），保留签名段；`decode()` 重置 `verifyResult` | 独立复验：篡改示例 → `t33__vres--bad`「签名不匹配」；有效示例 → `--ok`「签名验证通过（HS256）」 |
| 设计稿密码学画板写「演示数据/待验证」 | 未改（属设计稿，见“未做”） | — |

## 3. 计算与解析正确性（子代理 F2 + 复核）

| 问题 | 改动 | 验证 |
|---|---|---|
| T03 YAML→JSON 静默丢精度（`007`→`7`、19 位整数变尾 00） | `t03-json-yaml.vue`：自定义 `int/float` 隐式类型，合法 JSON 数字走 `RawNumber` 原样输出，非数字字面量按字符串保留，并在状态栏说明 | 页面实测输出 `{"id": 1234567890123456789, "code": "007", "z": 0.10}` + 真实提示文案 |
| T20 `WED`/`JUL` 被误判为 Quartz 扩展符 | `t20-cron.vue`：名称解析优先级修正 | 由 F2 实测（cron 页面正常） |
| T21 月末起始日历差出现负日 | `t21-date-diff.vue`：修正年月日差算法 | 页面示例 91,800,000 ms 正常 |
| T24 `\uXXXX` 解码计数恒为 0、尾部空白被 trim | `t24-properties-yaml.vue` | 页面状态栏显示真实计数 |
| T26 classifier 顺序双向颠倒 | `t26-maven-gradle.vue` | 独立复验：`implementation 'com.foo:bar:1.2.3:sources'` ✅ |

## 4. Web / 接口 / 文件 / 离线（子代理 F3）

| 问题 | 改动 | 验证 |
|---|---|---|
| T35 生成代码语法错误（header 键含 `-` 未加引号） | `t35-curl-convert.vue:229` `SAFE_KEY` 改为合法 JS 标识符 `/^[A-Za-z_$][A-Za-z0-9_$]*$/` | `node --check` 通过（fetch / axios / params 三处） |
| T34 无效 URL 仍显示旧结果 | `t34-url-params.vue`：catch 中清空结构并报错 | 结构卡 3 → 0，输入保留 |
| T36 缺 424 | `t36-http-status.vue`：补 424，并补 305/306 废弃说明 | 搜索 424/305/306 命中，共 63 条 |
| T38 无「移除文件」（`clearFile` 死代码） | `t38-image-compress.vue`：接入「移除」按钮 | 上传后出现、点击后回到空态 |
| offline 重试空操作 + 监听泄漏 + 文案不实 | `offline.vue`：重试改为真实探测（重新读取在线状态 + HEAD 自检），成对移除监听，文案改为「不做离线预缓存」 | 监听 +2/-2；联网/断网分别给出实测结论 |

## 5. 共享基建与工程

| 问题 | 改动 | 验证 |
|---|---|---|
| 大整数 JSON 哨兵串冲突（`"@@raw:123@@"` 变数字） | `app/utils/json.ts`：每次解析生成随机前缀，用户字符串不可能冲突 | node 单测 11/11 通过（含 NUL、字面量 `\\u0000`、指数、嵌套） |
| JSON 语法错误行列定位偏移 | `parseJson` 先用原文 `JSON.parse` 校验 | `{\n"a":1\n"b":2\n}` → 第 3 行第 3 列（正确） |
| 偏好设置刷新后失效 | `usePrefs.ts`：`onMounted` 重新从 localStorage 载入 | 写入 `theme:dark, codeFontSize:18` 后 reload → `html.dark=true`、`--code-font-size:18px` |
| G01 跨工具传递 7/10 目标静默失败 + 载荷残留注入 | `useTransfer.ts`：目标只列真正实现接收的 3 个工具；载荷一次性取用 + 目标匹配 + 5 分钟有效期 | 菜单只剩可用目标；载荷正确进入 json-diff；进入 json-yaml 无泄漏注入 |
| 类型检查入口不可用 | 新增 `devkit/tsconfig.json`、`package.json` 增加 `typecheck` 脚本、安装 `vue-tsc`；新增 `app/types/shims.d.ts` 声明 `sm-crypto/jsbn`；修掉 51 个类型错误 | `npm run typecheck` → 0 errors |
| 无障碍 | `DkSwitch` 增 `label`（3 处设置项传入）；`DkModal` 与 `CommandPalette` 增加焦点陷阱 + 文档级 Esc；`DkModal` danger 样式补齐 | 开关有 aria-label；面板/弹层 Tab 不外逃、Esc 可靠关闭 |
| FileDrop 拖入不校验类型、单个超限整批拒绝 | `FileDrop.vue`：按 `accept` 逐文件校验、超限/类型不符逐个 reject，其余仍交付 | 合成拖入 `.txt`+`.png` → .txt 被拒、.png 正常进入 |

---

## 6. 回归验证

- **全站巡检**：`audit/tools/crawl.py` 59 条路由 × 明/暗两种主题 → 浅色 flagged 3、深色 flagged 3，且全部是 404 路由自身的预期 console 记录（HTTP 404 + Nuxt dev 错误浮层 iframe 提示），**pageerror 为 0**。
- **工具冒烟**：24 个工具页「载入示例 + 执行」全部产出真实结果且无 pageerror（cron / sm2 / sm4 / sm3 / hmac / jwt / maven-gradle / date-diff / properties-yaml / stack-trace / json2java / curl-convert / url-params / qrcode / regex-test …）。
- **类型检查**：`npm run typecheck` → 0 errors（仅剩 vue-router volar 插件解析提示，非类型错误）。
- **构建**：子代理 F1 执行 `nuxt build` 通过。

## 7. 未做的部分（需要你确认是否继续）

1. **设计稿侧问题未改**：R01/R03 适配稿仍是旧版 24 工具首页；多张密码学画板里的「演示数据/待验证」文案。这些要改 `design.pen`（Pen MCP 写操作），属设计返工，风险与工作量都较大。
2. **设计还原类缺失（功能新增，不是缺陷）**：S04 收藏表格化、S05 分组切换、S07/S08 内容补全、T27/T29/T30/T31/T32/T34/T35 的缺失控件等。
3. **无 PWA 离线**：本次只让 `/offline` 文案与能力一致 + 重试真实；真正离线可用需要接 Service Worker。
4. **外链 Google Fonts**、深色首帧闪烁等低优先级项未处理。

## 8. 修改文件清单（33 个源码文件）

共享：`app/error.vue`、`app/utils/json.ts`、`app/composables/useToolRun.ts`、`usePrefs.ts`、`useTransfer.ts`、`app/components/{DkEditor,SplitPanes,DkModal,DkSwitch,FileDrop,CommandPalette}.vue`、`app/pages/{settings,offline}.vue`、`app/types/shims.d.ts`、`tsconfig.json`、`package.json`

工具：`t03 t05 t13 t15 t17 t18 t19 t20 t21 t22 t24 t25 t26 t33 t34 t35 t36 t38 t40`

子代理详细报告：`audit/reports/fix-f1-crypto.md`、`fix-f2-compute.md`、`fix-f3-web-file.md`
