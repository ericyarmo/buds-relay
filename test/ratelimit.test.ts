/**
 * Rate Limiting Tests
 * Phase 2: Golden + Threat Vectors
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, testLimiter } from '../src/middleware/ratelimit';
import { handleError } from '../src/utils/errors';

describe('Rate Limiting', () => {
  let app: Hono;

  beforeEach(() => {
    // Reset rate limiter before each test
    testLimiter.reset();

    // Create fresh app
    app = new Hono();
    app.onError((error, c) => handleError(error, c));
  });

  describe('GOLDEN: Requests under limit allowed', () => {
    it('allows requests within limit', async () => {
      app.get('/test', rateLimit({ limit: 5, period: 60 }), (c) => c.json({ ok: true }));

      // Make 5 requests (all should succeed)
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/test', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('X-RateLimit-Remaining')).toBe((4 - i).toString());
      }
    });

    it('sets correct rate limit headers', async () => {
      app.get('/test', rateLimit({ limit: 10, period: 60 }), (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });

    it('different IPs have separate limits', async () => {
      app.get('/test', rateLimit({ limit: 2, period: 60 }), (c) => c.json({ ok: true }));

      // IP 1: use full limit
      for (let i = 0; i < 2; i++) {
        const res = await app.request('/test', {
          headers: { 'CF-Connecting-IP': '1.1.1.1' },
        });
        expect(res.status).toBe(200);
      }

      // IP 2: should still have full limit
      const res = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '2.2.2.2' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
    });
  });

  describe('THREAT: Requests over limit blocked', () => {
    it('blocks requests after limit exceeded', async () => {
      app.get('/test', rateLimit({ limit: 3, period: 60 }), (c) => c.json({ ok: true }));

      // Make 3 successful requests
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/test', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        });
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Rate limit exceeded');
      expect(body.code).toBe('RATE_LIMITED');
    });

    it('returns Retry-After header when rate limited', async () => {
      app.get('/test', rateLimit({ limit: 1, period: 60 }), (c) => c.json({ ok: true }));

      // Use up limit
      await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      // Next request should be rate limited
      const res = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      const retryAfter = parseInt(res.headers.get('Retry-After')!);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('prevents DID enumeration attack', async () => {
      app.get('/lookup', rateLimit({ limit: 5, period: 60 }), (c) => c.json({ ok: true }));

      // Simulate attacker trying to enumerate DIDs
      const attackerIP = '6.6.6.6';

      // Make 5 lookup requests
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/lookup', {
          headers: { 'CF-Connecting-IP': attackerIP },
        });
        expect(res.status).toBe(200);
      }

      // 6th request blocked
      const res = await app.request('/lookup', {
        headers: { 'CF-Connecting-IP': attackerIP },
      });
      expect(res.status).toBe(429);
    });

    it('prevents device registration spam', async () => {
      app.post('/register', rateLimit({ limit: 3, period: 300 }), (c) => c.json({ ok: true }));

      const spammerIP = '7.7.7.7';

      // Use up limit (3 registrations in 5 minutes)
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/register', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': spammerIP },
        });
        expect(res.status).toBe(200);
      }

      // 4th registration blocked
      const res = await app.request('/register', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': spammerIP },
      });
      expect(res.status).toBe(429);
    });
  });

  describe('GOLDEN: Authenticated users tracked by UID', () => {
    it('uses UID instead of IP when authenticated', async () => {
      app.get(
        '/test',
        (c, next) => {
          // Mock authentication
          c.set('user', { uid: 'user123', phoneNumber: '+14155551234' });
          return next();
        },
        rateLimit({ limit: 2, period: 60 }),
        (c) => c.json({ ok: true })
      );

      // User 1: use full limit (same IP, different UID)
      for (let i = 0; i < 2; i++) {
        const res = await app.request('/test', {
          headers: { 'CF-Connecting-IP': '1.1.1.1' },
        });
        expect(res.status).toBe(200);
      }

      // Same IP but different user should have separate limit
      app = new Hono();
      app.onError((error, c) => handleError(error, c));
      app.get(
        '/test',
        (c, next) => {
          c.set('user', { uid: 'user456', phoneNumber: '+14155555678' });
          return next();
        },
        rateLimit({ limit: 2, period: 60 }),
        (c) => c.json({ ok: true })
      );

      const res = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.1.1.1' }, // Same IP as user123
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('1'); // Fresh limit
    });
  });

  describe('Edge cases', () => {
    it('handles missing CF-Connecting-IP header', async () => {
      app.get('/test', rateLimit({ limit: 1, period: 60 }), (c) => c.json({ ok: true }));

      // First request succeeds
      const res1 = await app.request('/test');
      expect(res1.status).toBe(200);

      // Second request rate limited (both use 'anonymous' key)
      const res2 = await app.request('/test');
      expect(res2.status).toBe(429);
    });

    it('handles very short periods', async () => {
      app.get('/test', rateLimit({ limit: 1, period: 1 }), (c) => c.json({ ok: true }));

      // Use up limit
      const res1 = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });
      expect(res1.status).toBe(200);

      // Immediately blocked
      const res2 = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });
      expect(res2.status).toBe(429);

      // Wait for period to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be allowed again
      const res3 = await app.request('/test', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });
      expect(res3.status).toBe(200);
    });
  });
});
