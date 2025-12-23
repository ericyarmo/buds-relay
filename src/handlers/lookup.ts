/**
 * DID Lookup Handlers
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

/**
 * POST /api/lookup/did
 * Lookup DID by phone number hash
 */
export async function lookupDid(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();
  const phoneHash = validate(schemas.phoneHash, body.phone_hash);

  // Query phone_to_did table
  const result = await db
    .prepare('SELECT did, updated_at FROM phone_to_did WHERE phone_hash = ?')
    .bind(phoneHash)
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
 * Batch lookup DIDs by phone number hashes (max 12)
 */
export async function batchLookupDid(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();

  // Validate phone hashes array (max 12 for Circle limit)
  if (!Array.isArray(body.phone_hashes)) {
    throw Errors.ValidationFailed('phone_hashes must be an array');
  }
  if (body.phone_hashes.length === 0) {
    throw Errors.ValidationFailed('phone_hashes cannot be empty');
  }
  if (body.phone_hashes.length > 12) {
    throw Errors.ValidationFailed('Maximum 12 phone hashes allowed');
  }

  // Validate each phone hash
  const phoneHashes = body.phone_hashes.map((hash: unknown) =>
    validate(schemas.phoneHash, hash)
  );

  // Build query with placeholders
  const placeholders = phoneHashes.map(() => '?').join(',');
  const query = `
    SELECT phone_hash, did, updated_at
    FROM phone_to_did
    WHERE phone_hash IN (${placeholders})
  `;

  const result = await db.prepare(query).bind(...phoneHashes).all();

  // Build result map
  const dids: Record<string, { did: string; updated_at: number }> = {};
  for (const row of result.results || []) {
    dids[row.phone_hash as string] = {
      did: row.did as string,
      updated_at: row.updated_at as number,
    };
  }

  return c.json({
    dids,
    found: Object.keys(dids).length,
    requested: phoneHashes.length,
  });
}
