# DevKit 审核报告 · 子代理 #3 · 工具 T15–T26（密码学 / 时间 / Java）

审核范围：T15 SM2、T16 SM3、T17 SM4、T18 时间戳、T19 UUID、T20 Cron、T21 日期差、T22 JSON→Java、T23 Java 转义、T24 Properties/YAML、T25 堆栈整理、T26 Maven/Gradle。

方法：
- 需求原文 `docs/DevKit-Pen完整页面设计任务书.md` 246–353 行；
- 设计稿主画板 + 必画变体（`audit/tools/pen.py dump/text`；注：`pen.py text` 按 `text` 字段抽取，本设计稿实际用 `content` 字段，故用只读脚本按 `content` 抽取）；
- 实现代码逐文件阅读；
- **真实运行**：`sm-crypto` / `js-yaml` 用 `node` 跑权威测试向量；把 Vue 内的纯函数用 `esbuild` 抽出后在 node 中执行；用 Playwright 对 `http://localhost:3000` 做交互验证与 `probe.py` 控制台/异常探测。

---

## 结论摘要

| 项 | 结果 |
|---|---|
| 工具覆盖 | T15–T26 共 12 个工具均有实现页与设计画板（T15 5 板、T16 3 板、T17 6 板、T18 4 板、T19 4 板、T20 4 板、T21 3 板、T22 4+2 板、T23 3 板、T24 3 板、T25 3 板、T26 4 板） |
| 密码学正确性 | **SM3 国标向量通过；SM4 标准 ECB 向量通过；SM2 示例密文解密与 raw/DER 验签通过**（见下） |
| 阻断问题 | 1 个：**T20 Cron 页面必崩**（`/tools/cron` 打开即 SSR 异常 → “出错了”页） |
| 高危问题 | 4 类：SM2 非法公钥“假成功”、SM2 空明文 C3 篡改“假成功”、全站“结果待更新”误判、T26 classifier 顺序颠倒 |
| 设计还原 | 多处选项缺失（T15 PEM/Base64 密钥、T17 Base64 密钥/IV、T18 输出格式与批量、T24 值类型策略、T25 “仅复制堆栈”、T26 作用域映射确认），见“设计还原问题” |

**最严重问题 Top 5**

1. `[阻断]` **T20 Cron 打开即崩**：`t20-cron.vue:319` 对 Unix 五字段 / Quartz 六字段均执行 `get('year').m`，而这两种方言没有 year 字段，`get('year')` 为 `undefined` → TypeError。实测 `/tools/cron` 标题变为“出错了”，`pageerror: Cannot read properties of undefined (reading 'm')`。
2. `[高]` **SM2 公钥不做曲线点校验**（`t15-sm2.vue:48-60` 仅校验前缀/长度）：格式合法但不在曲线上的公钥会被 `sm2.doEncrypt` 接受并返回密文，页面显示“SM2 加密成功”，但该密文永不可能被解密。设计稿明确“C1 点不在曲线上时会直接报错”。
3. `[高]` **SM2 空明文 C3 被篡改仍报“C3 校验通过”**：`t15-sm2.vue:179-183` 用 `out==='' && hex.length===192` 判定“空明文解密成功”，而 `sm-crypto` 校验失败同样返回 `''`，导致伪造成功。
4. `[高]` **全站“结果待更新”误判**：`useToolRun.ts` 中 `lastSig`（第 12、30 行）被赋值却**从未读取**，watch 回调（15–24 行）只判断 `armed && status∈{ok,error}`。因此“载入示例/加密示例/解密示例”在同一次事件里改写入参并执行后，结果立即被标成“待更新”、复制/下载被禁用。实测 T15/T16/T17/T22/T23/T24/T25/T26 均复现；T15 签名工作区因 `execute` 内写 `sigInput`（`t15-sm2.vue:229`）导致“签名成功”状态**永不可达**。
5. `[高]` **T26 classifier 顺序双向颠倒**：Maven→Gradle 输出 `g:a:classifier:version`（应为 `g:a:version:classifier`），Gradle→Maven 又把 `g:a:1.0:sources` 解析成 `version=sources / classifier=1.0`。见 `t26-maven-gradle.vue:89-97, 166-171`。

