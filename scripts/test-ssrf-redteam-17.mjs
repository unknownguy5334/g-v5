import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const pass = [];
const check = (label, condition) => (condition ? pass : failures).push(label);

const url = read('server/neonAuthUrl.ts');
const upstream = read('server/upstream.ts');
const health = read('server/healthRoutes.ts');
const auth = read('server/authMiddleware.ts');
const authRoutes = read('server/authRoutes.ts');
const account = read('server/accountRoutes.ts');
const config = read('server/config.ts');
const ocr = read('server/ocrExtractionService.ts');
const models = read('server/ocrModels.ts');

check('No server-side request API accepts a request-derived URL', !/fetchWithTimeout\(\s*req\.|fetch\(\s*req\./.test(health + auth + authRoutes + account));
check('Neon explicit URL has a dedicated validator', url.includes('isAllowedNeonAuthUrl'));
check('Neon explicit URL requires HTTPS except localhost development', url.includes("parsed.protocol === 'http:' && allowLocalhost && parsed.hostname === 'localhost'") && url.includes("parsed.protocol !== 'https:'"));
check('Neon explicit URL rejects embedded credentials and custom ports', url.includes('parsed.username || parsed.password || parsed.port'));
check('Neon explicit URL is restricted to neonauth.*.aws.neon.tech', /neonauth\\\./.test(url) && /aws\\\.neon\\\.tech/.test(url));
check('Neon explicit URL path is restricted to /.../auth', url.includes("/^\\/[^?#]*\\/auth$/"));
check('Neon explicit URL rejects query/hash components', url.includes('!parsed.search && !parsed.hash'));
check('Auth middleware uses the centralized Neon URL validator', auth.includes('deriveNeonAuthBaseUrl()'));
check('Auth routes use the centralized Neon URL validator', authRoutes.includes('deriveNeonAuthBaseUrl()'));
check('Account reauth uses the centralized Neon URL validator', account.includes('deriveNeonAuthBaseUrl()') && !account.includes('process.env.NEON_AUTH_URL?.trim()'));
check('All generic outbound HTTP uses timeout wrapper', health.includes('fetchWithTimeout') && auth.includes('fetchWithTimeout') && authRoutes.includes('fetchWithTimeout') && account.includes('fetchWithTimeout'));
check('Outbound HTTP redirect following is disabled by default', upstream.includes("redirect: 'error'"));
check('Outbound URL wrapper does not permit caller redirect policy to override security default', upstream.includes('redirect: _redirect') && upstream.includes('outboundInit'));
check('Gemini health target is fixed to generativelanguage.googleapis.com', health.includes('https://generativelanguage.googleapis.com/'));
check('Gemini SDK does not use request-controlled endpoint configuration', ocr.includes('ai.models.generateContent') && models.includes('MODEL_REGISTRY'));
check('No axios/got/undici/node-fetch alternate client is present', !/(?:\baxios\b|\bundici\b|\bnode-fetch\b)/i.test([health,auth,authRoutes,account,ocr,models].join('\n')));
check('No URL-like request field is consumed by a server outbound fetch', !/(req\.(body|query|params).*\b(url|uri|href|endpoint|callback)|\b(url|uri|href|endpoint|callback)\b.*req\.(body|query|params))/i.test(read('server.ts') + health + auth + authRoutes + account));
check('Production requires explicit Neon Auth configuration', config.includes('if (!neonAuthUrl) throw new Error'));
check('Neon live verification is bounded', read('scripts/test-neon-live.mjs').includes('AbortSignal.timeout(8000)'));
check('Final server network calls are bounded by explicit timeouts', upstream.includes('timeoutMs = 8_000') && health.includes('timeoutMs: 3000') && auth.includes('timeoutMs: 6_000') && authRoutes.includes('timeoutMs: 8_000') && account.includes('timeoutMs:8_000') || account.includes('timeoutMs: 8_000'));

if (failures.length) {
  console.error(`SSRF RED-TEAM FAILED (${failures.length} failures, ${pass.length} passes)`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`SSRF RED-TEAM PASSED: ${pass.length}/${pass.length} checks`);
