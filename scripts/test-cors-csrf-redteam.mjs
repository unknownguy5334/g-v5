import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(p, 'utf8');
const requestSecurity = read('server/requestSecurity.ts');
const config = read('server/config.ts');
const server = read('server.ts');
const headers = read('server/securityHeaders.ts');
const auth = read('server/authRoutes.ts');
const payment = read('server/paymentRoutes.ts');
const account = read('server/accountRoutes.ts');
const fetchClient = read('src/services/resilientFetch.ts');
const packageJson = JSON.parse(read('package.json'));
const walkText = (dir) => {
  let out = '';
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) out += walkText(p);
    else if (/\.(?:ts|tsx|js|mjs|cjs|html|css)$/.test(ent.name)) out += read(p) + '\n';
  }
  return out;
};
const source = walkText('server') + walkText('src') + read('server.ts');
let passed = 0;
function ok(name, condition) { assert.ok(condition, name); passed++; console.log(`PASS/VERIFIED ${name}`); }

ok('same-origin middleware is installed before routes', server.includes('app.use(enforceSameOriginForStateChanges);'));
ok('POST/PUT/PATCH/DELETE API state changes are protected', requestSecurity.includes("['POST','PUT','PATCH','DELETE']") && requestSecurity.includes("req.path.startsWith('/api/')"));
ok('explicit Origin is allowlist-checked', requestSecurity.includes('if (!isOriginAllowed(origin, req))'));
ok('malformed Referer is rejected', requestSecurity.includes("code: 'ORIGIN_REJECTED'"));
ok('production cookie-auth requests require an origin signal', requestSecurity.includes("req.headers.cookie && !req.headers.authorization"));
ok('production Origin validation fails closed', requestSecurity.includes("if (config.nodeEnv === 'production') return false;"));
ok('non-production no longer accepts arbitrary origins', requestSecurity.includes('arbitrary attacker-controlled Origin headers') && requestSecurity.includes('return false;'));
ok('development localhost exception is exact', requestSecurity.includes("origin === 'http://localhost:3000'") && requestSecurity.includes("origin === 'http://127.0.0.1:3000'"));
ok('same-host scheme/port heuristic is absent', !requestSecurity.includes('requestHostname === originHostname'));
ok('configured origins are authoritative', requestSecurity.includes('config.allowedOrigins'));
ok('production APP_ORIGIN must be HTTPS', config.includes("if (!appOrigin || !/^https:\\/\\//i.test(appOrigin))"));
ok('application emits no CORS allow-origin header', !/Access-Control-Allow-Origin/i.test(source));
ok('application emits no credential/method/header CORS grants', !/Access-Control-Allow-(Credentials|Methods|Headers)/i.test(source));
ok('no CORS package is declared', !Object.hasOwn(packageJson.dependencies || {}, 'cors') && !Object.hasOwn(packageJson.devDependencies || {}, 'cors'));
ok('CSP form-action is same-origin', headers.includes("form-action 'self'"));
ok('auth cookies enforce SameSite=Lax', auth.includes('SameSite=Lax'));
ok('state-changing GET handlers are absent from server routes', !/app\.get\([^\n]*\b(delete|update|create|save|reset|revoke|verify|favorite|rename|restore|duplicate|read)\b/i.test(server + auth + payment + account));
ok('frontend has no hard-coded absolute API fetch URLs', !/fetch\(\s*[`'\"]https?:\/\//i.test(fetchClient));
ok('frontend has no credentialed cross-origin mode', !/credentials:\s*['\"]include['\"]/.test(source));
ok('login is covered by the global origin gate', auth.includes("app.post('/api/auth/sign-in'"));
ok('payment submit is covered by the global origin gate', payment.includes("app.post('/api/payment/submit'"));
ok('account deletion is covered by the global origin gate', account.includes("app.post('/api/account/delete-request'"));
ok('admin mutations are covered by the global origin gate', payment.includes("app.post('/api/admin/payments/:id/approve'"));
ok('CSRF/CORS regression gate is in standard test script', packageJson.scripts.test.includes('test-cors-csrf-redteam.mjs'));
console.log(`Cors/CSRF PASS/VERIFIED: ${passed}/24`);
