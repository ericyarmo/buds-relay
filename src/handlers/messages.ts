/**
 * E2EE Message Handlers
 */

import type { Context } from 'hono';
import { validate, schemas } from '../utils/validation';
import { Errors } from '../utils/errors';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };

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
  const wrappedKeys = validate(schemas.base64, body.wrapped_keys);

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

  // Insert encrypted message
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  await db
    .prepare(`
      INSERT INTO encrypted_messages (
        message_id, receipt_cid, sender_did, sender_device_id,
        recipient_dids, encrypted_payload, wrapped_keys,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      messageId,
      receiptCid,
      senderDid,
      senderDeviceId,
      JSON.stringify(recipientDids),
      encryptedPayload,
      wrappedKeys,
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
      m.wrapped_keys,
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

  const messages = (result.results || []).map((row) => ({
    message_id: row.message_id,
    receipt_cid: row.receipt_cid,
    sender_did: row.sender_did,
    sender_device_id: row.sender_device_id,
    recipient_dids: JSON.parse(row.recipient_dids as string),
    encrypted_payload: row.encrypted_payload,
    wrapped_keys: row.wrapped_keys,
    created_at: row.created_at,
    expires_at: row.expires_at,
    delivered_at: row.delivered_at,
  }));

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

  // Verify sender owns the message
  const message = await db
    .prepare('SELECT sender_did FROM encrypted_messages WHERE message_id = ?')
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