---

## 覆盖对照表（每工具一行）

| 工具 | 需求要点 | 实现情况 | 证据 |
|---|---|---|---|
| T15 SM2 | 加解密/签名验签双子区；密钥格式 PEM/Hex/Base64；C1C3C2/C1C2C3；密文编码；raw/DER；userId；变体：解密、签名成功、验签不通过、公钥格式错误 | 子区/顺序/编码/raw-DER/userId 齐全；**密钥仅 Hex，无 PEM/Base64**；公钥只校验格式不校验曲线点 | `t15-sm2.vue:414-452` 仅 Hex 输入；`pubErr:48-60`；设计 `y2Dwo` 文本“密钥格式 PEM/Hex/Base64” |
| T16 SM3 | 文本/文件、UTF-8/Hex 输入、Hex/Base64 输出、abc 向量、不混 HMAC | 全部实现；**SM3('abc') 与国标一致**；Hex 非法有定位 | `t16-sm3.vue:75`；node 复算见下 |
| T17 SM4 | CBC/ECB、PKCS#7/NoPadding、密钥与 IV 编码、密钥显隐、输入输出编码 | 模式/填充/显隐/编解码齐全；**密钥缺 Base64、IV 仅 Hex**；解密输入缺 UTF-8 | `t17-sm4.vue:12-18,39-48,69-81`；设计 `Ja13I/d8Uvqe` “UTF-8/Hex/Base64” |
| T18 时间戳 | 秒/毫秒显式、双向、时区、ISO8601、当前时间、批量、DST、无效日期 | 显式单位/双向/时区/DST/无效日期/批量(仅 ts→time) 均实现；**缺“输出格式 ISO/本地化”选择器，缺 time→ts 批量** | `t18-timestamp.vue:157-192,259-350`；设计 `QWTJw/zbk9m` |
| T19 UUID | v4/v7、数量、大小写、连字符、批量复制下载、解析版本/变体、v7 时间、v4 不伪造时间 | 全部实现且数值正确 | `t19-uuid.vue:62-96,149-253`；node 复核 v1/v4/v7 见下 |
| T20 Cron | Unix 五字段 / Quartz 六/七字段、?L W#、时区、起始、未来列表、无后续 | **页面直接崩溃**；解析器另有 WED/JUL 名称误判 | `t20-cron.vue:319`（崩溃）、`114-122`（名称误判）；`probe.py /tools/cron` |
| T21 日期差 | 两端时间/时区、交换、实际时长、日历年月日差另列、跨 DST | 实际时长/DST/交换/跨时区正确；**日历差在月末起始时输出负数日** | `t21-date-diff.vue:129-144`；node 复算见下 |
| T22 JSON→Java | 类名/包名、POJO/record、字段命名、嵌套策略、Lombok/Jackson、多文件、类型覆盖、大整数、null 确认、非法类名 | 全部实现；生成代码抽查可编译（POJO/多文件/BigDecimal/溢出/非法名） | `t22-json2java.vue` + `utils/json.ts`；`javac` 结果见下 |
| T23 Java 转义 | 引号/反斜杠/换行/制表、反向还原、非法转义、文本块注明版本 | 转义表/八进制/`\uXXXX`/非法转义/文本块全部实现，往返正确 | `t23-java-escape.vue:14-141`；node 往返见下 |
| T24 Properties/YAML | 双向、Unicode 策略、点路径嵌套、数组索引、值类型策略、冲突先报错 | 双向/嵌套/数组/冲突/Unicode 均实现；**缺“值类型策略”，YAML 空对象/数组被静默丢弃** | `t24-properties-yaml.vue:149-238,347-354,445-476`；node 复算见下 |
| T25 堆栈整理 | cause 链、Suppressed、`... N more`、混入日志、无法识别、折叠框架、突出业务、不定位根因 | 解析/分组/折叠/整理文本均实现；**缺“仅复制堆栈”**；统计口径与设计不同 | `t25-stack-trace.vue:55-227`；node 复算见下 |
| T26 Maven/Gradle | 双向、Groovy/Kotlin、保留坐标、scope 映射需确认、不查版本、缺 version、不支持表达式 | 双向/Groovy-Kotlin/缺 version 提示均实现；**映射无确认 UI；classifier 顺序错；不支持的 Gradle 声明被静默丢弃** | `t26-maven-gradle.vue:13-25,89-97,132-133,166-171`；node 复算见下 |

