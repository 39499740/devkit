/** SM3（GB/T 32905-2016）：sm-crypto 实现，工具页（t16）与流程步骤 sm3 共用 */
import smCrypto from 'sm-crypto'
import { bytesToHex, hexToBytes } from '../bytes'

const { sm3 } = smCrypto

/** 传数组而不是字符串：sm-crypto 对字符串会先做编码判断，字节输入必须走数组分支 */
export function computeSm3Bytes(bytes: Uint8Array): Uint8Array {
  return hexToBytes(sm3(Array.from(bytes))).bytes
}

export function computeSm3(bytes: Uint8Array): string {
  return bytesToHex(computeSm3Bytes(bytes))
}
