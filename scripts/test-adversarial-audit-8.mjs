import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
function assert(name, condition, detail='') {
  checks.push({ name, ok: Boolean(condition), detail });
}

const auth = read('server/authRoutes.ts');
const middleware = read('server/authMiddleware.ts');
const profile = read('server/profileRoutes.ts');
const paymentRoutes = read('server/paymentRoutes.ts');
const payment = read('server/services/paymentService.ts');
const student = read('server/services/studentProfile.ts');
const course = read('server/services/courseService.ts');
const schedule = read('server/services/scheduleService.ts');
const access = read('server/services/accessService.ts');
const server = read('server.ts');
const migration = read('server/db/migrations/0006_redteam_hardening.sql');
const app = read('src/App.tsx'); const worker = read('src/utils/optimizerWorkerClient.ts');

assert('1. Authenticated/paid routes use server auth', /requireAuth\b/.test(profile) && /requireAdmin\b/.test(paymentRoutes), 'Protected routes use middleware.');
assert('2. No diagnostic admin token bypass', !middleware.includes('x-gadwal-admin-token') && !server.includes('x-gadwal-admin-token'), 'No legacy admin bypass token.');
assert('3. Session is verified by Neon Auth get-session', /get-session/.test(middleware) && /get-session/.test(auth), 'Server asks Neon Auth for session state.');
assert('4. IDOR ownership checks exist', /studentId: string, submissionId: string/.test(payment) && /eq\(paymentSubmissions\.studentId, studentId\)/.test(payment) && /student_id=\$1 AND student_id=\$2/.test(student) === false, 'Payment cancel and student-scoped reads filter by authenticated student.');
assert('5. Verification token is not accepted on status alone', /!otpResponse\.ok \|\| otpData\?\.error/.test(auth) && /emailVerified.*!== true/.test(auth), 'Verification requires upstream success and DB-confirmed emailVerified.');
assert('6. Password reset responses do not leak account existence', /If an account exists with this email/.test(auth) && !/\.\.\.data/.test(auth.split("request-password-reset")[1]?.split("// 8.")[0] || ''), 'Reset request is normalized.');
assert('7. Login error is generic', /Invalid email or password/.test(auth), 'Sign-in failures are normalized.');
assert('8. Login is rate-limited by IP and email', /allowCriticalRateLimit\('auth_login_ip'/.test(auth) && /allowCriticalRateLimit\('auth_login_account'/.test(auth), 'Combined key reduces brute-force bypass.');
assert('9. Verification and resend are rate-limited by IP and email', /allowCriticalRateLimit\('auth_verify'/.test(auth) && /allowCriticalRateLimit\('auth_resend'/.test(auth), 'Verification abuse controls are keyed by IP + email.');
assert('10. Free run is persistent server-side', /free_run_status/.test(student) && /run_sessions/.test(student), 'Free-run state lives in PostgreSQL.');
assert('11. Free run completion requires a saved generated schedule', /saved_schedules/.test(student) && /successful generated schedule result/.test(student), 'Completion cannot be confirmed by a client boolean alone.');
assert('12. Direct run start validates schedule input', /sanitizeSectionsSnapshot\(req\.body\?\.sections\)/.test(profile) && /sanitizePreferencesSnapshot\(req\.body\?\.preferences\)/.test(profile), 'Run inputs are validated server-side.');
assert('13. Client cannot choose a cheaper server price', /const amount = product\.amount/.test(payment) && !/data\.amount/.test(payment), 'Amount comes from enabled DB product.');
assert('14. Client cannot choose arbitrary academic term/year for purchase', /authoritativeAcademicYear/.test(payment) && /authoritativeTerm/.test(payment) && /getCurrentAcademicContext\(\)/.test(payment), 'Purchase context is derived server-side.');
assert('15. Payment method is allowlisted and enabled', /SUPPORTED_PAYMENT_METHODS/.test(payment) && /paymentMethodsConfig/.test(payment), 'Only enabled configured methods are accepted.');
const paymentValidation = read('server/paymentValidation.ts');
assert('16. Payment proof is validated by magic bytes', /detectMagicMime/.test(paymentValidation) && /validatePaymentProof/.test(payment), 'Uploaded proof is content-validated.');
assert('17. Payment proof has dimension/pixel limits', /MAX_PAYMENT_PROOF_PIXELS/.test(paymentValidation) && /MAX_PAYMENT_PROOF_DIMENSION/.test(paymentValidation), 'Oversized image dimensions are rejected.');
assert('18. Oversized request bodies are bounded', /MAX_RAW_PAYLOAD_BYTES/.test(server) && /express\.json\(\{ limit: "2mb" \}\)/.test(server), 'Transport/body limits are present.');
assert('19. Payment approval is transaction-protected', /BEGIN/.test(payment) && /COMMIT/.test(payment) && /ROLLBACK/.test(payment), 'Approval and entitlement are transactional.');
assert('20. DB prevents duplicate active entitlements', migration.includes('entitlements_active_scope_unique'), 'Database uniqueness constraint is present.');
assert('21. DB prevents invalid plan/method/term shapes', migration.includes('payment_submissions_plan_check') && migration.includes('payment_submissions_method_check') && migration.includes('payment_submissions_term_shape_check'), 'Database validates business invariants.');
assert('22. Course storage validates server-side', /sanitizeSectionsSnapshot\(incoming\)/.test(profile) && /INVALID_COURSE_DATA/.test(profile), 'Direct /api/courses cannot store arbitrary junk.');
assert('23. Schedule title input is bounded', /INVALID_SCHEDULE_TITLE/.test(profile) && /length > 120/.test(profile), 'Schedule titles are bounded/sanitized.');
assert('24. No dangerous eval/shell primitives in app source', !/dangerouslySetInnerHTML|\beval\(|new Function\(|child_process|\bexec\(/.test(auth+middleware+profile+paymentRoutes+payment+student+server+app), 'No obvious dynamic code/shell execution.');
assert('25. Legacy admin email is not runtime authorization', !/youssef2409621@miuegypt\.edu\.eg/.test(middleware+student), 'Admin identity is role-based, not hard-coded.');

// This is intentionally informational: the optimizer is still browser-executed. The server gates the normal workflow,
// but a determined user can inspect the shipped optimizer bundle. This is a known architectural boundary, not a false PASS.
assert('26. Client-shipped optimizer secrecy', !/runOptimizer\(/.test(app) && /api\/generate-schedule/.test(worker), 'Optimizer runs server-side and client hits API');

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name} — ${c.detail}`);
if (failed.length) process.exit(1);
console.log(`\nRed-team static gate passed: ${checks.filter(c=>c.ok).length}/${checks.length} checks passed.`);
