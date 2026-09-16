import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const dbUrl = String(env.DATABASE_URL || '').trim();
const authUrl = String(env.NEON_AUTH_URL || '').trim();
const appOrigin = String(env.APP_ORIGIN || '').trim();

if (!dbUrl || !authUrl) {
  console.log('NEON LIVE CHECK: SKIPPED — DATABASE_URL and/or NEON_AUTH_URL are not configured in this environment.');
  process.exit(0);
}

const { default: pg } = await import('pg');
const { Pool } = pg;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: true },
  max: 2,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 10000,
});

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

try {
  const client = await pool.connect();
  try {
    const ping = await client.query('SELECT 1 AS ok, current_database() AS db');
    assert(Number(ping.rows[0]?.ok) === 1, 'Neon PostgreSQL SELECT 1 failed.');

    const objects = await client.query(`
      SELECT c.table_schema, c.table_name
      FROM information_schema.tables c
      WHERE (c.table_schema = 'public' AND c.table_name IN ('students','products','payment_submissions','entitlements','saved_courses','saved_schedules','notifications'))
         OR (c.table_schema = 'neon_auth' AND c.table_name = 'user')
      ORDER BY c.table_schema, c.table_name
    `);
    const names = new Set(objects.rows.map((r) => `${r.table_schema}.${r.table_name}`));
    for (const required of ['public.students','public.products','public.payment_submissions','public.entitlements','public.saved_courses','public.saved_schedules','public.notifications','neon_auth.user']) {
      assert(names.has(required), `Required Neon table is missing: ${required}`);
    }

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='students'
        AND column_name IN ('onboarding_completed_at','deletion_requested_at','deletion_scheduled_for')
    `);
    const studentCols = new Set(cols.rows.map((r) => r.column_name));
    for (const col of ['onboarding_completed_at','deletion_requested_at','deletion_scheduled_for']) {
      assert(studentCols.has(col), `Student completion column is missing: ${col}`);
    }

    const migrationTable = await client.query(`
      SELECT to_regclass('public.__drizzle_migrations') AS public_migrations,
             to_regclass('drizzle.__drizzle_migrations') AS drizzle_migrations
    `);
    assert(Boolean(migrationTable.rows[0]?.public_migrations || migrationTable.rows[0]?.drizzle_migrations), 'Drizzle migration journal table could not be found.');
  } finally {
    client.release();
  }

  let authResponse;
  try {
    authResponse = await fetch(`${authUrl.replace(/\/$/, '')}/get-session`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(appOrigin ? { Origin: appOrigin } : {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    failures.push(`Neon Auth endpoint is unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (authResponse) {
    assert(authResponse.status >= 200 && authResponse.status < 500, `Neon Auth /get-session returned unexpected status ${authResponse.status}.`);
  }
} finally {
  await pool.end();
}

if (failures.length) {
  console.error(`NEON LIVE CHECK FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('NEON LIVE CHECK PASSED — Neon PostgreSQL, required application tables, migration journal, Neon Auth reachability, and auth schema are present.');
