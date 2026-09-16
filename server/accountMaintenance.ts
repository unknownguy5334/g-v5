import { getDbPool } from './db';
import { createHash } from 'node:crypto';

export async function purgeDueDeletedAccounts() {
  const pool = getDbPool(); if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext('gadwal-account-purge')) AS locked`);
    if (!lock.rows[0]?.locked) { await client.query('ROLLBACK'); return; }
    const due = await client.query<{ id: string }>(`SELECT id FROM students WHERE deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= NOW() ORDER BY deletion_scheduled_for ASC LIMIT 100`);
    for (const row of due.rows) {
      const userIdHash = createHash('sha256').update(row.id).digest('hex');
      await client.query(
        `INSERT INTO account_deletion_tombstones (user_id_hash) VALUES ($1) ON CONFLICT (user_id_hash) DO NOTHING`,
        [userIdHash],
      );
    }
    if (due.rows.length) {
      await client.query(`DELETE FROM students WHERE id = ANY($1::text[]) AND deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= NOW()`, [due.rows.map((row) => row.id)]);
    }
    await client.query('COMMIT');
  } catch(e) { try { await client.query('ROLLBACK'); } catch {} console.error('[AccountMaintenance] purge failed', e); } finally { client.release(); }
}

export function startAccountMaintenance() { void purgeDueDeletedAccounts(); return setInterval(() => void purgeDueDeletedAccounts(), 60 * 60 * 1000); }
