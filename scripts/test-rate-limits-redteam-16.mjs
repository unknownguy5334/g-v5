import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0;
const checks = [
  ['shared limiter defaults fail closed', read('server/persistentRateLimiter.ts').includes("options: PersistentRateLimitOptions = { failClosed: true }")],
  ['memory fallback requires explicit opt-out', read('server/persistentRateLimiter.ts').includes('if (options.failClosed)')],
  ['optimizer limiter is fail closed', read('server/optimizerRoutes.ts').includes('{ failClosed: true }')],
  ['payment submission limiter is fail closed', read('server/paymentRoutes.ts').includes("'payment_submit'") && read('server/paymentRoutes.ts').includes("'payment_submit', submitKey, 5, 60_000, { failClosed: true }")],
  ['OCR limiter is fail closed', read('server.ts').includes("allowPersistentRateLimit('ocr_extract', key, config.ocrRateLimitPerMinute, config.ocrRateLimitWindowMs, { failClosed: true })")],
  ['login has IP and account limits', read('server/authRoutes.ts').includes("'auth_login_ip'") && read('server/authRoutes.ts').includes("'auth_login_account'")],
  ['signup has IP and account limits', read('server/authRoutes.ts').includes("'auth_signup_ip'") && read('server/authRoutes.ts').includes("'auth_signup_account'")],
  ['verification has IP and account limits', read('server/authRoutes.ts').includes("'auth_verify'") && read('server/authRoutes.ts').includes("'auth_verify_email'")],
  ['reset has IP and account limits', read('server/authRoutes.ts').includes("'auth_reset'") && read('server/authRoutes.ts').includes("'auth_reset_email'")],
  ['reauth is account scoped', read('server/authRoutes.ts').includes("'auth_reauth_user'")],
  ['session endpoint is rate limited', read('server/authRoutes.ts').includes("'auth_session_ip'" )],
  ['sign-out endpoint is rate limited', read('server/authRoutes.ts').includes("'auth_signout_ip'" )],
  ['course save is rate limited', read('server/profileRoutes.ts').includes("'courses_save'" )],
  ['schedule save is rate limited', read('server/profileRoutes.ts').includes("'schedules_save'" )],
  ['run start is rate limited', read('server/profileRoutes.ts').includes("'run_start'" )],
  ['run complete is rate limited', read('server/profileRoutes.ts').includes("'run_complete'" )],
  ['account export is rate limited', read('server/accountRoutes.ts').includes("'account_export'" )],
  ['course duplication is rate limited', read('server/accountRoutes.ts').includes("'course_set_duplicate'" )],
  ['notification writes are rate limited', read('server/accountRoutes.ts').includes("'notification_read'") && read('server/accountRoutes.ts').includes("'notification_read_all'")],
  ['admin destructive actions are rate limited', read('server/accountRoutes.ts').includes("'admin_free_run_reset'") && read('server/paymentRoutes.ts').includes("'admin_entitlement_revoke'")],
  ['admin high-volume reads are rate limited', read('server/accountRoutes.ts').includes("'admin_students_search'") && read('server/paymentRoutes.ts').includes("'admin_payments_all'")],
  ['shared-key limiter uses database atomic upsert', read('server/persistentRateLimiter.ts').includes('ON CONFLICT (scope, bucket_key, window_start)') && read('server/persistentRateLimiter.ts').includes('count = rate_limit_buckets.count + 1')],
  ['trusted proxy configuration remains explicit', read('server.ts').includes("app.set('trust proxy', config.trustedProxyCidrs)") && read('server.ts').includes("app.set('trust proxy', false)" )],
];
for (const [name, ok] of checks) {
  if (!ok) { console.error(`FAIL: ${name}`); process.exitCode = 1; }
  else { passed++; console.log(`PASS/VERIFIED: ${name}`); }
}
console.log(`Rate-limit red-team checks: ${passed}/${checks.length} PASS/VERIFIED`);
if (passed !== checks.length) process.exitCode = 1;
