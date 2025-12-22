/**
 * Rate Limiting Middleware
 * Using Cloudflare Workers native rate limiting
 */

import type { Context, Next } from 'hono';
import { Errors } from '../utils/errors';

export interface RateLimitConfig {
  limit: number;
  period: number; // in seconds
}

// Rate limit configurations per endpoint
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/api/lookup/did': { limit: 20, period: 60 }, // 20 requests per minute
  '/api/devices/register': { limit: 5, period: 300 }, // 5 requests per 5 minutes
  '/api/devices/list': { limit: 50, period: 60 }, // 50 requests per minute
  '/api/messages/send': { limit: 100, period: 60 }, // 100 requests per minute
  '/api/messages/inbox': { limit: 200, period: 60 }, // 200 requests per minute
};

/**
 * Simple in-memory rate limiter (for development/testing)
 * Production should use Cloudflare's Durable Objects or KV
 */
class InMemoryRateLimiter {
  private requests: Map<string, { count: number; resetAt: number }> = new Map();

  check(key: string, limit: number, period: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const existing = this.requests.get(key);

    // If no existing record or period expired, create new
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + period * 1000;
      this.requests.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    // Check if under limit
    if (existing.count < limit) {
      existing.count++;
      this.requests.set(key, existing);
      return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
    }

    // Over limit
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  // For testing: reset all limits
  reset() {
    this.requests.clear();
  }
}

// Global instance (shared across requests in same isolate)
const limiter = new InMemoryRateLimiter();

/**
 * Rate limiting middleware factory
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    // Get identifier (authenticated user's UID or IP address)
    const user = c.get('user');
    const identifier = user?.uid || c.req.header('CF-Connecting-IP') || 'anonymous';

    // Create rate limit key (endpoint + identifier)
    const path = c.req.path;
    const key = `${path}:${identifier}`;

    // Check rate limit
    const result = limiter.check(key, config.limit, config.period);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', config.limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      c.header('Retry-After', retryAfter.toString());
      throw Errors.RateLimited();
    }

    await next();
  };
}

/**
 * Auto rate limit based on path configuration
 */
export function autoRateLimit() {
  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // Find matching rate limit config
    const config = RATE_LIMITS[path];

    if (config) {
      return rateLimit(config)(c, next);
    }

    // No rate limit configured for this path
    await next();
  };
}

// Export limiter for testing
export const testLimiter = limiter;
