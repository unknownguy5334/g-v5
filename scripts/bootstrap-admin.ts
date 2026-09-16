import 'dotenv/config';
import { getDbPool } from '../server/db';

const enabledRaw = (process.env.ADMIN_BOOTSTRAP_ENABLED || '').trim().toLowerCase();
if (enabledRaw && enabledRaw !== 'true' && enabledRaw !== 'false') throw new Error('ADMIN_BOOTSTRAP_ENABLED must be true or false.');
const enabled = enabledRaw === 'true';
if (!enabled) throw new Error('ADMIN_BOOTSTRAP_ENABLED=true is required for one-time admin bootstrap.');
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
if (!email) throw new Error('ADMIN_BOOTSTRAP_EMAIL is required.');
if (!email.endsWith('@miuegypt.edu.eg')) throw new Error('ADMIN_BOOTSTRAP_EMAIL must be an MIU email.');

const pool = getDbPool();
if (!pool) throw new Error('DATABASE_URL is required.');

try {
  await pool.query('BEGIN');
  await pool.query("SELECT pg_advisory_xact_lock(hashtext('gadwal_admin_bootstrap'))");
  const existingAdmin = await pool.query("SELECT id, email FROM students WHERE role='ADMIN' LIMIT 1");
  if (existingAdmin.rows.length) throw new Error('An administrator already exists. Refusing to re-run bootstrap.');
  const result = await pool.query(
    "UPDATE students SET role='ADMIN', updated_at=NOW() WHERE lower(email)=lower($1) AND role='STUDENT' RETURNING id, email, role",
    [email]
  );
  if (!result.rows.length) throw new Error('Student profile not found. Have the account sign up first?');
  await pool.query('COMMIT');
  console.log(`Admin role assigned to ${result.rows[0].email}.`);
} catch (error) {
  try { await pool.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  await pool.end();
}
