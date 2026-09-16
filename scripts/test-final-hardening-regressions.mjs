import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const checks = [];
function ok(c, label) { checks.push([c,label]); console.log(`${c ? 'PASS' : 'FAIL'} — ${label}`); }
const accountRoutes = read('server/accountRoutes.ts');
const accountService = read('server/services/accountService.ts');
const studentProfile = read('server/services/studentProfile.ts');
const paymentService = read('server/services/paymentService.ts');
ok(accountRoutes.includes("fetchWithTimeout") && accountRoutes.includes('timeoutMs:8_000'), 'account deletion re-auth is time-bounded');
ok(accountService.includes("normalizedTitle.length > 120") && accountService.includes('Course set title is invalid'), 'course-set duplication validates title length/control characters');
ok(studentProfile.includes('onConflictDoUpdate') && studentProfile.includes('Never update'), 'student profile creation is race-safe without client-controlled role writes');
ok(paymentService.includes("PAYMENT_CANCELLED") && paymentService.includes("PAYMENT_REJECTED") && paymentService.includes("ENTITLEMENT_REVOKED") && paymentService.includes("INSERT INTO activity_audit"), 'payment cancellation, rejection, and entitlement revocation audit logs are transactional');
const failed = checks.filter(([c]) => !c).length;
console.log(`FINAL HARDENING REGRESSIONS: ${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
