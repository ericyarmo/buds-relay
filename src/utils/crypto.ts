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
