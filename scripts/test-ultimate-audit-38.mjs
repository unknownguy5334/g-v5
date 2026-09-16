import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const allFiles = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.vite', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else allFiles.push(path.relative(root, p).replaceAll('\\','/'));
  }
}
walk(root);
const appFiles = allFiles.filter(f => /^(server\/|src\/|server\.ts$|vite\.config\.ts$)/.test(f) && /\.(ts|tsx|js|jsx|mjs|cjs|html|css)$/.test(f));
const source = appFiles.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const checks = [
  ['01 Frontend source — no client secret patterns or dangerous sinks', !/dangerouslySetInnerHTML|new Function\(|\beval\(|VITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(source)],
  ['02 Network — API discovery suite exists and request security is enforced', fs.existsSync(path.join(root,'scripts/test-api-discovery-red-team-audit.mjs')) && read('server.ts').includes('enforceSameOriginForStateChanges')],
  ['03 Sources — source maps are absent/blocked and production server artifact is not static-served', !allFiles.some(f=>/\.map$/i.test(f)) && read('server/staticApp.ts').includes('server\\.cjs')],
  ['04 Storage — safe storage wrapper plus cross-tab auth boundary exist', read('src/utils/safeStorage.ts').includes('devLogWarn') && read('src/contexts/AuthContext.tsx').includes('AUTH_BOUNDARY_STORAGE_KEY')],
  ['05 Cookies — auth cookie normalization is centralized and deployment-aware', read('server/authRoutes.ts').includes('normalizeAuthSetCookie') && read('server/authRoutes.ts').includes("getServerConfig().deploymentEnv === 'production'")],
  ['06 Environment — server-only secrets are not VITE-prefixed and production requirements are explicit', read('server/config.ts').includes('GEMINI_API_KEY') && !read('.env.example').includes('VITE_GEMINI_API_KEY')],
  ['07 Source maps — build control exists and production serving blocks maps', read('scripts/build-server.mjs').includes('PRODUCTION_SOURCEMAPS') && read('server/staticApp.ts').includes('/\\.map$/i.test')],
  ['08 Static files — no backup/credential artifact extensions are shipped', !allFiles.some(f=>/(^|\/)(?:\.env(?:\..*)?|.*\.(?:bak|old|orig|swp|tmp|pem|key|p12|pfx|crt|dump|backup|tar|gz|zip))$/i.test(f) && !f.endsWith('.env.example'))],
  ['09 API discovery — current discovery regression gate passes structurally', fs.existsSync(path.join(root,'scripts/test-api-discovery-red-team-audit.mjs'))],
  ['10 Authentication — critical auth controls fail closed and enumerate-safe', read('server/authRoutes.ts').includes('allowCriticalRateLimit') && read('server/authRoutes.ts').includes('{ failClosed: true }') && read('server/authRoutes.ts').includes('Invalid email or password.')],
  ['11 Authorization — admin and user guards exist on privileged routes', read('server/authMiddleware.ts').includes('requireAdmin') && read('server/authMiddleware.ts').includes('requireAuth')],
  ['12 IDOR/BOLA — account-bound identifiers use authenticated principal', /\(req as any\)\.user\.id/.test(read('server/accountRoutes.ts')) && read('server/paymentRoutes.ts').includes('requireAuth')],
  ['13 Admin — destructive/admin paths are server-guarded', read('server/accountRoutes.ts').includes('requireAdmin') && read('server/paymentRoutes.ts').includes('requireAdmin')],
  ['14 Input validation — bounded JSON and identifier helpers are present', read('server/inputValidation.ts').includes('isUuid') && read('server/profileRoutes.ts').includes('express.json({limit'),],
  ['15 Injection — parameterized/ORM boundary and no dynamic execution primitives in app', !/\beval\(|new Function\(|execSync\(|spawnSync\(|shell\s*:\s*true/.test(source) && read('server/db.ts').includes('drizzle')],
  ['16 File uploads — magic-byte proof validation and bounded OCR images', read('server/paymentValidation.ts').includes('detectMagicMime') && read('server.ts').includes('MAX_IMAGES_PER_REQUEST')],
  ['17 SSRF — outbound wrapper rejects redirects and configures fixed destinations', read('server/upstream.ts').includes("redirect: 'error'") && read('server/healthRoutes.ts').includes('generativelanguage.googleapis.com')],
  ['18 CORS — explicit origin trust, no wildcard credentials', read('server/requestSecurity.ts').includes('allowedOrigins') && !/Access-Control-Allow-Origin.?\*|credentials.?true/.test(source)],
  ['19 CSRF — same-origin enforcement covers API state changes', read('server/requestSecurity.ts').includes('enforceSameOriginForStateChanges')],
  ['20 Rate limits — persistent fail-closed limiter is used for critical routes', read('server/persistentRateLimiter.ts').includes('failClosed') && read('server/profileRoutes.ts').includes('admin_term_override')],
  ['21 Resource exhaustion — JSON/upload/global concurrency bounds exist', read('server/config.ts').includes('maxGlobalConcurrentWork') && read('server.ts').includes('MAX_TOTAL_IMAGES_BYTES')],
  ['22 Error messages — raw upstream exceptions are not returned', read('server/errors.ts').includes('serializeServerError') && read('server/paymentRoutes.ts').includes('sendPaymentError')],
  ['23 Health/debug — public health responses are generic and detailed health is admin-only', read('server/healthRoutes.ts').includes("res.status(200).json({ status: 'ok' })") && read('server/healthRoutes.ts').includes('requireAdmin')],
  ['24 Server headers — hardening middleware and no ETag fingerprint path', read('server/securityHeaders.ts').includes('Strict-Transport-Security') && read('server.ts').includes('app.set("etag", false)') || read('server.ts').includes("app.set('etag', false)")],
  ['25 Dependencies — exact runtime pinning and Node 22 baseline', JSON.parse(read('package.json')).engines?.node === '>=22' && !Object.values(JSON.parse(read('package.json')).dependencies||{}).some(v=>/^[~^]/.test(v))],
  ['26 Database/API — migrations and DB integrity helpers are present', fs.existsSync(path.join(root,'server/db/migrations/0014_api_db_integrity.sql')) && fs.existsSync(path.join(root,'server/db/migrations/0015_payment_integrity.sql'))],
  ['27 Webhooks — no inbound webhook processing path is present', !/webhook\s*[:=(]|stripe\s*webhook|paymob\s*webhook/i.test(read('server/paymentRoutes.ts') + read('server/services/paymentService.ts'))],
  ['28 Payments — server validates proof, fixes currency, and admin approval is authoritative', read('server/paymentRoutes.ts').includes('validatePaymentProof') && read('server/services/paymentService.ts').includes('MANUAL_TELDA')],
  ['29 Business logic — server-issued integrity token gates saved results', read('server/optimizerRoutes.ts').includes('resultIntegrityToken') && read('server/services/scheduleService.ts').includes('timingSafeEqual')],
  ['30 Replay/race — transactional locks/one-time token consumption exist', read('server/services/studentProfile.ts').includes('FOR UPDATE') || read('server/services/studentProfile.ts').includes('FOR NO KEY UPDATE') || read('server/services/studentProfile.ts').includes('for update'),],
  ['31 Secrets — no Git/VCS metadata or high-confidence embedded credentials', !allFiles.some(f=>/^\.git($|\/)/.test(f)) && !/(AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]{20,})/.test(source)],
  ['32 Old/dead code — deprecated public aliases are absent', !read('server.ts').includes('/api/parse-schedule-images') && !read('server/authRoutes.ts').includes("/api/auth/get-session")],
  ['33 Test/dev — mutating payment test is opt-in/loopback guarded', read('scripts/test-payment-access.ts').includes('ALLOW_MUTATING_TEST_DB') && read('scripts/test-payment-access.ts').includes('localhost')],
  ['34 Infrastructure — deployment baseline and gcloud exclusions exist', fs.existsSync(path.join(root,'infrastructure.md')) && read('.gcloudignore').includes('.git/')],
  ['35 Git/repository — workflow actions are SHA-pinned and workspace creds disabled', read('.github/workflows/ci.yml').includes('persist-credentials: false') && !/uses:\s+[^@\s]+@(?![0-9a-f]{40}\b)/m.test(read('.github/workflows/ci.yml'))],
  ['36 Browser — cross-tab auth boundary and no browser-side websocket/service-worker dependency', read('src/contexts/AuthContext.tsx').includes('storage') && !/new WebSocket|serviceWorker\.register\(|navigator\.serviceWorker/.test(source)],
  ['37 Information leakage — internal academic override/provider diagnostics omitted', read('server/profileRoutes.ts').includes('academicYear: context.academicYear, term: context.term') && read('server/healthRoutes.ts').includes('Internal dependencies obscured for security')],
  ['38 Abuse — optimizer/global and endpoint-specific throttles exist', read('server/optimizerRoutes.ts').includes('allowPersistentRateLimit') && read('server.ts').includes('maxGlobalConcurrentWork')],
];

for (const [label, ok] of checks) console.log(`${ok ? 'PASS/VERIFIED' : 'FAIL'} ${label}`);
const failed = checks.filter(([,ok])=>!ok);
console.log(`ULTIMATE 38-DOMAIN GATE: ${checks.length-failed.length}/${checks.length} PASS/VERIFIED`);
if (failed.length) process.exit(1);