---

## 密码学权威向量核对（真实命令与输出）

均在 `devkit/` 目录执行，`sm-crypto` 版本 `0.3.14`。

### SM3（国标 GB/T 32905 向量）

```
$ cd devkit && node -e "const {sm3}=require('sm-crypto');console.log(sm3('abc'));console.log(sm3([0x61,0x62,0x63]))"
66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0
66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0
```

与需求给定标准值完全一致。实现 `t16-sm3.vue:75 sm3(Array.from(bytes))` 的调用方式正确（UTF-8 文本与 Hex 解码两条路径都用同一字节数组入口）。**SM3 无缺陷。**

### SM4（标准 ECB 向量 + 自示例往返）

```
$ cd devkit && node -e "const {sm4}=require('sm-crypto');
const key='0123456789abcdeffedcba9876543210';
const enc=sm4.encrypt(Array.from(Buffer.from(key,'hex')),key,{mode:'ecb',padding:'none',output:'array'});
console.log('ECB:',Buffer.from(enc).toString('hex'));"
ECB: 681edf34d206965e86b3e94f536e4246
```

与标准值 `681edf34d206965e86b3e94f536e4246` 一致。另核对页面自带 CBC/PKCS#7 示例：

```
$ cd devkit && node -e "const {sm4}=require('sm-crypto');
const K='DevKit-SM4-Key12', KH=Buffer.from(K,'utf8').toString('hex');
const IV='0123456789abcdeffedcba9876543210';
const PT='国密 SM4 分组加密示例';
const enc=sm4.encrypt(Array.from(Buffer.from(PT,'utf8')),KH,{mode:'cbc',padding:'pkcs#7',iv:IV,output:'array'});
console.log(Buffer.from(enc).toString('hex'));"
38aca3c7539d7e6fff13841268b72c1eb3337a7658b22591e65d1e6cc6ca8ef8
```

与 `t17-sm4.vue:32 SAMPLE_CT` 完全一致，且解密回原文成功；PKCS#7 填充长度与 UTF-8 字节数处理正确（NoPadding 强制 16 字节整数倍，`t17:136-145`）。**SM4 算法无缺陷。**

### SM2

```
$ cd devkit && node -e "const {sm2}=require('sm-crypto');
const PUB='041533...5aed'; const PRIV='2ee6...5371';
const CT='709ae8c0...c64'; // 源码 SAMPLE_CT_HEX
console.log('dec:', JSON.stringify(sm2.doDecrypt(CT, PRIV, 1)));
const MSG='DevKit SM2 签名验签示例文本';
console.log('raw:', sm2.doVerifySignature(MSG, SAMPLE_SIG_RAW, PUB,{hash:true,userId:'1234567812345678',der:false}));
console.log('der:', sm2.doVerifySignature(MSG, SAMPLE_SIG_DER, PUB,{hash:true,userId:'1234567812345678',der:true}));"
dec: "你好，DevKit！SM2 国密非对称加密。"
raw: true
der: true
```

页面自带示例（`t15-sm2.vue:33-39`）真实可用；压缩公钥 `02/03` 开头 66 位也确实被 `sm-crypto` 支持（额外实测加密/解密成功），因此 `pubErr` 对压缩格式的接受不是 bug。

**但 SM2 有两处“伪造成功”：**

```
$ cd devkit && node -e "const {sm2}=require('sm-crypto');const kp=sm2.generateKeyPairHex();
let y=kp.publicKey.slice(66); y=y.slice(0,-1)+((parseInt(y.slice(-1),16)^1).toString(16));
const off='04'+kp.publicKey.slice(2,66)+y;  // 格式合法(04+130位)但不在曲线上
console.log('off-curve encrypt ct len:', sm2.doEncrypt('secret', off, 1).length);"
off-curve encrypt ct len: 204
```

`t15-sm2.vue` 的 `pubErr` 只检查 `04` 前缀与 130 位长度，不验证点是否在曲线上；`execute()`（134-140 行）直接调用 `doEncrypt` 成功返回，于是页面 `run.markOk('SM2 加密成功…')`。该密文无法被任何私钥还原，属于“假成功”。

