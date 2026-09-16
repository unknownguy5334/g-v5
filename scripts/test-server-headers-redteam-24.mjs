import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const ok = (name, condition) => checks.push({ name, condition: Boolean(condition) });

const server = read('server.ts');
const headers = read('server/securityHeaders.ts');
const config = read('server/config.ts');
const requestSecurity = read('server/requestSecurity.ts');
const health = read('server/healthRoutes.ts');
const pkg = JSON.parse(read('package.json'));

ok('Express fingerprint header disabled', /app\.disable\("x-powered-by"\)/.test(server));
ok('Server does not echo client request IDs', /const requestId = randomUUID\(\)/.test(server) && !/req\.headers\[.x-request-id./.test(server));
ok('Request ID syntax remains server-generated UUID', /randomUUID\(\)/.test(server) && /res\.setHeader\('X-Request-ID'/.test(server));
ok('ETag disabled to reduce protocol state leakage', /app\.set\("etag", false\)/.test(server));
ok('API ETags explicitly removed', /req\.path\.startsWith\('\/api\/'\)[\s\S]*res\.removeHeader\('ETag'\)/.test(headers));
ok('HSTS enabled in production', /Strict-Transport-Security/.test(headers) && /max-age=31536000; includeSubDomains/.test(headers));
ok('Hardened deployments do not enable unsafe-eval/inline', /isHardenedDeployment = config\.deploymentEnv !== 'development'/.test(headers) && /script-src 'self' \$\{isHardenedDeployment \? ''/.test(headers));
ok('CSP includes object-src none', /object-src 'none'/.test(headers));
ok('CSP includes base-uri self', /base-uri 'self'/.test(headers));
ok('CSP includes form-action self', /form-action 'self'/.test(headers));
ok('Clickjacking protection configured for hardened deployments', /frame-ancestors/.test(headers) && /isHardenedDeployment/.test(headers) && /X-Frame-Options/.test(headers));
ok('Content sniffing disabled', /X-Content-Type-Options.*nosniff/.test(headers));
ok('Strict same-origin resource policy', /Cross-Origin-Resource-Policy.*same-origin/.test(headers));
ok('Staging is treated as hardened', /deploymentEnv !== 'development'/.test(headers));
ok('Strict COOP', /Cross-Origin-Opener-Policy.*same-origin/.test(headers));
ok('Permissions policy denies sensitive browser APIs', /Permissions-Policy.*camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\)/.test(headers));
ok('Legacy DNS prefetch disabled', /X-DNS-Prefetch-Control.*off/.test(headers));
ok('Legacy cross-domain policy disabled', /X-Permitted-Cross-Domain-Policies.*none/.test(headers));
ok('API responses disable caching', /private, no-store, no-cache, must-revalidate/.test(server) && /Vary.*Cookie, Authorization/.test(server));
ok('Health responses disable caching', /Cache-Control.*no-store/.test(headers));
ok('No application CORS grant headers', !/Access-Control-Allow-(Origin|Credentials|Methods|Headers)/i.test(server + headers));
ok('Production origin trust remains explicit', /config\.nodeEnv === 'production'\) return false/.test(requestSecurity));
ok('Health route does not expose operational dependency details', !/latencyMs|serviceContext|releaseVersion|process\.uptime/.test(health.split('export function registerHealthRoutes')[1] || ''));
ok('Header regression test is wired into npm test', pkg.scripts?.test?.includes('test-server-headers-redteam-24.mjs'));

for (const c of checks) console.log(`${c.condition ? 'PASS' : 'FAIL'} — ${c.name}`);
const failed = checks.filter((c) => !c.condition);
console.log(`\nServer headers regression: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
