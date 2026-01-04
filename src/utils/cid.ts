/**
 * CID (Content Identifier) Utilities
 * Phase 10.3 Module 0.6: Relay Infrastructure
 *
 * CRITICAL: Must match iOS CIDv1 implementation exactly
 * Format: CIDv1 + dag-cbor + sha2-256 multihash + base32
 *
 * iOS implementation:
 * - CIDv1 prefix: 0x01
 * - dag-cbor codec: 0x71
 * - sha2-256 multihash: 0x12 (type) + 0x20 (32 bytes) + hash
 * - base32 encoding (lowercase, RFC 4648)
 * - "b" prefix
 */

import { encodeBase32 } from './base32';

/**
 * Compute CIDv1 from bytes (matches iOS implementation)
 *
 * Format: "b" + base32(0x01 + 0x71 + 0x12 + 0x20 + sha256(bytes))
 *
 * @param bytes - Receipt data bytes
 * @returns CIDv1 string (e.g., "bafyreib...")
 */
export async function computeCID(bytes: Uint8Array): Promise<string> {
  // Step 1: Compute SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashBytes = new Uint8Array(hashBuffer);

  // Step 2: Build multihash
  // Multihash format: [hash_type][hash_length][hash_bytes]
  const multihash = new Uint8Array(2 + hashBytes.length);
  multihash[0] = 0x12; // sha2-256
  multihash[1] = 0x20; // 32 bytes (0x20 = 32 in hex)
  multihash.set(hashBytes, 2);

  // Step 3: Build CID
  // CID format: [version][codec][multihash]
  const cid = new Uint8Array(2 + multihash.length);
  cid[0] = 0x01; // CIDv1
  cid[1] = 0x71; // dag-cbor
  cid.set(multihash, 2);

  // Step 4: Encode as base32 with "b" prefix
  const base32 = encodeBase32(cid);

  // Remove padding (CIDv1 doesn't use padding)
  const base32NoPadding = base32.replace(/=/g, '');

  return 'b' + base32NoPadding.toLowerCase();
}

/**
 * Verify CID matches content
 *
 * @param cid - Claimed CID
 * @param bytes - Receipt data bytes
 * @returns true if CID matches, false otherwise
 */
export async function verifyCID(cid: string, bytes: Uint8Array): Promise<boolean> {
  const computed = await computeCID(bytes);
  return computed === cid;
}
