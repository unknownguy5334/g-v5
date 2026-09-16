import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const ok = (name, condition) => checks.push({ name, condition: Boolean(condition) });

const account = read('server/accountRoutes.ts');
const profile = read('server/profileRoutes.ts');
const payment = read('server/paymentRoutes.ts');
const errors = read('server/errors.ts');
const auth = read('server/authRoutes.ts');
const main = read('server.ts');
const client = read('src/services/authClient.ts');

ok('Public error helper only allows explicit known messages', /knownPublicErrorMessage\(error: unknown, fallback: string, allowedMessages: readonly string\[\]\)/.test(errors) && /allowedMessages\.includes\(message\)/.test(errors));
ok('Course-set duplication does not relay arbitrary exception text', !/json\(\{error:e\.message/.test(account) && /Could not duplicate the course set\./.test(account));
ok('Schedule favorite/delete use fixed not-found message', /error:'Schedule not found\.'/.test(account));
ok('Schedule rename only exposes allowlisted validation text', /knownPublicErrorMessage\(e,'Could not rename the schedule\./.test(account));
ok('Course restore only exposes allowlisted service messages', /knownPublicErrorMessage\(e, 'Could not restore the previous course version\./.test(profile));
ok('Run start does not expose arbitrary exception text', /knownPublicErrorMessage\(e, 'Could not start the schedule run\./.test(profile));
ok('Run completion does not expose arbitrary exception text', /knownPublicErrorMessage\(e, 'Could not complete the schedule run\./.test(profile));
ok('Payment service errors are allowlisted before client exposure', /class PaymentServiceError/.test(read('server/services/paymentService.ts')) && /PAYMENT_PUBLIC_MESSAGES/.test(payment) && /PAYMENT_ERROR/.test(payment) && /message = PAYMENT_PUBLIC_MESSAGES\.has\(error\.message\)/.test(payment));
ok('Auth upstream bodies are normalized before returning', /SIGNUP_FAILED/.test(auth) && /INVALID_CREDENTIALS/.test(auth) && !/res\.status\(response\.status\)\.json\(parsed\)/.test(auth));
ok('Global error middleware omits stack/message from responses', /Server catch-all error/.test(main) && /An unexpected internal error occurred/.test(main) && !/res\.status\(500\).*safeError\.message/.test(main));
ok('OCR error path separates internal diagnostics from client payload', /structuredServerLog\('error', 'OCR extraction failed'/.test(main) && /We encountered an issue processing your request/.test(main));
ok('Frontend ErrorBoundary does not render exception text', !/state\.error\.message/.test(read('src/components/ErrorBoundary.tsx')));
ok('Auth client falls back to generic network text on transport failure', /Network error/.test(client));
ok('Error serialization redacts common secret-bearing strings', /REDACTED_DATABASE_URL/.test(errors) && /REDACTED/.test(errors));

const routeFiles = [account, profile, payment, auth];
const rawPublicLeakPattern = /\berror:\s*(?:e|err|error)\.message\b/;
ok('No direct exception message is returned by audited routes', routeFiles.every((content) => !rawPublicLeakPattern.test(content)));
ok('No direct exception object is returned by audited routes', !/res\.json\(\{[^\n]*(?:error|exception):\s*(?:e|err|error)\b/.test(account + '\n' + profile + '\n' + payment + '\n' + auth));

for (const c of checks) console.log(`${c.condition ? 'PASS/VERIFIED' : 'FAIL'}: ${c.name}`);
console.log(`Error-message red-team checks: ${checks.filter(c => c.condition).length}/${checks.length} PASS/VERIFIED`);
if (checks.some(c => !c.condition)) process.exit(1);
