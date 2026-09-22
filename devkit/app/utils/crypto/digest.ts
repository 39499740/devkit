/**
 * 摘要：MD5 走 spark-md5，SHA-256 / SHA-512 走 WebCrypto。
 * 工具页（t12）与流程步骤 digest 共用这一份实现。
 */
import SparkMD5 from 'spark-md5'
import { hexToBytes } from '../bytes'
import { toArrayBuffer } from './encoding'

export type DigestAlgo = 'MD5' | 'SHA-256' | 'SHA-512'

export const digestAlgoOptions: { value: DigestAlgo; label: string }[] = [
  { value: 'MD5', label: 'MD5' },
  { value: 'SHA-256', label: 'SHA-256' },
  { value: 'SHA-512', label: 'SHA-512' }
]

export async function computeDigest(algo: DigestAlgo, bytes: Uint8Array): Promise<Uint8Array> {
  if (algo === 'MD5') {
    const spark = new SparkMD5.ArrayBuffer()
    spark.append(toArrayBuffer(bytes))
    // end() 会重置内部状态，只能调用一次
    return hexToBytes(spark.end(false)).bytes
  }
  return new Uint8Array(await crypto.subtle.digest(algo, toArrayBuffer(bytes)))
}
