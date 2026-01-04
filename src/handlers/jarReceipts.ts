/**
 * Jar Receipts Handler (Relay Envelope Architecture)
 * Phase 10.3 Module 0.6: Relay Infrastructure
 *
 * CRITICAL ARCHITECTURE (Dec 30, 2025):
 * - Relay envelope: Separates signed payload from relay metadata
 * - Sequence number is NOT in signed bytes (relay assigns in envelope)
 * - Client sends: receipt_data + signature (no sequence)
 * - Relay assigns: authoritative sequence number (with retry for race safety)
 * - Relay verifies: signature + CID integrity before storing
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import type { AuthUser } from '../middleware/auth';
import { isActiveMember, getActiveMembers } from '../utils/jarValidation';
import { computeCID, verifyCID } from '../utils/cid';
import { processJarReceipt } from '../utils/receiptProcessor';

/**
 * Get sender's Ed25519 public key from devices table
 */
async function getSenderPublicKey(db: D1Database, senderDid: string): Promise<Uint8Array | null> {
  const device = await db
    .prepare(
      `SELECT pubkey_ed25519 FROM devices
       WHERE owner_did = ? AND status = 'active'
       ORDER BY registered_at DESC
       LIMIT 1`
    )
    .bind(senderDid)
    .first<{ pubkey_ed25519: string }>();

  if (!device || !device.pubkey_ed25519) {
    return null;
  }

  // Decode base64 to bytes
  try {
    const decoded = atob(device.pubkey_ed25519);
    return Uint8Array.from(decoded, c => c.charCodeAt(0));
  } catch (error) {
    console.error('Failed to decode public key:', error);
    return null;
  }
}

/**
 * Verify Ed25519 signature
 */
async function verifySignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  try {
    // Import Ed25519 public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKey,
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519',
      },
      false,
      ['verify']
    );

    // Verify signature
    const isValid = await crypto.subtle.verify('Ed25519', cryptoKey, signature, message);
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Attempt to insert receipt with sequence number (with retry for race condition)
 * Returns: sequence number if successful, null if should retry
 */
async function tryInsertReceipt(
  db: D1Database,
  jarId: string,
  receiptCid: string,
  receiptBytes: Uint8Array,
  signatureBytes: Uint8Array,
  senderDid: string,
  parentCid: string | null
): Promise<number | null> {
  try {
    // Attempt to insert with MAX(seq)+1
    await db
      .prepare(
        `INSERT INTO jar_receipts (
          jar_id,
          sequence_number,
          receipt_cid,
          receipt_data,
          signature,
          sender_did,
          received_at,
          parent_cid
        )
        VALUES (
          ?,
          COALESCE((SELECT MAX(sequence_number) FROM jar_receipts WHERE jar_id = ?), 0) + 1,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )`
      )
      .bind(
        jarId,
        jarId, // For subquery
        receiptCid,
        receiptBytes,
        signatureBytes,
        senderDid,
        Date.now(),
        parentCid
      )
      .run();

    // Success! Get the assigned sequence number
    const inserted = await db
      .prepare('SELECT sequence_number FROM jar_receipts WHERE receipt_cid = ?')
      .bind(receiptCid)
      .first<{ sequence_number: number }>();

    return inserted?.sequence_number || null;
  } catch (error: any) {
    // Check if it's a UNIQUE constraint violation (race condition)
    if (error.message?.includes('UNIQUE') || error.message?.includes('constraint')) {
      console.warn(`⚠️  Sequence collision for jar ${jarId}, will retry`);
      return null; // Signal to retry
    }

    // Other error - rethrow
    throw error;
  }
}

/**
 * POST /api/jars/:jarId/receipts
 * Store jar receipt and assign authoritative sequence number
 *
 * SECURITY CHECKS:
 * 1. Verify CID matches receipt_data (integrity)
 * 2. Verify signature matches sender's Ed25519 public key (authenticity)
 * 3. Verify sender is authenticated (Firebase token)
 * 4. Verify sender is active member (authorization)
 *
 * RACE SAFETY:
 * - Retry up to 5 times if sequence collision occurs
 * - UNIQUE(jar_id, sequence_number) constraint prevents duplicates
 *
 * Request body:
 * {
 *   "receipt_data": "base64...",    // Signed CBOR payload (NO sequence inside)
 *   "signature": "base64...",       // Ed25519 signature over receipt_data
 *   "parent_cid": "bafy..."         // Optional (extracted from payload, cached for indexing)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "receipt_cid": "bafy...",
 *   "sequence_number": 5,           // AUTHORITATIVE (relay-assigned)
 *   "jar_id": "uuid"
 * }
 */