```
$ cd devkit && node -e "const {sm2}=require('sm-crypto');const kp=sm2.generateKeyPairHex();
const ct=sm2.doEncrypt('', kp.publicKey, 1);            // 空明文 -> C1(64)+C3(32)=96字节
const bad=ct.slice(0,128)+'f'.repeat(64);               // 篡改 C3
const out=sm2.doDecrypt(bad, kp.privateKey, 1);
console.log('out=',JSON.stringify(out),'hexlen=',bad.length);"
out= "" hexlen= 192
```

`t15-sm2.vue:179-183` 判定 `out==='' && hex.length===192` 为“空明文、C3 校验通过”并 `markOk`，而 `sm-crypto` 对 C3 校验失败同样返回 `''`。即**篡改过的空明文密文会被报告为“解密成功 · C3 校验通过”**，且伪造成功。正确做法应显式对空明文单独加密/比对或调用带 `output:'array'` 的接口区分失败。

---

## 设计还原问题（逐条）

### D1 `[高]` T15 密钥格式只支持 Hex，设计要求的 PEM / Base64 完全缺失
- 设计 `y2Dwo` 主画板明文有“密钥格式 PEM / Hex / Base64”，输入区展示 `-----BEGIN PUBLIC KEY-----`、`-----BEGIN PRIVATE KEY-----`，变体 `XXObg` 直接以“PEM 解析失败（缺 END 行）”为错误示例。
- 实现 `t15-sm2.vue:414-452` 只有“公钥（Hex）”“私钥（Hex）”，`cleanHex()`（45 行）把所有输入当 Hex；粘贴 PEM 会得到“公钥 Hex 非法：包含非十六进制字符”，与设计的 PEM 解析与逐行定位完全不符。
- 实现没有任何 PEM/SPKI/PKCS#8 解析入口，也没有 Base64 密钥解码。

### D2 `[中]` T17 密钥 Base64 缺失、IV 仅 Hex
- 设计 `Ja13I/d8Uvqe` 的“密钥”与“IV”分段控件均为 `UTF-8 / Hex / Base64`；解密输入“密文编码”也含 `UTF-8`。
- 实现 `t17-sm4.vue:12-14`：`keyEnc` 只有 `'hex'|'utf8'`；`iv` 仅按 Hex 解码（`ivDecoded = hexToBytes(iv.value)`，69 行）；`ctEnc` 只有 `'hex'|'base64'`。
- 即设计的三选编码在实现中缩水为两选 / 一选。

### D3 `[中]` T18 缺“输出格式（ISO 8601 / 本地化）”选择器；time→ts 不支持批量
- 设计 `QWTJw` 有“输出格式 ISO 8601 / 本地化”和“可表示范围”；`zbk9m` 的“时间 → 时间戳”变体是“本地时间（每行一个）”，即反向也支持批量。
- 实现 `t18-timestamp.vue` 的 `time2ts` 分支（311-350 行）只有单个 `datetime-local` 输入（`dateInput`），无批量；结果区（553-566）固定同时展示秒/毫秒/ISO/时区，没有输出格式开关。

### D4 `[中]` T24 缺“值类型策略”，YAML→Properties 会改写数字字面
- 需求 329-330 行明确“值类型策略；默认保留字符串”。
- 实现无该选项；`yaml.load(...,{schema:JSON_SCHEMA})`（445 行）后 `flattenYaml` 对 number/boolean 走 `String(value)`（355-357 行），因此 `my.app.version: 1.0` 输出 `1`、`1e3` 输出 `1000`，原文本丢失。源码注释已承认（475、593 行），但设计所要求的用户可选策略不存在。
- 复算：`y2p('my.app.version: 1.0')` → `my.app.version=1`。

### D5 `[中]` T25 缺“仅复制堆栈 / 只复制原始堆栈行”
- 设计 `hQHEM` 明确两个动作：“仅复制堆栈”“只复制原始堆栈行”。
- 实现 `t25-stack-trace.vue:336-343` 只有“复制原文”“复制整理文本”，没有只含堆栈帧的复制。
- 统计口径也不同：设计为“堆栈帧 N · 折叠 N · 非堆栈行 N”，实现为“异常/业务帧/框架帧”（`t25:354`）。

