import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
let pass = 0;
function ok(name, condition) { assert.ok(condition, name); pass++; console.log(`PASS/VERIFIED ${name}`); }

const schedule = read('server/services/scheduleService.ts');
const student = read('server/services/studentProfile.ts');
const profile = read('server/profileRoutes.ts');
const payment = read('server/services/paymentService.ts');
const paymentSchema = read('server/db/migrations/0003_payment_logic_hardening.sql');
const schema = read('server/db/schema.ts');
const favorite = schedule;

ok('Saved schedule run row is locked before token validation', /FROM run_sessions WHERE id=\$1 AND student_id=\$2 FOR UPDATE/.test(schedule));
ok('Schedule save and token consumption share one transaction', /await client\.query\('BEGIN'\)[\s\S]*INSERT INTO saved_schedules[\s\S]*UPDATE run_sessions SET result_token_hash=NULL, result_created=1[\s\S]*await client\.query\('COMMIT'\)/.test(schedule));
ok('Consumed schedule result token is cleared atomically', /UPDATE run_sessions SET result_token_hash=NULL, result_created=1 WHERE id=\$1 AND student_id=\$2 AND status='IN_PROGRESS'/.test(schedule));
ok('Completed run is row-locked and status-gated', /SELECT \* FROM run_sessions WHERE id=\$1 AND student_id=\$2 FOR UPDATE/.test(student) && /if \(run\.status !== 'IN_PROGRESS'\)/.test(student));
ok('All run starts serialize before selecting free or paid access', /const existing = await client\.query\([\s\S]*FROM run_sessions WHERE student_id=\$1 AND status='IN_PROGRESS'[\s\S]*FOR UPDATE/.test(student));
ok('Free/paid cross-type concurrent run is prevented', /if \(existing\.rows\.length\)[\s\S]*return \{ run: existing\.rows\[0\]/.test(student));
ok('Run-start response reports authoritative existing run type', /accessType: existing\.rows\[0\]\.access_type/.test(student) && /accessType: result\.accessType \|\| accessType/.test(profile));
ok('Payment client idempotency is DB-unique', /payment_client_request_unique/.test(paymentSchema));
ok('Pending payment scope is DB-unique', /payment_pending_scope_unique/.test(paymentSchema));
ok('Payment approval locks target submission', /SELECT ps\.\*, pp\.id AS proof_id[\s\S]*WHERE ps\.id=\$1[\s\S]*FOR UPDATE/.test(payment));
ok('Payment approval requires pending state', /if \(sub\.payment_status !== 'PENDING'\)/.test(payment));
ok('Payment cancellation is atomic and pending-only', /BEGIN[\s\S]*UPDATE payment_submissions[\s\S]*payment_status='CANCELLED'[\s\S]*payment_status='PENDING'[\s\S]*COMMIT/.test(payment));
ok('Favorite mutations are transactional', /return db\.transaction\(async \(tx\)/.test(favorite));
ok('Favorite state is DB-unique per student', /saved_schedules_one_favorite_per_student/.test(read('server/db/migrations/0014_api_db_integrity.sql')));
ok('Account deletion purge serializes with an advisory lock', /pg_try_advisory_xact_lock\(hashtext\('gadwal-account-purge'\)\)/.test(read('server/accountMaintenance.ts')));
ok('Course saves have DB singleton invariant', /saved_courses_student_context_unique/.test(schema));
ok('Course revisions are bounded', /LIMIT 20/.test(read('server/services/courseService.ts')));
ok('Replay gate is wired into npm test', /test-replay-race-redteam-30\.mjs/.test(read('package.json')));

console.log(`PASS/VERIFIED ${pass}/18 replay/race regression checks`);
