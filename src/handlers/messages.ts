/**
 * E2EE Message Handlers
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';
import { SignJWT, importPKCS8 } from 'jose';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

// APNs JWT token cache
let cachedAPNsJWT: { token: string; expiresAt: number } | null = null;

/**
 * POST /api/messages/send
 * Send encrypted message to Circle members
 */
export async function sendMessage(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();

  const messageId = validate(schemas.messageId, body.message_id);
  const receiptCid = validate(schemas.cid, body.receipt_cid);
  const senderDid = validate(schemas.did, body.sender_did);
  const senderDeviceId = validate(schemas.deviceId, body.sender_device_id);
  const recipientDids = validate(schemas.dids, body.recipient_dids);
  const encryptedPayload = validate(schemas.base64, body.encrypted_payload);
  const wrappedKeys = validate(schemas.wrappedKeys, body.wrapped_keys);
  const signature = validate(schemas.signature, body.signature);

  // Verify sender device is registered to authenticated user
  const device = await db
    .prepare('SELECT owner_did FROM devices WHERE device_id = ? AND status = \'active\'')
    .bind(senderDeviceId)
    .first();

  if (!device) {
    throw Errors.NotFound('Device');
  }

  if (device.owner_did !== senderDid) {
    throw Errors.Forbidden();
  }

  // Check if message ID already exists (prevent duplicates)
  const existing = await db
    .prepare('SELECT message_id FROM encrypted_messages WHERE message_id = ?')
    .bind(messageId)
    .first();

  if (existing) {
    throw Errors.ValidationFailed('Message ID already exists');
  }

  // Upload encrypted payload to R2
  const now = Date.now();
  const r2Key = `messages/${messageId}.bin`;
  const r2 = c.env.R2_MESSAGES;

  // Decode base64 payload and upload to R2
  const payloadBytes = Uint8Array.from(atob(encryptedPayload), (c) => c.charCodeAt(0));
  await r2.put(r2Key, payloadBytes, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      messageId,
      receiptCid,
      senderDid,
      uploadedAt: now.toString(),
    },
  });

  // Insert encrypted message metadata (no encrypted_payload, just r2_key)
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  await db
    .prepare(`
      INSERT INTO encrypted_messages (
        message_id, receipt_cid, sender_did, sender_device_id,
        recipient_dids, wrapped_keys, signature, r2_key,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      messageId,
      receiptCid,
      senderDid,
      senderDeviceId,
      JSON.stringify(recipientDids),
      JSON.stringify(wrappedKeys),
      signature,
      r2Key,
      now,
      expiresAt
    )
    .run();

  // Create delivery records for each recipient
  const deliveryInserts = recipientDids.map((recipientDid) =>
    db
      .prepare(`
        INSERT INTO message_delivery (message_id, recipient_did, delivered_at)
        VALUES (?, ?, NULL)
      `)
      .bind(messageId, recipientDid)
      .run()
  );

  await Promise.all(deliveryInserts);

  // Send silent push notifications to recipients (non-blocking)
  c.executionCtx.waitUntil(
    sendPushNotifications(recipientDids, senderDid, c.env).catch((error) => {
      console.error('Failed to send push notifications:', error);
    })
  );

  return c.json({
    success: true,
    message_id: messageId,
    created_at: now,
    expires_at: expiresAt,
    recipients: recipientDids.length,
  }, 201);
}

/**
 * GET /api/messages/inbox
 * Get encrypted messages for authenticated user's DID
 */
export async function getInbox(c: Context<AppContext>) {
  const db = c.env.DB;

  // Get DID from query parameter
  const did = validate(schemas.did, c.req.query('did'));

  // Get optional limit (default: 50, max: 100)
  const limitStr = c.req.query('limit') || '50';
  const limit = Math.min(parseInt(limitStr, 10) || 50, 100);

  // Get optional since timestamp (for pagination)
  const sinceStr = c.req.query('since');
  const since = sinceStr ? parseInt(sinceStr, 10) : 0;

  // Query messages for this DID
  const query = `
    SELECT
      m.message_id,
      m.receipt_cid,
      m.sender_did,
      m.sender_device_id,
      m.recipient_dids,
      m.encrypted_payload,
      m.r2_key,
      m.wrapped_keys,
      m.signature,
      m.created_at,
      m.expires_at,
      d.delivered_at
    FROM encrypted_messages m
    INNER JOIN message_delivery d ON m.message_id = d.message_id
    WHERE d.recipient_did = ? AND m.created_at > ? AND m.expires_at > ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `;

  const now = Date.now();
  const result = await db.prepare(query).bind(did, since, now, limit).all();
  const r2 = c.env.R2_MESSAGES;

  // Map messages and fetch payloads from R2 (convert to base64 for client compatibility)
  const messages = await Promise.all(
    (result.results || []).map(async (row) => {
      let encryptedPayload: string | undefined;

      // New format: R2 storage (preferred)
      if (row.r2_key) {
        const r2Object = await r2.get(row.r2_key as string);
        if (r2Object) {
          // Read R2 object and convert to base64 (same format as old D1 storage)
          const payloadBytes = await r2Object.arrayBuffer();
          encryptedPayload = btoa(
            String.fromCharCode(...new Uint8Array(payloadBytes))
          );
        } else {
          console.error(`R2 object not found for key: ${row.r2_key}`);
          // Fallback: skip this message or throw error
          throw new Error(`Message payload not found in R2: ${row.message_id}`);
        }
      }
      // Old format: D1 inline storage (backward compatibility)
      else if (row.encrypted_payload) {
        encryptedPayload = row.encrypted_payload as string;
      } else {
        // Neither r2_key nor encrypted_payload exists - data corruption
        console.error(`Message ${row.message_id} has no payload (neither R2 nor D1)`);
        throw new Error(`Message payload missing: ${row.message_id}`);
      }

      return {
        message_id: row.message_id,
        receipt_cid: row.receipt_cid,
        sender_did: row.sender_did,
        sender_device_id: row.sender_device_id,
        recipient_dids: JSON.parse(row.recipient_dids as string),
        encrypted_payload: encryptedPayload,
        wrapped_keys: JSON.parse(row.wrapped_keys as string),
        signature: row.signature,
        created_at: row.created_at,
        expires_at: row.expires_at,
        delivered_at: row.delivered_at,
      };
    })
  );

  return c.json({
    messages,
    count: messages.length,
    has_more: messages.length === limit,
  });
}

/**
 * POST /api/messages/mark-delivered
 * Mark message as delivered
 */
export async function markDelivered(c: Context<AppContext>) {
  const db = c.env.DB;

  // Validate request body
  const body = await c.req.json();
  const messageId = validate(schemas.messageId, body.message_id);
  const recipientDid = validate(schemas.did, body.recipient_did);

  // Update delivery record
  const now = Date.now();
  const result = await db
    .prepare(`
      UPDATE message_delivery
      SET delivered_at = ?
      WHERE message_id = ? AND recipient_did = ? AND delivered_at IS NULL
    `)
    .bind(now, messageId, recipientDid)
    .run();

  if (result.meta.changes === 0) {
    throw Errors.NotFound('Message delivery record');
  }

  return c.json({
    success: true,
    delivered_at: now,
  });
}

/**
 * DELETE /api/messages/:messageId
 * Delete expired or unwanted message
 */
export async function deleteMessage(c: Context<AppContext>) {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  const messageId = validate(schemas.messageId, c.req.param('messageId'));

  // Verify sender owns the message and get R2 key for cleanup
  const message = await db
    .prepare('SELECT sender_did, r2_key FROM encrypted_messages WHERE message_id = ?')
    .bind(messageId)
    .first();

  if (!message) {
    throw Errors.NotFound('Message');
  }

  // Only sender can delete (or message is expired)
  const now = Date.now();
  const result = await db
    .prepare('DELETE FROM encrypted_messages WHERE message_id = ? AND (sender_did = ? OR expires_at < ?)')
    .bind(messageId, message.sender_did, now)
    .run();

  if (result.meta.changes === 0) {
    throw Errors.Forbidden();
  }

  // Delete R2 object if it exists
  if (message.r2_key) {
    const r2 = c.env.R2_MESSAGES;
    await r2.delete(message.r2_key as string);
    console.log(`Deleted R2 object: ${message.r2_key}`);
  }

  // Delete delivery records (cascade)
  await db
    .prepare('DELETE FROM message_delivery WHERE message_id = ?')
    .bind(messageId)
    .run();

  return c.json({
    success: true,
    deleted_at: now,
  });
}

/**
 * Generate APNs JWT token (cached for 15 minutes)
 */
async function generateAPNsJWT(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (expires in 20 min, cache for 15)
  if (cachedAPNsJWT && cachedAPNsJWT.expiresAt > now + 300) {
    return cachedAPNsJWT.token;
  }

  // Import APNs p8 key from secrets
  const apnsKey = env.APNS_P8_KEY; // .p8 key content as secret
  const keyId = env.APNS_KEY_ID; // Key ID from Apple Developer Portal
  const teamId = env.APNS_TEAM_ID; // Team ID from Apple Developer Portal

  if (!apnsKey || !keyId || !teamId) {
    throw new Error('APNs credentials not configured');
  }

  // Generate JWT (ES256 algorithm)
  const privateKey = await importPKCS8(apnsKey, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({
      alg: 'ES256',
      kid: keyId,
    })
    .setIssuedAt(now)
    .setIssuer(teamId)
    .sign(privateKey);

  // Cache token for 15 minutes
  cachedAPNsJWT = {
    token,
    expiresAt: now + 900, // 15 minutes
  };

  return token;
}

/**
 * Send push notifications to recipient devices
 */
async function sendPushNotifications(
  recipientDids: string[],
  senderDid: string,
  env: Env
): Promise<void> {
  // Query devices for all recipients
  const placeholders = recipientDids.map(() => '?').join(',');
  const query = `
    SELECT device_id, apns_token
    FROM devices
    WHERE owner_did IN (${placeholders})
      AND status = 'active'
      AND apns_token IS NOT NULL
  `;

  const result = await env.DB.prepare(query).bind(...recipientDids).all();
  const devices = result.results || [];

  if (devices.length === 0) {
    console.log('No APNs tokens found for recipients');
    return;
  }

  // Send silent push to all recipient devices
  // SECURITY: Zero PII/metadata in push payload (not even sender_did)
  const apnsPayload = {
    aps: {
      'content-available': 1, // Silent push only
    },
    inbox: 1, // Non-identifying hint that inbox has messages
  };

  // Generate APNs JWT token
  const apnsJWT = await generateAPNsJWT(env);

  // Determine APNs endpoint (sandbox vs production)
  const apnsEndpoint =
    env.ENVIRONMENT === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';

  // Send to APNs (use fetch to Apple's APNs HTTP/2 API)
  const pushPromises = devices.map(async (device) => {
    const apnsToken = device.apns_token as string;
    const deviceId = device.device_id as string;

    try {
      const response = await fetch(
        `${apnsEndpoint}/3/device/${apnsToken}`,
        {
          method: 'POST',
          headers: {
            'apns-topic': 'app.getbuds.buds', // Bundle ID
            'apns-push-type': 'background',
            'apns-priority': '5', // Low priority (background)
            'apns-expiration': '0', // Immediate expiration for silent push
            authorization: `bearer ${apnsJWT}`,
          },
          body: JSON.stringify(apnsPayload),
        }
      );

      // Handle APNs error codes
      if (response.status === 410) {
        // Token invalid - mark device inactive
        console.log(`APNs token invalid for device ${deviceId}, marking inactive`);
        await env.DB.prepare(
          'UPDATE devices SET apns_token = NULL, status = ? WHERE device_id = ?'
        )
          .bind('inactive', deviceId)
          .run();
      } else if (response.status === 429 || response.status >= 500) {
        // Rate limit or server error - log but don't fail
        console.error(`APNs error ${response.status} for device ${deviceId}, will retry later`);
      } else if (response.status === 200) {
        console.log(`Push notification sent successfully to device ${deviceId}`);
      } else {
        const errorBody = await response.text();
        console.error(`APNs error ${response.status} for device ${deviceId}: ${errorBody}`);
      }
    } catch (error) {
      console.error(`Failed to send push to device ${deviceId}:`, error);
    }
  });

  await Promise.allSettled(pushPromises);
}
