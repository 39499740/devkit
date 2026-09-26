<script setup lang="ts">
/**
 * P1 场景页：加密数据调试（AES / SM4 解密，HMAC / SM2 验签）。
 *
 * 只做解释与引导：固定示例、步骤说明、正反结果对照与单项工具入口；计算全部由
 * crypto 分类的单项工具（/tools/aes、/tools/sm4、/tools/hmac、/tools/sm2 等）执行。
 * 本页不接收任何输入到 URL 或分享链接；示例为无敏感数据的造造样本。
 *
 * 数据真实性：页面里每条密文 / MAC / 签名与每句工具提示，均在 2026-09-26 用
 * esbuild 打包 devkit 真实共享实现（app/utils/crypto/{aesgcm,sm4,sm2,hmac}.ts，
 * 与工具页 t13/t14/t15/t17 同一份代码）后 node 实跑核对：
 * 正样本逐字还原明文 / 验签通过；反样本按算法的真实性质展示结果。
 * SM4-CBC 错 IV 不会认证失败，已在页面说明。正反样本的实测结论同时抄录在下方各 verdicts 里。
 */
useSeo({
  title: '加密数据调试：AES / SM4 解密与 HMAC / SM2 验签 · DevKit',
  description:
    'AES、SM4 响应密文解不开，或 HMAC、SM2 签名校验结果不清楚？在浏览器本地配齐密钥 / IV / 签名格式，区分「解码成功、解密成功、验签通过」三种结论；附已实测的正反示例，并说明 SM4-CBC 错误 IV 不会自动报错。密文与密钥只在页面内存中处理，不上传。'
})

const clipboard = useClipboard()

/** ── 示例数据（2026-09-26 node 实跑产出，勿手改）── */
// AES-256-GCM：密文||认证标签（Base64 形态，网关响应常见），AAD 为空
const AES_PT = '{"code":0,"message":"ok","data":{"orderId":"SO-2026-0926","status":"PAID","amount":199}}'
const AES_CT_B64 =
  'CY8UHTFfOvmZYqnqLnUECbO0gU7E+7NZgNG6cUg8c8IFuPTIk2EplohEDul6XGLj0ZB7HWisB6b5NNVTj9Hq1OlEJbuoOhorcKjNclNTNk66UIZARFiT4hCmYZY0th1Zjdc3C/3yovY='
// SM4-CBC / PKCS#7：明文 68 字节 → 密文 80 字节（Hex）
const SM4_PT = '{"code":0,"data":{"orderId":"GM-1024","amount":88,"currency":"CNY"}}'
const SM4_CT = '1c87844389cde9c68db25e11943029d408f7c1a83bbe3ab736988becfc9ec04751ee33045001ff954a05681b72170b3b7043c6561d7ed8f0ee06995f0e0690514c976347bedbd62b2f6f7b43b68b5aaa'
// HMAC-SHA-256：期望值与 node:crypto 独立实现互核一致；篡改 amount 后的值用于反样本
const HMAC_MAC = 'eae93c7491b84e24d75c1ed2841f947da49452bc50c19b46107835495c7a6f99'
const HMAC_MAC_TAMPERED = 'f4fb323119cc9db2100fb261ffec5ac95fa3ae50f27e96ead5cda9b4b73c1063'
// SM2 验签：工具页同源示例（pub / raw 签名 / userId），本页 node 复核验签通过
const SM2_PUB = '04153365094222d65b0733da2de3515b7a45c58eaacf7f8a77da497ec2a5edf7c2d4cb0636be80c3b18b32229044734b0b8d5a50be7eba40b450f60d3b667e5aed'
const SM2_SIG = 'c6638f4749d35e688af204c50499bc105db2b404912972e02a3091eae63246be97ba81878c328c525befe1a6aaea137bc5fb8be60533b5a47581e21f6d7fe766'

interface Verdict {
  kind: 'ok' | 'bad'
  label: string
  /** 工具实际显示的提示 / 结论原文 */
  msg: string
}

interface DemoStep {
  title: string
  why: string
  note?: string
  out?: string
  outLabel?: string
}

interface DemoGroup {
  key: string
  title: string
  inputLabel: string
  input: string
  params: { k: string; v: string }[]
  steps: DemoStep[]
  verdicts: Verdict[]
}

interface ModeDef {
  key: 'aes' | 'sm4' | 'sign'
  label: string
  groups: DemoGroup[]
  cta: { to: string; button: string; primary?: boolean }[]
}

