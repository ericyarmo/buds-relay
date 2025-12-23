/**
 * Firebase Authentication Middleware
 * Phase 1 of Hardening Sprint
 *
 * Uses firebase-auth-cloudflare-workers for zero-dependency token verification
 * with KV-backed public key caching.
 */

import { Auth } from 'firebase-auth-cloudflare-workers';
import type { Context, Next } from 'hono';

export interface AuthEnv {
  FIREBASE_PROJECT_ID: string;
  KV_CACHE: KVNamespace;
}

export interface AuthUser {
  uid: string;
  phoneNumber?: string;
  email?: string;
}

// Simple KV adapter for Firebase Auth
class KVAdapter {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return await this.kv.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    await this.kv.put(key, value);
  }
}

// Singleton Auth instance (cached across requests)
let authInstance: Auth | null = null;

function getAuth(env: AuthEnv): Auth {
  if (!authInstance) {
    const kvAdapter = new KVAdapter(env.KV_CACHE);
    authInstance = Auth.getOrInitialize(
      env.FIREBASE_PROJECT_ID,
      kvAdapter as any
    );
  }
  return authInstance;
}

/**
 * Middleware: Require Firebase Authentication
 *
 * Sets c.get('user') with authenticated user info on success.
 * Returns 401 on auth failure.
 */
export async function requireAuth(
  c: Context<{ Bindings: AuthEnv; Variables: { user: AuthUser } }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing token' }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const auth = getAuth(c.env);
    const decodedToken = await auth.verifyIdToken(token);

    // Store user info in context for handlers
    c.set('user', {
      uid: decodedToken.uid,
      phoneNumber: decodedToken.phone_number,
      email: decodedToken.email,
    } as AuthUser);

    await next();
  } catch (error) {
    console.error('[AUTH] Token verification failed:', error);
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }
}
