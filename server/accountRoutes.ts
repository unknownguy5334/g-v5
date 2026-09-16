import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin } from './authMiddleware';
import { getAccountOverview, markOnboardingCompleted, duplicateCourseSet, requestAccountDeletion, cancelAccountDeletion, getAdminStudentDirectory, getAdminStudentDetail } from './services/accountService';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from './services/notificationService';
import { setFavoriteSchedule, renameSavedSchedule, deleteSavedSchedule } from './services/scheduleService';
import { getDb } from './db';
import { activityAudit, students, adminAuditLog } from './db/schema';
import { desc, eq } from 'drizzle-orm';
import { fetchWithTimeout } from './upstream';
import { deriveNeonAuthBaseUrl } from './neonAuthUrl';
import { allowPersistentRateLimit } from './persistentRateLimiter';
import { persistentRateLimitMiddleware } from './rateLimitMiddleware';
import { resolveAuthoritativeOrigin } from './requestSecurity';
import { isUuid } from './inputValidation';
import { knownPublicErrorMessage } from './errors';

export function registerAccountRoutes(app: express.Express) {
  app.get('/api/account/overview', requireAuth, persistentRateLimitMiddleware('account_overview', 30, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => { try { res.json({ ok: true, ...(await getAccountOverview((req as any).user.id)) }); } catch(e:any) { console.error('[Account]',e); res.status(503).json({ error:'Account information is temporarily unavailable.', code:'ACCOUNT_UNAVAILABLE', retryable:true }); } });
  app.post('/api/account/onboarding/complete', requireAuth, persistentRateLimitMiddleware('onboarding_complete', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async (req: Request,res: Response) => { try { await markOnboardingCompleted((req as any).user.id); res.json({ok:true}); } catch(e:any){res.status(500).json({error:'Could not save onboarding state.'});} });
  app.get('/api/account/course-sets', requireAuth, persistentRateLimitMiddleware('account_course_sets', 30, 60_000, (req) => `user:${(req as any).user.id}`), async (req,res)=>{ try { const data=await getAccountOverview((req as any).user.id); res.json({ok:true,courseSets:data.courseSets}); } catch(e:any){res.status(503).json({error:'Could not load course sets.'});} });
  app.post('/api/account/course-sets/:id/duplicate', requireAuth, persistentRateLimitMiddleware('course_set_duplicate', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async(req,res)=>{ try { if (!isUuid(req.params.id)) return res.status(400).json({error:'Invalid course set identifier.',code:'INVALID_ID'}); const title=typeof req.body?.title==='string'?req.body.title.trim():undefined; if(title && (title.length>120 || /[\u0000-\u001F\u007F]/.test(title))) return res.status(400).json({error:'Course set title is invalid.',code:'INVALID_COURSE_SET_TITLE'}); const replaceExisting=req.body?.replaceExisting===true; res.json({ok:true,courseSet:await duplicateCourseSet((req as any).user.id,req.params.id,title,replaceExisting)}); } catch(e:any){ const isConflict = e?.code === 'COURSE_SET_EXISTS'; res.status(isConflict ? 409 : 400).json({error: isConflict ? 'A course set already exists for the current term. Confirm that you want to replace it.' : 'Could not duplicate the course set.', code: isConflict ? 'COURSE_SET_EXISTS' : 'COURSE_SET_DUPLICATE_FAILED'}); } });
  app.get('/api/account/notifications', requireAuth, persistentRateLimitMiddleware('account_notifications', 60, 60_000, (req) => `user:${(req as any).user.id}`), async(req,res)=>{ try{res.json({ok:true,notifications:await getNotifications((req as any).user.id)});}catch(e:any){res.status(503).json({error:'Could not load notifications.'});} });
  app.post('/api/account/notifications/:id/read', requireAuth, persistentRateLimitMiddleware('notification_read', 60, 60_000, (req) => `user:${(req as any).user.id}`), async(req,res)=>{ try{ if (!isUuid(req.params.id)) return res.status(400).json({error:'Invalid notification identifier.',code:'INVALID_ID'});res.json({ok:true,notification:await markNotificationRead((req as any).user.id,req.params.id)});}catch(e:any){res.status(404).json({error:'Notification not found.'});} });
  app.post('/api/account/notifications/read-all', requireAuth, persistentRateLimitMiddleware('notification_read_all', 30, 60_000, (req) => `user:${(req as any).user.id}`), async(req,res)=>{try{await markAllNotificationsRead((req as any).user.id);res.json({ok:true});}catch(e:any){res.status(500).json({error:'Could not update notifications.'});}});
  app.post('/api/account/schedules/:id/favorite', requireAuth, persistentRateLimitMiddleware('schedule_favorite', 60, 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async(req,res)=>{try{ if (!isUuid(req.params.id)) return res.status(400).json({error:'Invalid schedule identifier.',code:'INVALID_ID'});res.json({ok:true,schedule:await setFavoriteSchedule((req as any).user.id,req.params.id,req.body?.favorite===true)});}catch(e:any){res.status(404).json({error:'Schedule not found.'});}});
  app.post('/api/account/schedules/:id/rename', requireAuth, persistentRateLimitMiddleware('schedule_rename', 30, 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async(req,res)=>{try{ if (!isUuid(req.params.id)) return res.status(400).json({error:'Invalid schedule identifier.',code:'INVALID_ID'});res.json({ok:true,schedule:await renameSavedSchedule((req as any).user.id,req.params.id,typeof req.body?.title==='string'?req.body.title:'' )});}catch(e:any){res.status(400).json({error:knownPublicErrorMessage(e,'Could not rename the schedule.', ['Schedule title is invalid.']),code: 'SCHEDULE_RENAME_FAILED'});}});
  app.delete('/api/account/schedules/:id', requireAuth, persistentRateLimitMiddleware('schedule_delete', 30, 60_000, (req) => `user:${(req as any).user.id}`), async(req,res)=>{try{ if (!isUuid(req.params.id)) return res.status(400).json({error:'Invalid schedule identifier.',code:'INVALID_ID'});res.json({ok:true,schedule:await deleteSavedSchedule((req as any).user.id,req.params.id)});}catch(e:any){res.status(404).json({error:'Schedule not found.'});}});
  app.get('/api/account/export', requireAuth, persistentRateLimitMiddleware('account_export', 5, 60_000, (req) => `user:${(req as any).user.id}`), async(req,res)=>{try{const d=await getAccountOverview((req as any).user.id); const activity = await (async()=>{const db=getDb(); if(!db) return []; return db.select().from(activityAudit).where(eq(activityAudit.studentId,(req as any).user.id)).orderBy(desc(activityAudit.timestamp)).limit(500);})(); const safe={profile:d.profile,access:d.access,payments:d.payments,entitlements:d.entitlements,schedules:d.schedules,courseSets:d.courseSets,notifications:await getNotifications((req as any).user.id),activityAudit:activity}; res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition','attachment; filename="gadwal-account-export.json"'); res.setHeader('Cache-Control','private, no-store'); res.json(safe);}catch(e:any){res.status(503).json({error:'Could not export account data.'});}});
  app.post('/api/account/delete-request', requireAuth, persistentRateLimitMiddleware('account_delete_request', 5, 5 * 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async(req,res)=>{
    if(req.body?.confirmation!=='DELETE GADWAL') return res.status(400).json({error:'Type DELETE GADWAL to schedule account deletion.'});
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Your current password is required to schedule account deletion.' });
    try {
      const user = (req as any).user;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userRl = await allowPersistentRateLimit('auth_reauth_user', user.id, 5, 5 * 60_000, { failClosed: true });
      if (!userRl.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${userRl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
      const rl = await allowPersistentRateLimit('auth_reauth_ip', `${user.id}:${ip}`, 5, 5 * 60_000, { failClosed: true });
      if (!rl.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
      const authBase = deriveNeonAuthBaseUrl();
      if (!authBase) return res.status(503).json({ error: 'Authentication service is not configured for secure account deletion.', code: 'AUTH_UNAVAILABLE' });
      const reauth = await fetchWithTimeout(`${authBase.replace(/\/$/, '')}/sign-in/email`, { method:'POST', headers:{'Content-Type':'application/json','Origin':resolveAuthoritativeOrigin(req)}, body:JSON.stringify({email:user.email,password,rememberMe:false}), timeoutMs:8_000 });
      if (!reauth.ok) return res.status(403).json({ error:'Current password is incorrect.', code:'REAUTH_FAILED' });
      const scheduled=await requestAccountDeletion(user.id);
      res.json({ok:true,scheduledFor:scheduled.toISOString()});
    } catch(e:any){res.status(500).json({error:'Could not schedule account deletion.'});}
  });
  app.post('/api/account/delete-cancel', requireAuth, persistentRateLimitMiddleware('account_delete_cancel', 5, 5 * 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async(req,res)=>{
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Your current password is required to cancel account deletion.' });
    try {
      const user = (req as any).user;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userRl = await allowPersistentRateLimit('auth_reauth_user', user.id, 5, 5 * 60_000, { failClosed: true });
      if (!userRl.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${userRl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
      const rl = await allowPersistentRateLimit('auth_reauth_ip', `${user.id}:${ip}`, 5, 5 * 60_000, { failClosed: true });
      if (!rl.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
      const authBase = deriveNeonAuthBaseUrl();
      if (!authBase) return res.status(503).json({ error: 'Authentication service is not configured for secure account deletion.', code: 'AUTH_UNAVAILABLE' });
      const reauth = await fetchWithTimeout(`${authBase.replace(/\/$/, '')}/sign-in/email`, { method:'POST', headers:{'Content-Type':'application/json','Origin':resolveAuthoritativeOrigin(req)}, body:JSON.stringify({email:user.email,password,rememberMe:false}), timeoutMs:8_000 });
      if (!reauth.ok) return res.status(403).json({ error:'Current password is incorrect.', code:'REAUTH_FAILED' });
      await cancelAccountDeletion(user.id);
      res.json({ok:true});
    } catch(e:any){res.status(500).json({error:'Could not cancel account deletion.'});}
  });
  app.get('/api/admin/students', requireAdmin, persistentRateLimitMiddleware('admin_students_search', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async(req,res)=>{try{res.json({ok:true,students:await getAdminStudentDirectory(typeof req.query.search==='string'?req.query.search:'')});}catch(e:any){res.status(503).json({error:'Could not load students.'});}});
  app.get('/api/admin/students/:id', requireAdmin, persistentRateLimitMiddleware('admin_student_detail', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async(req,res)=>{try{res.json({ok:true,student:await getAdminStudentDetail(req.params.id)});}catch(e:any){res.status(404).json({error:'Student not found.'});}});
  app.post('/api/admin/students/:id/free-run/reset', requireAdmin, persistentRateLimitMiddleware('admin_free_run_reset', 60, 60_000, (req) => `admin:${(req as any).user.id}`), async(req,res)=>{try{ if (!req.params.id || req.params.id.length > 200 || /[\u0000-\u001F\u007F]/.test(req.params.id)) return res.status(400).json({error:'Invalid student identifier.',code:'INVALID_ID'});const db=getDb();if(!db) return res.status(503).json({error:'Database unavailable.'});const updated = await db.transaction(async (tx) => { const rows = await tx.update(students).set({freeRunStatus:'available',freeRunStartedAt:null,lastActiveAt:new Date()}).where(eq(students.id,req.params.id)).returning({id:students.id}); if(!rows.length) return rows; await tx.insert(adminAuditLog).values({ adminId:(req as any).user.id, action:'FREE_RUN_RESET', targetType:'STUDENT', targetId:req.params.id }); return rows; }); if(!updated.length) return res.status(404).json({error:'Student not found.'}); res.json({ok:true});}catch(e:any){res.status(500).json({error:'Could not reset free run.'});}});
}
