# 修复报告 F1 · 密码学工具的真实性 / 假成功缺陷

- 修复子代理：F1
- 工作目录：`/Users/hao/WebstormProjects/web_tools`
- 涉及文件：`devkit/app/components/tools/t13-hmac.vue`、`t15-sm2.vue`、`t33-jwt.vue`
- 修复原则：真计算、不伪造；失败保留输入；文案与事实一致；改动最小。
- 结论：4 个问题全部修复，页面实测 22/22 通过，`nuxt build` 生产构建通过。

---

## 问题 1【T13】内置预设假标签 "RFC 4231 Test Case 1"

**问题**：`t13-hmac.vue` 用 40 字节 ASCII 数字当密钥，却把该向量标为 RFC 4231 TC1。真 TC1 为 key = 0x0b × 20、data = `Hi There`。

**改动**（`devkit/app/components/tools/t13-hmac.vue`）：

| 位置 | 改动 |
| --- | --- |
| `t13-hmac.vue:21-23` | 期望值替换为真 RFC 4231 TC1：SHA-256 `b0344c61…2cff7`、SHA-512 `87aa7cde…126854`；注释改为 `key = 0x0b × 20` |
| `t13-hmac.vue:85-93`（`loadSample`） | `keyEnc` 由 `utf8` 改为 `hex`，`key` 改为 `'0b'.repeat(20)`，与页面密钥输入格式一致 |
| `t13-hmac.vue:203-209` | 折叠区说明同步为 `0b0b…0b`（0x0b × 20 字节，密钥编码选 Hex），并说明载入示例会自动切到 Hex |

**验证命令与输出**（node crypto 独立复算）：

```
$ cd devkit && node -e "
const c=require('crypto');
const key=Buffer.from('0b'.repeat(20),'hex');
const msg=Buffer.from('Hi There');
console.log('key hex =', key.toString('hex'));
console.log('key bytes =', key.length);
console.log('HMAC-SHA256 =', c.createHmac('sha256',key).update(msg).digest('hex'));
console.log('HMAC-SHA512 =', c.createHmac('sha512',key).update(msg).digest('hex'));
"
key hex = 0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b
key bytes = 20
HMAC-SHA256 = b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
HMAC-SHA512 = 87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854
```

页面实测（Playwright，`http://localhost:3000/tools/hmac`）：点击「载入示例」后密钥输入为 `0b`×20，结果区显示 `b0344c61…2cff7`，徽标「与期望一致」；切到 HMAC-SHA-512 计算得到 `87aa7cde…126854`。

---

## 问题 2【T15】SM2 公钥无曲线点校验，非法点显示加密成功

**问题**：`pubErr` 只校验 `04`/`02`/`03` 前缀与长度，不在曲线上的点会被 `sm2.doEncrypt` 接受并显示「SM2 加密成功」，而该密文永不可解（假成功）。

**改动**（`devkit/app/components/tools/t15-sm2.vue`）：

- `t15-sm2.vue:4-5`：引入 `sm-crypto/src/sm2/utils`（`getGlobalCurve`）与 `jsbn` 的 `BigInteger`，用于问题 3 的独立 C3 复核。
- `t15-sm2.vue:78-80`：在 `pubErr` 格式校验之后加入真实曲线点校验 `if (!sm2.verifyPublicKey(k)) return '公钥不是有效的 SM2 曲线点：不满足 y² = x³ + ax + b (mod p)…'`。`sm2.verifyPublicKey` 内部即验算 `y² = x³ + ax + b`。该校验同时覆盖加密与验签两个入口（两者都读 `pubErr`）。
- `t15-sm2.vue:84-90`：`pubHelp` 文案同步为「格式与曲线点均有效」/「先修正上方错误后才能执行」。
- 输入不被清空，报错出现在公钥字段下方，符合画板 XXObg「直接报错」。

**验证命令与输出**（node + sm-crypto，构造格式合法但离曲线的点）：

```
$ cd devkit && node -e "
const {sm2}=require('sm-crypto');
const PUB='04153365094222d65b0733da2de3515b7a45c58eaacf7f8a77da497ec2a5edf7c2d4cb0636be80c3b18b32229044734b0b8d5a50be7eba40b450f60d3b667e5aed';
let y=PUB.slice(66); y=y.slice(0,-1)+((parseInt(y.slice(-1),16)^1).toString(16));
const off='04'+PUB.slice(2,66)+y;
console.log('sample on-curve :', sm2.verifyPublicKey(PUB));
console.log('off-curve on-curve:', sm2.verifyPublicKey(off));
console.log('OLD behaviour: doEncrypt(off) ct length =', sm2.doEncrypt('secret', off, 1).length, '(accepted, unusable)');
"
sample on-curve : true
off-curve on-curve: false
OLD behaviour: doEncrypt(off) ct length = 204 (accepted, unusable)
```

