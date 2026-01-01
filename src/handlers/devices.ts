/**
 * Device Registration & Discovery Handlers
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
 * POST /api/devices/register
 * Register a new device for the authenticated user
 *
 * Phase 10.3 Module 0.3: Now accepts plaintext phone_number, encrypts server-side
 * Security: Phone sent over HTTPS (TLS), encrypted at rest in DB
 */
export async function registerDevice(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();

  const deviceId = validate(schemas.deviceId, body.device_id);
  const deviceName = validate(schemas.deviceName, body.device_name);
  const ownerDid = validate(schemas.did, body.owner_did);
  const phoneNumber = body.phone_number; // Plaintext phone from client (over HTTPS)
  const pubkeyX25519 = validate(schemas.base64, body.pubkey_x25519);
  const pubkeyEd25519 = validate(schemas.base64, body.pubkey_ed25519);
  const apnsToken = body.apns_token ? validate(schemas.apnsToken, body.apns_token) : null;

  // Verify the authenticated user's phone matches the provided phone
  if (user.phoneNumber) {
    if (user.phoneNumber !== phoneNumber) {
      throw Errors.Forbidden('Phone number mismatch');
    }
  }

  // Encrypt phone number server-side (deterministic for lookups)
  const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw Errors.ServerError('Phone encryption key not configured');
  }

  const ownerEncryptedPhone = await encryptPhone(phoneNumber, encryptionKey);

  try {
    const now = Date.now();

    // Check if device already exists
    const existing = await db
      .prepare('SELECT device_id FROM devices WHERE device_id = ?')
      .bind(deviceId)
      .first();

    if (existing) {
      // Update existing device (re-registration with potentially new APNs token)
      await db
        .prepare(`
          UPDATE devices
          SET device_name = ?,
              owner_encrypted_phone = ?,
              pubkey_x25519 = ?,
              pubkey_ed25519 = ?,
              apns_token = ?,
              last_seen_at = ?
          WHERE device_id = ?
        `)
        .bind(deviceName, ownerEncryptedPhone, pubkeyX25519, pubkeyEd25519, apnsToken, now, deviceId)
        .run();
    } else {
      // Insert new device (Phase 10.3: encrypted phone instead of hash)
      await db
        .prepare(`
          INSERT INTO devices (
            device_id, owner_did, owner_encrypted_phone, device_name,
            pubkey_x25519, pubkey_ed25519, apns_token, status, registered_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `)
        .bind(
          deviceId,
          ownerDid,
          ownerEncryptedPhone,
          deviceName,
          pubkeyX25519,
          pubkeyEd25519,
          apnsToken,
          now,
          now
        )
        .run();
    }

    // Update phone_to_did mapping (Phase 10.3: encrypted phone instead of hash)
    await db
      .prepare(`
        INSERT INTO phone_to_did (encrypted_phone, did, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(encrypted_phone) DO UPDATE SET did = ?, updated_at = ?
      `)
      .bind(ownerEncryptedPhone, ownerDid, now, ownerDid, now)
      .run();

    return c.json({
      success: true,
      device_id: deviceId,
      registered_at: now,
    }, 201);
  } catch (error) {
    throw error;
  }
}

/**
 * POST /api/devices/list
 * Get all devices for given DIDs
 */
export async function listDevices(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();
  const dids = validate(schemas.dids, body.dids);

  // Build query with placeholders
  const placeholders = dids.map(() => '?').join(',');
  const query = `
    SELECT
      device_id,
      owner_did,
      device_name,
      pubkey_x25519,
      pubkey_ed25519,
      status,
      registered_at,
      last_seen_at
    FROM devices
    WHERE owner_did IN (${placeholders}) AND status = 'active'
    ORDER BY owner_did, registered_at DESC
  `;

  const result = await db.prepare(query).bind(...dids).all();

  // Group devices by DID
  const devicesByDid: Record<string, any[]> = {};
  for (const row of result.results || []) {
    const did = row.owner_did as string;
    if (!devicesByDid[did]) {
      devicesByDid[did] = [];
    }
    devicesByDid[did].push({
      device_id: row.device_id,
      device_name: row.device_name,
      pubkey_x25519: row.pubkey_x25519,
      pubkey_ed25519: row.pubkey_ed25519,
      registered_at: row.registered_at,
      last_seen_at: row.last_seen_at,
    });
  }

  return c.json({
    devices: devicesByDid,
  });
}

/**
 * POST /api/devices/heartbeat
 * Update last_seen_at for a device
 */
export async function deviceHeartbeat(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();
  const deviceId = validate(schemas.deviceId, body.device_id);

  // Update last_seen_at
  const now = Date.now();
  const result = await db
    .prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND status = \'active\'')
    .bind(now, deviceId)
    .run();

  if (result.meta.changes === 0) {
    throw Errors.NotFound('Device');
  }

  return c.json({
    success: true,
    last_seen_at: now,
  });
}
