import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const health = read('server/healthRoutes.ts');
const headers = read('server/securityHeaders.ts');
const config = read('server/config.ts');
const server = read('server.ts');
const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

check('Public liveness responses do not expose process uptime', !/uptime:|process\.uptime\(\)/.test(health));
check('Public readiness payload contains only generic state', /payload:\s*\{\s*status: ready \? 'ok' : 'degraded',\s*ready,/.test(health));
check('Public readiness does not expose dependency names or configuration values', !/DATABASE_URL|GEMINI_API_KEY|NEON_AUTH_URL|postgres|generativelanguage|neonAuth/.test(health.split('export function registerHealthRoutes')[1] || ''));
check('Public readiness does not expose service/release/version identifiers', !/service:|release|version|hostname|environment|latencyMs/.test(health.split('export function registerHealthRoutes')[1] || ''));
check('Detailed Neon Auth health is admin-protected', /app\.get\(\['\/health\/neon-auth',\s*'\/api\/health\/neon-auth'\], requireAdmin,/.test(health));
check('Detailed DB health is admin-protected', /app\.get\(\['\/health\/db',\s*'\/api\/health\/db'\], requireAdmin,/.test(health));
check('Detailed health responses do not return dependency error text', /json\(\{ status: 'error' \}\)/.test(health) && !/res\.status\([^\n]+\)\.json\(\{[^\n]*testResult\.message/.test(health));
check('Diagnostic model route remains admin-protected', /app\.get\("\/api\/models", requireAdmin/.test(server));
check('Health routes are marked no-store', headers.includes("req.path === '/health'") && headers.includes("req.path === '/health/db'") && headers.includes("req.path === '/api/health/db'"));
check('Readiness probing is cached and coalesced', health.includes('expiresAt: Date.now() + 10_000') && health.includes('readinessInFlight'));
check('Readiness performs bounded upstream probes', (health.match(/timeoutMs: 3000/g) || []).length >= 2 && health.includes('fetchWithTimeout')); 
check('Production configuration still requires explicit dependencies', /DATABASE_URL is required in production/.test(config) && /GEMINI_API_KEY/.test(config) && /NEON_AUTH_URL/.test(config));
check('No health route exposes stack traces or raw exceptions', !/stack|err\.message|error\.message|serializeServerError/.test(health.split('export function registerHealthRoutes')[1] || ''));
check('Health endpoints remain GET-only', !/app\.(post|put|patch|delete)\(['\"\/]health/.test(health));
check('Public health endpoint does not accept client-controlled debug parameters', !/req\.(query|body|params)/.test(health));
check('No public metrics/debug endpoint is registered alongside health routes', !/app\.(get|post)\(['\"]\/api\/(metrics|debug|diagnostics)/.test(server));

const failures = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS/VERIFIED' : 'FAIL'} ${name}`);
console.log(`HEALTH_DEBUG_REDTEAM_23 ${checks.length - failures.length}/${checks.length} PASS/VERIFIED`);
if (failures.length) process.exit(1);
