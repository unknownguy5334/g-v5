import crypto from 'node:crypto';
import { getDbPool } from './db';
import { SlidingWindowRateLimiter } from './rateLimiter';

export interface PersistentRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface PersistentRateLimitOptions {
  /** Reject requests rather than falling back to a local per-instance limiter. */
  failClosed?: boolean;
}

const memoryLimiters = new Map<string, SlidingWindowRateLimiter>();

function getMemoryLimiter(scope: string, limit: number, windowMs: number): SlidingWindowRateLimiter {
  const key = `${scope}:${limit}:${windowMs}`;
  let limiter = memoryLimiters.get(key);
  if (!limiter) {
    limiter = new SlidingWindowRateLimiter(limit, windowMs);
    memoryLimiters.set(key, limiter);
  }
  return limiter;
}

/**
 * Small fixed-window rate limiter backed by the shared Neon database so auth/payment
 * limits remain effective when Cloud Run scales across multiple instances.
 * Critical callers fail closed when the shared store is unavailable; an in-memory fallback
 * is available only when a caller explicitly opts into failClosed: false.
 */
export async function allowPersistentRateLimit(
  scope: string,
  rawKey: string,
  limit: number,
  windowMs: number,
  options: PersistentRateLimitOptions = { failClosed: true },
): Promise<PersistentRateLimitResult> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1000, Math.floor(windowMs));
  const now = Date.now();
  const windowStart = Math.floor(now / safeWindowMs) * safeWindowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + safeWindowMs - now) / 1000));
  const bucketKey = crypto.createHash('sha256').update(String(rawKey)).digest('hex').slice(0, 32);

  const pool = getDbPool();
  if (!pool) {
    if (options.failClosed) {
      return { allowed: false, retryAfterSeconds };
    }
    const memoryLimiter = getMemoryLimiter(scope, safeLimit, safeWindowMs);
    return memoryLimiter.allow(bucketKey);
  }

  try {
    const client = await pool.connect();
    try {
      const expiresAt = new Date(windowStart + safeWindowMs);
      const result = await client.query<{ count: number }>(
        `INSERT INTO rate_limit_buckets (scope, bucket_key, window_start, count, expires_at)
         VALUES ($1, $2, $3::bigint, 1, $4)
         ON CONFLICT (scope, bucket_key, window_start)
         DO UPDATE SET count = rate_limit_buckets.count + 1
         RETURNING count`,
        [scope, bucketKey, windowStart, expiresAt],
      );

      // Opportunistic cleanup avoids unbounded growth without adding a scheduled job.
      if (Math.random() < 0.02) {
        await client.query(`DELETE FROM rate_limit_buckets WHERE expires_at < NOW()`).catch(() => {});
      }

      const count = Number(result.rows[0]?.count || 0);
      return {
        allowed: count <= safeLimit,
        retryAfterSeconds: count > safeLimit ? retryAfterSeconds : 0,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[RateLimiter] Database rate limiting error:', err instanceof Error ? err.message : String(err));
    if (options.failClosed) {
      return { allowed: false, retryAfterSeconds };
    }
    const memoryLimiter = getMemoryLimiter(scope, safeLimit, safeWindowMs);
    return memoryLimiter.allow(bucketKey);
  }
}
