import { describe, expect, it } from 'vitest';
import { decryptAes128Ecb, encryptAes128Ecb, getPkcs7PaddedSize } from '@/services/remote/wechat/wechat-crypto';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe('wechat-crypto', () => {
  it('encrypts and decrypts AES-128-ECB symmetrically', () => {
    const key = new Uint8Array(Array.from({ length: 16 }, (_, index) => index + 1));
    const plaintext = new TextEncoder().encode('hello wechat crypto');

    const encrypted = encryptAes128Ecb(plaintext, key);
    const decrypted = decryptAes128Ecb(encrypted, base64(key));

    expect(new TextDecoder().decode(decrypted)).toBe('hello wechat crypto');
  });

  it('calculates PKCS7 padded size', () => {
    expect(getPkcs7PaddedSize(0)).toBe(16);
    expect(getPkcs7PaddedSize(15)).toBe(16);
    expect(getPkcs7PaddedSize(16)).toBe(32);
    expect(getPkcs7PaddedSize(17)).toBe(32);
  });
});
