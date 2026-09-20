/** 下载文本为文件 */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  if (import.meta.server) return
  const blob = new Blob([text], { type: mime })
  downloadBlob(filename, blob)
}

/** 下载 Blob 为文件 */
export function downloadBlob(filename: string, blob: Blob) {
  if (import.meta.server) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** UTF-8 字节数（TextEncoder） */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/** 统计行数（\n 分隔） */
export function lineCount(s: string): number {
  if (!s) return 0
  return s.split('\n').length
}

/** 字符数（UTF-16 码元） */
export function charCount(s: string): number {
  return s.length
}

/** 码点数（真实字符数，含 emoji 单字符统计） */
export function codePointCount(s: string): number {
  return [...s].length
}

/** 格式化字节数显示 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** bytes → hex 小写 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** hex → bytes，忽略空白，校验合法性 */
export function hexToBytes(hex: string): { bytes: Uint8Array; error?: string } {
  const clean = hex.replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]*$/.test(clean)) return { bytes: new Uint8Array(0), error: 'Hex 中包含非十六进制字符' }
  if (clean.length % 2 !== 0) return { bytes: new Uint8Array(0), error: 'Hex 长度必须为偶数' }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return { bytes: out }
}

/** bytes → base64 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** base64 → bytes（允许空白） */
export function base64ToBytes(b64: string): { bytes: Uint8Array; error?: string } {
  const clean = b64.replace(/\s+/g, '')
  if (!clean) return { bytes: new Uint8Array(0), error: 'Base64 为空' }
  if (!/^[A-Za-z0-9+/\-_=]*$/.test(clean)) return { bytes: new Uint8Array(0), error: 'Base64 中包含非法字符' }
  const normalized = clean.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const bin = atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return { bytes: out }
  } catch {
    return { bytes: new Uint8Array(0), error: 'Base64 格式错误，无法解码' }
  }
}

/** 字符串 → UTF-8 bytes */
export function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** UTF-8 bytes → 字符串（失败返回 error） */
export function bytesToText(bytes: Uint8Array): { text: string; error?: string } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text }
  } catch {
    return { text: '', error: '解码结果不是有效的 UTF-8 文本（可能为二进制数据）' }
  }
}

/** 是否大概率可打印文本（用于二进制判断提示） */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  let printable = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++
  }
  return n === 0 || printable / n > 0.9
}