const MODES: ModeDef[] = [
  {
    key: 'aes',
    label: 'AES 密文',
    groups: [
      {
        key: 'aes',
        title: 'AES-GCM 响应解密',
        inputLabel: '响应里的密文字段（Base64，密文||认证标签 拼接，粘进工具的密文输入框）',
        input: AES_CT_B64,
        params: [
          { k: '密钥（Hex，32 字节 = AES-256）', v: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff' },
          { k: 'IV / nonce（Hex，12 字节）', v: 'e0e1e2e3e4e5e6e7e8e9eaeb' },
          { k: 'AAD', v: '未使用（加密时为空；后端若用了 AAD，解密时必须填完全一致的一段）' },
          { k: '其余选项', v: 'AES-256 · 认证标签 128 位 · 输入编码 Base64' }
        ],
        steps: [
          {
            title: '第 1 步 · 按原始编码粘入密文',
            why: '工具按「输入编码」把文本还原成字节——这一步只做解码：解码成功 ≠ 解密成功，它只说明拿到了字节。串被截断或混入非法字符会在这里报错，先把复制问题排掉。',
            note: 'Base64 解码成功，得到 104 字节（密文 88 字节 + 认证标签 16 字节）——这只是「拿到了字节」，还没有解密'
          },
          {
            title: '第 2 步 · 配齐四个参数：密钥、IV、AAD、标签长度',
            why: 'GCM 解密四个参数缺一不可，工具在计算前先校验并明确指出缺什么：IV 为空提示「IV（nonce）为空：…」，密钥字节数不符提示「密钥解码后 N 字节，需要 32 字节（AES-256）」，不会带着错参数开算。',
            note: '参数校验通过：AES-256 · IV 12 字节 · 认证标签 128 位 · AAD 为空'
          },
          {
            title: '第 3 步 · 解密——认证通过才叫「解密成功」',
            why: 'GCM 是认证加密，认证标签校验内嵌在解密里：密钥、IV、AAD、标签长度任一与加密时不同，都得到「认证失败」，不会输出半截明文，绝不显示假成功。',
            note: 'AES-GCM 解密成功（88 字节，认证通过）',
            out: AES_PT,
            outLabel: '第 3 步输出（解密得到的明文，UTF-8 文本，可复制）'
          },
          {
            title: '第 4 步 · 明文再核对',
            why: '解密成功只说明密文还原了，不代表业务数据对：把明文粘进「JSON 格式化」确认能解析、字段齐全；要取字段再走 JSONPath。解密成功 ≠ 业务正确，这一步把两件事分开。'
          }
        ],
        verdicts: [
          {
            kind: 'ok',
            label: '正样本 · 示例数据原样运行',
            msg: 'AES-GCM 解密成功（88 字节，认证通过）——明文即第 3 步输出，逐字一致'
          },
          {
            kind: 'bad',
            label: '反样本 · 密钥末字节 ff 改成 fe',
            msg: '认证失败：密钥错误、密文被修改或 AAD 不一致（IV 与认证标签长度也须与加密时相同）'
          },
          {
            kind: 'bad',
            label: '反样本 · IV 首字节 e0 改成 e1',
            msg: '认证失败（同一句提示）——GCM 的 IV 参与认证，错一位也过不了'
          }
        ]
      }
    ],
    cta: [{ to: '/tools/aes', button: '用我的数据处理 · AES 密文', primary: true }]
  },
  {
    key: 'sm4',
    label: 'SM4 密文',
    groups: [
      {
        key: 'sm4',
        title: '国密 SM4-CBC 响应解密',
        inputLabel: '响应里的密文字段（Hex，粘进工具的密文输入框，密文编码选 Hex）',
        input: SM4_CT,
        params: [
          { k: '密钥（UTF-8，16 字节）', v: 'DevKit-SM4-Key12（Hex 形态 4465764b69742d534d342d4b65793132）' },
          { k: 'IV（Hex，16 字节）', v: '0123456789abcdeffedcba9876543210' },
          { k: '其余选项', v: '模式 CBC · 填充 PKCS#7 · 输出 UTF-8' }
        ],
        steps: [
          {
            title: '第 1 步 · 先核对密文长度',
            why: 'SM4 密文必为 16 字节的整数倍。复制被截断或粘错编码（Hex 当 Base64），工具会直接报「不是 16 的整数倍」——先把形态问题排掉，再谈解密。',
            note: '示例密文 80 字节 = 明文 68 字节 + PKCS#7 填充 12 字节，是 16 的整数倍'
          },
          {
            title: '第 2 步 · 配齐密钥与 IV',
            why: 'SM4 密钥固定 16 字节（32 个 Hex 字符，或恰好 16 个 ASCII 字符）；CBC 必须有 16 字节 IV，ECB 没有。密钥编码选错会得到明确的字节数错误：把 32 位 Hex 按 UTF-8 算会报「密钥 UTF-8 编码后 32 字节，需要恰好 16 字节」。',
            note: '密钥 16 字节 · IV 16 字节 · CBC / PKCS#7'
          },
          {
            title: '第 3 步 · 解密——去填充校验是一道闸',
            why: 'PKCS#7 去填充校验未通过是「密钥错误或密文被改」的典型信号，工具明确报失败；只有校验通过、明文按 UTF-8 正常显示，才叫解密成功。注意与 AES-GCM 不同：SM4-CBC 没有认证标签，完整性靠这一步兜底。',
            note: 'SM4 CBC 解密成功（PKCS#7 去填充校验通过，输出 68 字节）',
            out: SM4_PT,
            outLabel: '第 3 步输出（解密得到的明文，UTF-8 文本，可复制）'
          },
          {
            title: '第 4 步 · 警惕「开头乱码、后面正常」',
            why: 'CBC 模式里 IV 只参与第一个分组：IV 错了不会报错，只有开头 16 字节乱码，其余照常解出（node 实测本例：错 IV 时首字节 { 变成 k，后 52 字节与正确明文完全一致）。看到这种形态先核对 IV，别把带乱码的明文当成功结果复制走。',
            note: 'node 实测：错误 IV 时第一分组输出 6b22636f6465223a302c226461746122（k"code":0,"data"），解密本身不报错'
          }
        ],
        verdicts: [
          {
            kind: 'ok',
            label: '正样本 · 示例数据原样运行',
            msg: 'SM4 CBC 解密成功（PKCS#7 去填充校验通过，输出 68 字节）——明文即第 3 步输出，逐字一致'
          },
          {
            kind: 'bad',
            label: '反样本 · 密钥 DevKit 改成 XevKit',
            msg: '解密失败：PKCS#7 去填充校验未通过（通常是密钥错误或密文被修改；请核对密钥、IV 与模式）'
          },
          {
            kind: 'bad',
            label: '反样本 · 密文删掉末尾 2 个字符（剩 79 字节）',
            msg: '解密密文长度错误：当前 79 字节，不是 16 的整数倍（SM4 密文必为 16 字节的整数倍，请检查输入编码或密文是否完整）'
          }
        ]
      }
    ],
    cta: [{ to: '/tools/sm4', button: '用我的数据处理 · SM4 密文', primary: true }]
  },
  {
    key: 'sign',
    label: '签名校验',
    groups: [
      {
        key: 'hmac',
        title: 'HMAC-SHA-256 签名对照（对称密钥，接口签名最常见）',
        inputLabel: '参与签名的报文原文（粘进工具的「消息」输入框）',
        input: '{"orderId":"SO-2026-0926","amount":199}',
        params: [
          { k: '密钥（UTF-8，25 字节）', v: 'devkit-hmac-demo-key-2026' },
          { k: '期望 MAC（Hex，用于对照）', v: HMAC_MAC },
          { k: '其余选项', v: '算法 HMAC-SHA-256 · 密钥编码 UTF-8 · 输出 Hex' }
        ],
        steps: [
          {
            title: '第 1 步 · 固定参与签名的原文',
            why: '对照的是字节：多一个空格、换行从 LF 变 CRLF、字段顺序变化，都会让 MAC 完全不同。先把报文原文一字不差地固定下来，再谈签名对不对。'
          },
          {
            title: '第 2 步 · 对齐算法、密钥编码、期望值',
            why: 'SHA-256 与 SHA-512 结果不同；同一串密钥按 UTF-8 还是 Hex 解码结果不同；期望值按 Hex 对照（忽略大小写与空白）。三样都对齐，结论才有意义；密钥为空会被明确提示「密钥为空：请填写密钥」。',
            note: 'HMAC 计算成功（SHA-256，密钥 25 字节）；期望值对照：一致',
            out: HMAC_MAC,
            outLabel: '计算出的 HMAC-SHA-256（与期望值相同；已与 node:crypto 独立实现互核一致）'
          },
          {
            title: '第 3 步 · 读结论：一致 / 不一致',
            why: 'HMAC 对任何输入都能算出一个值，「计算成功」只是计算状态。校验结论看「与期望一致 / 不一致」徽标：不一致时工具仍允许复制计算值以便排查，但不能把它当成验签通过。',
            note: '与期望一致（绿色徽标）；反样本显示「与期望不一致」（红色徽标）'
          }
        ],
        verdicts: [
          {
            kind: 'ok',
            label: '正样本 · 示例报文 + 示例密钥',
            msg: `HMAC 计算成功（SHA-256，密钥 25 字节）；期望值对照：一致（计算值 = 期望值 = ${HMAC_MAC.slice(0, 16)}…）`
          },
          {
            kind: 'bad',
            label: '反样本 · 报文 amount 199 改成 198',
            msg: `与期望不一致——计算值变为 ${HMAC_MAC_TAMPERED.slice(0, 16)}…（${HMAC_MAC_TAMPERED}，红色徽标）`
          },
          {
            kind: 'bad',
            label: '反样本 · 换密钥 devkit-hmac-demo-key-2027',
            msg: '与期望不一致（红色徽标）——密钥变了，MAC 必然不同'
          }
        ]
      },
      {
        key: 'sm2',
        title: '国密 SM2 验签（公钥验签，不需要私钥）',
        inputLabel: '签名对应的原文（粘进工具「签名验签 → 验签」的原文输入框）',
        input: 'DevKit SM2 签名验签示例文本',
        params: [
          { k: '公钥（Hex，04 开头非压缩）', v: SM2_PUB },
          { k: '签名（raw r||s，128 位 Hex）', v: SM2_SIG },
          { k: 'userId', v: '1234567812345678（默认值；签名时用的哪个，验签就得填哪个）' },
          { k: '签名格式', v: 'raw（r||s）；DER 签名要切到 DER，两种编码不通用' }
        ],
        steps: [
          {
            title: '第 1 步 · 验签只用公钥，对齐三样参数',
            why: '私钥只用于签名，验签对齐：公钥（04 非压缩 130 位或 02/03 压缩 66 位，且必须是 SM2 曲线上的点）、userId、签名格式（raw 与 DER 不通用）。格式不符会在计算前被指出，如「raw 签名应为 128 位 Hex（r||s 各 64 位），当前 N 位」。'
          },
          {
            title: '第 2 步 · 运行验签',
            why: 'SM2 把 userId 与原文一起做 SM3 摘要再验证签名：原文、签名、公钥、userId、格式五者任一不匹配，结果就是「不通过」。本页示例的公钥 / 签名 / 原文已用 node 复核为通过组合。',
            note: '验签通过：签名与原文、公钥、userId「1234567812345678」及 raw r||s 格式均匹配'
          },
          {
            title: '第 3 步 · 「不通过」也是结论，不是执行错误',
            why: '验签不通过时，结论面板显示红色「验签不通过」并给出可能原因，状态栏注明「这是一个真实计算出的结论，不是执行错误」——计算本身成功了，结论是否定的。按五项逐一排查，绝不能把「算出来了」当「验签通过」。',
            note: '反样本时结论面板显示：验签不通过（公钥未验证通过该签名）'
          }
        ],
        verdicts: [
          {
            kind: 'ok',
            label: '正样本 · 示例公钥 + 示例签名 + 默认 userId',
            msg: '验签通过：签名与原文、公钥、userId「1234567812345678」及 raw r||s 格式均匹配'
          },
          {
            kind: 'bad',
            label: '反样本 · 签名第 64 位字符 4 改成 5',
            msg: '验签不通过：这是一个真实计算出的结论，不是执行错误'
          },
          {
            kind: 'bad',
            label: '反样本 · 原文末尾多加一个 !',
            msg: '验签不通过——原文变了一个字节，签名即失效'
          },
          {
            kind: 'bad',
            label: '反样本 · userId 与签名时不一致',
            msg: '验签不通过——SM2 的 userId 参与摘要，默认 1234567812345678 之外需双方约定一致'
          }
        ]
      }
    ],
    cta: [
      { to: '/tools/hmac', button: '用我的数据处理 · HMAC 对照', primary: true },
      { to: '/tools/sm2', button: '用我的数据验签 · SM2' }
    ]
  }
]

const mode = ref<'aes' | 'sm4' | 'sign'>('aes')
const current = computed<ModeDef>(() => MODES.find((m) => m.key === mode.value)!)

/** ── 三种结果 + 缺失参数：术语先分清（P1 验收：不能混用）── */
const TERMS = [
  {
    icon: 'binary',
    name: '解码成功',
    desc: 'Base64 / Hex 文本还原成了字节。只说明「拿到了字节」，与密钥对不对没有任何关系——解码成功 ≠ 解密成功。'
  },
  {
    icon: 'lock',
    name: '解密成功',
    desc: '密文真的还原出了明文：AES-GCM 认证标签校验通过、SM4 PKCS#7 去填充校验通过。密钥错一位都到不了这一步。'
  },
  {
    icon: 'shield-check',
    name: '验签通过',
    desc: '签名与原文、密钥（公钥）完全匹配：HMAC 显示「与期望一致」，SM2 显示「验签通过」。不匹配时给出明确否定结论。'
  },
  {
    icon: 'alert-triangle',
    name: '缺失参数',
    desc: '密钥 / IV / 签名为空或格式不符时，工具在计算前就指出缺什么（如「IV（nonce）为空：…」「raw 签名应为 128 位 Hex…」），不会带着空参数开算。'
  }
]

/** ── 常见失败：提示文案均为工具真实显示（源码核对 + node 实跑触发），可直接对照 ── */
const FAILURES = [
  {
    err: '认证失败：密钥错误、密文被修改或 AAD 不一致（IV 与认证标签长度也须与加密时相同）',
    where: 'AES 加解密',
    why: '密钥、IV、AAD、认证标签长度任一与加密时不同（node 实测：错一位密钥或 IV 都触发）。GCM 是认证加密，这是真实结论不是工具故障；逐一核对四个参数即可定位。'
  },
  {
    err: 'IV（nonce）为空：加密前请填写或点击「随机 IV」生成',
    where: 'AES 加解密',
    why: '缺 IV。GCM 的 IV 参与认证不能省略；抓包里 IV 通常随密文一起下发，也可能藏在响应头或密文前缀里。'
  },
  {
    err: '密钥解码后 17 字节，需要 32 字节（AES-256）',
    where: 'AES 加解密',
    why: '把口令当密钥粘进去了。本工具不做任何密码派生（PBKDF2 / scrypt）：密钥必须是 16 / 24 / 32 字节原始字节（AES-256 = 32 字节），长度不符会得到精确的字节数错误。'
  },
  {
    err: '密文（含认证标签）共 12 字节，不足认证标签长度（16 字节）：请确认输入的是「密文||认证标签」拼接格式',
    where: 'AES 加解密',
    why: '粘错了字段（比如把 12 字节的 IV 当密文粘了）。输入应为 WebCrypto 输出顺序的「密文||认证标签」拼接，标签固定在末尾。'
  },
  {
    err: '解密失败：PKCS#7 去填充校验未通过（通常是密钥错误或密文被修改；请核对密钥、IV 与模式）',
    where: 'SM4 加解密',
    why: '错误密钥或密文被改的典型信号（node 实测：换一位密钥即触发）。核对密钥（编码别选反）、IV 与模式；密钥正确而密文被改动也会走到这里。'
  },
  {
    err: '解密密文长度错误：当前 79 字节，不是 16 的整数倍（SM4 密文必为 16 字节的整数倍，请检查输入编码或密文是否完整）',
    where: 'SM4 加解密',
    why: '密文被截断 / 复制不完整（node 实测：删 2 个 Hex 字符即触发），或把 Hex 当 Base64 粘（反之亦然）。重新完整复制，并核对输入编码选项。'
  },
  {
    err: '密钥 UTF-8 编码后 32 字节，需要恰好 16 字节（16 个 ASCII 字符；非 ASCII 字符多字节编码会导致超长）',
    where: 'SM4 加解密',
    why: '密钥编码选错：32 个 Hex 字符被按 UTF-8 算成了 32 字节。把「密钥编码」切到 Hex 再试；UTF-8 输入则须恰好 16 个 ASCII 字符。'
  },
  {
    err: '不报错，但明文开头 16 字节是乱码',
    where: 'SM4 加解密（CBC）',
    why: 'IV 错了：CBC 的 IV 只影响第一个分组，后面照常解出（node 实测确认，见示例第 4 步）。密钥错通常是整段乱码或触发去填充报错——按乱码范围先分辨是 IV 还是密钥问题。'
  },
  {
    err: '与期望不一致（红色徽标）',
    where: 'HMAC 计算与校验',
    why: '报文或密钥与签名时不一致（多一个空格也不行），或期望值编码口径不同（Hex 与 Base64）。先用示例报文 + 你的密钥重算一遍：重算值与期望一致说明密钥对、报文被改过。'
  },
  {
    err: '验签不通过：这是一个真实计算出的结论，不是执行错误',
    where: 'SM2 加解密与签名',
    why: '原文、签名、公钥、userId、签名格式（raw 与 DER 不通用）任一不匹配（node 实测：改一位签名、改一个字符原文、换 userId 均触发）。逐项排查；DER 签名（30 开头）当 raw 用是最常见错法。'
  },
  {
    err: 'raw 签名应为 128 位 Hex（r||s 各 64 位），当前 N 位',
    where: 'SM2 加解密与签名',
    why: '粘的签名不是 raw r||s：可能带 04 前缀、是 DER 编码或被截断。按实际格式切换 raw / DER；DER 签名以 30 开头且长度不定。'
  }
]

/** 如实说明：不是 bug，但用前必须知道的真实现象 */
const NOTES = [
  {
    title: 'SM4-CBC 错误 IV 不报错（结构性现象）',
    body: 'CBC 模式下 IV 只参与第一个分组的解密：IV 错了不会失败，只会让开头 16 字节乱码、其余分组正常（node 实测：本场景示例错 IV 时首字节 { 变 k，后 52 字节与正确明文完全一致）。这是 CBC 的数学性质，任何正确实现都如此。识别方法：只有开头乱码 → 查 IV；整段乱码或去填充报错 → 查密钥。AES-GCM 不存在此问题——IV 参与认证，错一位即「认证失败」。'
  },
  {
    title: '「验签不通过」时状态栏不是红色',
    body: 'SM2 验签「不通过」是计算结论而非执行错误：结论面板显示红色「验签不通过」并给出可能原因，状态栏因计算成功显示完成、文案注明「这是一个真实计算出的结论，不是执行错误」。HMAC 的「与期望不一致」同理。读结论面板 / 徽标的文案，不要只看状态栏颜色。'
  }
]

/** ── 相关单项工具（slug 与 app/data/tools.ts 的 crypto 分类一致）── */
const TOOLS = [
  { slug: 'aes', name: 'AES 加解密', desc: 'AES-GCM 本地加解密，密钥与 IV 编码、AAD 可配', icon: 'lock' },
  { slug: 'sm4', name: 'SM4 加解密', desc: '国密 SM4 CBC / ECB，PKCS#7 与 NoPadding 可选', icon: 'shield-check' },
  { slug: 'sm2', name: 'SM2 加解密与签名', desc: '国密 SM2 加解密、签名验签，raw 与 DER 可选', icon: 'shield' },
  { slug: 'sm3', name: 'SM3 摘要', desc: '国密 SM3 摘要计算，Hex 与 Base64 输出', icon: 'fingerprint' },
  { slug: 'hmac', name: 'HMAC 计算与校验', desc: 'HMAC-SHA256 / SHA512 计算与期望值对照', icon: 'key-round' },
  { slug: 'md5-sha', name: 'MD5 / SHA 摘要', desc: 'MD5、SHA-256、SHA-512 摘要与期望值对照', icon: 'hash' }
]

function copyText(text: string, label: string) {
  clipboard.copy(text, label)
}
</script>

<template>
  <div class="scd">
    <header class="scd__head">
      <div class="scd__title">
        <span class="scd__icon"><DkIcon name="lock" :size="17" /></span>
        <div>
          <h1 class="scd__name">加密数据调试</h1>
          <p class="scd__desc">
            AES / SM4 的响应密文解不开，或 HMAC / SM2 的签名校验结果看不清楚：把参数配齐、把结论算清楚——
            AES-GCM 错误参数会认证失败；SM4-CBC 错误 IV 可能只损坏开头，需核对明文与下方说明。
          </p>
        </div>
      </div>
      <NuxtLink to="/privacy" class="scd__local" title="本地处理与隐私说明">
        <DkIcon name="shield-check" :size="13" />
        本地处理 · 密文与密钥不上传
      </NuxtLink>
    </header>

    <section class="panel">
      <!-- ① 一句话问题、支持的输入与产出 -->
      <section class="io">
        <div class="io__col">
          <div class="io__head">
            <DkIcon name="corner-down-left" :size="14" style="color: var(--cat-crypto)" />
            <h2 class="card__title">支持的输入</h2>
          </div>
          <div class="io__chips">
            <span class="io__chip">AES-GCM 密文（Base64 / Hex，密文||认证标签）</span>
            <span class="io__chip">SM4-CBC / ECB 密文（Hex / Base64）</span>
            <span class="io__chip">HMAC 报文原文 + 期望 MAC</span>
            <span class="io__chip">SM2 原文 + 签名（raw / DER）+ 公钥</span>
          </div>
        </div>
        <DkIcon name="arrow-right" :size="16" class="io__arrow" />
        <div class="io__col">
          <div class="io__head">
            <DkIcon name="clipboard" :size="14" style="color: var(--ok)" />
            <h2 class="card__title">得到的结论与产出（全部可复制）</h2>
          </div>
          <div class="io__chips">
            <span class="io__chip">解密明文（认证 / 去填充通过才算）</span>
            <span class="io__chip">HMAC「与期望一致 / 不一致」</span>
            <span class="io__chip">SM2「验签通过 / 不通过」</span>
            <span class="io__chip">失败原因与缺失参数提示</span>
          </div>
        </div>
      </section>

      <!-- 术语：三种结果必须分清 -->
      <section class="terms">
        <div class="terms__head">
          <DkIcon name="info" :size="14" style="color: var(--accent)" />
          <h2 class="card__title">先把结论的措辞分清</h2>
          <span class="grow"></span>
          <span class="terms__note">本场景页与工具文案严格区分这三种结果，不混用</span>
        </div>
        <div class="terms__grid">
          <article v-for="t in TERMS" :key="t.name" class="terms__item">
            <span class="terms__icon"><DkIcon :name="t.icon" :size="14" /></span>
            <div>
              <h3 class="terms__name">{{ t.name }}</h3>
              <p class="terms__desc">{{ t.desc }}</p>
            </div>
          </article>
        </div>
      </section>

      <!-- ②③ 示例数据 + 处理步骤（按问题类型三选一） -->
      <section class="demo">
        <div class="demo__head">
          <span class="badge badge--demo"><DkIcon name="sparkles" :size="12" />示例数据</span>
          <h2 class="card__title">先跑一个真实示例（含正反对照）</h2>
          <span class="grow"></span>
          <DkSegmented
            v-model="mode"
            size="sm"
            :options="MODES.map((m) => ({ value: m.key, label: m.label }))"
            aria-label="选择问题类型"
          />
        </div>
        <p class="demo__hint">
          示例为无敏感信息的造造数据；每条密文 / MAC / 签名与每句工具提示，均于 2026-09-26 用本站工具的同一份执行器
          （node 实跑）核对：正样本逐字还原明文或校验通过；反样本依实际算法展示失败或异常明文，SM4-CBC 错 IV 的边界见下方说明。
          进入对应工具页照参数复现即可。
        </p>

        <div v-for="g in current.groups" :key="g.key" class="demo__group">
          <h3 class="demo__group-title">{{ g.title }}</h3>

          <div class="demo__input">
            <div class="demo__input-head">
              <span class="demo__label">{{ g.inputLabel }}</span>
              <span class="grow"></span>
              <DkButton size="sm" @click="copyText(g.input, '示例输入')">
                <DkIcon name="copy" :size="12" />复制示例输入
              </DkButton>
            </div>
            <pre class="mono demo__code demo__code--wrap">{{ g.input }}</pre>
          </div>

          <dl class="demo__params">
            <div v-for="p in g.params" :key="p.k" class="demo__param">
              <dt class="demo__param-k">{{ p.k }}</dt>
              <dd class="demo__param-v mono">{{ p.v }}</dd>
            </div>
          </dl>

          <ol class="demo__steps">
            <li v-for="s in g.steps" :key="s.title" class="step">
              <div class="step__head">
                <span class="step__dot"><DkIcon name="circle-check" :size="13" /></span>
                <span class="step__title">{{ s.title }}</span>
              </div>
              <p class="step__why">{{ s.why }}</p>
              <p v-if="s.note" class="step__note">{{ s.note }}</p>
              <div v-if="s.out" class="step__out">
                <div class="step__out-head">
                  <span class="step__out-label">{{ s.outLabel }}</span>
                </div>
                <pre class="mono demo__code demo__code--wrap">{{ s.out }}</pre>
              </div>
            </li>
          </ol>

          <div class="demo__verdicts">
            <div class="demo__verdicts-head">
              <DkIcon name="list-checks" :size="13" style="color: var(--ok)" />
              <span class="demo__verdicts-title">正反对照（node 实跑结论，逐字抄录工具提示）</span>
            </div>
            <div v-for="v in g.verdicts" :key="v.label" class="verdict" :class="v.kind === 'ok' ? 'verdict--ok' : 'verdict--bad'">
              <span class="verdict__badge">
                <DkIcon :name="v.kind === 'ok' ? 'circle-check' : 'circle-x'" :size="12" />
                {{ v.kind === 'ok' ? '成功' : '明确失败' }}
              </span>
              <div class="verdict__body">
                <span class="verdict__label">{{ v.label }}</span>
                <span class="verdict__msg mono">{{ v.msg }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ④ 用我的数据处理 -->
      <section class="cta">
        <div class="cta__text">
          <h2 class="cta__title">用我的数据处理</h2>
          <p class="cta__desc">
            单项工具适合直接计算或对照：进入工具页，按示例配齐密钥、IV、签名格式后运行。
            单项工具的数据只在页面内存中处理，离开即清除。
            要串联步骤，可到<NuxtLink to="/workflows" class="cta__inline">处理流程</NuxtLink>的预设库添加
            「AES 响应解密」或「HMAC 签名校验」等预设；HMAC 校验预设要求填写期望值，缺失或不一致时流程明确失败。
            流程中的密钥会在确认风险后保存到本机浏览器。
          </p>
        </div>
        <div class="cta__actions">
          <NuxtLink v-for="c in current.cta" :key="c.to" :to="c.to">
            <DkButton :variant="c.primary ? 'primary' : 'secondary'" size="md">
              <DkIcon name="play" :size="13" />{{ c.button }}
            </DkButton>
          </NuxtLink>
          <NuxtLink v-for="m in MODES.filter((x) => x.key !== mode)" :key="m.key" :to="m.cta[0]!.to">
            <DkButton size="md">
              <DkIcon name="arrow-right" :size="13" />我的问题是{{ m.label }}
            </DkButton>
          </NuxtLink>
        </div>
      </section>

      <!-- ⑤ 常见失败原因 -->
      <section class="fails">
        <div class="fails__head">
          <DkIcon name="alert-triangle" :size="14" style="color: var(--warn)" />
          <h2 class="card__title">常见失败原因</h2>
          <span class="grow"></span>
          <span class="fails__note">提示文案均为工具真实显示，node 实跑触发后逐字抄录，可直接对照</span>
        </div>
        <div class="fails__scroll">
          <table class="fails__table">
            <thead>
              <tr>
                <th>你会看到的提示</th>
                <th>出现在</th>
                <th>原因与下一步</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in FAILURES" :key="f.err">
                <td class="mono fails__err">{{ f.err }}</td>
                <td>
                  <span class="fails__scope">{{ f.where }}</span>
                </td>
                <td>{{ f.why }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 如实说明：真实现象，用前须知 -->
      <section class="notes">
        <div class="notes__head">
          <DkIcon name="info" :size="14" style="color: var(--text-tertiary)" />
          <h2 class="card__title">如实说明（真实现象，不是故障）</h2>
          <span class="grow"></span>
          <span class="badge badge--soft">使用前请知悉</span>
        </div>
        <div class="notes__list">
          <article v-for="n in NOTES" :key="n.title" class="notes__item">
            <h3 class="notes__title">{{ n.title }}</h3>
            <p class="notes__body">{{ n.body }}</p>
          </article>
        </div>
      </section>

      <!-- 数据处理说明 + 相关单项工具入口 -->
      <section class="tools">
        <div class="tools__privacy">
          <div class="card__head">
            <DkIcon name="shield-check" :size="14" style="color: var(--cat-crypto)" />
            <h2 class="card__title">数据处理说明</h2>
          </div>
          <p class="card__body">
            本页只有固定示例，不接收任何输入；你的密文、密钥、签名不经过本页，也不进入 URL 或分享链接。
            单项工具页里，密钥与密文只存在于当前页面内存，刷新或离开即清除，不上传、不写 localStorage。
            若把含密钥的步骤加进「处理流程」，密钥在你确认风险后仅保存到本机浏览器 localStorage（设置页可清除）；
            运行记录只存状态与耗时，不含输入输出。详见<NuxtLink to="/privacy" class="card__inline">本地处理与隐私</NuxtLink>。
          </p>
        </div>
        <div class="tools__grid-wrap">
          <div class="card__head">
            <DkIcon name="grid" :size="14" style="color: var(--cat-crypto)" />
            <h2 class="card__title">相关单项工具</h2>
            <span class="grow"></span>
            <span class="tools__note">本场景的计算全部由这些工具执行</span>
          </div>
          <div class="tools__grid">
            <NuxtLink v-for="t in TOOLS" :key="t.slug" :to="`/tools/${t.slug}`" class="tools__item">
              <span class="tools__icon"><DkIcon :name="t.icon" :size="14" /></span>
              <span class="tools__info">
                <span class="tools__name">{{ t.name }}</span>
                <span class="tools__desc">{{ t.desc }}</span>
              </span>
              <DkIcon name="chevron-right" :size="14" class="tools__go" />
            </NuxtLink>
          </div>
        </div>
      </section>
    </section>

    <section class="outro">
      <div>
        <h2 class="outro__title">解开了，接下来呢</h2>
        <p class="outro__desc">密文解开后是 JSON？格式化核对结构与字段；要核对散列 / 摘要，用 MD5 / SHA 工具。</p>
      </div>
      <div class="outro__actions">
        <NuxtLink to="/tools/json-format">
          <DkButton variant="primary" size="sm"><DkIcon name="braces" :size="13" />JSON 格式化</DkButton>
        </NuxtLink>
        <NuxtLink to="/tools/md5-sha">
          <DkButton size="sm"><DkIcon name="hash" :size="13" />MD5 / SHA 摘要</DkButton>
        </NuxtLink>
        <NuxtLink to="/workflows">
          <DkButton size="sm"><DkIcon name="workflow" :size="13" />全部处理流程</DkButton>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scd {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.scd__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.scd__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.scd__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--cat-crypto-soft);
  color: var(--cat-crypto);
  flex-shrink: 0;
}
.scd__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.scd__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.scd__local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.scd__local:hover {
  text-decoration: none;
  color: var(--accent);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 28px 30px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.card__head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.card__title {
  font-size: 13px;
  font-weight: 600;
}
.card__body {
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.card__inline {
  color: var(--accent);
}

/* ① 输入 / 产出 */
.io {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 16px;
  align-items: center;
}
.io__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.io__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.io__arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.io__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.io__chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-primary);
}

/* 术语 */
.terms {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.terms__head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.terms__note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.terms__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.terms__item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 13px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.terms__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--cat-crypto-soft);
  color: var(--cat-crypto);
  flex-shrink: 0;
}
.terms__name {
  font-size: 12.5px;
  font-weight: 600;
}
.terms__desc {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* ②③ 示例 + 步骤 */
.demo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.demo__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.demo__hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.7;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.badge--soft {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.badge--demo {
  background: var(--accent-soft);
  color: var(--accent);
}
.demo__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-subtle);
}
.demo__group-title {
  font-size: 13px;
  font-weight: 600;
}
.demo__input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.demo__input-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.demo__label {
  font-size: 12px;
  font-weight: 500;
}
.demo__code {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--editor-bg);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
  overflow-x: auto;
}
.demo__code--wrap {
  white-space: pre-wrap;
  word-break: break-all;
}
.demo__params {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.demo__param {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 9px 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.demo__param-k {
  font-size: 11px;
  color: var(--text-tertiary);
}
.demo__param-v {
  margin: 0;
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.7;
  word-break: break-all;
}
.demo__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.step__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.step__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--cat-crypto-soft);
  color: var(--cat-crypto);
  flex-shrink: 0;
}
.step__title {
  font-size: 12.5px;
  font-weight: 600;
}
.step__why {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.step__note {
  margin: 8px 0 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--surface-subtle);
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.7;
  word-break: break-word;
}
.step__out {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.step__out-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.step__out-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 正反对照 */
.demo__verdicts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.demo__verdicts-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.demo__verdicts-title {
  font-size: 12px;
  font-weight: 600;
}
.verdict {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
}
.verdict--ok {
  border-left: 2px solid var(--ok);
}
.verdict--bad {
  border-left: 2px solid var(--error);
}
.verdict__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.verdict--ok .verdict__badge {
  background: var(--ok-soft);
  color: var(--ok);
}
.verdict--bad .verdict__badge {
  background: var(--error-soft);
  color: var(--error);
}
.verdict__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.verdict__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.verdict__msg {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.7;
  word-break: break-all;
}

/* ④ CTA */
.cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border: 1px solid var(--accent-ring);
  border-radius: 10px;
  background: var(--accent-soft);
  flex-wrap: wrap;
}
.cta__title {
  font-size: 14px;
  font-weight: 700;
}
.cta__desc {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  max-width: 640px;
}
.cta__inline {
  color: var(--accent);
}
.cta__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ⑤ 常见失败 */
.fails {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fails__head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.fails__note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.fails__scroll {
  overflow-x: auto;
}
.fails__table {
  width: 100%;
  min-width: 720px;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 12px;
}
.fails__table th,
.fails__table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.fails__table thead th {
  background: var(--surface-subtle);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.fails__table tbody tr:last-child td {
  border-bottom: none;
}
.fails__err {
  font-size: 11px;
  color: var(--error);
  word-break: break-all;
  width: 42%;
}
.fails__scope {
  display: block;
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
}
.fails__table td:last-child {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 如实说明 */
.notes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.notes__head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.notes__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.notes__item {
  padding: 14px 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.notes__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.notes__body {
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 数据说明 + 工具入口 */
.tools {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) minmax(380px, 7fr);
  gap: 20px;
  align-items: start;
}
.tools__privacy,
.tools__grid-wrap {
  padding: 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.tools__grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tools__note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.tools__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.tools__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-secondary);
}
.tools__item:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.tools__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--cat-crypto-soft);
  color: var(--cat-crypto);
  flex-shrink: 0;
}
.tools__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.tools__name {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 500;
}
.tools__desc {
  font-size: 10.5px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tools__go {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.outro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 4px;
}
.outro__title {
  font-size: 13.5px;
  font-weight: 600;
}
.outro__desc {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.outro__actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
@media (max-width: 1000px) {
  .io {
    grid-template-columns: 1fr;
  }
  .io__arrow {
    transform: rotate(90deg);
    align-self: center;
  }
  .terms__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .notes__list {
    grid-template-columns: 1fr;
  }
  .tools {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .demo__params {
    grid-template-columns: 1fr;
  }
  .terms__grid {
    grid-template-columns: 1fr;
  }
  .tools__grid {
    grid-template-columns: 1fr;
  }
  .scd__head {
    flex-direction: column;
    align-items: flex-start;
  }
  .cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .outro {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
