/**
 * Buds Relay Server
 * Cloudflare Workers + D1
 *
 * Zero-trust E2EE message relay for Buds Circle sharing.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireAuth } from './middleware/auth';
import { autoRateLimit } from './middleware/ratelimit';
import { handleError } from './utils/errors';

// Import handlers
import { registerDevice, listDevices, deviceHeartbeat } from './handlers/devices';
import { lookupDid, batchLookupDid } from './handlers/lookup';
import { sendMessage, getInbox, markDelivered, deleteMessage } from './handlers/messages';
import { getOrCreateAccountSalt } from './handlers/account';
import type { AuthUser } from './middleware/auth';

// Type definitions for bindings
export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace (for Firebase public key caching)
  KV_CACHE: KVNamespace;

  // R2 Object Storage (for encrypted message payloads)
  R2_MESSAGES: R2Bucket;

  // Environment variables
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT: string;

  // APNs credentials (secrets)
  APNS_P8_KEY?: string; // .p8 key content
  APNS_KEY_ID?: string; // Key ID from Apple Developer Portal
  APNS_TEAM_ID?: string; // Team ID from Apple Developer Portal
}

// Context variables
interface Variables {
  user: AuthUser;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS configuration
app.use('/*', cors({
  origin: '*', // TODO: Restrict in production
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check (no auth required)
app.get('/health', async (c) => {
  try {
    // Test database connection
    await c.env.DB.prepare('SELECT 1').first();

    return c.json({
      status: 'healthy',
      version: '1.0.0',
      environment: c.env.ENVIRONMENT || 'development',
      timestamp: Date.now(),
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: Date.now(),
    }, 503);
  }
});

// Apply rate limiting and auth to all API routes
app.use('/api/*', autoRateLimit());
app.use('/api/*', requireAuth);

// Account endpoints (Phase 10.3 Module 0.2)
app.post('/api/account/salt', getOrCreateAccountSalt);

// Device endpoints
app.post('/api/devices/register', registerDevice);
app.post('/api/devices/list', listDevices);
app.post('/api/devices/heartbeat', deviceHeartbeat);

// Lookup endpoints
app.post('/api/lookup/did', lookupDid);
app.post('/api/lookup/batch', batchLookupDid);

// Message endpoints
app.post('/api/messages/send', sendMessage);
app.get('/api/messages/inbox', getInbox);
app.post('/api/messages/mark-delivered', markDelivered);
app.delete('/api/messages/:messageId', deleteMessage);

// Global error handler
app.onError((error, c) => {
  return handleError(error, c);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Export with scheduled cleanup job
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const { runCleanup } = await import('./cron/cleanup');
    ctx.waitUntil(runCleanup(env));
  },
};
