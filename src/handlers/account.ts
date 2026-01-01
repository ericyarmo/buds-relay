/**
 * Account Management Handlers
 * Phase 10.3 Module 0.2: Phone-Based Identity
 * Phase 10.3 Module 0.3: Deterministic Phone Encryption
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import { encryptPhone } from '../utils/phone_encryption';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

/**
 * POST /api/account/salt
 * Get or create account salt for phone-based DID derivation
 *
 * DID = did:phone:SHA256(phone + account_salt)
 *
 * Security (Phase 10.3 Module 0.3):
 * - encrypted_phone: AES-256-GCM(phone, server_key) - prevents rainbow tables
 * - salt: Random 32-byte value for DID derivation
 * - Same phone → same salt → same DID across devices
 */
export async function getOrCreateAccountSalt(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  console.log('[getOrCreateAccountSalt] User:', user?.uid, 'Phone:', user?.phoneNumber);

  // Get authenticated user's phone number
  if (!user.phoneNumber) {
    console.error('[getOrCreateAccountSalt] No phone number in user object:', user);
    throw Errors.Forbidden('Phone number required for account salt');
  }

  // Encrypt phone number server-side (deterministic)
  const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('[getOrCreateAccountSalt] No encryption key configured');
    throw Errors.ServerError('Phone encryption key not configured');
  }

  console.log('[getOrCreateAccountSalt] Encrypting phone:', user.phoneNumber);
  const encryptedPhone = await encryptPhone(user.phoneNumber, encryptionKey);
  console.log('[getOrCreateAccountSalt] Encrypted phone:', encryptedPhone);

  try {
    console.log('[getOrCreateAccountSalt] Querying DB for salt...');
    // Check if salt already exists
    const existing = await db
      .prepare('SELECT salt FROM account_salts WHERE encrypted_phone = ?')
      .bind(encryptedPhone)
      .first<{ salt: string }>();

    console.log('[getOrCreateAccountSalt] DB query result:', existing);

    if (existing) {
      // Return existing salt
      console.log('[getOrCreateAccountSalt] Found existing salt, returning');
      return c.json({
        salt: existing.salt,
        created: false,
      });
    }

    console.log('[getOrCreateAccountSalt] No existing salt, generating new one');
    // Generate new salt (32 random bytes, base64 encoded)
    const cryptoUtils = await import('../utils/crypto');
    const salt = cryptoUtils.generateSalt();
    const now = Date.now();

    console.log('[getOrCreateAccountSalt] Inserting new salt into DB...');
    // Store salt with encrypted phone
    await db
      .prepare(`
        INSERT INTO account_salts (encrypted_phone, salt, created_at)
        VALUES (?, ?, ?)
      `)
      .bind(encryptedPhone, salt, now)
      .run();

    console.log(`✅ Generated account salt for encrypted phone`);

    return c.json({
      salt,
      created: true,
    });
  } catch (error) {
    console.error('[getOrCreateAccountSalt] Error:', error);
    console.error('[getOrCreateAccountSalt] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw Errors.ServerError('Failed to get or create account salt');
  }
}
