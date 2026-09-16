import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });

const routeFiles = [
  'server.ts', 'server/authMiddleware.ts', 'server/profileRoutes.ts', 'server/accountRoutes.ts',
  'server/paymentRoutes.ts', 'server/optimizerRoutes.ts', 'server/authRoutes.ts',
];
const serviceFiles = [
  'server/services/accessService.ts', 'server/services/accountService.ts', 'server/services/courseService.ts',
  'server/services/notificationService.ts', 'server/services/paymentService.ts', 'server/services/scheduleService.ts',
  'server/services/studentProfile.ts', 'server/services/purePolicies.ts',
];
const routeText = routeFiles.map(read).join('\n');
const serviceText = serviceFiles.map(read).join('\n');

// Authentication-derived authority must be server owned.
const middleware = read('server/authMiddleware.ts');
check('Admin role is loaded from application profile, not auth-provider role', /profile\?\.role === 'ADMIN'/.test(middleware) && !/data\.user\??\.role/.test(middleware));
check('Database failure cannot silently create an authenticated request', /if \(!pool\) return null;/.test(middleware));
check('All admin entry points use requireAdmin', [
  /\/api\/admin\/students', requireAdmin/.test(routeText),
  /\/api\/admin\/payments', requireAdmin/.test(routeText),
  /\/api\/admin\/products', requireAdmin/.test(routeText),
  /\/api\/admin\/payment-methods', requireAdmin/.test(routeText),
  /\/api\/admin\/entitlements', requireAdmin/.test(routeText),
  /\/api\/admin\/term-override', requireAdmin/.test(routeText),
  /\/api\/models", requireAdmin/.test(routeText),
].every(Boolean));
check('Student-owned API entry points use requireAuth', [
  /\/api\/profile', requireAuth/.test(routeText),
  /\/api\/courses', requireAuth/.test(routeText),
  /\/api\/schedules', requireAuth/.test(routeText),
  /\/api\/run\/start', requireAuth/.test(routeText),
  /\/api\/run\/complete', requireAuth/.test(routeText),
  /\/api\/payment\/submissions', requireAuth/.test(routeText),
  /\/api\/account\/overview', requireAuth/.test(routeText),
].every(Boolean));

// No remotely supplied identity may replace the authenticated principal.
check('No route trusts client-supplied studentId/userId/adminId', !/req\.(body|query|params)\.(studentId|userId|adminId)/.test(routeText + serviceText));
check('No browser-supplied role/entitlement is used as server authorization', !/req\.(body|query|params)\.(role|isAdmin|entitlement|hasScheduleAccess)|(?:localStorage|sessionStorage)[^\n]*\b(role|isAdmin|entitlement|hasScheduleAccess)\b/.test(routeText + serviceText));

// Horizontal object authorization.
const account = read('server/services/accountService.ts');
const course = read('server/services/courseService.ts');
const schedule = read('server/services/scheduleService.ts');
const notification = read('server/services/notificationService.ts');
const payment = read('server/services/paymentService.ts');
const student = read('server/services/studentProfile.ts');
check('Course-set duplication is ownership-scoped', /eq\(savedCourses\.id, sourceId\).*eq\(savedCourses\.studentId, studentId\)/s.test(account));
check('Course revision restore is ownership-scoped on read and write', /eq\(savedCourses\.id, courseSetId\), eq\(savedCourses\.studentId, studentId\)/.test(course) && /eq\(courseSetRevisions\.courseSetId, courseSetId\), eq\(courseSetRevisions\.studentId, studentId\)/.test(course));
check('Schedule mutations are ownership-scoped', [
  /eq\(savedSchedules\.id, scheduleId\), eq\(savedSchedules\.studentId, studentId\)/.test(schedule),
  /eq\(savedSchedules\.studentId, studentId\)/.test(schedule),
].every(Boolean));
check('Notification mutations are ownership-scoped', /eq\(notifications\.id, id\), eq\(notifications\.studentId, studentId\)/.test(notification));
check('Payment cancellation is ownership-scoped', /WHERE id=\$1 AND student_id=\$2 AND payment_status='PENDING'/.test(payment));
check('Student run completion is ownership-scoped', /WHERE id=\$1 AND student_id=\$2 FOR UPDATE/.test(student));
check('Saved schedule evidence for run completion is ownership-scoped', /WHERE run_id=\$1 AND student_id=\$2/.test(student));

// Paid entitlement is authoritative for every phase of a privileged paid run.
const pure = read('server/services/purePolicies.ts');
const access = read('server/services/accessService.ts');
const optimizer = read('server/optimizerRoutes.ts');
check('Paid-run continuation policy requires current academic-year coverage', /runContext\.academicYear !== currentContext\.academicYear/.test(pure));
check('Paid-run continuation policy recognizes academic-year vs current-term coverage', /plan === 'ACADEMIC_YEAR'/.test(pure) && /plan === 'CURRENT_TERM'/.test(pure));
check('Paid-run continuation queries ACTIVE entitlements for the authenticated student', /eq\(entitlements\.studentId, studentId\).*eq\(entitlements\.status, 'ACTIVE'\)/s.test(access));
check('Full optimizer binds run to authenticated student and active state', /eq\(runSessions\.id, runId\.trim\(\)\), eq\(runSessions\.studentId, user\.id\), eq\(runSessions\.status, 'IN_PROGRESS'\)/.test(optimizer));
check('Full optimizer rejects stale/revoked paid access', /ACCESS_REVOKED/.test(optimizer) && /run\.accessType === 'PAID'/.test(optimizer));
check('Schedule persistence rejects stale/revoked paid access', /run\.access_type === 'PAID'[\s\S]*canContinuePaidRun\(studentId, run\.academic_year, run\.term/s.test(schedule));
check('Run completion rejects stale/revoked paid access', /run\.access_type === 'PAID'/.test(student) && /canContinuePaidRun/.test(student));

// Vertical authorization and hidden internal functionality.
check('Diagnostic optimizer mode is admin-only', /normalizedMode === 'diagnostic' && user\.role !== 'ADMIN'/.test(optimizer) && /status\(403\)/.test(optimizer));
check('No admin-token/backdoor authorization path exists', !/x-gadwal-admin-token|admin-token/.test(routeText + serviceText));

// Provider-controlled identity boundary.
check('Admin identity is constrained to MIU emails', /isMiuEmail\(data\.user\.email\)/.test(middleware));
check('Profile upsert cannot promote a student from provider-controlled input', /role: 'STUDENT'/.test(student) && !/role\s*:\s*data\.user/.test(student));

// Payment/admin action authorization stays route-guarded and business-state guarded.
const paymentRoutes = read('server/paymentRoutes.ts');
check('Admin approval/rejection/revocation actions are requireAdmin guarded', [
  /\/api\/admin\/payments\/\:id\/approve', requireAdmin/.test(paymentRoutes),
  /\/api\/admin\/payments\/\:id\/reject', requireAdmin/.test(paymentRoutes),
  /\/api\/admin\/entitlements\/\:id\/revoke', requireAdmin/.test(paymentRoutes),
].every(Boolean));
check('Payment approval only accepts pending submissions', /WHERE id=\$2.*payment_status='PENDING'/s.test(payment));
check('Entitlement revocation only changes ACTIVE entitlements', /if \(entitlement\.status !== 'ACTIVE'\)/.test(payment));
check('Purchase access is revalidated inside the paid-run transaction', /paidAccess/.test(student) && /status='ACTIVE'/.test(student));

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`\nAUTHORIZATION RED-TEAM 11: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
