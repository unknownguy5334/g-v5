import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';

const { Pool } = pg;

function parsePoolMax(raw: string | undefined): number {
  const value = raw == null || raw.trim() === '' ? 5 : Number(raw);
  return Number.isInteger(value) && value >= 2 && value <= 10 ? value : 5;
}

let pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export interface DbConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  serverVersion?: string;
  timestamp?: string;
  error?: string;
}

/**
 * Lazily initializes and returns the PostgreSQL connection pool for Neon.
 * Returns null if DATABASE_URL is not set.
 */
export function getDbPool(): pg.Pool | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  if (!pool) {
    const isLocalhost = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: isLocalhost ? false : { rejectUnauthorized: true },
      // Keep per-instance connections bounded for Cloud Run/Neon autoscaling. Use
      // DATABASE_POOL_MAX to tune this when a pooled Neon endpoint is configured.
      max: parsePoolMax(process.env.DATABASE_POOL_MAX),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

    pool.on('error', (err: Error) => {
      console.error('[Neon DB] Unexpected client error on idle connection:', err.message);
    });
  }

  return pool;
}

export function getDb() {
  if (_db) return _db;
  const pool = getDbPool();
  if (!pool) return null;
  _db = drizzle(pool, { schema });
  return _db;
}

/**
 * Runs a simple 'SELECT 1' connection verification test against Neon PostgreSQL.
 */
export async function testDbConnection(): Promise<DbConnectionTestResult> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      ok: false,
      message: 'DATABASE_URL environment variable is not configured.',
    };
  }

  const p = getDbPool();
  if (!p) {
    return {
      ok: false,
      message: 'Database pool could not be initialized.',
    };
  }

  const startTime = Date.now();
  try {
    const client = await p.connect();
    try {
      const result = await client.query('SELECT 1 as connected, NOW() as current_time, version() as version;');
      const latencyMs = Date.now() - startTime;
      const row = result.rows[0];
      const versionText = row?.version ? String(row.version).split(' on ')[0] : undefined;
      return {
        ok: true,
        message: 'Successfully connected to Neon PostgreSQL database.',
        latencyMs,
        serverVersion: versionText,
        timestamp: row?.current_time ? new Date(row.current_time).toISOString() : new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: 'Failed to connect to Neon PostgreSQL database.',
      latencyMs,
      error: errorMessage,
    };
  }
}

/**
 * Gracefully shuts down the connection pool.
 */

/** Bounded startup/readiness retry. Returns the last result rather than throwing so
 * Cloud Run/another supervisor can keep the process alive in a degraded state. */
export async function waitForDbReady(options: { attempts?: number; baseDelayMs?: number } = {}): Promise<DbConnectionTestResult> {
  const attempts = Math.max(1, Math.min(5, Math.floor(options.attempts ?? 3)));
  const baseDelayMs = Math.max(100, Math.min(5000, Math.floor(options.baseDelayMs ?? 500)));
  let last: DbConnectionTestResult = { ok: false, message: 'Database readiness check not attempted.' };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await testDbConnection();
    if (last.ok) return last;
    if (attempt < attempts) {
      const delay = Math.min(4000, baseDelayMs * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return last;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } finally {
      pool = null;
    }
  }
}
