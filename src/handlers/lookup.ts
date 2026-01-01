/**
 * DID Lookup Handlers
 * Updated in Phase 10.3 Module 0.3: Deterministic Phone Encryption
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import { encryptPhone } from '../utils/phone_encryption';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

/**
 * POST /api/lookup/did
 * Lookup DID by phone number
 *
 * Phase 10.3 Module 0.3: Now accepts plaintext phone_number, encrypts server-side
 * Security: Same deterministic encryption as registration ensures lookups work
 */
export async function lookupDid(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();
  const phoneNumber = body.phone_number; // Plaintext phone from client (over HTTPS)

  if (!phoneNumber) {
    throw Errors.ValidationFailed('phone_number is required');
  }

  // Encrypt phone number server-side (deterministic - same phone → same ciphertext)
  const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw Errors.ServerError('Phone encryption key not configured');
  }

  const encryptedPhone = await encryptPhone(phoneNumber, encryptionKey);

  // Query phone_to_did table by encrypted phone
  const result = await db
    .prepare('SELECT did, updated_at FROM phone_to_did WHERE encrypted_phone = ?')
    .bind(encryptedPhone)
    .first();

  if (!result) {
    // Return 404 if DID not found
    // This is safe from enumeration due to rate limiting (20/min)
    throw Errors.NotFound('DID');
  }

  return c.json({
    did: result.did,
    updated_at: result.updated_at,
  });
}

/**
 * POST /api/lookup/batch
 * Batch lookup DIDs by phone numbers (max 12)
 *
 * Phase 10.3 Module 0.3: Now accepts plaintext phone_numbers array
 */
export async function batchLookupDid(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();

  // Validate phone numbers array (max 12 for Circle limit)
  if (!Array.isArray(body.phone_numbers)) {
    throw Errors.ValidationFailed('phone_numbers must be an array');
  }
  if (body.phone_numbers.length === 0) {
    throw Errors.ValidationFailed('phone_numbers cannot be empty');
  }
  if (body.phone_numbers.length > 12) {
    throw Errors.ValidationFailed('Maximum 12 phone numbers allowed');
  }

  // Encrypt phone number server-side (deterministic)
  const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw Errors.ServerError('Phone encryption key not configured');
  }

  // Encrypt all phone numbers
  const phoneNumbers = body.phone_numbers as string[];
  const encryptedPhones = await Promise.all(
    phoneNumbers.map((phone) => encryptPhone(phone, encryptionKey))
  );

  // Build query with placeholders
  const placeholders = encryptedPhones.map(() => '?').join(',');
  const query = `
    SELECT encrypted_phone, did, updated_at
    FROM phone_to_did
    WHERE encrypted_phone IN (${placeholders})
  `;

  const result = await db.prepare(query).bind(...encryptedPhones).all();

  // Build result map (map back to original phone numbers)
  const dids: Record<string, { did: string; updated_at: number }> = {};
  for (const row of result.results || []) {
    const encryptedPhone = row.encrypted_phone as string;
    const index = encryptedPhones.indexOf(encryptedPhone);
    if (index >= 0) {
      const originalPhone = phoneNumbers[index];
      dids[originalPhone] = {
        did: row.did as string,
        updated_at: row.updated_at as number,
      };
    }
  }

  return c.json({
    dids,
    found: Object.keys(dids).length,
    requested: phoneNumbers.length,
  });
}
