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

// Type definitions for bindings
export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace (for Firebase public key caching)
  KV_CACHE: KVNamespace;

  // Environment variables
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use('/*', cors({
  origin: '*', // TODO: Restrict in production
  allowMethods: ['GET', 'POST', 'OPTIONS'],
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

// API routes (TODO: implement handlers)
app.get('/api/test', (c) => {
  const user = c.get('user');
  return c.json({
    message: 'Authenticated!',
    user,
  });
});

// Global error handler
app.onError((error, c) => {
  return handleError(error, c);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

export default app;
