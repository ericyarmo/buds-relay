/**
 * Account Management Handlers
 * Phase 10.3 Module 0.2: Phone-Based Identity
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

/**
 * POST /api/account/salt
 * Get or create account salt for phone-based DID derivation
 *
 * DID = did:phone:SHA256(phone + account_salt)
 *
 * Security:
 * - phone_hash: SHA-256(phone) stored in DB (not plaintext)
 * - salt: Random 32-byte value for DID derivation
 * - Same phone → same salt → same DID across devices
 */
export async function getOrCreateAccountSalt(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  // Get authenticated user's phone number
  if (!user.phoneNumber) {
    throw Errors.Forbidden('Phone number required for account salt');
  }

  // Hash phone number for privacy (don't store plaintext)
  const crypto = await import('../utils/crypto');
  const phoneHash = await crypto.hashPhoneNumber(user.phoneNumber);

  try {
    // Check if salt already exists
    const existing = await db
      .prepare('SELECT salt FROM account_salts WHERE phone_hash = ?')
      .bind(phoneHash)
      .first<{ salt: string }>();

    if (existing) {
      // Return existing salt
      return c.json({
        salt: existing.salt,
        created: false,
      });
    }

    // Generate new salt (32 random bytes, base64 encoded)
    const salt = crypto.generateSalt();
    const now = Date.now();

    // Store salt
    await db
      .prepare(`
        INSERT INTO account_salts (phone_hash, salt, created_at)
        VALUES (?, ?, ?)
      `)
      .bind(phoneHash, salt, now)
      .run();

    console.log(`✅ Generated account salt for phone_hash: ${phoneHash.substring(0, 10)}...`);

    return c.json({
      salt,
      created: true,
    });
  } catch (error) {
    console.error('Account salt error:', error);
    throw Errors.ServerError('Failed to get or create account salt');
  }
}
