/**
 * Phone Number Encryption Utilities
 * Phase 10.3 Module 0.3: Deterministic Phone Encryption
 *
 * Purpose: Encrypt phone numbers at rest to prevent rainbow table attacks
 * Security Model:
 * - Deterministic encryption (same phone → same ciphertext for lookups)
 * - AES-256-GCM encryption
 * - Nonce derived from phone number (SHA-256, first 12 bytes)
 * - Requires both DB leak AND secrets leak to expose phones
 */

/**
 * Derive deterministic 12-byte nonce from phone number
 *
 * Security:
 * - Uses SHA-256 hash of phone number
 * - Takes first 12 bytes (96 bits) for AES-GCM nonce
 * - Deterministic: same phone → same nonce (required for lookups)
 * - Collision-resistant: different phones → different nonces
 *
 * @param phoneNumber - E.164 phone number (e.g., "+14155551234")
 * @returns 12-byte nonce for AES-GCM
 */
async function deriveNonce(phoneNumber: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phoneNumber);

  // Hash phone with SHA-256 (256 bits = 32 bytes)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Take first 12 bytes (96 bits) for AES-GCM nonce
  const nonce = new Uint8Array(hashBuffer).slice(0, 12);

  return nonce;
}

/**
 * Encrypt phone number with deterministic AES-256-GCM
 *
 * @param phoneNumber - Plaintext E.164 phone number
 * @param encryptionKey - Base64-encoded 256-bit AES key from Cloudflare secrets
 * @returns Base64-encoded ciphertext (same phone → same ciphertext)
 */
export async function encryptPhone(
  phoneNumber: string,
  encryptionKey: string
): Promise<string> {
  try {
    // Import encryption key from base64
    const keyData = Uint8Array.from(atob(encryptionKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Derive deterministic nonce from phone number
    const nonce = await deriveNonce(phoneNumber);

    // Encrypt phone number
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(phoneNumber);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      plaintext
    );

    // Convert to base64 for storage
    const ciphertextArray = new Uint8Array(ciphertext);
    const base64 = btoa(String.fromCharCode(...ciphertextArray));

    return base64;
  } catch (error) {
    console.error('[encryptPhone] Error:', error, 'Phone:', phoneNumber, 'Key length:', encryptionKey?.length);
    throw new Error(`Phone encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypt phone number with AES-256-GCM
 *
 * Note: Decryption is rarely needed (lookups use encrypted values directly)
 * Only used for:
 * - Admin debugging (with proper authorization)
 * - Migration/backfill operations
 *
 * @param encryptedPhone - Base64-encoded ciphertext
 * @param encryptionKey - Base64-encoded 256-bit AES key from Cloudflare secrets
 * @returns Plaintext E.164 phone number
 */
export async function decryptPhone(
  encryptedPhone: string,
  encryptionKey: string
): Promise<string> {
  // Import encryption key from base64
  const keyData = Uint8Array.from(atob(encryptionKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decode ciphertext from base64
  const ciphertextArray = Uint8Array.from(atob(encryptedPhone), c => c.charCodeAt(0));

  // Note: We need to derive nonce from plaintext phone, but we don't have it yet!
  // AES-GCM includes authentication tag, so we need to know the nonce used for encryption.
  // For decryption to work, we need to store nonce separately OR derive it from phone.
  // Since nonce is derived from phone, we have a chicken-and-egg problem.

  // SOLUTION: Try all possible phone numbers (ONLY for migration/debugging)
  // In practice, this function should rarely be called.
  // For now, throw error - decryption requires knowing the original phone.

  throw new Error('Decryption not implemented - deterministic encryption prevents decryption without original phone');
}
