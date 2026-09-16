import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, condition: Boolean(condition), detail });

const srcDir = path.join(root, 'src');
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(srcDir);

const src = sourceFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const optimizer = read('src/utils/optimizerWorkerClient.ts');
const requestSecurity = read('server/requestSecurity.ts');
const authRoutes = read('server/authRoutes.ts');
const paymentRoutes = read('server/paymentRoutes.ts');
const env = read('.env.example');
const readme = read('README.md');

check('No browser localStorage auth-token read', !/localStorage\.getItem\(['"]token['"]\)/.test(src));
check('Optimizer does not construct browser Authorization bearer headers', !/['"]Authorization['"]\s*:\s*`Bearer/.test(optimizer) && /credentials:\s*['"]same-origin['"]/.test(optimizer));
check('Production CSRF origin allowlist is configuration-backed', /config\.allowedOrigins/.test(requestSecurity) && /nodeEnv === 'production'\) return false/.test(requestSecurity));
check('Production origin validation does not inspect raw x-forwarded-host', !/x-forwarded-host/.test(requestSecurity));
check('Session response strips upstream session object', !/session:\s*sessionData\.session/.test(authRoutes) && /session:\s*\{ authenticated: true \}/.test(authRoutes));
check('Signup failures are normalized', !/res\.status\(response\.status\)\.json\(parsed\)/.test(authRoutes));
check('Multipart payment rate limit is before upload parser', /requireAuth,\s*paymentSubmissionRateLimit,\s*upload\.single/.test(paymentRoutes));
check('No private-key material is present in frontend source', !/BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/.test(src));
check('No obvious dynamic-code execution in frontend source', !/\beval\s*\(|new\s+Function\s*\(|WebAssembly\.(?:instantiate|compile)/.test(src));
check('Frontend API calls are relative or same-origin', !/fetch\(\s*[`'\"]https?:\/\//i.test(src));
check('No VITE_ environment variable is named like a secret', !/VITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(src));
check('Example secret values are blank', /^(?:GEMINI_API_KEY|DATABASE_URL|NEON_AUTH_BASE_URL|APP_ORIGIN|ALLOWED_ORIGINS|CRON_SECRET|ADMIN_BOOTSTRAP_EMAIL)=\s*$/m.test(env));
check('README does not expose a concrete AI Studio workspace identifier', !/ai\.studio\/apps\/[0-9a-f-]{20,}/i.test(readme));
check('Production source maps are opt-in', /PRODUCTION_SOURCEMAPS.*false/.test(env));
check('No source-map files are shipped in the archive tree', !sourceFiles.some((f) => f.endsWith('.map')) && !fs.existsSync(path.join(root, 'dist')));

let failed = 0;
for (const c of checks) {
  if (c.condition) console.log(`PASS — ${c.name}`);
  else { failed++; console.error(`FAIL — ${c.name}${c.detail ? ` — ${c.detail}` : ''}`); }
}
if (failed) process.exit(1);
console.log(`Frontend source security audit: ${checks.length}/${checks.length} passed`);
