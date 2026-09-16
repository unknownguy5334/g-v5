import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8');
const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk('.');

const serverFiles = files.filter(f => f.startsWith('server/') || f === 'server.ts');
const text = new Map(serverFiles.filter(f => /\.(ts|tsx|js|mjs|cjs)$/.test(f)).map(f => [f, read(f)]));
const allServer = [...text.values()].join('\n');

const checks = [];
function check(name, ok) { checks.push([name, !!ok]); }

const sensitive = [
  ['/api/auth/change-password', 'requireAuth'],
  ['/api/auth/change-email', 'requireAuth'],
  ['/api/auth/revoke-other-sessions', 'requireAuth'],
  ['/api/auth/revoke-all-sessions', 'requireAuth'],
];
for (const [route, middleware] of sensitive) {
  const re = new RegExp(`app\\.post\\(['"]${route.replaceAll('/', '\\/').replaceAll('-', '\\-')}['"]\\s*,\\s*${middleware}\\b`);
  check(`${route} is explicitly guarded by ${middleware}`, re.test(allServer));
}

for (const route of ['/api/admin/check','/api/admin/students','/api/admin/students/:id','/api/admin/payments','/api/admin/payments/all','/api/admin/payments/:id/proof','/api/admin/payments/:id/approve','/api/admin/payments/:id/reject','/api/admin/entitlements','/api/admin/products','/api/admin/payment-methods','/api/admin/academic-context','/api/admin/term-override','/api/models']) {
  const escaped = route.replaceAll('/', '\\/').replaceAll(':','\\:');
  const re = new RegExp(`app\\.(get|post|put|patch|delete)\\(['"]${escaped}['"]\\s*,\\s*requireAdmin\\b`);
  check(`${route} has requireAdmin`, re.test(allServer));
}

for (const route of ['/api/profile','/api/courses','/api/courses/restore','/api/schedules','/api/access','/api/run/start','/api/run/complete','/api/generate-schedule','/api/payment/pricing-for-user','/api/payment/submissions','/api/payment/submissions/:id/cancel','/api/payment/submit','/api/account/overview','/api/account/course-sets','/api/account/course-sets/:id/duplicate','/api/account/notifications','/api/account/notifications/:id/read','/api/account/schedules/:id/favorite','/api/account/schedules/:id/rename','/api/account/schedules/:id','/api/account/export','/api/account/delete-request','/api/account/delete-cancel']) {
  const escaped = route.replaceAll('/', '\\/').replaceAll(':','\\:');
  const re = new RegExp(`app\\.(get|post|put|patch|delete)\\(['"]${escaped}['"]\\s*,\\s*requireAuth\\b`);
  check(`${route} has requireAuth`, re.test(allServer));
}

check('Only GET/POST/DELETE API route registrations are present; no undocumented PUT/PATCH/all/route registrations', !/app\.(put|patch|all|options|head)\s*\(/.test(allServer));
check('API 404 fallback is present', /app\.use\(['"]\/api['"]/.test(allServer) && /API route not found/.test(allServer));
check('Diagnostic model endpoint requires requireAdmin', /app\.get\(["']\/api\/models["']\s*,\s*requireAdmin/.test(allServer));
check('Production diagnostic endpoint can be disabled by configuration', /diagnosticModelsEnabled/.test(allServer) && /ENABLE_DIAGNOSTIC_MODELS_ENDPOINT/.test(allServer));
check('Health routes return bounded information only', !/process\.uptime\(\)/.test(read('server/healthRoutes.ts')) && !/DATABASE_URL|GEMINI_API_KEY|NEON_AUTH_URL/.test(read('server/healthRoutes.ts')));
check('Authenticated API cache headers are globally applied', /req\.path\.startsWith\(['"]\/api\/['"]\)/.test(read('server.ts')) && /no-store/.test(read('server.ts')));
check('Latest generated schedule endpoint requires a valid runId', /requireAuth/.test(read('server/optimizerRoutes.ts')) && /runId/.test(read('server/optimizerRoutes.ts')));
check('No SQL/user-service route uses a client-supplied studentId as authorization identity', !/req\.(body|query|params)\.studentId/.test(allServer));

const failures = checks.filter(([,ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log(`RESULT ${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exit(1);