页面实测（Playwright，`/tools/sm2`）：

- 填入离曲线公钥 + 明文 → 公钥字段报「公钥不是有效的 SM2 曲线点…」，结果区无密文（`.t15__row-val` 数量 0）。
- 合法非压缩示例公钥 → 正常加密；合法压缩公钥 `0315…f7c2` → 正常加密（回归通过）。
- 离曲线公钥在「签名验签 → 验签」入口同样被 `pubErr` 阻断。

---

## 问题 3【T15】空明文解密把 C3 校验失败当成成功

**问题**：`out === '' && hex.length === 192` 被判为「空明文、C3 校验通过」，但 `sm-crypto` C3 校验失败同样返回空串，导致篡改 C3 的空明文密文被报告为解密成功。

**改动**（`devkit/app/components/tools/t15-sm2.vue`）：

- `t15-sm2.vue:49-64`：新增 `emptyPlaintextC3Valid(ctHex, privHex, mode)`，用曲线 `S = C1 · d` 求出 `x2、y2`，独立复核 `C3 == SM3(x2 || y2)`（空明文时 M 为空）。
- `t15-sm2.vue:201-212`：仅当 `out === '' && hex.length === 192` **且** 自校验通过时才报「明文为空字符串，C3 校验通过」；否则走 `markFail('解密失败：C3 校验未通过…')`，结果区不显示明文。
- 非空明文分支与非 192 长度的失败分支保持原样（后者本就正确）。

**验证命令与输出**：

```
$ cd devkit && node -e "
const smCrypto=require('sm-crypto'); const {sm2,sm3}=smCrypto;
const utils=require('sm-crypto/src/sm2/utils'); const {BigInteger}=require('jsbn');
const curve=utils.getGlobalCurve(); const leftPad=(s,n)=>s.length>=n?s:'0'.repeat(n-s.length)+s;
function c3Valid(hex,priv,mode){const c1=curve.decodePointHex('04'+hex.slice(0,128));const p=c1.multiply(new BigInteger(priv,16));const x2=leftPad(p.getX().toBigInteger().toString(16),64);const y2=leftPad(p.getY().toBigInteger().toString(16),64);const b=[];for(let i=0;i<x2.length;i+=2)b.push(parseInt(x2.substr(i,2),16));for(let i=0;i<y2.length;i+=2)b.push(parseInt(y2.substr(i,2),16));const exp=sm3(b);const act=mode===0?hex.slice(hex.length-64):hex.slice(128,192);return exp===act.toLowerCase();}
const kp=sm2.generateKeyPairHex();
const good=sm2.doEncrypt('',kp.publicKey,1); const bad=good.slice(0,128)+'f'.repeat(64);
console.log('doDecrypt(good) =', JSON.stringify(sm2.doDecrypt(good,kp.privateKey,1)), '(empty either way)');
console.log('doDecrypt(bad)  =', JSON.stringify(sm2.doDecrypt(bad,kp.privateKey,1)), '(empty either way)');
console.log('our C3 check(good) =', c3Valid(good,kp.privateKey,1));
console.log('our C3 check(bad)  =', c3Valid(bad,kp.privateKey,1));
"
doDecrypt(good) = "" (empty either way)
doDecrypt(bad)  = "" (empty either way)
our C3 check(good) = true
our C3 check(bad)  = false
```

页面实测（Playwright，`/tools/sm2`，示例私钥 + C1C3C2）：

- 合法空明文密文 → 状态栏「SM2 解密成功：明文为空字符串（C2 为 0 字节），C3 校验通过」。
- 把 C3 段改成 `ff…ff` 的同长度密文 → 状态栏「解密失败：C3 校验未通过…」，结果区无「（空字符串）」明文。
- 非空示例密文「解密示例」仍正常解出原文（回归通过）。

---

## 问题 4【T33】"被篡改签名"示例实际未篡改 + 验签结论不随 Token 清除

**问题 4a**：`SAMPLE_TAMPERED` 只把签名段末位 `Y→Z`，该字符低 2 位是丢弃的填充位，解码字节与正确签名完全相同，点击验签反而显示「签名验证通过」，与文案「验签必然失败」矛盾。

**问题 4b**：`decode()` 不重置 `verifyResult`，换 Token 后旧的绿色「签名验证通过」仍然保留，误导用户。

**改动**（`devkit/app/components/tools/t33-jwt.vue`）：

| 位置 | 改动 |
| --- | --- |
| `t33-jwt.vue:12-13` | `SAMPLE_TAMPERED` 改为「Payload 的 `sub` 由 `devkit-demo` 改为 `devkit-admin`、保留原签名」，payload 字节真实改变、签名段有效位不变 |
| `t33-jwt.vue:106-109` | `decode()` 开头新增 `verifyResult.value = null`，Token 一变即清除旧验签结论 |
| `t33-jwt.vue:277` | 按钮 title 改为「载入被篡改 Payload 的示例（sub 改为 devkit-admin，签名段不变）」 |
| `t33-jwt.vue:398` | 「关于本工具」说明同步为真实篡改方式 |