### D6 `[中]` T26 scope→configuration 映射无确认 UI（硬编码）
- 设计 `RWdXA` 明示“作用域映射由你确认”“provided 为什么映射成 compileOnly？…映射条上标注为待确认，可手动改”，变体 `H4Oxfk` 是逐条选择目标配置。
- 实现 `t26-maven-gradle.vue:13-18` 为固定表 `SCOPE_MAP`：`compile→implementation`、`provided→compileOnly`、`test→testImplementation`、`runtime→runtimeOnly`，直接静默套用；只有无法识别/不支持的 scope 才进“人工处理清单”，没有让用户确认或改映射的控件。`compile` 到底应映射 `api` 还是 `implementation` 也没有选择。

### D7 `[低]` T15 验签变体缺“逐步检查”
- 设计 `g8o9dO` 要求把“签名解码 / 格式检查 / 公钥解析 / 签名校验”分步展示，以严格区分“解码成功 ≠ 验签通过”。
- 实现只显示一个布尔结论（`t15-sm2.vue:527-539`）。文案层面有区分（“解码成功不代表验签通过”未直接出现，但失败原因列表已提及格式/公钥/userId），比设计弱。

### D8 `[低]` T20 设计“无后续执行”搜索窗口为 5 年，实现为 29 年
- 设计 `yKSz6` 文案“未来 5 年内无匹配”；实现 `t20-cron.vue:328` 为 `y0 + 29`。属产品口径差异。

---

## 功能与代码缺陷（附 `文件:行号` 与复现）

### E1 `[阻断]` T20 Cron 页面必崩 —— `get('year').m` 无条件解引用
- 位置：`devkit/app/components/tools/t20-cron.vue:319`
  ```ts
  const yearM = get('year').m as { type: string; vals: Set<number> } | undefined
  ```
  `get`（314 行）在找不到字段时返回 `undefined`。`fieldDefs(false)`（Unix）无 year；`fieldDefs(true)` 仅在 7 字段时才追加 year（212 行）。因此 **Unix 五字段与 Quartz 六字段的所有表达式都会抛 TypeError**；`nextRuns` 在 `execute()` 中（519 行）不被 try/catch 包裹。
- 浏览器实测（`python3 audit/tools/probe.py /tools/cron`）：
  ```
  title: 出错了 · DevKit
  console warning: [Vue warn]: Unhandled error during execution of setup function
                   at <Error key=1 error= H3Error: Cannot read properties of undefined (reading 'm') >
  pageerror: getTool is not defined
  ```
- 把 `t20-cron.vue:319` 换成 `get('year')?.m` 后，抽取同一套纯函数用 esbuild 运行，核心逻辑全部正确：
  - `*/15 * * * *` 自 `2026-01-15T00:07:30 +08:00` → `00:15, 00:30, 00:45, 01:00, 01:15`；
  - Quartz `0 0 12 L * ?` → 每月最后一天 12:00（01-31、02-28、03-31…）；
  - `0 30 2 * * ?` America/New_York 自 2026-03-07 → `03-07 02:30`、然后跳过 03-08（该墙钟不存在）到 `03-09 02:30`；
  - 永不触发 `0 0 30 2 *` → 搜索到 2055 年返回“未找到”；
  - Unix OR 语义 `30 4 1,15 * 5` → 1/1、1/2、1/9、1/15。
  ⇒ 这是**个别行**的运行时缺陷，不是算法缺陷。

### E2 `[高]` T20 周/月英文名 WED、JUL 被误判为 Quartz 扩展符
- 位置：`t20-cron.vue:114`（`const sp = t.match(/[LW#?]/g)` 先于名称解析）、`118/122`（`!f.quartz` 抛错）。
- 任何含 `L`/`W` 的名称都被当扩展符：`JUL`（七月）、`WED`（周三）。抽取函数实测：
  ```
  "* * * * WED" (Unix)  -> ERROR "Unix 五字段方言不支持 W（L/W/# 为 Quartz 扩展）"
  "* * * JUL *" (Unix)  -> ERROR "Unix 五字段方言不支持 L（L/W/# 为 Quartz 扩展）"
  "0 0 0 ? * WED" (Quartz) -> ERROR "字段「周」的 L/# 语法「WED」无法识别（支持 L、nL、n#m）"
  "0 0 0 1 JUL ?" (Quartz) -> ERROR "Unix 五字段方言不支持 L"   // 且 Quartz 下报错文案错误
  ```
