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

  // Delete expired messages
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
