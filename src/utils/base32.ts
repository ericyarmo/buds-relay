/**
 * Base32 Encoding (RFC 4648)
 * Used for CIDv1 encoding to match iOS implementation
 */

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Encode bytes to base32 (lowercase, RFC 4648)
 * Matches iOS Base32.encode() implementation
 */
export function encodeBase32(bytes: Uint8Array): string {
  let result = '';
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;

    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      const index = (buffer >> bitsInBuffer) & 0x1f;
      result += BASE32_ALPHABET[index];
    }
  }

  // Handle remaining bits
  if (bitsInBuffer > 0) {
    const index = (buffer << (5 - bitsInBuffer)) & 0x1f;
    result += BASE32_ALPHABET[index];
  }

  // Add padding (though CIDv1 typically doesn't use padding)
  while (result.length % 8 !== 0) {
    result += '=';
  }

  return result;
}

/**
 * Decode base32 to bytes (lowercase, RFC 4648)
 */
export function decodeBase32(str: string): Uint8Array {
  const cleanStr = str.toLowerCase().replace(/=/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const char of cleanStr) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    buffer = (buffer << 5) | index;
    bitsInBuffer += 5;

    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bytes.push((buffer >> bitsInBuffer) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
