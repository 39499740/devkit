declare module 'sm-crypto' {
  export const sm2: {
    generateKeyPairHex(): { publicKey: string; privateKey: string }
    getPublicKeyFromPrivateKey(privateKey: string): string
    compressPublicKeyHex(publicKey: string): string
    comparePublicKeyHex(a: string, b: string): boolean
    verifyPublicKey(publicKey: string): boolean
    doEncrypt(msg: string, publicKey: string, cipherMode?: number): string
    doDecrypt(encryptData: string, privateKey: string, cipherMode?: number): string
    doSignature(
      msg: string,
      privateKey: string,
      options?: { pointPool?: unknown; der?: boolean; hash?: boolean; publicKey?: string; userId?: string }
    ): string
    doVerifySignature(
      msg: string,
      signValue: string,
      publicKey: string,
      options?: { der?: boolean; hash?: boolean; userId?: string }
    ): boolean
  }
  export function sm3(input: string | number[] | Uint8Array | ArrayBuffer, options?: { hash?: boolean }): string
  export const sm4: {
    encrypt(
      msg: string | number[],
      key: string | number[],
      options?: { mode?: string; iv?: string | number[]; padding?: string; output?: string }
    ): string | number[]
    decrypt(
      msg: string | number[],
      key: string | number[],
      options?: { mode?: string; iv?: string | number[]; padding?: string; output?: string }
    ): string | number[]
  }
}

declare module 'sm-crypto/src/sm2/utils' {
  interface CurvePoint {
    getX(): { toBigInteger(): { toString(radix: number): string } }
    getY(): { toBigInteger(): { toString(radix: number): string } }
    multiply(n: unknown): CurvePoint
  }
  interface Curve {
    decodePointHex(hex: string): CurvePoint
  }
  const utils: { getGlobalCurve(): Curve }
  export default utils
}

declare module 'jsbn' {
  export class BigInteger {
    constructor(value: string | number | bigint, radix?: number)
    toString(radix?: number): string
  }
}
