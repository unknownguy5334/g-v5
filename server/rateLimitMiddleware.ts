import { NextFunction, Request, Response } from 'express';
import { allowPersistentRateLimit } from './persistentRateLimiter';

export function persistentRateLimitMiddleware(
  scope: string,
  limit: number,
  windowMs: number,
  getKey: (req: Request) => string,
  failClosed = true,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await allowPersistentRateLimit(scope, getKey(req), limit, windowMs, { failClosed });
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many requests. Please wait before trying again.', code: 'RATE_LIMITED', retryAfter: result.retryAfterSeconds });
      }
      return next();
    } catch {
      if (failClosed) {
        return res.status(503).json({ error: 'Request throttling is temporarily unavailable. Please try again shortly.', code: 'RATE_LIMIT_SERVICE_UNAVAILABLE', retryable: true });
      }
      return next();
    }
  };
}
