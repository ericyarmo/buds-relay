/**
 * Cryptographic Utilities
 * Privacy-preserving phone number hashing
 */

/**
 * Hash phone number with SHA-256
 * Used for privacy-preserving DID lookup
 *
 * Security note: SHA-256 (without salt) is vulnerable to rainbow tables,
 * but this is acceptable trade-off for UX (client-side hashing enables
 * simple DID lookup). Rate limiting mitigates bulk enumeration attacks.
 */
export async function hashPhone(phoneNumber: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phoneNumber);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Alias for compatibility
export const hashPhoneNumber = hashPhone;

/**
 * Generate random 32-byte salt for account DID derivation
 * Used in: DID = did:phone:SHA256(phone + salt)
 *
 * Returns base64-encoded 32-byte random value
 */
export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  // Convert to base64
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte),
  ).join('');

  return btoa(binString);
}
