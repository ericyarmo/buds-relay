/**
 * CBOR Utilities
 * Handles CBOR decoding for jar receipts
 */

import { decode } from 'cbor-x';

/**
 * Jar receipt CBOR structure
 */
export interface JarReceiptPayload {
  jar_id: string;
  receipt_type: string;
  sender_did: string;
  timestamp: number;
  parent_cid?: string;
  payload: any;
}

/**
 * Extract sender DID from jar receipt CBOR
 *
 * SECURITY: This is a critical security function. The sender_did extracted here
 * is used to:
 * 1. Look up the sender's Ed25519 public key
 * 2. Verify the receipt signature
 * 3. Authorize the sender for jar operations
 *
 * The DID comes from the signed receipt payload, NOT from the HTTP auth token.
 * This ensures cryptographic proof of identity, not just HTTP session auth.
 */
export function extractSenderDid(receiptBytes: Uint8Array): string {
  try {
    const decoded = decode(receiptBytes) as JarReceiptPayload;

    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Invalid CBOR structure');
    }

    const senderDid = decoded.sender_did;

    if (!senderDid || typeof senderDid !== 'string') {
      throw new Error('Missing or invalid sender_did in receipt');
    }

    if (!senderDid.startsWith('did:phone:')) {
      throw new Error(`Invalid DID format: ${senderDid}`);
    }

    return senderDid;
  } catch (error) {
    console.error('Failed to extract sender_did from receipt:', error);
    throw new Error(`Invalid receipt CBOR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decode jar receipt CBOR (for debugging/logging)
 */
export function decodeJarReceipt(receiptBytes: Uint8Array): JarReceiptPayload {
  try {
    return decode(receiptBytes) as JarReceiptPayload;
  } catch (error) {
    console.error('Failed to decode jar receipt:', error);
    throw new Error(`Invalid receipt CBOR: ${error instanceof Error ? error.message : String(error)}`);
  }
}
