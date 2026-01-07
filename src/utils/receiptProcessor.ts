/**
 * Receipt Processor (Upgrade E: Membership Changes as Receipts)
 * Phase 10.3 Module 0.6: Relay Infrastructure
 *
 * Processes jar receipts to update jar_members table.
 * jar_members is a materialized view - single source of truth is receipts.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { decodeJarReceipt } from './cbor';
import { decode } from 'cbor-x';

/**
 * Process jar receipt to update jar_members table
 *
 * Receipt types handled:
 * - jar.created → Insert owner
 * - jar.member_added → Insert member (status: pending)
 * - jar.invite_accepted → Update status: pending → active
 * - jar.member_removed → Update status: active → removed
 *
 * @param db - D1 database
 * @param jarId - Jar ID
 * @param receiptCid - Receipt CID
 * @param receiptBytes - Receipt CBOR bytes
 * @param sequenceNumber - Relay-assigned sequence
 */
export async function processJarReceipt(
  db: D1Database,
  jarId: string,
  receiptCid: string,
  receiptBytes: Uint8Array,
  sequenceNumber: number
): Promise<void> {
  console.log(`🔍 [DEBUG] processJarReceipt called: jar=${jarId}, cid=${receiptCid}, seq=${sequenceNumber}`);

  try {
    // Decode CBOR receipt
    console.log(`🔍 [DEBUG] Decoding CBOR receipt...`);
    const receipt = decodeJarReceipt(receiptBytes);
    console.log(`🔍 [DEBUG] Decoded receipt: type=${receipt.receipt_type}, sender=${receipt.sender_did}`);

    const receiptType = receipt.receipt_type;
    const senderDid = receipt.sender_did;

    console.log(`📦 Processing receipt: type=${receiptType}, jar=${jarId}, seq=${sequenceNumber}`);

    switch (receiptType) {
      case 'jar.created': {
        // Insert owner into jar_members
        console.log(`👤 Adding owner ${senderDid} to jar ${jarId}`);

        // CRITICAL: Convert BigInt to Number (D1 doesn't support BigInt in bind parameters)
        const addedAt = typeof receipt.timestamp === 'bigint' ? Number(receipt.timestamp) : receipt.timestamp;
        console.log(`🔍 [DEBUG] Insert params: jar=${jarId}, did=${senderDid}, timestamp=${addedAt} (type: ${typeof addedAt}), cid=${receiptCid}`);

        try {
          const result = await db
            .prepare(
              `INSERT OR REPLACE INTO jar_members (
                jar_id, member_did, status, role, added_at, added_by_receipt_cid
              ) VALUES (?, ?, 'active', 'owner', ?, ?)`
            )
            .bind(jarId, senderDid, addedAt, receiptCid)
            .run();

          console.log(`🔍 [DEBUG] Insert result: success=${result.success}, meta=${JSON.stringify(result.meta)}`);
          console.log(`✅ Owner added to jar_members`);
        } catch (error) {
          console.error(`❌ [DEBUG] Failed to insert owner into jar_members:`, error);
          throw error;
        }
        break;
      }

      case 'jar.member_added': {
        // CRITICAL: payload is raw CBOR bytes, need to decode it
        const payloadBytes = receipt.payload as Uint8Array;
        console.log(`🔍 [DEBUG] Decoding jar.member_added payload (${payloadBytes.length} bytes)...`);

        let payload: any;
        try {
          payload = decode(payloadBytes);
          console.log(`🔍 [DEBUG] Decoded payload keys: ${Object.keys(payload).join(', ')}`);
        } catch (error) {
          console.error(`❌ Failed to decode jar.member_added payload:`, error);
          return;
        }

        const memberDid = payload.memberDID || payload.member_did;

        if (!memberDid) {
          console.error(`❌ No member_did in jar.member_added payload (tried: memberDID, member_did)`);
          console.error(`❌ Available keys: ${Object.keys(payload).join(', ')}`);
          console.error(`❌ Payload: ${JSON.stringify(payload)}`);
          return;
        }

        console.log(`👤 Adding member ${memberDid} to jar ${jarId} (status: active)`);

        // CRITICAL: Convert BigInt to Number (D1 doesn't support BigInt in bind parameters)
        const addedAt = typeof receipt.timestamp === 'bigint' ? Number(receipt.timestamp) : receipt.timestamp;

        // Phase 10.3 Module 6: Members are auto-active (no invite flow yet)
        await db
          .prepare(
            `INSERT OR REPLACE INTO jar_members (
              jar_id, member_did, status, role, added_at, added_by_receipt_cid
            ) VALUES (?, ?, 'active', 'member', ?, ?)`
          )
          .bind(jarId, memberDid, addedAt, receiptCid)
          .run();
        console.log(`✅ Member added to jar_members (active)`);
        break;
      }

      case 'jar.invite_accepted': {
        // Update status: pending → active
        const payload = receipt.payload as any;
        const memberDid = payload.memberDID || payload.member_did || senderDid;

        console.log(`✅ Accepting invite for ${memberDid} in jar ${jarId}`);
        await db
          .prepare(
            `UPDATE jar_members
             SET status = 'active'
             WHERE jar_id = ? AND member_did = ?`
          )
          .bind(jarId, memberDid)
          .run();
        console.log(`✅ Member status updated to active`);
        break;
      }

      case 'jar.member_removed': {
        // Update status: active → removed
        const payload = receipt.payload as any;
        const memberDid = payload.memberDID || payload.member_did;

        if (!memberDid) {
          console.error(`❌ No member_did in jar.member_removed payload`);
          return;
        }

        console.log(`🚫 Removing member ${memberDid} from jar ${jarId}`);

        // CRITICAL: Convert BigInt to Number (D1 doesn't support BigInt in bind parameters)
        const removedAt = typeof receipt.timestamp === 'bigint' ? Number(receipt.timestamp) : receipt.timestamp;

        await db
          .prepare(
            `UPDATE jar_members
             SET status = 'removed', removed_at = ?, removed_by_receipt_cid = ?
             WHERE jar_id = ? AND member_did = ?`
          )
          .bind(removedAt, receiptCid, jarId, memberDid)
          .run();
        console.log(`✅ Member status updated to removed`);
        break;
      }

      default:
        console.warn(`⚠️  Unknown receipt type: ${receiptType} (ignoring)`);
    }
  } catch (error: any) {
    console.error(`❌ Failed to process receipt ${receiptCid}:`, error);
    console.error(`❌ Error message: ${error.message}`);
    console.error(`❌ Error stack: ${error.stack}`);
    // Don't throw - we don't want to fail the entire request if receipt processing fails
    // The receipt is already stored, we can reprocess it later if needed
  }
}
