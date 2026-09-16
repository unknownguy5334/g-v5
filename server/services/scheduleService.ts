import { eq, desc, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDb, getDbPool } from '../db';
import { savedSchedules } from '../db/schema';
import { logActivity } from './studentProfile';
import { getCurrentAcademicContext } from './academicContext';
import { canContinuePaidRun } from './accessService';
import { runSessions } from '../db/schema';
import { sanitizeSectionsSnapshot, sanitizePreferencesSnapshot } from '../../src/utils/persistenceValidation';

export async function saveGeneratedSchedule(studentId: string, scheduleData: any, title?: string, runId?: string) {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');

  if (!scheduleData || typeof scheduleData !== 'object' || scheduleData.signatureStatus !== 'verified' || scheduleData.sectionsSnapshotComplete !== true || scheduleData.preferencesSnapshotComplete !== true || !Array.isArray(scheduleData.byDayCount)) {
    throw new Error('The generated schedule result is incomplete or not verified.');
  }
  const totalGeneratedSchedules: number = (Object.values(scheduleData.byDayCount) as unknown[]).reduce<number>((sum: number, bucket: unknown) => sum + (Array.isArray(bucket) ? bucket.length : 0), 0);
  if (totalGeneratedSchedules <= 0 || scheduleData.searchCompleteness === 'cancelled' || scheduleData.searchCompleteness === 'preflight_rejected') {
    throw new Error('A successful schedule result is required before it can be saved.');
  }
  if (!sanitizePreferencesSnapshot(scheduleData.preferencesUsed)) {
    throw new Error('The generated preferences snapshot is invalid.');
  }
  if (!sanitizeSectionsSnapshot(scheduleData.sectionsSnapshot)) {
    throw new Error('The generated course snapshot is invalid.');
  }

  if (!runId) throw new Error('The scheduling run is required.');
  const providedResultToken = typeof scheduleData.resultIntegrityToken === 'string' ? scheduleData.resultIntegrityToken : '';
  if (!providedResultToken || providedResultToken.length > 200) throw new Error('The generated schedule result is not authorized for this run.');

  const pool = getDbPool();
  if (!pool) throw new Error('DB not initialized');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the run row for the entire authorization + insert + token-consumption
    // sequence. This closes the TOCTOU window where completion or another save
    // could otherwise race the pre-check and reuse the same result token.
    const runResult = await client.query(
      `SELECT id, student_id, status, academic_year, term, expires_at, access_type, result_token_hash
       FROM run_sessions WHERE id=$1 AND student_id=$2 FOR UPDATE`,
      [runId, studentId],
    );
    const run = runResult.rows[0];
    if (!run || run.status !== 'IN_PROGRESS') throw new Error('The associated schedule run is no longer active.');

    const tokenHash = crypto.createHash('sha256').update(providedResultToken).digest('hex');
    if (!run.result_token_hash || !crypto.timingSafeEqual(Buffer.from(tokenHash, 'hex'), Buffer.from(run.result_token_hash, 'hex'))) {
      throw new Error('The generated schedule result is not authorized for this run.');
    }
    if (run.expires_at && new Date(run.expires_at).getTime() <= Date.now()) throw new Error('The associated schedule run has expired.');

    if (run.access_type === 'PAID' && !(await canContinuePaidRun(studentId, run.academic_year, run.term as 'FALL' | 'SPRING' | 'SUMMER'))) {
      throw new Error('Paid access for the associated schedule run is no longer active.');
    }

    const insertResult = await client.query(
      `INSERT INTO saved_schedules (student_id, run_id, academic_year, term, schedule_data, title)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
      [studentId, run.id, run.academic_year, run.term, JSON.stringify(scheduleData), title || 'Saved Schedule'],
    );
    const result = insertResult.rows[0];
    await client.query(
      `UPDATE run_sessions SET result_token_hash=NULL, result_created=1 WHERE id=$1 AND student_id=$2 AND status='IN_PROGRESS'`,
      [run.id, studentId],
    );
    await client.query('COMMIT');
    await logActivity(studentId, 'SCHEDULE_SAVED', { scheduleId: result.id, runId: run.id });
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getStudentSchedules(studentId: string) {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');

  return await db.select().from(savedSchedules).where(eq(savedSchedules.studentId, studentId)).orderBy(desc(savedSchedules.createdAt)).limit(100);
}


export async function setFavoriteSchedule(studentId: string, scheduleId: string, favorite: boolean) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  return db.transaction(async (tx) => {
    if (favorite) {
      await tx.update(savedSchedules)
        .set({ isFavorite: 0, updatedAt: new Date() })
        .where(eq(savedSchedules.studentId, studentId));
    }
    const rows = await tx.update(savedSchedules)
      .set({ isFavorite: favorite ? 1 : 0, updatedAt: new Date() })
      .where(and(eq(savedSchedules.id, scheduleId), eq(savedSchedules.studentId, studentId)))
      .returning();
    if (!rows.length) throw new Error('Schedule not found');
    return rows[0];
  });
}

export async function renameSavedSchedule(studentId: string, scheduleId: string, title: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  if (!title.trim() || title.trim().length > 120 || /[\u0000-\u001F\u007F]/.test(title)) throw new Error('Schedule title is invalid.');
  const rows = await db.update(savedSchedules).set({ title: title.trim(), updatedAt: new Date() }).where(and(eq(savedSchedules.id, scheduleId), eq(savedSchedules.studentId, studentId))).returning();
  if (!rows.length) throw new Error('Schedule not found');
  return rows[0];
}

export async function deleteSavedSchedule(studentId: string, scheduleId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const rows = await db.delete(savedSchedules).where(and(eq(savedSchedules.id, scheduleId), eq(savedSchedules.studentId, studentId))).returning();
  if (!rows.length) throw new Error('Schedule not found');
  return rows[0];
}
