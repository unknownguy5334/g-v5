import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const ok = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });

const accountRoutes = read('server/accountRoutes.ts');
const profileRoutes = read('server/profileRoutes.ts');
const paymentRoutes = read('server/paymentRoutes.ts');
const optimizerRoutes = read('server/optimizerRoutes.ts');
const account = read('server/services/accountService.ts');
const course = read('server/services/courseService.ts');
const notification = read('server/services/notificationService.ts');
const payment = read('server/services/paymentService.ts');
const schedule = read('server/services/scheduleService.ts');
const student = read('server/services/studentProfile.ts');
const middleware = read('server/authMiddleware.ts');

// Student endpoints: direct references require the authenticated principal and service-level ownership predicates.
ok('Course-set duplicate route uses authenticated principal', /\/api\/account\/course-sets\/:id\/duplicate', requireAuth/.test(accountRoutes) && /duplicateCourseSet\(\(req as any\)\.user\.id,req\.params\.id/.test(accountRoutes));
ok('Course-set duplicate enforces source ownership', /eq\(savedCourses\.id, sourceId\), eq\(savedCourses\.studentId, studentId\)/.test(account));
ok('Course revision restore route uses authenticated principal', /\/api\/courses\/restore', requireAuth/.test(profileRoutes) && /restoreLatestCourseRevision\(user\.id, courseSetId\)/.test(profileRoutes));
ok('Course revision restore enforces ownership on source and revision', /eq\(savedCourses\.id, courseSetId\), eq\(savedCourses\.studentId, studentId\)/.test(course) && /eq\(courseSetRevisions\.courseSetId, courseSetId\), eq\(courseSetRevisions\.studentId, studentId\)/.test(course));
ok('Schedule mutations use authenticated principal', [/schedules\/:id\/favorite', requireAuth/.test(accountRoutes), /schedules\/:id\/rename', requireAuth/.test(accountRoutes), /schedules\/:id', requireAuth/.test(accountRoutes)].every(Boolean));
ok('Schedule mutations enforce ownership', (schedule.match(/eq\(savedSchedules\.id, scheduleId\), eq\(savedSchedules\.studentId, studentId\)/g) || []).length >= 2);
ok('Notification read uses authenticated principal and owner predicate', /notifications\/:id\/read', requireAuth/.test(accountRoutes) && /eq\(notifications\.id, id\), eq\(notifications\.studentId, studentId\)/.test(notification));
ok('Payment cancellation is principal-bound', /payment\/submissions\/:id\/cancel', requireAuth/.test(paymentRoutes) && /WHERE id=\$1 AND student_id=\$2 AND payment_status='PENDING'/.test(payment));
ok('Run completion is principal-bound', /run\/complete', requireAuth/.test(profileRoutes) && /WHERE id=\$1 AND student_id=\$2 FOR UPDATE/.test(student));
ok('Run-backed schedule lookup is principal-bound', /WHERE run_id=\$1 AND student_id=\$2/.test(student));
ok('Run start never accepts a student/user id from the request', !/req\.body\?.*(studentId|userId)|req\.query\.(studentId|userId)|req\.params\.(studentId|userId)/.test(profileRoutes));
ok('Optimizer run lookup binds runId to authenticated principal', /eq\(runSessions\.id, runId\.trim\(\)\), eq\(runSessions\.studentId, user\.id\)/.test(optimizerRoutes));
ok('Account export derives every object set from authenticated principal', /getAccountOverview\(\(req as any\)\.user\.id\)/.test(accountRoutes) && /getNotifications\(\(req as any\)\.user\.id\)/.test(accountRoutes) && /eq\(activityAudit\.studentId,\(req as any\)\.user\.id\)/.test(accountRoutes));

// Payment object references: student mutations are scoped; admin references are deliberately global but protected by requireAdmin.
ok('Student payment reads are authenticated', /\/api\/payment\/submissions', requireAuth/.test(paymentRoutes) && /getStudentSubmissions\(user\.id\)/.test(paymentRoutes));
ok('Admin payment proof reference is requireAdmin-gated', /\/api\/admin\/payments\/:id\/proof', requireAdmin/.test(paymentRoutes));
ok('Admin payment approval/rejection references are requireAdmin-gated', [/\/api\/admin\/payments\/:id\/approve', requireAdmin/.test(paymentRoutes), /\/api\/admin\/payments\/:id\/reject', requireAdmin/.test(paymentRoutes)].every(Boolean));
ok('Admin entitlement reference is requireAdmin-gated', /\/api\/admin\/entitlements\/:id\/revoke', requireAdmin/.test(paymentRoutes));

// Identity boundary: no client-provided identity or role may become an object owner.
const allServer = [accountRoutes, profileRoutes, paymentRoutes, optimizerRoutes, account, course, notification, payment, schedule, student].join('\n');
ok('No route accepts client studentId/userId/adminId as authorization identity', !/req\.(body|query|params)\.(studentId|userId|adminId)/.test(allServer));
ok('No browser-supplied role/isAdmin becomes authorization', !/(req\.(body|query|params)|localStorage|sessionStorage).*\b(role|isAdmin)\b/.test(allServer));
ok('Authenticated principal comes from upstream session plus application profile', /get-session/.test(middleware) && /profile\?\.role === 'ADMIN'/.test(middleware) && /data\.user\.id/.test(middleware));

// Predictability/replay does not weaken the authorization check because every object lookup repeats the owner predicate.
ok('User-owned identifiers are UUIDs where applicable', /id: uuid\("id"\)\.primaryKey\(\)\.defaultRandom\(\)/.test(read('server/db/schema.ts')));
ok('Student-owned object tables carry student foreign keys', [
  /studentId: text\("student_id"\)\.notNull\(\)\.references\(\(\) => students\.id/.test(read('server/db/schema.ts')),
].every(Boolean));
ok('No undocumented HTTP verb route registration bypass is present', !/app\.(put|patch)\(/.test([accountRoutes, profileRoutes, paymentRoutes, optimizerRoutes].join('\n')));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`\nIDOR/BOLA RED-TEAM 12: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
