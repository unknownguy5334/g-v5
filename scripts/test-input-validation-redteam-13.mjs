import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const checks = [];
const ok = (name, condition) => checks.push([name, Boolean(condition)]);

const server = read('server.ts');
const input = read('server/inputValidation.ts');
const persistence = read('src/utils/persistenceValidation.ts');
const payment = read('server/paymentRoutes.ts');
const account = read('server/accountRoutes.ts');
const profile = read('server/profileRoutes.ts');
const optimizer = read('server/optimizerRoutes.ts');
const ocr = read('src/utils/ocrApiContract.ts');
const packageJson = JSON.parse(read('package.json'));

ok('Global JSON bodies are bounded', /express\.json\(\{ limit: "2mb" \}\)/.test(server));
ok('OCR JSON bodies have transport and concurrency bounds', /MAX_CONCURRENT_OCR_BODY_PARSES/.test(server) && /MAX_RAW_PAYLOAD_BYTES/.test(server));
ok('Payment multipart files are single-file bounded', /files:\s*1/.test(payment) && /fileSize:\s*10 \* 1024 \* 1024/.test(payment));
ok('Payment multipart fields, parts, and headers are bounded', /fields:\s*8/.test(payment) && /parts:\s*10/.test(payment) && /fieldSize:\s*16 \* 1024/.test(payment) && /headerPairs:\s*200/.test(payment));
ok('UUID references are syntactically validated before DB use', /export function isUuid/.test(input) && (account.match(/isUuid\(req\.params\.id\)/g) || []).length >= 5 && (payment.match(/isUuid\(req\.params\.id\)/g) || []).length >= 5 && (profile.match(/isUuid\(/g) || []).length >= 3);
ok('Snapshot section count is capped before traversal', /MAX_SECTIONS_PER_SNAPSHOT/.test(persistence) && /if \(!Array\.isArray\(value\) \|\| value\.length > MAX_SECTIONS_PER_SNAPSHOT\) return null/.test(persistence));
ok('Per-section session count is capped before traversal', /MAX_SESSIONS_PER_SECTION/.test(persistence) && /if \(item\.sessions\.length > MAX_SESSIONS_PER_SECTION\) return \[\];/.test(persistence));
ok('Mandatory-course arrays are bounded', /MAX_MANDATORY_COURSES/.test(persistence) && /MAX_MANDATORY_COURSE_KEYS/.test(persistence));
ok('OCR client builder rejects unsupported MIME types at runtime', /validMimeTypes/.test(ocr) && /!validMimeTypes\.has\(image\.mimeType\)/.test(ocr));
ok('OCR client builder rejects oversized image strings', /image\.data\.length > 20_000_000/.test(ocr));
ok('OCR client builder rejects blank/control-containing generation IDs', /workflowGenerationId\.trim\(\)\.length === 0/.test(ocr) && /\\u0000-\\u001F/.test(ocr));
ok('Optimizer mode is explicitly enum-bound', /normalizedMode !== 'full' && normalizedMode !== 'estimate' && normalizedMode !== 'diagnostic'/.test(optimizer));
ok('Payment plan is enum-bound', /\['CURRENT_TERM', 'ACADEMIC_YEAR'\]\.includes\(plan\)/.test(payment));
ok('Admin term override is enum-bound', /\['AUTO', 'FALL', 'SPRING', 'SUMMER'\]\.includes\(mode\)/.test(profile));
ok('Security test chain includes input audit gate', /test-input-validation-redteam-13\.mjs/.test(packageJson.scripts.test) || /test-input-validation-redteam-13\.mjs/.test(packageJson.scripts['verify:predeploy'] ?? ''));

for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}`);
const failed = checks.filter(([, pass]) => !pass);
console.log(`\nINPUT VALIDATION RED-TEAM 13: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