**验证命令与输出**（node crypto）：

```
$ cd devkit && node -e "
const c=require('crypto');
const VALID='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZraXQtZGVtbyIsIm5hbWUiOiLmnKzlnLDlt6XlhbfnrrEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.m-TEfec4PcwDypb1zPDKzu2fIUQiZ82QTW5cFIlXIXY';
const oldTampered=VALID.slice(0,-1)+'Z';
const sigOf=t=>t.split('.')[2];
console.log('OLD tamper: sig bytes equal original? ', Buffer.from(sigOf(VALID),'base64url').equals(Buffer.from(sigOf(oldTampered),'base64url')));
const NEW='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZraXQtYWRtaW4iLCJuYW1lIjoi5pys5Zyw5bel5YW3566xIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.m-TEfec4PcwDypb1zPDKzu2fIUQiZ82QTW5cFIlXIXY';
const [h,p,s]=NEW.split('.');
console.log('NEW tamper payload =', Buffer.from(p,'base64url').toString());
console.log('NEW tamper HMAC recomputed == provided? ', c.createHmac('sha256','devkit-secret').update(h+'.'+p).digest('base64url')===s);
console.log('VALID sample HMAC recomputed == provided? ', c.createHmac('sha256','devkit-secret').update(VALID.split('.').slice(0,2).join('.')).digest('base64url')===sigOf(VALID));
"
OLD tamper: sig bytes equal original?  true
NEW tamper payload = {"sub":"devkit-admin","name":"本地工具箱","iat":1700000000,"exp":1900000000}
NEW tamper HMAC recomputed == provided?  false
VALID sample HMAC recomputed == provided?  true
```

页面实测（Playwright，`/tools/jwt`）：

- 「示例：被篡改签名」→ Payload 解码出 `devkit-admin`，点「验证签名」→ 红框「签名不匹配：密钥错误或 Token 被修改」。
- 「示例：有效签名」→ 点「验证签名」→ 绿框「签名验证通过（HS256）」。
- 验签通过后直接把 Token 换成篡改 Token（不点验签）→ `.t33__vres` 结论框消失（旧结论被清除）。

---

## 自测汇总

Playwright 驱动真实页面 `http://localhost:3000`（Chromium，1440×1000）：

```
T13 key is Hex 0b*20                                  PASS
T13 HMAC-SHA256 == RFC4231 TC1                        PASS
T13 badge shows 与期望一致                             PASS
T13 HMAC-SHA512 == RFC4231 TC1                        PASS
T13 no page errors                                    PASS
T15 off-curve key rejected                            PASS
T15 off-curve no encryption success                   PASS
T15 valid sample encrypts                             PASS
T15 valid empty plaintext decrypts (C3 pass)          PASS
T15 tampered empty C3 fails                           PASS
T15 tampered empty no success result                  PASS
T15 no page errors                                    PASS
T33 tampered sample payload decoded (devkit-admin)    PASS
T33 tampered verify FAILS                             PASS
T33 valid verify PASSES                               PASS
T33 verifyResult cleared on token change              PASS
T33 no page errors                                    PASS
SUMMARY: 17/17 passed

T15 compressed key has no error                       PASS
T15 compressed key encrypts                           PASS
T15 non-empty sample decrypts                         PASS
T15 verify mode off-curve rejected                    PASS
T15b no page errors                                   PASS
SUMMARY: 5/5
```

生产构建（验证 `sm-crypto/src/sm2/utils` 与 `jsbn` 的深层导入可打包）：

```
$ cd devkit && npm run build
...
├─ .output/server/index.mjs (353 B) (204 B gzip)
└─ ✨ Build complete!
EXIT=0
```

## 说明

- 未改动任何共享文件（`useToolRun.ts`、`bytes.ts`、`Dk*.vue`、`SplitPanes.vue`、`error.vue`、`FileDrop.vue` 等）。审计中提到的「`useToolRun` 把示例结果误判为 stale」「T15 缺 PEM/Base64 密钥」等不在本次 F1 任务清单内，本报告不涉及，也未顺手重构。
- T15 曲线校验复用 `sm-crypto` 自带的 `verifyPublicKey`（其实现正是 `y² = x³ + ax + b`），避免自造椭圆曲线运算；C3 复核所需的共享点 `C1·d` 使用同库 `getGlobalCurve()` + `jsbn`，与 `sm-crypto` 内部解密使用同一曲线，结果一致。
- T33 篡改示例保留原签名、只改 Payload，既保证字节真实不同（验签失败），又保留「解码成功」的演示价值。

DONE: /Users/hao/WebstormProjects/web_tools/audit/reports/fix-f1-crypto.md
