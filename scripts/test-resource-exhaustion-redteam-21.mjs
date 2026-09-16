import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let passed = 0;
let failed = 0;
function ok(name, condition) {
  if (condition) { passed++; console.log(`PASS/VERIFIED ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
const server = read('server.ts');
const acctRoutes = read('server/accountRoutes.ts');
const acctService = read('server/services/accountService.ts');
const acctMaint = read('server/accountMaintenance.ts');
const payment = read('server/services/paymentService.ts');
const optimizer = read('server/optimizerRoutes.ts');
const ocr = read('server/ocrExtractionService.ts');
const limiter = read('server/persistentRateLimiter.ts');
const pkg = JSON.parse(read('package.json'));

ok('global standard JSON parser is capped at 2 MB', /express\.json\(\{ limit: "2mb" \}\)/.test(server));
ok('OCR parser has an explicit bounded payload limit', /const JSON_BODY_PARSER_LIMIT = `\$\{jsonBodyLimitMb\}mb`/.test(server));
ok('OCR body parsing concurrency is bounded', /MAX_CONCURRENT_OCR_BODY_PARSES = 4/.test(server));
ok('OCR downstream work has global concurrency control', /new Semaphore\(MAX_GLOBAL_CONCURRENT_WORK\)/.test(server));
ok('OCR image count is bounded', /maxImagesPerRequest: 30/.test(read('server/config.ts')));
ok('OCR raw/decoded byte budgets exist', /maxTotalImagesBytes: 80 \* 1024 \* 1024/.test(read('server/config.ts')) && /maxRawPayloadBytes: 80 \* 1024 \* 1024/.test(read('server/config.ts')));
ok('OCR per-image size budget exists', /maxSingleImageBytes: 15 \* 1024 \* 1024/.test(read('server/config.ts')));
ok('OCR provider calls have timeout and bounded retry path', /timeoutMs: 35_000/.test(read('server/ocrModelFallback.ts')) && /const attempts = Math\.max\(1, Math\.floor/.test(read('src/utils/ocrApiContract.ts')));
ok('optimizer input section cap exists', /MAX_SECTIONS_INPUT = 500/.test(read('server/optimizer/optimizer.ts')));
ok('optimizer search budgets are finite', /maxCourseSubsetNodes: 100_000/.test(read('server/optimizer/optimizer.ts')) && /maxSectionNodes: 500_000/.test(read('server/optimizer/optimizer.ts')));
ok('schedule generation route caps request body', /express\.json\(\{ limit: '2mb' \}\)/.test(optimizer));
ok('schedule generation uses persistent throttling', /allowPersistentRateLimit\(/.test(optimizer));
ok('account overview has a per-user throttle', /account_overview', 30, 60_000/.test(acctRoutes));
ok('account course-set reads have a per-user throttle', /account_course_sets', 30, 60_000/.test(acctRoutes));
ok('account notifications reads have a per-user throttle', /account_notifications', 60, 60_000/.test(acctRoutes));
ok('account exports have a per-user throttle', /account_export', 5, 60_000/.test(acctRoutes));
ok('payment submission reads are bounded', /orderBy\(desc\(paymentSubmissions\.createdAt\)\)\.limit\(100\)/.test(payment));
ok('account maintenance due-row scan is bounded', /ORDER BY deletion_scheduled_for ASC LIMIT 100/.test(acctMaint));
ok('account maintenance deletion only processes selected batch IDs', /DELETE FROM students WHERE id = ANY\(\$1::text\[\]\)/.test(acctMaint));
ok('admin directory enrichment concurrency is bounded', /Math\.min\(8, filtered\.length\)/.test(acctService));
ok('admin directory initial student list is bounded', /students\)\.orderBy\(desc\(students\.createdAt\)\)\.limit\(500\)/.test(acctService));
ok('admin detail collections are bounded', /getStudentSubmissions\(studentId\).*getStudentEntitlements\(studentId\).*getStudentSchedules\(studentId\).*listStudentCourseSets\(studentId\).*limit\(100\)/s.test(acctService));
ok('DB pool maximum is bounded', /value >= 2 && value <= 10/.test(read('server/db.ts')));
ok('shared persistent limiter is wired with fail-closed support', /failClosed/.test(limiter));
ok('all prior security gates remain in npm test', ['test-rate-limits-redteam-16.mjs','test-cors-csrf-redteam.mjs','test-file-upload-redteam.mjs','test-injection-redteam-15.mjs','test-admin-surfaces-redteam.mjs','test-idor-bola-redteam-12.mjs','test-input-validation-redteam-13.mjs'].every(x => pkg.scripts.test.includes(x)));
ok('resource-exhaustion gate is included in npm test', pkg.scripts.test.includes('test-resource-exhaustion-redteam-21.mjs'));
if (failed) process.exit(1);
console.log(`PASS/VERIFIED Resource exhaustion red-team gate: ${passed}/${passed + failed}`);
