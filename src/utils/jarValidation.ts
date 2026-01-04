/**
 * Jar Membership Validation
 * Phase 10.3 Module 0.6: Relay Infrastructure
 *
 * Validates jar membership for access control.
 * Relay stores authoritative membership state.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface JarMember {
  jar_id: string;
  member_did: string;
  status: 'active' | 'pending' | 'removed';
  role: 'owner' | 'member';
  added_at: number;
  removed_at: number | null;
}

/**
 * Check if a DID is an active member of a jar
 */
export async function isActiveMember(
  db: D1Database,
  jarId: string,
  memberDid: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT 1 FROM jar_members
       WHERE jar_id = ? AND member_did = ? AND status = 'active'`
    )
    .bind(jarId, memberDid)
    .first();

  return result !== null;
}

/**
 * Check if a DID is the owner of a jar
 */
export async function isOwner(
  db: D1Database,
  jarId: string,
  memberDid: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT 1 FROM jar_members
       WHERE jar_id = ? AND member_did = ? AND role = 'owner' AND status = 'active'`
    )
    .bind(jarId, memberDid)
    .first();

  return result !== null;
}

/**
 * Get all active members of a jar (for broadcasting)
 */
export async function getActiveMembers(
  db: D1Database,
  jarId: string
): Promise<JarMember[]> {
  const result = await db
    .prepare(
      `SELECT jar_id, member_did, status, role, added_at, removed_at
       FROM jar_members
       WHERE jar_id = ? AND status = 'active'
       ORDER BY added_at ASC`
    )
    .bind(jarId)
    .all<JarMember>();

  return result.results || [];
}

/**
 * Get member info (for checking role, status)
 */
export async function getMember(
  db: D1Database,
  jarId: string,
  memberDid: string
): Promise<JarMember | null> {
  const result = await db
    .prepare(
      `SELECT jar_id, member_did, status, role, added_at, removed_at
       FROM jar_members
       WHERE jar_id = ? AND member_did = ?`
    )
    .bind(jarId, memberDid)
    .first<JarMember>();

  return result || null;
}