- 另外 `fieldDefs(true)` 的 月/秒/分/时 字段没有 `quartz:true`（82-83 行），故 Quartz 模式下这些字段出错会误报“Unix 五字段方言不支持”。

### E3 `[高]` 全站“结果待更新”误判（`useToolRun` 的 `lastSig` 从未使用）
- 位置：`devkit/app/composables/useToolRun.ts:12`（`let lastSig = ''`）、`15-24`（watch 回调仅判断 `armed` 与 `status`）、`30/38`（`lastSig = getSignature()` 赋值后从不读取）。
- 后果：在同一次事件回调里“先改签名相关输入、再同步 execute”时，watch 在回调结束后才 flush，看到 `armed===true && status==='ok'`，于是无条件改为 `stale`。
- Playwright 实测（点击各页第一个示例按钮后读取状态）：
  ```
  sm2       载入/加密示例  -> 结果待更新: true
  sm3       载入示例      -> true
  sm4       加密示例      -> true
  json2java 载入示例      -> true
  properties-yaml 载入示例 -> true
  stack-trace     载入示例 -> true
  maven-gradle    载入示例 -> true
  java-escape     Windows 路径 -> true
  timestamp / date-diff / uuid -> false（因为它们另有 watch 重新执行，抵消了误判）
  ```
- T15 最严重：签名成功后 `sigInput.value = out`（`t15-sm2.vue:229`）必然触发误判，实测：
  ```
  SIGN: 待更新=true  签名成功=false
  ENC(手动再次点击): 待更新=false 加密成功=true
  ```
  即**“签名成功”状态不可达**，签名结果复制按钮 `disabled=true`；而手动加密（execute 内不改动签名输入）状态正常。设计 `Q9BlV` 要求的“签名成功”变体实际无法呈现。
- 影响文件（本范围内）：`t15-sm2.vue`、`t16-sm3.vue`（`loadSample:117-123`）、`t17-sm4.vue`（`loadEncSample/loadDecSample`）、`t22-json2java.vue`、`t23-java-escape.vue`（`loadSample`）、`t24-properties-yaml.vue`、`t25-stack-trace.vue`、`t26-maven-gradle.vue`。修复点在共享 composable：watch 回调应 `if (sig === lastSig) return`。

### E4 `[高]` T26 classifier 顺序颠倒（双向）
- 位置：Maven→Gradle `t26-maven-gradle.vue:89-97`（`coord = `${g}:${a}:${classifier}:${v}``）；Gradle→Maven `166-171`（`parts.length===4 → cls=parts[2]; version=parts[3]`）。
- Gradle 紧凑坐标的规范顺序是 `group:name:version:classifier`。实测：
  ```
  Maven<dependency … <classifier>sources</classifier><version>1.0</version></dependency>
    -> implementation 'g:a:sources:1.0'      // 错：版次与 classifier 对调
  Gradle implementation 'g:a:1.0:sources'
    -> <version>sources</version><classifier>1.0</classifier>   // 错
  ```
- 属于“静默产出错误坐标”，会直接污染用户构建文件。

### E5 `[中]` T26 不支持的 Gradle 声明在混排时被静默丢弃
- 位置：`t26-maven-gradle.vue:132-133`：`GRADLE_LINE_RE` 不匹配的行直接 `continue`，既不计数也不进 `manual`。
- 实测混排：
  ```
  implementation 'org.foo:bar:1.0'
  implementation group: 'x', name: 'y', version: 'z'   // map 形式
  testImplementation 'j:k:2.0'
  -> ok=2, deps=[org.foo:bar, j:k], manual=[]
  ```
  页面会显示“已转换 2 条依赖”，但 map 形式那行**无任何提示**，违背设计“不支持的表达式”必须列出的要求。若输入只有 map 形式，`matched===0` 会整体报错，反而暴露；一旦混入合法行就被吞掉。

