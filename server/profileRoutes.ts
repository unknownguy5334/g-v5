import express, { Request, Response } from 'express';
import { getStudentProfile, getOrCreateStudentProfile, startFreeRun, completeRun, getAppConfig } from './services/studentProfile';
import { getStudentCourses, saveStudentCourses, restoreLatestCourseRevision } from './services/courseService';
import { getStudentSchedules, saveGeneratedSchedule } from './services/scheduleService';
import { getCurrentAcademicContext, invalidateAcademicContextCache } from './services/academicContext';
import { getAccessState } from './services/accessService';
import { requireAuth, requireAdmin } from './authMiddleware';
import { persistentRateLimitMiddleware } from './rateLimitMiddleware';

import { getDb } from './db';
import { appConfig, adminAuditLog } from './db/schema';
import { eq } from 'drizzle-orm';
import { sanitizeSectionsSnapshot, sanitizePreferencesSnapshot } from '../src/utils/persistenceValidation';
import { isUuid } from './inputValidation';
import { knownPublicErrorMessage } from './errors';

export function registerProfileRoutes(app: express.Express) {
  app.get('/api/profile', requireAuth, persistentRateLimitMiddleware('profile_read', 60, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const access = await getAccessState(user.id);
      res.json({ ok: true, profile: user.profile, role: user.role, access });
    } catch (e: unknown) {
      console.error('[Profile] Profile load error:', e);
      res.status(503).json({ error: 'Your account could not be loaded right now. Please try again.', code: 'PROFILE_UNAVAILABLE', retryable: true });
    }
  });

  app.get('/api/courses', requireAuth, persistentRateLimitMiddleware('courses_read', 60, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const requestedYear = typeof req.query.academicYear === 'string' ? req.query.academicYear : undefined;
      const requestedTerm = typeof req.query.term === 'string' ? req.query.term : undefined;
      const courses = await getStudentCourses(user.id, requestedYear, requestedTerm);
      res.json({ ok: true, courses: courses || [] });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.post('/api/courses/restore', requireAuth, persistentRateLimitMiddleware('courses_restore', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json({ limit: '2mb' }), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const courseSetId = typeof req.body?.courseSetId === 'string' ? req.body.courseSetId.trim() : '';
    if (!isUuid(courseSetId)) return res.status(400).json({ error: 'A valid courseSetId is required.', code: 'INVALID_ID' });
    if (!courseSetId) return res.status(400).json({ error: 'courseSetId is required.', code: 'COURSE_SET_ID_REQUIRED' });
    try {
      const courseSet = await restoreLatestCourseRevision(user.id, courseSetId);
      res.json({ ok: true, courseSet });
    } catch (e: any) {
      res.status(400).json({ error: knownPublicErrorMessage(e, 'Could not restore the previous course version.', ['Course set not found', 'No previous course version is available.']), code: 'COURSE_RESTORE_FAILED' });
    }
  });

  app.post('/api/courses', requireAuth, persistentRateLimitMiddleware('courses_save', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json({limit: '2mb'}), async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const incoming = req.body?.courses;
      const sanitized = sanitizeSectionsSnapshot(incoming);
      if (!sanitized || sanitized.length !== (Array.isArray(incoming) ? incoming.length : 0) || sanitized.length > 500) {
        return res.status(400).json({ error: 'Course data is invalid or too large.', code: 'INVALID_COURSE_DATA' });
      }
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined;
      await saveStudentCourses(user.id, sanitized, title);
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.get('/api/schedules', requireAuth, persistentRateLimitMiddleware('schedules_read', 60, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const schedules = await getStudentSchedules(user.id);
      res.json({ ok: true, schedules });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.post('/api/schedules', requireAuth, persistentRateLimitMiddleware('schedules_save', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json({limit: '1mb'}), async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const scheduleTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : 'Saved Schedule';
      if (scheduleTitle.length > 120 || /[\u0000-\u001F\u007F]/.test(scheduleTitle)) {
        return res.status(400).json({ error: 'Schedule title is invalid.', code: 'INVALID_SCHEDULE_TITLE' });
      }
      const runId = typeof req.body.runId === 'string' ? req.body.runId.trim() : '';
      if (!isUuid(runId)) return res.status(400).json({ error: 'A valid scheduling run is required before saving a result.', code: 'INVALID_ID' });
      if (!runId) {
        return res.status(400).json({ error: 'A valid scheduling run is required before saving a result.', code: 'RUN_ID_REQUIRED' });
      }
      const saved = await saveGeneratedSchedule(user.id, req.body.scheduleData, scheduleTitle || 'Saved Schedule', runId);
      res.json({ ok: true, schedule: saved });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.get('/api/access', requireAuth, persistentRateLimitMiddleware('access_read', 120, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const state = await getAccessState((req as any).user.id);
      res.json({ ok: true, ...state });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.post('/api/run/start', requireAuth, persistentRateLimitMiddleware('run_start', 6, 60_000, (req) => `user:${(req as any).user.id}`), express.json({ limit: '3mb' }), async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const sectionsSnapshot = sanitizeSectionsSnapshot(req.body?.sections);
      const preferencesSnapshot = sanitizePreferencesSnapshot(req.body?.preferences);
      if (!sectionsSnapshot || !preferencesSnapshot || sectionsSnapshot.length === 0) {
        return res.status(400).json({ error: 'The schedule inputs are incomplete or invalid. Please review your courses and choices.', code: 'INVALID_RUN_INPUT' });
      }
      const context = await getCurrentAcademicContext();
      const access = await getAccessState(user.id);
      let accessType: 'FREE_RUN' | 'PAID' = 'FREE_RUN';

      if (!access.hasFreeRun) {
        if (!access.hasScheduleAccess) return res.status(403).json({ error: 'Access denied: free run consumed and no active paid access.', code: 'PAYMENT_REQUIRED' });
        accessType = 'PAID';
      }
      const result = await startFreeRun(user.id, accessType, context.academicYear, context.term);
      res.json({ ok: true, runId: result.run.id, profile: await getStudentProfile(user.id), accessType: result.accessType || accessType });
    } catch (e: any) {
      if (e.message === 'Free run already in progress') {
        return res.status(409).json({ error: 'A schedule run is already in progress for this account.', code: 'RUN_IN_PROGRESS' });
      }
      if (e.message === 'Free run already used') {
        const state = await getAccessState(user.id);
        if (state.hasScheduleAccess) return res.status(200).json({ ok: true, accessType: 'PAID', profile: await getStudentProfile(user.id) });
        return res.status(403).json({ error: 'Access denied: free run consumed and no active paid access.', code: 'PAYMENT_REQUIRED' });
      }
      res.status(400).json({ error: knownPublicErrorMessage(e, 'Could not start the schedule run.', ['The current academic access period is unavailable. Please try again later.']), code: 'RUN_START_FAILED' });
    }
  });

  app.post('/api/run/complete', requireAuth, persistentRateLimitMiddleware('run_complete', 20, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { runId, success } = req.body || {};
    if (!isUuid(runId)) return res.status(400).json({ error: 'A valid runId is required.', code: 'INVALID_ID' });
    if (success !== true) return res.status(400).json({ error: 'A run is only completed after a successful schedule result.', code: 'RUN_SUCCESS_REQUIRED' });
    try {
      const profile = await completeRun(user.id, runId);
      res.json({ ok: true, profile });
    } catch (e: any) {
      res.status(400).json({ error: knownPublicErrorMessage(e, 'Could not complete the schedule run.', ['Run not found', 'Run is not active', 'This scheduling run expired. Your free run is still available; please start again.', 'Paid access for this scheduling run is no longer active.', 'A successful generated schedule result is required before completing the run.']), code: 'RUN_COMPLETE_FAILED' });
    }
  });

  app.get('/api/academic-context', persistentRateLimitMiddleware('academic_context_public', 120, 60_000, (req) => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`), async (req: Request, res: Response) => {
    try {
      const context = await getCurrentAcademicContext();
      res.json({ ok: true, academicYear: context.academicYear, term: context.term });
    } catch (e: any) {
      console.error('[Profile] Internal error:', e);
      res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }
  });

  app.post('/api/admin/term-override', requireAdmin, persistentRateLimitMiddleware('admin_term_override', 20, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try {
      const { mode } = req.body || {};
      if (!['AUTO', 'FALL', 'SPRING', 'SUMMER'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'Database not initialized', code: 'DB_UNAVAILABLE', retryable: true });
      await db.transaction(async (tx) => { const configRows = await tx.select({ id: appConfig.id }).from(appConfig).limit(1); if (!configRows.length) { await tx.insert(appConfig).values({ id: 'singleton', termOverrideMode: mode }); } else { await tx.update(appConfig).set({ termOverrideMode: mode, updatedAt: new Date() }).where(eq(appConfig.id, configRows[0].id)); } await tx.insert(adminAuditLog).values({ adminId:(req as any).user.id, action:'TERM_OVERRIDE_CHANGED', targetType:'APP_CONFIG', targetId:'singleton', metadata:{ mode } }); });
      invalidateAcademicContextCache();
      res.json({ ok: true, mode });
    } catch (e: unknown) {
      console.error('[Profile] Term override error:', e);
      res.status(503).json({ error: 'The academic term setting could not be saved. Please try again.', code: 'TERM_OVERRIDE_UNAVAILABLE', retryable: true });
    }
  });
}