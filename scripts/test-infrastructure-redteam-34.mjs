import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const assert = (condition, name) => checks.push({ name, ok: Boolean(condition) });

const ci = read('.github/workflows/ci.yml');
const backup = read('scripts/backup-database.sh');
const release = read('scripts/verify-release-config.mjs');
const config = read('server/config.ts');
const server = read('server.ts');
const ignore = read('.gcloudignore');

assert(ci.includes('actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0'), 'CI checkout action is immutable SHA-pinned');
assert(ci.includes('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'), 'CI setup-node action is immutable SHA-pinned');
assert(ci.includes('persist-credentials: false'), 'CI checkout credentials are not persisted');
assert(ci.includes('node-version-file: .nvmrc'), 'CI Node version is synchronized with repository runtime policy');
assert(ci.includes('test -f package-lock.json') && ci.includes('npm ci --ignore-scripts'), 'CI blocks non-reproducible dependency installation');
assert(ignore.includes('.env') && ignore.includes('backups/') && ignore.includes('*.dump'), 'Cloud source upload excludes secrets and database dumps');
assert(ignore.includes('*_RED_TEAM_FINAL_REPORT.md') && ignore.includes('scripts/test-*.mjs'), 'Cloud source upload excludes audit/test artifacts');
assert(backup.includes('umask 077') && backup.includes('chmod 700') && backup.includes('chmod 600'), 'Database backups use restrictive permissions');
assert(backup.includes('mktemp') && backup.includes('mv -- "$TMP" "$OUT"'), 'Database backups are written atomically through a private temporary file');
assert(release.includes("const lockNames = ['package-lock.json'];"), 'Release verification requires npm package-lock.json');
assert(config.includes("deploymentEnv === 'production'") && config.includes('APP_ORIGIN must be an HTTPS URL in production'), 'Production deployment requires explicit hardened environment configuration');
assert(server.includes("app.set('trust proxy', false)") && server.includes("app.disable(\"x-powered-by\")"), 'Runtime defaults do not trust arbitrary proxies and disable Express fingerprinting');
assert(server.includes("server.requestTimeout = OCR_END_TO_END_BUDGET_MS"), 'Server request timeout is bounded');

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS/VERIFIED' : 'FAIL'} — ${c.name}`);
console.log(`Infrastructure red-team gate: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
