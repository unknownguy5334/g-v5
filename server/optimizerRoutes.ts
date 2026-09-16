import express from 'express';
import crypto from 'node:crypto';
import { requireAuth } from './authMiddleware';
import { OptimizerParams, runOptimizer, OptimizerSearchBudget } from './optimizer/optimizer';
import { getDb } from './db';
import { canContinuePaidRun } from './services/accessService';
import { runSessions } from './db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { allowPersistentRateLimit } from './persistentRateLimiter';
import { OptimizerOutput } from '../src/types';
import { SlidingWindowRateLimiter } from './rateLimiter';

const optimizerProcessRateLimiter = new SlidingWindowRateLimiter(40, 60_000, 1);

export function registerOptimizerRoutes(app: express.Express): void {
  app.post('/api/generate-schedule', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const user = (req as any).user;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { courses, fixedCourses, targetCredits, preferences, mode, runId } = req.body as Partial<OptimizerParams> & { runId?: unknown };

      if (!courses || !preferences) {
        return res.status(400).json({ error: 'Missing required parameters: courses or preferences.' });
      }

      const normalizedMode = mode === undefined ? 'full' : mode;
      if (normalizedMode !== 'full' && normalizedMode !== 'estimate' && normalizedMode !== 'diagnostic') {
        return res.status(400).json({ error: 'Unsupported optimizer mode.', code: 'INVALID_MODE' });
      }

      if (normalizedMode === 'diagnostic' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Diagnostic optimizer mode is restricted to administrators.', code: 'FORBIDDEN' });
      }

      const processLimit = optimizerProcessRateLimiter.allow('all');
      if (!processLimit.allowed) {
        res.setHeader('Retry-After', String(processLimit.retryAfterSeconds));
        return res.status(503).json({ error: 'The scheduler is busy processing other requests. Please try again shortly.', code: 'SCHEDULER_BUSY', retryable: true, retryAfter: processLimit.retryAfterSeconds });
      }

      const limiterKey = `user:${user.id}:${normalizedMode}`;
      const limiter = await allowPersistentRateLimit(
        'optimizer_generate',
        limiterKey,
        normalizedMode === 'full' ? 8 : normalizedMode === 'estimate' ? 30 : 10,
        60_000,
        { failClosed: true },
      );
      const ipLimit = await allowPersistentRateLimit(
        'optimizer_generate_ip',
        `${ip}:${normalizedMode}`,
        normalizedMode === 'full' ? 20 : normalizedMode === 'estimate' ? 60 : 20,
        60_000,
        { failClosed: true },
      );
      if (!ipLimit.allowed) {
        res.setHeader('Retry-After', String(ipLimit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many schedule-generation requests from this network. Please wait before trying again.', code: 'RATE_LIMITED', retryAfter: ipLimit.retryAfterSeconds });
      }
      if (!limiter.allowed) {
        res.setHeader('Retry-After', String(limiter.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many schedule-generation requests. Please wait before trying again.', code: 'RATE_LIMITED', retryAfter: limiter.retryAfterSeconds });
      }

      if (normalizedMode === 'full') {
        if (typeof runId !== 'string' || !/^[0-9a-fA-F-]{20,100}$/.test(runId.trim())) {
          return res.status(403).json({ error: 'A valid active scheduling run is required.', code: 'RUN_REQUIRED' });
        }
        const db = getDb();
        if (!db) return res.status(503).json({ error: 'Scheduling service is temporarily unavailable.', code: 'DB_UNAVAILABLE', retryable: true });
        const run = (await db.select({ id: runSessions.id, status: runSessions.status, expiresAt: runSessions.expiresAt, studentId: runSessions.studentId, accessType: runSessions.accessType, academicYear: runSessions.academicYear, term: runSessions.term })
          .from(runSessions)
          .where(and(eq(runSessions.id, runId.trim()), eq(runSessions.studentId, user.id), eq(runSessions.status, 'IN_PROGRESS'), gt(runSessions.expiresAt, new Date())))
          .limit(1))[0];
        if (!run) return res.status(403).json({ error: 'The scheduling run is no longer active.', code: 'RUN_INVALID' });
        if (run.accessType === 'PAID') {
          const accessStillValid = await canContinuePaidRun(user.id, run.academicYear, run.term as 'FALL' | 'SPRING' | 'SUMMER');
          if (!accessStillValid) return res.status(403).json({ error: 'Paid access for this scheduling run is no longer active.', code: 'ACCESS_REVOKED' });
        }
      }
      
      const searchBudget: OptimizerSearchBudget = {
        maxCourseSubsetNodes: 100_000,
        maxSectionNodes: 500_000,
        maxResultsRetained: 3,
        maxEstimatesAllowed: 2_000_000
      };

      const result = runOptimizer({
        courses,
        fixedCourses: fixedCourses || [],
        targetCredits,
        preferences,
        mode: normalizedMode,
        searchBudget
      });

      let resultIntegrityToken: string | undefined;
      if (normalizedMode === 'full' && typeof runId === 'string') {
        resultIntegrityToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(resultIntegrityToken).digest('hex');
        const db = getDb();
        if (!db) return res.status(503).json({ error: 'Scheduling service is temporarily unavailable.', code: 'DB_UNAVAILABLE', retryable: true });
        const updated = await db.update(runSessions).set({ resultTokenHash: tokenHash, resultCreated: 0 }).where(and(eq(runSessions.id, runId.trim()), eq(runSessions.studentId, user.id), eq(runSessions.status, 'IN_PROGRESS'))).returning({ id: runSessions.id });
        if (!updated.length) return res.status(403).json({ error: 'The scheduling run is no longer active.', code: 'RUN_INVALID' });
      }

      // Remove internal diagnostic stats before sending to client
      if (result && 'searchStats' in result) {
        delete (result as any).searchStats;
      }
      if (result && 'diagnostics' in result) {
        delete (result as any).diagnostics;
      }
      if (resultIntegrityToken) (result as any).resultIntegrityToken = resultIntegrityToken;

      return res.json(result);
    } catch (e: any) {
      console.error('Failed to run optimizer on server:', e);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
}
