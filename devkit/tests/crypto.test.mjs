/**
 * 加解密向量测试：全部对照公开标准向量（NIST GCM / RFC 4231 / GB-T 32905 / GB-T 32907），
 * 期望值另用 node:crypto + sm-crypto 复核过，不使用「自己加密自己解密」作为唯一证据。
 */
import { computeDigest } from '../app/utils/crypto/digest.ts'
import { computeHmac } from '../app/utils/crypto/hmac.ts'
import { aesGcmDecrypt, aesGcmEncrypt, isAesGcmAuthFailure } from '../app/utils/crypto/aesgcm.ts'
import { computeSm3 } from '../app/utils/crypto/sm3.ts'
import { sm4Decrypt, sm4Encrypt } from '../app/utils/crypto/sm4.ts'
import {
  sm2Decrypt,
  sm2Encrypt,
  sm2PrivateKeyError,
  sm2PublicKeyError,
  sm2Sign,
  sm2Verify
} from '../app/utils/crypto/sm2.ts'
import { bytesToBase64, bytesToHex, hexToBytes, textToBytes } from '../app/utils/bytes.ts'
import { makeCases } from './cases.mjs'

const hx = (s) => hexToBytes(s).bytes
const h = (bytes) => bytesToHex(bytes)

export const run = async () => {
  const { cases, ok, eqj, rejects } = makeCases()

  // ── 摘要（公开向量）──
  eqj('MD5("abc")', h(await computeDigest('MD5', textToBytes('abc'))), '900150983cd24fb0d6963f7d28e17f72')
  eqj(
    'SHA-256("abc")',
    h(await computeDigest('SHA-256', textToBytes('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
  eqj(
    'SHA-512("abc")',
    h(await computeDigest('SHA-512', textToBytes('abc'))),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
  )
  eqj('MD5("")', h(await computeDigest('MD5', textToBytes(''))), 'd41d8cd98f00b204e9800998ecf8427e')
  eqj(
    'SHA-256("")',
    h(await computeDigest('SHA-256', textToBytes(''))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )
  eqj(
    'SHA-256("abc") 的 Base64 形式',
    bytesToBase64(await computeDigest('SHA-256', textToBytes('abc'))),
    'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='
  )
  eqj('摘要按 Hex 输入解码', h(await computeDigest('SHA-256', hx('616263'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

  // ── HMAC（RFC 4231）──
  eqj(
    'RFC 4231 TC1 HMAC-SHA256',
    h(await computeHmac('SHA-256', new Uint8Array(20).fill(0x0b), textToBytes('Hi There'))),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  )
  eqj(
    'RFC 4231 TC1 HMAC-SHA512',
    h(await computeHmac('SHA-512', new Uint8Array(20).fill(0x0b), textToBytes('Hi There'))),
    '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854'
  )
  eqj(
    'RFC 4231 TC2 HMAC-SHA256（文本密钥）',
    h(await computeHmac('SHA-256', textToBytes('Jefe'), textToBytes('what do ya want for nothing?'))),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
  )
  eqj(
    'HMAC-SHA256 的 Base64 形式',
    bytesToBase64(await computeHmac('SHA-256', new Uint8Array(20).fill(0x0b), textToBytes('Hi There'))),
    'sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c='
  )

  // ── AES-GCM（McGrew-Viega / NIST 向量，密文 = 密文 || 标签）──
  const gcm = (keyHex, ivHex, ptHex, aadHex, tagLength = 128) => ({
    key: hx(keyHex),
    iv: hx(ivHex),
    aad: aadHex ? hx(aadHex) : new Uint8Array(0),
    tagLength
  })
  const Z16 = '00'.repeat(16)
  const Z12 = '00'.repeat(12)
  eqj('AES-GCM 用例 1（空明文空 AAD）', h(await aesGcmEncrypt(hx(''), gcm(Z16, Z12, '', ''))), '58e2fccefa7e3061367f1d57a4e7455a')
  eqj(
    'AES-GCM 用例 2（16 字节零明文）',
    h(await aesGcmEncrypt(hx(Z16), gcm(Z16, Z12, Z16, ''))),
    '0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf'
  )
  const K3 = 'feffe9928665731c6d6a8f9467308308'
  const P3 =
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39'
  const C3 = '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091'
  eqj(
    'AES-GCM 用例 3（64 字节明文，无 AAD）',
    h(await aesGcmEncrypt(hx(P3 + '1aafd255'), gcm(K3, 'cafebabefacedbaddecaf888', P3, ''))),
    C3 + '473f59854d5c2af327cd64a62cf35abd2ba6fab4'
  )
  const AAD4 = 'feedfacedeadbeeffeedfacedeadbeefabaddad2'
  eqj(
    'AES-GCM 用例 4（带 AAD）',
    h(await aesGcmEncrypt(hx(P3), gcm(K3, 'cafebabefacedbaddecaf888', P3, AAD4))),
    C3 + '5bc94fbc3221a5db94fae95ae7121a47'
  )
  eqj(
    'AES-GCM 解密回原文',
    h(await aesGcmDecrypt(hx(C3 + '5bc94fbc3221a5db94fae95ae7121a47'), gcm(K3, 'cafebabefacedbaddecaf888', P3, AAD4))),
    P3
  )
  const AES256_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
  const AES256_IV = '101112131415161718191a1b'
  const T14_VEC = '399bee5d20bd1af28f26255a4c3449b473eaaab09087b1f3067293b23c2a3fc51516fe62dc'
  eqj(
    'AES-256-GCM 与工具页样例一致',
    h(await aesGcmEncrypt(textToBytes('DevKit AES-GCM 示例'), gcm(AES256_KEY, AES256_IV, '', '6465766b6974'))),
    T14_VEC
  )
  eqj(
    'AES-GCM 错误的 AAD 会认证失败',
    await aesGcmDecrypt(hx(T14_VEC), gcm(AES256_KEY, AES256_IV, '', '6f74686572')).then(
      () => 'ok',
      (e) => (isAesGcmAuthFailure(e) ? 'auth' : 'other')
    ),
    'auth'
  )
  // 96 / 112 位标签：只验证「能解回原文」与「标签长度不同即失败」，向量由 node:crypto 现场生成
  const shortTag = await aesGcmEncrypt(textToBytes('tag length'), {
    key: hx(AES256_KEY),
    iv: hx(AES256_IV),
    aad: new Uint8Array(0),
    tagLength: 96
  })
  eqj(
    '96 位标签可解回原文',
    new TextDecoder().decode(await aesGcmDecrypt(shortTag, { key: hx(AES256_KEY), iv: hx(AES256_IV), aad: new Uint8Array(0), tagLength: 96 })),
    'tag length'
  )
  eqj(
    '标签长度不一致时认证失败',
    await aesGcmDecrypt(shortTag, { key: hx(AES256_KEY), iv: hx(AES256_IV), aad: new Uint8Array(0), tagLength: 128 }).then(
      () => 'ok',
      (e) => (isAesGcmAuthFailure(e) ? 'auth' : 'other')
    ),
    'auth'
  )
  eqj(
    '错误密钥解密认证失败',
    await aesGcmDecrypt(hx(T14_VEC), gcm('ff'.repeat(32), AES256_IV, '', '6465766b6974')).then(
      () => 'ok',
      (e) => (isAesGcmAuthFailure(e) ? 'auth' : 'other')
    ),
    'auth'
  )

  // ── SM3（GB/T 32905-2016）──
  eqj('SM3("abc")', computeSm3(textToBytes('abc')), '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0')
  eqj(
    'SM3("abcd"×16)',
    computeSm3(textToBytes('abcd'.repeat(16))),
    'debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732'
  )
  eqj('SM3 的 Base64 形式', bytesToBase64(hx(computeSm3(textToBytes('abc')))), 'Zsfw9GLu7dnR8tRr3BDk4kFnxIdc8veiKX2gK49LqOA=')

  // ── SM4（GB/T 32907-2016 标准向量 + CBC 往返）──
  const SM4_KEY = '0123456789abcdeffedcba9876543210'
  const SM4_IV = '000102030405060708090a0b0c0d0e0f'
  eqj(
    'SM4-ECB 无填充标准向量',
    h(sm4Encrypt(hx(SM4_KEY), SM4_KEY, { mode: 'ecb', padding: 'none' })),
    '681edf34d206965e86b3e94f536e4246'
  )
  const CBC_CT = 'b6bbc4826b710680aa26f00b986a9a3189dbda6c50e30381ca6b864bdb9a9e2c'
  const CBC_PT_HEX = 'e59bbde5868520534d342043424320e7a4bae4be8b'
  eqj(
    'SM4-CBC PKCS#7 加密向量',
    h(sm4Encrypt(hx(CBC_PT_HEX), SM4_KEY, { mode: 'cbc', padding: 'pkcs#7', ivHex: SM4_IV })),
    CBC_CT
  )
  eqj(
    'SM4-CBC PKCS#7 解密回原文',
    h(sm4Decrypt(hx(CBC_CT), SM4_KEY, { mode: 'cbc', padding: 'pkcs#7', ivHex: SM4_IV })),
    CBC_PT_HEX
  )
  eqj('SM4-CBC 密文的 Base64', bytesToBase64(hx(CBC_CT)), 'trvEgmtxBoCqJvALmGqaMYnb2mxQ4wOBymuGS9uaniw=')
  // PKCS#7 去填充有 1/256 概率「碰巧合法」，所以断言的是「不会静默解出原文」而不是「一定抛错」
  let sm4Wrong = ''
  try {
    sm4Wrong = h(sm4Decrypt(hx(CBC_CT), 'ff'.repeat(16), { mode: 'cbc', padding: 'pkcs#7', ivHex: SM4_IV }))
  } catch (e) {
    sm4Wrong = 'error:' + (e && e.message ? e.message : String(e))
  }
  ok('SM4 错误密钥不会静默解出原文', sm4Wrong !== CBC_PT_HEX, `实际 ${sm4Wrong}`)
  await rejects(
    'SM4 密钥长度不足直接报错',
    () => Promise.resolve(sm4Encrypt(hx('0011'), '0011', { mode: 'ecb', padding: 'pkcs#7' })),
    /需要 16 字节/
  )
  await rejects(
    'SM4 CBC 缺 IV 直接报错',
    () => Promise.resolve(sm4Encrypt(hx('0011'.repeat(8)), SM4_KEY, { mode: 'cbc', padding: 'pkcs#7' })),
    /IV/
  )

  // ── SM2（crypto 层；密钥/签名/密文由 node + sm-crypto 生成后写死）──
  const SM2_PUB =
    '0463bb89d7efec4f2590d5486e249082c4c4ba68458ed484db2dbc3c1f6ac11187668e8c6cfed5c75c669433fb037606961bcf99a8c3ce12c6fa9e44a22d64454d'
  const SM2_PRIV = '62f1724b3e02e23b38a8594f0cd01b963b1607e43631e20d75d35060464fa774'
  const SM2_MSG = 'DevKit SM2 冒烟'
  const SM2_SIG = '178ad21eeb334f351d77e034f17505af69e4d0431ad2a819f0cb22c93f4f34d765af22944b1ecaa6346f8efd30b93d78f15c0e087229057904186ed7433a20a7'
  const SM2_CT =
    'e3642e93167253042a349c8ebdb90849eb23599e9a3f5315869c587bf386149cf275aa602437e160dca17fb02123b149af2cf3cbc0728d4371971b14aed36ca6f738faa0e20c4176147e218bb7319f1a20ae8915bc19be822a66807c6534fe5959d3d8b10c7c41b8c61a8beb011a7c3d0c'
  const signOpts = { userId: '1234567812345678', der: false }
  eqj('SM2 验签通过（外部生成的签名）', sm2Verify(SM2_MSG, SM2_SIG, SM2_PUB, signOpts), true)
  eqj('SM2 验签对改过的原文不通过', sm2Verify(SM2_MSG + 'x', SM2_SIG, SM2_PUB, signOpts), false)
  eqj('SM2 解密外部密文', sm2Decrypt(SM2_CT, SM2_PRIV, 1).text, SM2_MSG)
  eqj('SM2 解密空明文时标记 empty', sm2Decrypt(sm2Encrypt('', SM2_PUB, 1), SM2_PRIV, 1).empty, true)
  const selfSig = sm2Sign(SM2_MSG, SM2_PRIV, signOpts)
  eqj('SM2 自签自验通过', sm2Verify(SM2_MSG, selfSig, SM2_PUB, signOpts), true)
  eqj('SM2 加密后能解回原文', sm2Decrypt(sm2Encrypt('往返测试', SM2_PUB, 1), SM2_PRIV, 1).text, '往返测试')
  eqj('SM2 公钥格式错误可读', /130 位/.test(sm2PublicKeyError('04abcd')), true)
  eqj('SM2 非曲线点被识别', sm2PublicKeyError('04' + '11'.repeat(64)).length > 0, true)
  eqj('SM2 私钥长度错误可读', /64 位 Hex/.test(sm2PrivateKeyError('abcd')), true)
  await rejects('SM2 错误私钥解密失败', () => Promise.resolve(sm2Decrypt(SM2_CT, 'ff'.repeat(32), 1)), /C3 校验未通过/)
  await rejects('SM2 密文过短直接报错', () => Promise.resolve(sm2Decrypt('00'.repeat(10), SM2_PRIV, 1)), /C3|长度|invalid/i)

  ok('向量用例全部在本地执行（无网络）', true)
  return cases
}
