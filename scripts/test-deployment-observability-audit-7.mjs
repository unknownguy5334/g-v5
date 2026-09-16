import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const checks = [];
const config = read('server/config.ts');
const server = read('server.ts');
const health = read('server/healthRoutes.ts');
const obs = read('server/observability.ts');
const setup = read('LAUNCH_SETUP.md');
const ops = read('OPERATIONS.md');
const env = read('.env.example');
const release = read('scripts/verify-release-config.mjs');
const pkg = JSON.parse(read('package.json'));

const assert = (condition, name) => { checks.push({ name, ok: Boolean(condition) }); if (!condition) console.error(`FAIL: ${name}`); };

assert(config.includes("DATABASE_URL is required in production"), 'production DATABASE_URL required');
assert(config.includes('GEMINI_API_KEY') && config.includes('required in production'), 'production Gemini credential required');
assert(config.includes('APP_ORIGIN must be an HTTPS URL in production'), 'production HTTPS origin enforced');
assert(config.includes('GADWAL_ENV'), 'development/staging/production configuration separation is represented');
assert(server.includes("process.on('uncaughtException'"), 'uncaught exception handler exits for supervisor restart');
assert(server.includes('Production startup blocked: Neon database is not ready'), 'production fails closed when DB is unavailable at startup');
assert(server.includes("requestId") && server.includes("X-Request-ID"), 'request IDs are attached');
assert(server.includes('path: req.path') && server.includes('userId'), 'catch-all errors include request context without client stack traces');
assert(obs.includes('serviceContext') && obs.includes('google.devtools.clouderrorreporting'), 'structured Cloud Error Reporting context is emitted');
assert(health.includes("/api/health/ready") && health.includes('testDbConnection') && health.includes('testGeminiReachability'), 'readiness checks critical dependencies');
assert(health.includes('expiresAt: Date.now() + 10_000'), 'readiness checks are cached to avoid probe amplification');
assert(setup.includes('npm run verify:predeploy'), 'launch setup documents deployment verification gate');
assert(setup.includes('rollback'), 'launch setup documents rollback');
assert(setup.includes('restore drill'), 'launch setup documents backup restore testing');
assert(ops.includes('Cloud Monitoring') && ops.includes('uptime check'), 'operations runbook documents uptime monitoring');
assert(ops.includes('errorId') && ops.includes('requestId'), 'operations runbook documents incident correlation');
assert(ops.includes('db:backup') && ops.includes('pg_dump'), 'operations runbook documents independent DB backups');
assert(env.includes('GADWAL_ENV') && env.includes('GADWAL_RELEASE'), 'production env example is documented');
assert(release.includes("const lockNames = ['package-lock.json'];") && release.includes('OPERATIONS.md') && release.includes('verify:predeploy'), 'release validator checks operational readiness assets');
assert(Boolean(pkg.scripts['verify:predeploy']) && Boolean(pkg.scripts['db:backup']) && Boolean(pkg.scripts['test:ops-readiness']), 'package scripts include deployment readiness tooling');

const failed = checks.filter((c) => !c.ok);
console.log(`Deployment/observability static checks: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
