import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const ok = (name, condition) => checks.push({ name, condition: Boolean(condition) });

const auth = read('server/authRoutes.ts');
const middleware = read('server/authMiddleware.ts');
const requestSecurity = read('server/requestSecurity.ts');
const paymentRoutes = read('server/paymentRoutes.ts');
const payment = read('server/services/paymentService.ts');
const profile = read('server/profileRoutes.ts');
const db = read('server/db/migrations/0009_security_hardening.sql');
const schema = read('server/db/schema.ts');
const rate = read('server/persistentRateLimiter.ts');
const env = read('.env.example');

ok('Persistent shared auth rate limiter', /allowPersistentRateLimit/.test(auth) && /rate_limit_buckets/.test(rate) && db.includes('rate_limit_buckets'));
ok('Persistent payment submission rate limiter', /allowPersistentRateLimit/.test(paymentRoutes));
ok('Production cookie requests require origin/referer or authorization', /ORIGIN_REQUIRED/.test(requestSecurity));
ok('Saved schedules require a server-issued run id', /RUN_ID_REQUIRED/.test(profile));
ok('Payment amount is constrained in DB', db.includes('payment_submissions_amount_positive_chk'));
ok('No runtime hard-coded admin identity', !new RegExp('youssef2409621@miuegypt\\.edu\\.eg').test(middleware + profile + paymentRoutes + payment));
ok('No diagnostic admin-token runtime bypass', !(middleware + profile + paymentRoutes).includes('x-gadwal-admin-token') && !(middleware + profile + paymentRoutes).includes('admin-token'));
ok('Auth forwards multiple Set-Cookie headers safely', /getSetCookie/.test(auth));
ok('External Vite host is not enabled by example config', /ALLOW_EXTERNAL_VITE_HOST=false/.test(env));
ok('Admin bootstrap email is not prefilled', /^ADMIN_BOOTSTRAP_EMAIL=$/m.test(env));
ok('Student course and schedule APIs are authenticated', /\/api\/courses', requireAuth/.test(profile) && /\/api\/schedules', requireAuth/.test(profile));
ok('Payment methods are server-validated and enabled', /SUPPORTED_PAYMENT_METHODS/.test(payment) && /paymentMethodsConfig/.test(payment));
ok('Auth verification requires upstream success plus DB state', /!otpResponse\.ok \|\| otpData\?\.error/.test(auth) && /emailVerified.*!== true/.test(auth));
ok('Role comes from stored student record', /role !== 'ADMIN'|role:\s*'STUDENT'/.test(read('server/services/studentProfile.ts')) && /profile\?\.role === 'ADMIN'/.test(read('server/authMiddleware.ts')));
ok('No one-off audit patch scripts remain', !fs.existsSync(path.join(root, 'apply2.py')) && !fs.existsSync(path.join(root, 'apply3.py')) && !fs.existsSync(path.join(root, 'apply4.py')) && !fs.existsSync(path.join(root, 'apply_audit11.py')));
ok('Optimizer uses cookie session credentials only', !/localStorage\.getItem\(['"]token['"]\)/.test(read('src/utils/optimizerWorkerClient.ts')) && !/Authorization['\"]?\s*:\s*`Bearer/.test(read('src/utils/optimizerWorkerClient.ts')) && /credentials:\s*['"]same-origin['"]/.test(read('src/utils/optimizerWorkerClient.ts')));
ok('Production origin checks do not trust raw forwarded-host headers', !/x-forwarded-host/.test(read('server/requestSecurity.ts')) && /nodeEnv === 'production'\) return false/.test(read('server/requestSecurity.ts')));
ok('Session endpoint does not expose upstream session object', !/session:\s*sessionData\.session/.test(read('server/authRoutes.ts')) && /session:\s*\{ authenticated: true \}/.test(read('server/authRoutes.ts')));
ok('Signup errors are normalized instead of relaying provider bodies', !/res\.status\(response\.status\)\.json\(parsed\)/.test(read('server/authRoutes.ts')));
ok('Payment upload rate limit runs before multipart buffering', /requireAuth,\s*paymentSubmissionRateLimit,\s*upload\.single/.test(read('server/paymentRoutes.ts')));
ok('No AI Studio workspace identifier remains in README', !/ai\.studio\/apps\/[0-9a-f-]{20,}/i.test(read('README.md')));

const failed = checks.filter((c) => !c.condition);
for (const c of checks) console.log(`${c.condition ? 'PASS' : 'FAIL'} — ${c.name}`);
if (failed.length) process.exit(1);
console.log(`\nFinal security audit gate passed: ${checks.length}/${checks.length}`);
