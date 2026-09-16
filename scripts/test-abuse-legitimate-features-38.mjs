import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
let passed = 0;
let failed = 0;
function ok(name, condition) {
  if (condition) { passed++; console.log(`PASS/VERIFIED ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
}

const account = read('server/accountRoutes.ts');
const auth = read('server/authRoutes.ts');
const profile = read('server/profileRoutes.ts');
const optimizer = read('server/optimizerRoutes.ts');
const server = read('server.ts');
const payment = read('server/paymentRoutes.ts');
const limiter = read('server/persistentRateLimiter.ts');
const observability = read('server/observability.ts');

ok('expensive optimizer has a process-wide rate ceiling', /optimizerProcessRateLimiter = new SlidingWindowRateLimiter\(40, 60_000, 1\)/.test(optimizer) && /processLimit = optimizerProcessRateLimiter\.allow\('all'\)/.test(optimizer));
ok('optimizer process-wide limit is checked after basic request/mode validation', /if \(!courses \|\| !preferences\)[\s\S]*?normalizedMode[\s\S]*?processLimit = optimizerProcessRateLimiter/.test(optimizer));
ok('optimizer has both per-user and per-IP persistent limits', /'optimizer_generate'/.test(optimizer) && /'optimizer_generate_ip'/.test(optimizer));
ok('OCR has both per-user and per-IP persistent limits', /allowOcrRateLimit\(rateKey\)/.test(server) && /'ocr_extract_ip'/.test(server));
ok('expensive authenticated profile read has a per-user limit', /'profile_read', 60, 60_000/.test(profile));
ok('expensive course read has a per-user limit', /'courses_read', 60, 60_000/.test(profile));
ok('expensive schedule read has a per-user limit', /'schedules_read', 60, 60_000/.test(profile));
ok('access reads have a per-user limit', /'access_read', 120, 60_000/.test(profile));
ok('schedule favorite mutation is throttled', /'schedule_favorite', 60, 60_000/.test(account));
ok('schedule rename mutation is throttled', /'schedule_rename', 30, 60_000/.test(account));
ok('schedule delete mutation is throttled', /'schedule_delete', 30, 60_000/.test(account));
ok('account deletion request/cancel are throttled', /'account_delete_request', 5, 5 \* 60_000/.test(account) && /'account_delete_cancel', 5, 5 \* 60_000/.test(account));
ok('sensitive auth mutations are throttled', /'auth_change_email', 5, 15 \* 60_000/.test(auth) && /'auth_revoke_other_sessions', 10, 15 \* 60_000/.test(auth) && /'auth_revoke_all_sessions', 10, 15 \* 60_000/.test(auth));
ok('payment submission remains fail-closed and bounded', /'payment_submit', submitKey, 5, 60_000, \{ failClosed: true \}/.test(payment));
ok('telemetry has a bounded body and IP limiter', /express\.json\(\{ limit: '12kb' \}\)/.test(server) && /new SlidingWindowRateLimiter\(120, 60_000\)/.test(server));
ok('account overview/export collections remain bounded', /limit\(500\)/.test(account) && /account_export', 5, 60_000/.test(account));
ok('payment read/public metadata routes are throttled', /payment_methods_public/.test(payment) && /payment_pricing_public/.test(payment) && /payment_pricing_user/.test(payment) && /payment_submissions_read/.test(payment));
ok('admin payment proof/check reads are throttled', /admin_payment_proof/.test(payment) && /admin_check/.test(payment));
ok('academic context public read is throttled', /academic_context_public/.test(profile));
ok('observability metrics collection is stateless', /function recordServerMetric\(metric: ServerMetric\): void/.test(observability) && !/new Map|Array<ServerMetric>|maxSize/.test(observability));
ok('persistent limiter hashes raw keys before storage', /createHash\('sha256'\)\.update\(String\(rawKey\)\)/.test(limiter));
ok('abuse gate is wired into npm test', pkg.scripts.test.includes('test-abuse-legitimate-features-38.mjs'));

if (failed) process.exit(1);
console.log(`PASS/VERIFIED Abuse-of-legitimate-features red-team gate: ${passed}/${passed + failed}`);
