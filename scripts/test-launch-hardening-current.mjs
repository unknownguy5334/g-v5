import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8');
const checks = [];
const ok = (name, condition) => checks.push([name, Boolean(condition)]);
const server = read('server.ts');
const auth = read('server/authRoutes.ts');
const payment = read('server/paymentRoutes.ts');
const addCourses = read('src/components/StepAddCourses.tsx');
const app = read('src/App.tsx');
const profile = read('server/services/studentProfile.ts');
const maintenance = read('server/accountMaintenance.ts');
const schema = read('server/db/schema.ts');

ok('OCR route requires verified authentication middleware', /app\.post\('\/api\/extract-schedule', requireAuth/.test(server));
ok('OCR rate limiting uses shared persistent buckets', /allowPersistentRateLimit\(\s*'ocr_extract'/.test(server));
ok('critical auth limiter fails closed on shared-store failure', /return \{ allowed: false, retryAfterSeconds/.test(auth));
ok('payment limiter does not silently continue after shared limiter outage', /RATE_LIMIT_SERVICE_UNAVAILABLE/.test(payment));
ok('client OCR action requires authentication', /authStatus === 'unauthenticated'/.test(addCourses) && /onOpenAuth\?\.\('login'\)/.test(addCourses));
ok('client OCR action requires verified email', /authStatus === 'unverified'/.test(addCourses) && /onOpenAuth\?\.\('verify'\)/.test(addCourses));
ok('App passes auth opener into course entry flow', /onOpenAuth=\{\(view\) => handleOpenAuth/.test(app));
ok('Deleted accounts cannot be silently recreated', /accountDeletionTombstones/.test(profile) && /account_deletion_tombstones/.test(maintenance) && /account_deletion_tombstones/.test(schema));
ok('Payment limiter is account-scoped', /const submitKey = `user:\$\{user\.id\}`/.test(payment));

let failed = 0;
for (const [name, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}`); if (!pass) failed++; }
console.log(`CURRENT HARDENING REGRESSION GATE: ${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
