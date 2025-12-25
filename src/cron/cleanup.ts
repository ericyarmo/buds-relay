/**
 * Cleanup Cron Job
 * Runs daily to delete expired messages
 */

import type { Env } from '../index';

/**
 * Delete expired messages from database
 * Runs daily at 2 AM UTC via wrangler.toml scheduled trigger
 */
export async function cleanupExpiredMessages(env: Env): Promise<{
  deleted: number;
  timestamp: number;
}> {
  const now = Date.now();
  const db = env.DB;
  const r2 = env.R2_MESSAGES;

  // First, get all expired messages with R2 keys
  const expiredMessages = await db
    .prepare('SELECT message_id, r2_key FROM encrypted_messages WHERE expires_at < ?')
    .bind(now)
    .all();

  // Delete R2 objects for expired messages
  let deletedR2Objects = 0;
  if (expiredMessages.results && expiredMessages.results.length > 0) {
    const r2DeletePromises = expiredMessages.results
      .filter((msg) => msg.r2_key) // Only messages with R2 keys
      .map(async (msg) => {
        try {
          await r2.delete(msg.r2_key as string);
          deletedR2Objects++;
        } catch (error) {
          console.error(`Failed to delete R2 object ${msg.r2_key}:`, error);
        }
      });

    await Promise.allSettled(r2DeletePromises);
  }

  // Delete expired messages from D1
  const result = await db
    .prepare('DELETE FROM encrypted_messages WHERE expires_at < ?')
    .bind(now)
    .run();

  const deletedMessages = result.meta.changes;

  // Delete orphaned delivery records (messages that no longer exist)
  await db
    .prepare(`
      DELETE FROM message_delivery
      WHERE message_id NOT IN (
        SELECT message_id FROM encrypted_messages
      )
    `)
    .run();

  // Log cleanup results
  console.log(JSON.stringify({
    level: 'info',
    event: 'cleanup_completed',
    deleted_messages: deletedMessages,
    deleted_r2_objects: deletedR2Objects,
    timestamp: now,
  }));

  return {
    deleted: deletedMessages,
    timestamp: now,
  };
}

/**
 * Delete old devices (inactive for > 90 days)
 * Optional: Run less frequently (weekly)
 */
export async function cleanupInactiveDevices(env: Env): Promise<{
  deleted: number;
  timestamp: number;
}> {
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const db = env.DB;

  // Delete devices inactive for > 90 days
  const result = await db
    .prepare('DELETE FROM devices WHERE status = \'active\' AND last_seen_at < ?')
    .bind(ninetyDaysAgo)
    .run();

  const deletedDevices = result.meta.changes;

  console.log(JSON.stringify({
    level: 'info',
    event: 'device_cleanup_completed',
    deleted_devices: deletedDevices,
    threshold: ninetyDaysAgo,
    timestamp: now,
  }));

  return {
    deleted: deletedDevices,
    timestamp: now,
  };
}

/**
 * Combined cleanup job (messages + devices)
 */
export async function runCleanup(env: Env): Promise<{
  messages_deleted: number;
  devices_deleted: number;
  timestamp: number;
}> {
  const [messagesResult, devicesResult] = await Promise.all([
    cleanupExpiredMessages(env),
    cleanupInactiveDevices(env),
  ]);

  return {
    messages_deleted: messagesResult.deleted,
    devices_deleted: devicesResult.deleted,
    timestamp: Date.now(),
  };
}
