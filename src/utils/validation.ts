/**
 * Input Validation Utilities
 * Phase 3 of Hardening Sprint
 *
 * Uses Zod for strict, type-safe validation with detailed error messages.
 */

import { z } from 'zod';

// Zod schemas for all API inputs
export const schemas = {
  // DID format: did:buds:<base58>
  did: z.string().regex(
    /^did:buds:[A-Za-z0-9]{1,44}$/,
    'Invalid DID format (expected: did:buds:<base58>)'
  ),

  // UUID v4 format
  deviceId: z.string().uuid('Invalid device ID (expected UUID v4)'),

  // Base64 encoded string
  base64: z.string().regex(
    /^[A-Za-z0-9+/]+=*$/,
    'Invalid base64 format'
  ).min(1, 'Base64 string cannot be empty'),

  // SHA-256 hash (64 hex characters)
  phoneHash: z.string().regex(
    /^[a-f0-9]{64}$/,
    'Invalid phone hash (expected SHA-256 hex)'
  ),

  // E.164 phone number format
  phoneNumber: z.string().regex(
    /^\+[1-9]\d{1,14}$/,
    'Invalid phone number (expected E.164 format: +14155551234)'
  ),

  // Device name (1-100 characters)
  deviceName: z.string()
    .min(1, 'Device name cannot be empty')
    .max(100, 'Device name too long (max 100 characters)'),

  // APNs token (64 hex characters)
  apnsToken: z.string().regex(
    /^[a-f0-9]{64}$/,
    'Invalid APNs token (expected 64 hex characters)'
  ),

  // Message ID (UUID v4)
  messageId: z.string().uuid('Invalid message ID (expected UUID v4)'),

  // CID format: bafyrei... (CIDv1, base32)
  cid: z.string().regex(
    /^bafy[a-z0-9]{50,60}$/,
    'Invalid CID format (expected CIDv1 base32)'
  ),

  // Array of DIDs (1-12 max for Circle limit)
  dids: z.array(
    z.string().regex(/^did:buds:[A-Za-z0-9]{1,44}$/)
  ).min(1, 'At least one DID required')
    .max(12, 'Maximum 12 DIDs allowed (Circle limit)'),

  // Wrapped keys: Record<device_id, base64_wrapped_key>
  wrappedKeys: z.record(
    z.string().uuid('Invalid device ID in wrapped_keys'),
    z.string().regex(/^[A-Za-z0-9+/]+=*$/, 'Invalid base64 wrapped key')
  ).refine(
    (keys) => Object.keys(keys).length > 0,
    'At least one wrapped key required'
  ),

  // Ed25519 signature (base64 encoded, 64 bytes raw = 88 chars base64)
  // 64 bytes * 4/3 = 85.33, rounds to 86 chars + 2 padding = 88 total
  signature: z.string().regex(
    /^[A-Za-z0-9+/]{86,88}={0,2}$/,
    'Invalid Ed25519 signature (expected base64, 88 chars)'
  ),
};

/**
 * Validate data against a Zod schema
 * Throws ZodError with detailed messages on validation failure
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safe validation - returns null instead of throwing
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate request body with Zod schema
 * Returns validated data or throws with user-friendly errors
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown
): T {
  try {
    return validate(schema, body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Transform Zod errors into user-friendly messages
      const details = error.issues.map((e: z.ZodIssue) =>
        `${e.path.join('.')}: ${e.message}`
      );
      throw new Error(`Validation failed: ${details.join(', ')}`);
    }
    throw error;
  }
}
