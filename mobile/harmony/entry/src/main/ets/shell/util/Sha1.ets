/**
 * SHA-1 摘要（RFC 3174）。
 *
 * ## 为什么自己实现
 *
 * 只有一处用它：WebSocket 握手的 `Sec-WebSocket-Accept` 计算（RFC 6455 §4.2.2）。
 * 那是**协议校验**，不是安全边界——真正的安全在 TLS 与凭证上。
 *
 * 用平台 crypto API（`@ohos.security.cryptoFramework`）当然也行，但那个接口在鸿蒙上
 * 以「算法名字符串」区分实现（本壳用的是 `SHA1`），而这个字符串在编译期无法校验；
 * 万一名字不被接受，握手会在真机上才失败。摘要算法本身是固定且可离线验证的，
 * 所以这里给它一份自足的实现：把 RFC 3174 的测试向量离线核对过，结果与标准一致。
 */
export class Sha1 {
  /**
   * 计算摘要。
   *
   * @param input 待摘要的字节。
   * @returns 20 字节的摘要。
   */
  static digest(input: Uint8Array): Uint8Array {
    const bitLength = input.length * 8;
    // 末尾补 0x80，再补零到长度 ≡ 56 (mod 64)，最后 8 字节是原始长度（大端）。
    const padded = new Uint8Array(((input.length + 8) >> 6 << 6) + 64);
    padded.set(input);
    padded[input.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(padded.length - 4, bitLength >>> 0);

    let h0 = 0x67452301;
    let h1 = 0xEFCDAB89;
    let h2 = 0x98BADCFE;
    let h3 = 0x10325476;
    let h4 = 0xC3D2E1F0;
    const words = new Uint32Array(80);

    for (let block = 0; block < padded.length; block += 64) {
      for (let index = 0; index < 16; index++) {
        words[index] = view.getUint32(block + index * 4);
      }
      for (let index = 16; index < 80; index++) {
        words[index] = Sha1.rotl(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      for (let index = 0; index < 80; index++) {
        let f = 0;
        let k = 0;
        if (index < 20) {
          f = (b & c) | (~b & d);
          k = 0x5A827999;
        } else if (index < 40) {
          f = b ^ c ^ d;
          k = 0x6ED9EBA1;
        } else if (index < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8F1BBCDC;
        } else {
          f = b ^ c ^ d;
          k = 0xCA62C1D6;
        }
        const temp = (Sha1.rotl(a, 5) + f + e + k + words[index]) >>> 0;
        e = d;
        d = c;
        c = Sha1.rotl(b, 30);
        b = a;
        a = temp;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }

    const digest = new Uint8Array(20);
    const out = new DataView(digest.buffer);
    out.setUint32(0, h0);
    out.setUint32(4, h1);
    out.setUint32(8, h2);
    out.setUint32(12, h3);
    out.setUint32(16, h4);
    return digest;
  }

  /** 32 位左循环移位。 */
  private static rotl(value: number, bits: number): number {
    return ((value << bits) | (value >>> (32 - bits))) >>> 0;
  }
}
