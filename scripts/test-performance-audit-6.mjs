import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: Boolean(condition), detail }); }

const main = read('src/main.tsx');
const app = read('src/App.tsx');
const db = read('server/db.ts');
const schema = read('server/db/schema.ts');
const migration = read('server/db/migrations/0005_performance_indexes.sql');
const payment = read('server/services/paymentService.ts');
const academic = read('server/services/academicContext.ts');

check('Admin route is lazy-loaded', /lazy\(\(\) => import\('\.\/AdminApp\.tsx'\)/.test(main), 'AdminApp is split from the initial entry chunk.');
check('Results/modal code splitting remains present', /const StepResults = lazy\(/.test(app), 'Heavy result/information components remain lazy-loaded.');
check('PDF export lazy-loads jsPDF', /await import\('jspdf'\)/.test(read('src/utils/export.ts')), 'jsPDF loads only when PDF export is requested.');
check('Bounded DB pool', /DATABASE_POOL_MAX/.test(db) && /max: parsePoolMax/.test(db), 'DB pool is capped per instance.');
check('Performance indexes migration exists', /payment_submissions_status_created_idx/.test(migration) && /saved_schedules_student_created_idx/.test(migration), 'Query-path indexes are present.');
check('Schema models indexes', /saved_schedules_student_created_idx/.test(schema) && /payment_submissions_status_created_idx/.test(schema), 'Drizzle schema documents the performance indexes.');
check('Academic config cache bounded', /CACHE_TTL_MS = 5_000/.test(academic), 'Short TTL cache is bounded and invalidatable.');
check('Product/payment config cache bounded', /CONFIG_CACHE_TTL_MS = 10_000/.test(payment) && /invalidatePaymentConfigCache/.test(payment), 'Low-churn config is cached briefly and invalidated on writes.');
check('Admin history bounded', /\.limit\(500\)/.test(payment) && /\.limit\(100\)/.test(payment), 'Admin history and pending queues are response-capped.');

const failures = checks.filter((c) => !c.ok);
console.log(`Performance Audit 6 static checks: ${checks.length - failures.length}/${checks.length} passed`);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name} — ${c.detail}`);
if (failures.length) process.exit(1);