### E6 `[中/高]` T21 日历差输出负数日
- 位置：`t21-date-diff.vue:129-144`（`calendarDiff` 借位固定取“结束月的上个月”天数，未按起始日锚定）。
- 抽取函数实测：
  ```
  2026-01-31 -> 2026-03-01  => {y:0, m:1, d:-2}
  2026-01-30 -> 2026-03-01  => {y:0, m:1, d:-1}
  2024-01-31 -> 2024-03-01  => {y:0, m:1, d:-1}   // 闰年也错
  2026-05-31 -> 2026-07-01  => {y:0, m:1, d:0}    // 偏小
  ```
  页面 `t21-date-diff.vue:390` 直接渲染 `{{ result.calM }} 月 {{ result.calD }} 日`，用户会看到“0 年 1 月 -2 日”。
- 正常样本与 DST 样本本身正确：`2026-03-01 08:00→2026-03-02 09:30`(上海) 实测 `91,800,000 ms`；`2026-03-07 01:00→2026-03-09 01:00`(纽约) 实测 `169,200,000 ms = 47h`。

### E7 `[中]` T24 YAML→Properties 静默丢弃空对象 / 空数组
- 位置：`t24-properties-yaml.vue:347-354`，`flattenYaml` 对 `{}`（Object.entries 为空）与 `[]`（forEach 为空）不产生任何输出行。
- 实测：`y2p('a: {}\nb: []\nc: 1\n')` → 仅 `c=1`，`a`、`b` 消失，也无告警。

### E8 `[中]` T24 Properties 值尾部空白被 `trim()` 吃掉
- 位置：`t24-properties-yaml.vue:121-122` 对 key 与 value 都调 `.trim()`。`java.util.Properties` 只跳过分隔符后的**前导**空白，**保留尾部空白**。
- 实测 `parseProperties('a=value   \n')` → value `"value"`（应为 `"value   "`）。

### E9 `[中]` T15 公钥无曲线校验导致假成功（同 Top5 #2）
- 位置：`t15-sm2.vue:48-60`（仅 `04`/`02`/`03` 前缀与长度）、`134-140`（直接 `doEncrypt` 并 `markOk`）。复现命令见“密码学权威向量核对”。与设计“公钥格式错误已阻断本次计算”“C1 点不在曲线上时会直接报错”矛盾。

### E10 `[中]` T15 空明文 C3 篡改假成功（同 Top5 #3）
- 位置：`t15-sm2.vue:179-183`。复现命令见上。

### E11 `[低]` T23 文本块输出会多出结尾换行
- 位置：`t23-java-escape.vue:46-49`。`"""\n${lines.join('\n')}\n"""` 使 Java 文本块内容固定以一个换行结束，对没有结尾换行的原文发生语义改变（`A` → `A\n`）。说明区只提示了行首/行尾空白，未提示结尾换行。

### E12 `[低]` T25 `fqcn` 把方法名也算进类名
- 位置：`t25-stack-trace.vue:108-109`，`fqcn = stripModule(fqRaw)` 得到的是 `com.example.X.method`，`method` 再由最后一个点切出。分类/展示目前不受影响（前缀匹配仍在），但字段语义错误，后续若用于高亮/折叠判断易出问题。

### E13 `[低]` T18 毫秒溢出错误文案错误
- 位置：`t18-timestamp.vue:165-167`，文案固定写“`${unit} × 1000 后`”。当单位为 ms 时并不会乘 1000，实际提示为“毫秒 × 1000 后须在 ±8.64e15 内”，误导。

### E14 `[低]` error.vue 引用 `getTool` 未导入，崩溃时的错误页自身报错
- 位置：`devkit/app/error.vue:11`：`common.map((s) => getTool(s)!)`，但文件只 `import type { NuxtError }`，没有从 `~/data/tools` 导入 `getTool`。
- 实测 T20 崩溃进入错误页时：`pageerror: getTool is not defined`，页面“常用工具”区块不渲染（`has 常用工具: False`）。纯 404 页因服务端整包渲染未复现，但客户端错误边界下稳定复现。这是 T20 崩溃的次生放大。

---

## 无法验证 / 存疑项

