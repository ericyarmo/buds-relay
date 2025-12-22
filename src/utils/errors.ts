/**
 * Error Handling & Logging
 * Phase 4 of Hardening Sprint
 *
 * Safe error messages, structured logging, zero info leaks.
 */

import type { Context } from 'hono';
import { z } from 'zod';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public code: string,
    public internalDetails?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Predefined error types
export const Errors = {
  Unauthorized: () =>
    new AppError('Unauthorized', 401, 'AUTH_FAILED'),

  Forbidden: () =>
    new AppError('Forbidden', 403, 'FORBIDDEN'),

  NotFound: (resource: string) =>
    new AppError(`${resource} not found`, 404, 'NOT_FOUND'),

  RateLimited: () =>
    new AppError('Rate limit exceeded', 429, 'RATE_LIMITED'),

  ValidationFailed: (details: string) =>
    new AppError('Validation failed', 400, 'VALIDATION_ERROR', details),

  Internal: () =>
    new AppError('Internal server error', 500, 'INTERNAL_ERROR'),

  DeviceLimitExceeded: () =>
    new AppError(
      'Device limit exceeded (max 10 devices per user)',
      400,
      'DEVICE_LIMIT_EXCEEDED'
    ),

  CircleLimitExceeded: () =>
    new AppError(
      'Circle limit exceeded (max 12 members)',
      400,
      'CIRCLE_LIMIT_EXCEEDED'
    ),
};

/**
 * Central error handler
 * Logs errors safely, returns user-friendly messages
 */
export function handleError(error: unknown, c: Context): Response {
  const requestId = c.req.header('CF-Ray') || crypto.randomUUID();

  // AppError (known errors)
  if (error instanceof AppError) {
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      code: error.code,
      status: error.statusCode,
      message: error.message,
      details: error.internalDetails,
      path: c.req.url,
      method: c.req.method,
      timestamp: Date.now(),
    }));

    return c.json({
      error: error.message,
      code: error.code,
      requestId,
    }, error.statusCode);
  }

  // Zod validation errors
  if (error instanceof z.ZodError) {
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      code: 'VALIDATION_ERROR',
      status: 400,
      errors: error.errors,
      path: c.req.url,
      timestamp: Date.now(),
    }));

    return c.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      requestId,
    }, 400);
  }

  // Unknown errors - log internally but don't expose
  console.error(JSON.stringify({
    level: 'error',
    requestId,
    code: 'INTERNAL_ERROR',
    status: 500,
    error: String(error),
    stack: error instanceof Error ? error.stack : undefined,
    path: c.req.url,
    timestamp: Date.now(),
  }));

  return c.json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  }, 500);
}

/**
 * Structured logger
 */
export interface LogContext {
  requestId: string;
  path: string;
  method: string;
  userId?: string;
}

export const logger = {
  info(message: string, context: LogContext, data?: Record<string, any>) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      ...context,
      ...data,
      timestamp: Date.now(),
    }));
  },

  warn(message: string, context: LogContext, data?: Record<string, any>) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      ...context,
      ...data,
      timestamp: Date.now(),
    }));
  },

  error(message: string, context: LogContext, error?: unknown) {
    console.error(JSON.stringify({
      level: 'error',
      message,
      ...context,
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
    }));
  },
};
