import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else files.push(abs);
  }
}
walk(root);
let passed = 0;
function check(ok, label) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  passed += 1;
  console.log(`PASS: ${label}`);
}

const auth = read('server/authRoutes.ts');
const config = read('server/config.ts');
const vite = read('vite.config.ts');
const env = read('.env.example');
const staticApp = read('server/staticApp.ts');
const buildServer = read('scripts/build-server.mjs');
const securityHeaders = read('server/securityHeaders.ts');
const packageJson = JSON.parse(read('package.json'));

check(auth.includes('normalizeAuthSetCookie'), 'upstream auth cookies are normalized before browser delivery');
check(auth.includes("SameSite=Lax"), 'auth cookies are forced to a conservative SameSite policy');
check(auth.includes('HttpOnly'), 'auth cookies are forced HttpOnly');
check(auth.includes("getServerConfig().deploymentEnv === 'production' && !hasSecure") && config.includes("deploymentEnv === 'production' && nodeEnv !== 'production'"), 'production auth cookies are forced Secure under the deployment environment invariant');
check(auth.includes("lower.startsWith('domain=')") && auth.includes('continue;'), 'upstream cookie Domain attributes are stripped to prevent unintended scope');
check(auth.includes('clearBetterAuthCookies') && auth.includes('Max-Age=0'), 'logout clears known Better Auth cookies locally on upstream 401');
check(!vite.includes('VITE_ALLOW_EXTERNAL_HOST'), 'server-only Vite host control no longer uses a VITE_ public prefix');
check(vite.includes('ALLOW_EXTERNAL_VITE_HOST'), 'server-only Vite host control uses a non-public environment variable');
check(!env.includes('VITE_ALLOW_EXTERNAL_HOST='), '.env.example does not advertise a public-prefixed server control');
const appSourceFiles = files.filter((f) => { const rel = path.relative(root, f).replaceAll('\\','/'); return /^(src\/|server\/|server\.ts$|vite\.config\.ts$)/.test(rel) && /\.(ts|tsx|js|jsx|html|css)$/.test(rel); });
const appSource = appSourceFiles.map((f)=>fs.readFileSync(f,'utf8')).join('\n');
check(!/VITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(appSource), 'no VITE_ variable is named like a secret');
check(!fs.existsSync(path.join(root, 'public', '.env')), 'public directory has no .env file');
check(!files.some((f) => /\.map$/i.test(f)), 'source maps are absent from the source archive');
check(staticApp.includes("/\\.map$/i.test(req.path)") && staticApp.includes('server\\.cjs'), 'production static serving blocks source maps and the bundled server artifact');
check(buildServer.includes('PRODUCTION_SOURCEMAPS') && buildServer.includes('sourcemap'), 'server source-map generation is explicitly controlled');
check(securityHeaders.includes("res.setHeader('Strict-Transport-Security'"), 'production security headers include HSTS');
check(packageJson.scripts?.build === 'vite build && node scripts/build-server.mjs', 'release build uses the audited Vite/server build path');

const forbiddenStaticNames = /(^|\/)(?:\.env(?:\..*)?|.*\.(?:bak|old|orig|swp|tmp|map|log|pem|key|crt|p12|pfx|sqlite|db|dump|tar|gz|zip))$/i;
const suspicious = files.map((f)=>path.relative(root,f)).filter((rel)=>forbiddenStaticNames.test(rel) && rel !== '.env.example' && !rel.startsWith('server/db/migrations/'));
check(suspicious.length === 0, `no suspicious backup/secret artifacts are present outside intended SQL migrations (${suspicious.length})`);

console.log(`ALL PASS: ${passed}`);
