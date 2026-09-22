/** HMAC：WebCrypto importKey + sign，工具页（t13）与流程步骤 hmac 共用 */
import { toArrayBuffer } from './encoding'

export type HmacAlgo = 'SHA-256' | 'SHA-512'

export const hmacAlgoOptions: { value: HmacAlgo; label: string }[] = [
  { value: 'SHA-256', label: 'SHA-256' },
  { value: 'SHA-512', label: 'SHA-512' }
]

export async function computeHmac(algo: HmacAlgo, keyBytes: Uint8Array, messageBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'HMAC', hash: algo }, false, [
    'sign'
  ])
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(messageBytes))
  return new Uint8Array(sig)
}
