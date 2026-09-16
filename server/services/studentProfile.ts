import { eq, and, desc } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { getDb, getDbPool } from '../db';
import { students, activityAudit, appConfig, runSessions, savedSchedules, accountDeletionTombstones } from '../db/schema';
import { getCurrentAcademicContext } from './academicContext';
import { canContinuePaidRun, canStartFreeRun, shouldConsumeFreeRun } from './purePolicies';

const RUN_TTL_MS = 2 * 60 * 60 * 1000;

export async function getOrCreateStudentProfile(userId: string, email: string, displayName?: string) {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');

  const normalizedEmail = (email || '').trim().toLowerCase();
  const normalizedName = displayName?.trim() || null;
  const userIdHash = createHash('sha256').update(userId).digest('hex');
  const deleted = await db.select({ userIdHash: accountDeletionTombstones.userIdHash })
    .from(accountDeletionTombstones)
    .where(eq(accountDeletionTombstones.userIdHash, userIdHash))
    .limit(1);
  if (deleted.length) {
    const error = new Error('This Gadwal account was deleted.');
    (error as any).code = 'ACCOUNT_DELETED';
    throw error;
  }

  // Upsert on the Neon Auth user id so concurrent session requests cannot race
  // through SELECT-then-INSERT and surface a duplicate-key failure. Never update
  // the stored role from auth-provider input; ADMIN remains server-controlled.
  await db.insert(students).values({
    id: userId,
    email: normalizedEmail,
    displayName: normalizedName,
    role: 'STUDENT',
  }).onConflictDoUpdate({
    target: students.id,
    set: {
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(normalizedName ? { displayName: normalizedName } : {}),
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const rows = await db.select().from(students).where(eq(students.id, userId)).limit(1);
  if (!rows.length) throw new Error('Student profile could not be loaded.');
  return rows[0];
}

export async function getStudentProfile(userId: string) {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');
  const rows = await db.select().from(students).where(eq(students.id, userId));
  return rows[0] || null;
}

export async function logActivity(studentId: string, eventType: string, metadata?: Record<string, any>) {
  const db = getDb();
  if (!db) {
    console.warn('[Audit] Activity log skipped because the database is unavailable.', { eventType });
    return;
  }
  try {
    await db.insert(activityAudit).values({ studentId, eventType, metadata });
  } catch (error) {
    // Activity logging must never turn an already-completed user action into a failed request.
    console.warn('[Audit] Activity log write failed.', { eventType, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function startFreeRun(studentId: string, accessType: 'FREE_RUN' | 'PAID', academicYear: string, term: string) {
  const pool = getDbPool();
  if (!pool) throw new Error('DB not initialized');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const studentResult = await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE', [studentId]);
    const student = studentResult.rows[0];
    if (!student) throw new Error('Student not found');

    const stale = await client.query(
      `SELECT * FROM run_sessions WHERE student_id=$1 AND status='IN_PROGRESS' AND expires_at IS NOT NULL AND expires_at <= NOW() FOR UPDATE`,
      [studentId],
    );
    for (const run of stale.rows) {
      await client.query(`UPDATE run_sessions SET status='FAILED', failed_at=NOW(), result_created=0, result_token_hash=NULL WHERE id=$1`, [run.id]);
    }
    if (stale.rows.some((run: any) => run.access_type === 'FREE_RUN')) {
      await client.query(`UPDATE students SET free_run_status='available', free_run_started_at=NULL, last_active_at=NOW() WHERE id=$1`, [studentId]);
      student.free_run_status = 'available';
    }

    // Serialize every run-start request for this student before deciding whether
    // to consume free access or paid access. Checking only inside the FREE_RUN
    // branch allowed a direct concurrent request to create a second run when a
    // PAID run already existed.
    const existing = await client.query(
      `SELECT * FROM run_sessions WHERE student_id=$1 AND status='IN_PROGRESS' ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
      [studentId],
    );
    if (existing.rows.length) {
      await client.query('COMMIT');
      return { run: existing.rows[0], profile: await getStudentProfile(studentId), accessType: existing.rows[0].access_type as 'FREE_RUN' | 'PAID' };
    }

    if (accessType === 'FREE_RUN') {
      if (!canStartFreeRun(student.free_run_status)) {
        await client.query('ROLLBACK');
        throw new Error('Free run already used');
      }
      const expiresAt = new Date(Date.now() + RUN_TTL_MS);
      const runResult = await client.query(
        `INSERT INTO run_sessions (student_id, access_type, status, academic_year, term, expires_at)
         VALUES ($1,'FREE_RUN','IN_PROGRESS',$2,$3,$4) RETURNING *`,
        [studentId, academicYear, term, expiresAt],
      );
      await client.query(`UPDATE students SET free_run_status='in-progress', free_run_started_at=NOW(), last_active_at=NOW() WHERE id=$1`, [studentId]);
      await client.query('COMMIT');
      await logActivity(studentId, 'FREE_RUN_STARTED', { runId: runResult.rows[0].id, academicYear, term });
      return { run: runResult.rows[0], profile: await getStudentProfile(studentId) };
    }

    const paidAccess = await client.query(
      `SELECT id FROM entitlements
       WHERE student_id=$1 AND status='ACTIVE' AND academic_year=$2
       AND (plan='ACADEMIC_YEAR' OR (plan='CURRENT_TERM' AND term=$3))
       LIMIT 1`,
      [studentId, academicYear, term],
    );
    if (!paidAccess.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('Paid access is no longer active.');
    }
    const expiresAt = new Date(Date.now() + RUN_TTL_MS);
    const runResult = await client.query(
      `INSERT INTO run_sessions (student_id, access_type, status, academic_year, term, expires_at)
       VALUES ($1,'PAID','IN_PROGRESS',$2,$3,$4) RETURNING *`,
      [studentId, academicYear, term, expiresAt],
    );
    await client.query('COMMIT');
    return { run: runResult.rows[0] };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally { client.release(); }
}

export async function completeRun(studentId: string, runId: string) {
  const pool = getDbPool();
  if (!pool) throw new Error('DB not initialized');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runResult = await client.query(
      `SELECT * FROM run_sessions WHERE id=$1 AND student_id=$2 FOR UPDATE`,
      [runId, studentId],
    );
    const run = runResult.rows[0];
    if (!run) throw new Error('Run not found');
    if (run.status !== 'IN_PROGRESS') throw new Error('Run is not active');
    if (run.expires_at && new Date(run.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE run_sessions SET status='FAILED', failed_at=NOW(), result_created=0 WHERE id=$1`, [runId]);
      if (run.access_type === 'FREE_RUN') {
        await client.query(`UPDATE students SET free_run_status='available', free_run_started_at=NULL, last_active_at=NOW() WHERE id=$1`, [studentId]);
      }
      await client.query('COMMIT');
      throw new Error('This scheduling run expired. Your free run is still available; please start again.');
    }
    if (run.access_type === 'PAID') {
      const context = await getCurrentAcademicContext();
      const entitlementRows = await client.query(
        `SELECT plan, academic_year, term, status FROM entitlements WHERE student_id=$1 AND status='ACTIVE'`,
        [studentId],
      );
      const allowed = canContinuePaidRun(
        { academicYear: run.academic_year, term: run.term },
        { academicYear: context.academicYear, term: context.term },
        entitlementRows.rows.map((e: any) => ({ plan: e.plan, academicYear: e.academic_year, term: e.term, status: e.status })),
      );
      if (!allowed) throw new Error('Paid access for this scheduling run is no longer active.');
    }

    const resultRows = await client.query(
      `SELECT id FROM saved_schedules WHERE run_id=$1 AND student_id=$2 LIMIT 1`,
      [runId, studentId],
    );
    if (resultRows.rows.length === 0) throw new Error('A successful generated schedule result is required before completing the run.');

    const now = new Date();
    await client.query(
      `UPDATE run_sessions SET status='SUCCEEDED', completed_at=$1, failed_at=NULL, result_created=1, result_token_hash=NULL WHERE id=$2`,
      [now, runId],
    );

    if (shouldConsumeFreeRun(run.access_type === 'FREE_RUN' ? 'FREE_RUN' : 'PAID', true)) {
      await client.query(
        `UPDATE students SET free_run_status='used', free_run_completed_at=$1, last_active_at=$1 WHERE id=$2`,
        [now, studentId],
      );
    } else {
      await client.query(`UPDATE students SET last_active_at=$1 WHERE id=$2`, [now, studentId]);
    }

    await client.query('COMMIT');
    await logActivity(studentId, 'SCHEDULE_RUN_COMPLETED', { runId, accessType: run.access_type, academicYear: run.academic_year, term: run.term });
    return await getStudentProfile(studentId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getAppConfig() {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');
  const rows = await db.select().from(appConfig).limit(1);
  if (rows.length === 0) {
    const newConfig = await db.insert(appConfig).values({ id: 'singleton' }).returning();
    return newConfig[0];
  }
  return rows[0];
}