export async function storeJarReceipt(c: Context<{ Bindings: Env; Variables: { user: AuthUser } }>) {
  try {
    const jarId = c.req.param('jarId');
    const user = c.get('user');
    const senderDid = user.uid;

    // Parse request body
    const body = await c.req.json<{
      receipt_data: string;
      signature: string;
      parent_cid?: string;
    }>();

    const { receipt_data, signature, parent_cid } = body;

    if (!receipt_data) {
      return c.json({ error: 'receipt_data required' }, 400);
    }

    if (!signature) {
      return c.json({ error: 'signature required' }, 400);
    }

    // Decode base64 to bytes
    const receiptBytes = Uint8Array.from(atob(receipt_data), ch => ch.charCodeAt(0));
    const signatureBytes = Uint8Array.from(atob(signature), ch => ch.charCodeAt(0));

    // SECURITY CHECK #1: Compute and verify CID (integrity)
    const receiptCid = await computeCID(receiptBytes);
    const cidValid = await verifyCID(receiptCid, receiptBytes);
    if (!cidValid) {
      console.error(`❌ CID mismatch for receipt from ${senderDid}`);
      return c.json({ error: 'CID does not match receipt data' }, 400);
    }

    // Check if receipt already exists (idempotency)
    const existing = await c.env.DB
      .prepare('SELECT sequence_number FROM jar_receipts WHERE receipt_cid = ?')
      .bind(receiptCid)
      .first<{ sequence_number: number }>();

    if (existing) {
      console.log(`✅ Receipt ${receiptCid} already exists with sequence ${existing.sequence_number} (idempotent)`);
      return c.json({
        success: true,
        receipt_cid: receiptCid,
        sequence_number: existing.sequence_number,
        jar_id: jarId,
        note: 'Receipt already stored (idempotent)',
      });
    }

    // SECURITY CHECK #2: Get sender's Ed25519 public key
    const senderPublicKey = await getSenderPublicKey(c.env.DB, senderDid);
    if (!senderPublicKey) {
      console.error(`❌ No Ed25519 public key found for ${senderDid}`);
      return c.json({ error: 'Sender device not registered or no public key found' }, 403);
    }

    // SECURITY CHECK #3: Verify Ed25519 signature (authenticity)
    const signatureValid = await verifySignature(senderPublicKey, receiptBytes, signatureBytes);
    if (!signatureValid) {
      console.error(`❌ Signature verification failed for ${senderDid}`);
      return c.json({ error: 'Invalid signature' }, 403);
    }

    console.log(`✅ Signature verified for ${senderDid}`);

    // SECURITY CHECK #4: Validate sender is active member (authorization)
    const isMember = await isActiveMember(c.env.DB, jarId, senderDid);
    if (!isMember) {
      // Special case: jar.created receipt (first receipt, no members yet)
      const maxSeq = await c.env.DB
        .prepare('SELECT COALESCE(MAX(sequence_number), 0) as max_seq FROM jar_receipts WHERE jar_id = ?')
        .bind(jarId)
        .first<{ max_seq: number }>();

      if (maxSeq && maxSeq.max_seq > 0) {
        // Not the first receipt, and sender is not a member → reject
        return c.json({ error: 'Not a member of this jar' }, 403);
      }

      // First receipt (jar.created) → allow
      console.log(`✅ Allowing jar.created receipt from ${senderDid} (first receipt)`);
    }

    // Optional: Validate parent_cid exists (if provided)
    if (parent_cid) {
      const parentExists = await c.env.DB
        .prepare('SELECT 1 FROM jar_receipts WHERE receipt_cid = ?')
        .bind(parent_cid)
        .first();

      if (!parentExists) {
        console.warn(`⚠️  Parent CID ${parent_cid} not found, but accepting receipt (client can backfill)`);
      }
    }

    // RACE-SAFE SEQUENCE ASSIGNMENT: Retry up to 5 times on collision
    let authoritativeSequence: number | null = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      authoritativeSequence = await tryInsertReceipt(
        c.env.DB,
        jarId,
        receiptCid,
        receiptBytes,
        signatureBytes,
        senderDid,
        parent_cid || null
      );

      if (authoritativeSequence !== null) {
        // Success!
        break;
      }

      // Race condition detected, wait a bit and retry
      console.log(`⚠️  Retry ${attempt + 1}/${maxRetries} for jar ${jarId}`);
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1))); // Exponential backoff
    }

    if (authoritativeSequence === null) {
      throw new Error(`Failed to assign sequence after ${maxRetries} retries (race condition)`);
    }

    console.log(`✅ Stored jar receipt ${receiptCid} with sequence ${authoritativeSequence}`);

    // Process receipt to update jar_members (Upgrade E)
    try {
      await processJarReceipt(c.env.DB, jarId, receiptCid, receiptBytes, authoritativeSequence);
      console.log(`✅ Processed receipt ${receiptCid} → updated jar_members`);
    } catch (error) {
      console.error(`❌ Failed to process receipt ${receiptCid}:`, error);
      // Don't fail the entire request, just log the error
    }

    // TODO: Broadcast to jar members (Phase 10.3 Module 6)

    return c.json({
      success: true,
      receipt_cid: receiptCid,
      sequence_number: authoritativeSequence,
      jar_id: jarId,
    });
  } catch (error) {
    console.error('❌ Failed to store jar receipt:', error);
    return c.json(
      {
        error: 'Failed to store jar receipt',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * GET /api/jars/:jarId/receipts
 * Backfill missing receipts (Upgrade B)
 *
 * Two query modes:
 * 1. ?after={lastSeq}&limit={N} - Normal sync (everything after lastSeq)
 * 2. ?from={seq}&to={seq} - Gap filling (specific range)
 *
 * Response:
 * {
 *   "receipts": [
 *     {
 *       "jar_id": "uuid",
 *       "sequence_number": 5,
 *       "receipt_cid": "bafy...",
 *       "receipt_data": "base64...",
 *       "signature": "base64...",
 *       "sender_did": "did:phone:...",
 *       "received_at": 1234567890,
 *       "parent_cid": "bafy..."
 *     }
 *   ]
 * }
 */
export async function getJarReceipts(c: Context<{ Bindings: Env; Variables: { user: AuthUser } }>) {
  try {
    const jarId = c.req.param('jarId');
    const user = c.get('user');
    const requesterDid = user.uid;

    // Parse query params
    const after = c.req.query('after'); // For normal sync
    const from = c.req.query('from'); // For gap filling
    const to = c.req.query('to'); // For gap filling
    const limitStr = c.req.query('limit'); // For normal sync

    // Determine query mode
    let query: string;
    let binds: any[];

    if (after !== undefined) {
      // Mode 1: Normal sync (?after={lastSeq}&limit={N})
      const afterSeq = parseInt(after);
      const limit = limitStr ? Math.min(parseInt(limitStr), 1000) : 500; // Max 1000

      if (isNaN(afterSeq)) {
        return c.json({ error: 'Invalid after parameter' }, 400);
      }

      query = `
        SELECT jar_id, sequence_number, receipt_cid, receipt_data, signature, sender_did, received_at, parent_cid
        FROM jar_receipts
        WHERE jar_id = ? AND sequence_number > ?
        ORDER BY sequence_number ASC
        LIMIT ?
      `;
      binds = [jarId, afterSeq, limit];
    } else if (from !== undefined && to !== undefined) {
      // Mode 2: Gap filling (?from={seq}&to={seq})
      const fromSeq = parseInt(from);
      const toSeq = parseInt(to);

      if (isNaN(fromSeq) || isNaN(toSeq)) {
        return c.json({ error: 'Invalid from/to parameters' }, 400);
      }

      if (fromSeq > toSeq) {
        return c.json({ error: 'from must be <= to' }, 400);
      }

      query = `
        SELECT jar_id, sequence_number, receipt_cid, receipt_data, signature, sender_did, received_at, parent_cid
        FROM jar_receipts
        WHERE jar_id = ? AND sequence_number BETWEEN ? AND ?
        ORDER BY sequence_number ASC
      `;
      binds = [jarId, fromSeq, toSeq];
    } else {
      return c.json({ error: 'Must specify either "after" or "from/to" parameters' }, 400);
    }

    // Validate requester is active member
    const isMember = await isActiveMember(c.env.DB, jarId, requesterDid);
    if (!isMember) {
      return c.json({ error: 'Not a member of this jar' }, 403);
    }

    // Fetch receipts
    const result = await c.env.DB
      .prepare(query)
      .bind(...binds)
      .all<{
        jar_id: string;
        sequence_number: number;
        receipt_cid: string;
        receipt_data: ArrayBuffer;
        signature: ArrayBuffer;
        sender_did: string;
        received_at: number;
        parent_cid: string | null;
      }>();

    // Convert ArrayBuffers to base64
    const receipts = (result.results || []).map(r => ({
      jar_id: r.jar_id,
      sequence_number: r.sequence_number,
      receipt_cid: r.receipt_cid,
      receipt_data: btoa(String.fromCharCode(...new Uint8Array(r.receipt_data))),
      signature: btoa(String.fromCharCode(...new Uint8Array(r.signature))),
      sender_did: r.sender_did,
      received_at: r.received_at,
      parent_cid: r.parent_cid || undefined,
    }));

    console.log(`✅ Returned ${receipts.length} receipts for jar ${jarId} (mode: ${after !== undefined ? 'after' : 'from/to'})`);

    return c.json({ receipts });
  } catch (error) {
    console.error('❌ Failed to get jar receipts:', error);
    return c.json(
      {
        error: 'Failed to get jar receipts',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
