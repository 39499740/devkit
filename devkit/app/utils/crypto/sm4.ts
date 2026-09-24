/** SM4：sm-crypto 实现（CBC / ECB、PKCS#7 或无填充），工具页（t17）与流程步骤 sm4 共用 */
import smCrypto from 'sm-crypto'

const { sm4 } = smCrypto

export type Sm4Mode = 'cbc' | 'ecb'
export type Sm4Padding = 'pkcs#7' | 'none'

export interface Sm4Options {
  mode: Sm4Mode
  padding: Sm4Padding
  /** CBC 必填，16 字节的 Hex */
  ivHex?: string
}

export const sm4ModeOptions: { value: Sm4Mode; label: string }[] = [
  { value: 'cbc', label: 'CBC' },
  { value: 'ecb', label: 'ECB' }
]

export const sm4PaddingOptions: { value: Sm4Padding; label: string }[] = [
  { value: 'pkcs#7', label: 'PKCS#7 填充' },
  { value: 'none', label: '无填充（数据须为 16 字节整数倍）' }
]

export const SM4_BLOCK_BYTES = 16

/** Hex 里混入非十六进制字符时必须报错，否则会被底层静默当 0 处理，产出看似成功的错误结果 */
function assertHexChars(hex: string, label: string): void {
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error(`${label} Hex 非法：包含非十六进制字符`)
}

export function assertSm4KeyHex(keyHex: string): void {
  assertHexChars(keyHex, '密钥')
  const len = keyHex.length / 2
  if (len !== SM4_BLOCK_BYTES) {
    throw new Error(`密钥解码后 ${len} 字节，需要 16 字节（SM4 密钥固定 128 位）`)
  }
}

export function assertSm4IvHex(ivHex: string | undefined): void {
  const hex = ivHex ?? ''
  if (!hex) throw new Error('IV 为空：CBC 模式需要 16 字节 IV（32 个 Hex 字符）')
  assertHexChars(hex, 'IV')
  const len = hex.length / 2
  if (len !== SM4_BLOCK_BYTES) throw new Error(`IV 解码后 ${len} 字节，需要 16 字节（32 个 Hex 字符）`)
}

function options(o: Sm4Options): { mode: string; padding: string; iv?: string; output: 'array' } {
  const out: { mode: string; padding: string; iv?: string; output: 'array' } = {
    mode: o.mode,
    padding: o.padding === 'none' ? 'none' : 'pkcs#7',
    output: 'array'
  }
  if (o.mode === 'cbc') out.iv = o.ivHex ?? ''
  return out
}

export function sm4Encrypt(data: Uint8Array, keyHex: string, o: Sm4Options): Uint8Array {
  assertSm4KeyHex(keyHex)
  if (o.mode === 'cbc') assertSm4IvHex(o.ivHex)
  if (o.padding === 'none' && data.length % SM4_BLOCK_BYTES !== 0) {
    throw new Error(
      `无填充（NoPadding）要求数据长度为 16 字节整数倍：当前 ${data.length} 字节，可改用 PKCS#7 填充`
    )
  }
  return new Uint8Array(sm4.encrypt(Array.from(data), keyHex, options(o)) as number[])
}

export function sm4Decrypt(data: Uint8Array, keyHex: string, o: Sm4Options): Uint8Array {
  assertSm4KeyHex(keyHex)
  if (o.mode === 'cbc') assertSm4IvHex(o.ivHex)
  if (data.length % SM4_BLOCK_BYTES !== 0) {
    throw new Error(
      `密文长度错误：当前 ${data.length} 字节，不是 16 的整数倍（SM4 密文必为 16 字节整数倍，请检查密文是否完整）`
    )
  }
  return new Uint8Array(sm4.decrypt(Array.from(data), keyHex, options(o)) as number[])
}
