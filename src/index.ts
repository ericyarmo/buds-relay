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
import { storeJarReceipt, getJarReceipts } from './handlers/jarReceipts';
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

  // Phone encryption key (Phase 10.3 Module 0.3)
  PHONE_ENCRYPTION_KEY: string; // Base64-encoded 256-bit AES key
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

// Test endpoint for phone encryption (no auth required, dev only)
// Phase 10.3 Module 0.3: Test deterministic encryption
app.post('/test/phone-encryption', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Test endpoint disabled in production' }, 403);
  }

  try {
    const { encryptPhone } = await import('./utils/phone_encryption');
    const body = await c.req.json();
    const phoneNumber = body.phone_number;

    if (!phoneNumber) {
      return c.json({ error: 'phone_number required' }, 400);
    }

    const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: 'PHONE_ENCRYPTION_KEY not configured' }, 500);
    }

    // Encrypt phone twice to show deterministic behavior
    const encrypted1 = await encryptPhone(phoneNumber, encryptionKey);
    const encrypted2 = await encryptPhone(phoneNumber, encryptionKey);

    return c.json({
      phone_number: phoneNumber,
      encrypted_phone_1: encrypted1,
      encrypted_phone_2: encrypted2,
      deterministic: encrypted1 === encrypted2,
      note: 'Same phone → same ciphertext (required for lookups)',
    });
  } catch (error) {
    return c.json({
      error: 'Encryption test failed',
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Debug endpoint to test account salt flow (no auth required, dev only)
app.post('/test/account-salt-debug', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Test endpoint disabled in production' }, 403);
  }

  try {
    const { encryptPhone } = await import('./utils/phone_encryption');
    const body = await c.req.json();
    const phoneNumber = body.phone_number;

    if (!phoneNumber) {
      return c.json({ error: 'phone_number required' }, 400);
    }

    const encryptionKey = c.env.PHONE_ENCRYPTION_KEY;
    if (!encryptionKey) {
      return c.json({ error: 'PHONE_ENCRYPTION_KEY not configured' }, 500);
    }

    console.log('[DEBUG] Phone number:', phoneNumber);
    console.log('[DEBUG] Encryption key length:', encryptionKey?.length);

    // Encrypt phone
    const encryptedPhone = await encryptPhone(phoneNumber, encryptionKey);
    console.log('[DEBUG] Encrypted phone:', encryptedPhone);

    // Check if salt exists
    const existing = await c.env.DB
      .prepare('SELECT salt FROM account_salts WHERE encrypted_phone = ?')
      .bind(encryptedPhone)
      .first<{ salt: string }>();

    console.log('[DEBUG] Salt query result:', existing);

    if (existing) {
      return c.json({
        phone_number: phoneNumber,
        encrypted_phone: encryptedPhone,
        salt: existing.salt,
        found: true,
        message: 'Salt exists in DB',
      });
    } else {
      return c.json({
        phone_number: phoneNumber,
        encrypted_phone: encryptedPhone,
        found: false,
        message: 'Salt not found in DB',
      });
    }
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    return c.json({
      error: 'Debug test failed',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 500);
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

// Jar receipt endpoints (Phase 10.3 Module 0.6)
app.post('/api/jars/:jarId/receipts', storeJarReceipt);
app.get('/api/jars/:jarId/receipts', getJarReceipts);

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
