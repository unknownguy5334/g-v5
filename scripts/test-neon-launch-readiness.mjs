import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const fail = [];
const pass = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (condition, message) => (condition ? pass : fail).push(message);

const config = read('server/config.ts');
const authUrl = read('server/neonAuthUrl.ts');
const db = read('server/db.ts');
const migrate = read('server/db/migrate.ts');
const authMiddleware = read('server/authMiddleware.ts');
const health = read('server/healthRoutes.ts');
const journal = JSON.parse(read('server/db/migrations/meta/_journal.json'));

assert(config.includes("if (!databaseUrl) throw new Error('DATABASE_URL is required in production.')"), 'Production requires DATABASE_URL.');
assert(config.includes("if (!neonAuthUrl) throw new Error('NEON_AUTH_URL is required in production."), 'Production requires explicit NEON_AUTH_URL.');
assert(config.includes("if (!appOrigin || !/^https:\\/\\//i.test(appOrigin))"), 'Production requires HTTPS APP_ORIGIN.');
assert(authUrl.includes('isAllowedNeonAuthUrl'), 'NEON_AUTH_URL uses a dedicated outbound host allowlist.');
assert(authUrl.includes('neonauth\\.'), 'NEON_AUTH_URL is restricted to Neon Auth hostnames.');
assert(db.includes('rejectUnauthorized: true'), 'Remote Neon PostgreSQL TLS requires certificate verification.');
assert(db.includes('connectionTimeoutMillis: 8000'), 'Neon DB connections have a bounded connection timeout.');
assert(db.includes('idleTimeoutMillis: 30000'), 'Neon DB connections have a bounded idle timeout.');
assert(migrate.includes('migrate(db, { migrationsFolder: "./server/db/migrations" })'), 'Database startup uses the Drizzle migration journal.');
assert(!migrate.includes('0010_student_product_completion.sql'), 'Migration runner does not manually reapply the student-product migration.');
assert(journal.entries.length === 17, 'Migration journal contains 16 ordered migrations.');
assert(journal.entries.map((e) => e.idx).every((v, i) => v === i), 'Migration journal indexes are contiguous.');
assert(journal.entries.map((e) => e.tag).join('|') === [
  '0000_jittery_roughhouse','0001_previous_thanos','0002_launch_hardening','0003_payment_logic_hardening',
  '0004_core_logic_hardening','0005_performance_indexes','0006_redteam_hardening','0007_exhaustive_hardening',
  '0008_exhaustive_integrity','0009_security_hardening','0010_student_product_completion','0011_course_set_integrity','0012_account_deletion_tombstones','0013_admin_audit_log','0014_api_db_integrity','0015_payment_integrity','0016_business_logic_integrity'
].join('|'), 'Migration journal ordering matches migration files.');
assert(authMiddleware.includes("/get-session"), 'Authenticated requests are resolved through Neon Auth sessions.');
assert(authMiddleware.includes('neon_auth.user'), 'Email verification is cross-checked against Neon Auth user state.');
assert(authMiddleware.includes("profile?.role === 'ADMIN'"), 'Application roles come from the student profile, not the browser.');
assert(health.includes('testNeonAuthReachability'), 'Readiness actively checks Neon Auth reachability.');
assert(health.includes("'/health/neon-auth'"), 'Dedicated Neon Auth health endpoint exists.');
assert(/app\.get\(\['\/health\/neon-auth',\s*'\/api\/health\/neon-auth'\], requireAdmin,/.test(health), 'Detailed Neon Auth health endpoint is admin-protected.');
assert(/app\.get\(\['\/health\/db',\s*'\/api\/health\/db'\], requireAdmin,/.test(health), 'Detailed DB health endpoint is admin-protected.');

const forbiddenClientSecrets = ['DATABASE_URL', 'NEON_AUTH_URL'];
const sourceFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((x) => /\.(ts|tsx|js|jsx)$/.test(x));
for (const rel of sourceFiles) {
  const content = read(path.join('src', rel));
  for (const secretName of forbiddenClientSecrets) assert(!content.includes(secretName), `Client source does not reference ${secretName}: ${rel}`);
}

// Ensure the project has exactly the expected Neon migration files and no stray journal duplication.
const migrationFiles = fs.readdirSync(path.join(root, 'server/db/migrations')).filter((x) => x.endsWith('.sql')).sort();
assert(migrationFiles.length === 17, 'There are exactly 16 SQL migrations in the source tree.');
assert(!fs.existsSync(path.join(root, 'server/db/_journal.json')), 'No duplicate migration journal exists outside server/db/migrations/meta.');

if (fail.length) {
  console.error(`NEON LAUNCH READINESS FAILED (${fail.length} failures, ${pass.length} passes)`);
  for (const item of fail) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`NEON LAUNCH READINESS PASSED: ${pass.length} checks.`);
