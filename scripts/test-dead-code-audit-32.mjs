import fs from 'node:fs';

const read = (f) => fs.readFileSync(f, 'utf8');
const checks = [];
const ok = (name, condition) => checks.push([name, Boolean(condition)]);

const server = read('server.ts');
const auth = read('server/authRoutes.ts');
const models = read('server/ocrModels.ts');
const launch = read('scripts/test-launch-hardening-current.mjs');
const uploads = read('scripts/test-file-upload-redteam.mjs');
const pkg = JSON.parse(read('package.json'));
const workflowPersistence = read('src/app/workflowPersistence.ts');

ok('legacy OCR route alias removed from runtime', !server.includes('/api/parse-schedule-images'));
ok('legacy auth session alias removed from runtime', !auth.includes('/api/auth/get-session'));
ok('shutdown Gemini preview model absent from active registry', !models.includes('gemini-3.1-flash-lite-preview'));
ok('canonical OCR route remains', server.includes("app.post('/api/extract-schedule', requireAuth"));
ok('canonical auth session route remains', auth.includes("app.get('/api/auth/session'"));
ok('legacy workflow migration remains explicit and client-side only', workflowPersistence.includes('legacyPendingReviewV1') && !server.includes('legacyPendingReviewV1'));
ok('launch gate no longer requires removed OCR alias', !launch.includes('parse-schedule-images'));
ok('file-upload gate no longer requires removed OCR alias', !uploads.includes('parse-schedule-images'));
ok('no obsolete shutdown-model string in package test commands', !JSON.stringify(pkg.scripts).includes('gemini-3.1-flash-lite-preview'));

let failed = 0;
for (const [name, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}`); if (!pass) failed++; }
console.log(`DEAD/LEGACY CODE AUDIT GATE: ${checks.length - failed}/${checks.length} passed`);
process.exitCode = failed ? 1 : 0;