1. **T22 record 输出未能在本机编译**：本机 `javac` 为 OpenJDK 1.8，不支持 record（Java 16+）。人工检查生成的 `record` 语法（`t22-json2java.vue:426-448`）结构正确（含嵌套 record、空 record 的 `public record X(\n) {}`），但未能用 javac 实证；建议在 JDK 17+ 环境复验。设计标注“record（Java 16+）”已到位。
2. **T22 Jackson 输出未编译**：失败原因是 classpath 无 `jackson-annotations`（`程序包 com.fasterxml.jackson.annotation 不存在`），非生成代码错误；`@JsonProperty` 位置（字段前/record 组件前）人工看正确。
3. **T20 nextRuns 的 DST 歧义（回拨）只触发一次**：与 Quartz 常见行为一致，但未与 Quartz 实体库逐例比对，属存疑而非缺陷。
4. **T24 YAML 锚点/合并键 `<<`** 在 `JSON_SCHEMA` 下的行为未逐项验证，设计未要求，列为存疑。
5. **T18 time→ts 的 `datetime-local` 各浏览器是否带秒**未逐一验证；`parseWallText` 正则接受可省略秒，逻辑上兼容。
6. **T15 PEM/Base64 密钥**：实现完全缺失，无法验证其（不存在的）解析质量。
7. **T20 修复后**（`get('year')?.m`）本报告用抽取函数验证了算法；未在真实页面打补丁验证，因审核为只读。

---

## 修复优先级建议

**P0（阻断，必须修）**
1. `t20-cron.vue:319`：`const yearM = get('year')?.m`（或显式 `const yf = get('year'); const yearM = yf ? yf.m : undefined`）。修完 T20 才能打开。建议同时对 `execute()` 的 `nextRuns` 调用加 try/catch 兜底，避免同类异常再次白屏。

**P1（高危，尽快修）**
2. `useToolRun.ts:15-24`：watch 回调加入 `if (sig === lastSig) return`（`lastSig` 已在 30/38 行维护），修复全站示例/签名后的“结果待更新”误判；重点回归 T15 签名成功、T16/T17/T22/T23/T24/T25/T26 示例按钮。
3. `t15-sm2.vue`：公钥解密前做曲线点校验（可用 `sm2` 的曲线参数验算，或捕获异常并明确报错），禁止非法点进入 `doEncrypt`；空明文 C3 校验改为“解密失败/成功”显式区分（不要用 `out===''` 判定通过）。
4. `t26-maven-gradle.vue:89-97,166-171`：classifier 统一为 `g:a:version:classifier`，双向对称。

**P2（中危 / 设计还原）**
5. `t20-cron.vue:111-192`：名称解析先于 `L/W/#/?` 扩展符判断，修复 `WED`/`JUL`；并修正 Quartz 模式下非日/周字段的误导性报错文案。
6. `t21-date-diff.vue:129-144`：采用“以起始日锚定、先加年/月再补天”的日历差算法，保证各分量非负。
7. `t26-maven-gradle.vue:132-133`：不匹配的 Gradle 声明行应计入 `manual` 或至少给出“已跳过 N 行无法识别”的提示，禁止静默丢弃。
8. `t24-properties-yaml.vue`：补“值类型策略”（保留原始标量文本）选择；空对象/数组要么保留为 `key=`，要么显式告警；去掉对 value 的尾部 trim。
9. `t15-sm2.vue`：补 PEM/Hex/Base64 密钥格式选择与 PEM 解析（对齐设计 `y2Dwo`/`XXObg`）；`t17-sm4.vue` 补密钥 Base64、IV UTF-8/Base64。
10. `t26-maven-gradle.vue`：补作用域映射确认/可改 UI（设计 `RWdXA`/`H4Oxfk`）。

**P3（低 / 打磨）**
11. `t25` 补“仅复制堆栈”；统一统计口径；修正 `fqcn` 语义。
12. `t18` 补输出格式选择与 time→ts 批量；修正 ms 溢出文案。
13. `t23` 文本块结尾换行提示或改用带续行符的精确写法。
14. `error.vue:11` 补 `import { getTool } from '~/data/tools'`，保证任何页面崩溃时错误页可用。

---

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/r3-tools-t15-t26.md
