import CryptoJS from 'crypto-js';

function wordArrayFromUint8Array(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      continue;
    }

    const wordIndex = index >>> 2;
    words[wordIndex] = (words[wordIndex] ?? 0) | (byte << (24 - (index % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function uint8ArrayFromWordArray(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wordArray;
  const result = new Uint8Array(sigBytes);

  for (let i = 0; i < sigBytes; i += 1) {
    const word = words[i >>> 2] ?? 0;
    result[i] = (word >>> (24 - (i % 4) * 8)) & 0xff;
  }

  return result;
}

export function decryptAes128Ecb(ciphertext: Uint8Array, base64Key: string): Uint8Array {
  const key = CryptoJS.enc.Base64.parse(base64Key);
  const encrypted = wordArrayFromUint8Array(ciphertext);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encrypted } as CryptoJS.lib.CipherParams,
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  );
  return uint8ArrayFromWordArray(decrypted);
}

export function encryptAes128Ecb(plaintext: Uint8Array, rawKey: Uint8Array): Uint8Array {
  const key = wordArrayFromUint8Array(rawKey);
  const encrypted = CryptoJS.AES.encrypt(wordArrayFromUint8Array(plaintext), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return uint8ArrayFromWordArray(encrypted.ciphertext);
}

export function getPkcs7PaddedSize(size: number): number {
  return Math.ceil((size + 1) / 16) * 16;
}
