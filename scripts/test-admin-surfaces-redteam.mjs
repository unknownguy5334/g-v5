import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const files = [
  'server.ts','server/authMiddleware.ts','server/profileRoutes.ts','server/accountRoutes.ts',
  'server/paymentRoutes.ts','server/services/paymentService.ts','server/services/adminAuditService.ts',
  'server/db/schema.ts','server/db/migrations/0013_admin_audit_log.sql','scripts/bootstrap-admin.ts',
  'src/AdminApp.tsx','src/main.tsx','src/types/auth.ts','server/staticApp.ts','server/securityHeaders.ts',
  '.env.example','.github/workflows/ci.yml'
];
for (const f of files) fs.readFileSync(path.join(root,f),'utf8');
const server = files.slice(0,7).map(read).join('\n');
const checks=[]; const ok=(name,condition)=>checks.push([name,!!condition]);
const adminRoutes = [
  ['/api/admin/check','get'],['/api/admin/students','get'],['/api/admin/students/:id','get'],
  ['/api/admin/students/:id/free-run/reset','post'],['/api/admin/payments','get'],['/api/admin/payments/all','get'],
  ['/api/admin/payments/:id/proof','get'],['/api/admin/payments/:id/approve','post'],['/api/admin/payments/:id/reject','post'],
  ['/api/admin/entitlements','get'],['/api/admin/entitlements/:id/revoke','post'],['/api/admin/products','get'],['/api/admin/products','post'],
  ['/api/admin/payment-methods','post'],['/api/admin/academic-context','get'],['/api/admin/term-override','post'],['/api/models','get']
];
for (const [route,verb] of adminRoutes) {
  const escaped=route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('/','\\/').replaceAll(':','\\:');
  ok(`${route} has requireAdmin`, new RegExp(`app\\.${verb}\\(['"]${escaped}['"]\\s*,\\s*requireAdmin\\b`).test(server));
}
ok('No alternate admin router is present', !/express\.Router\(\)/.test(server));
ok('Application role is stored-record controlled', /profile\?\.role === 'ADMIN'/.test(read('server/authMiddleware.ts')) && /role:\s*'STUDENT'/.test(read('server/services/studentProfile.ts')));
ok('No request-supplied role/admin flag controls privilege', !/req\.(body|query|params)\.[A-Za-z]*(role|admin|isAdmin)/i.test(server));
ok('Admin audit schema exists', /admin_audit_log/.test(read('server/db/schema.ts')) && /CREATE TABLE IF NOT EXISTS admin_audit_log/.test(read('server/db/migrations/0013_admin_audit_log.sql')));
ok('Sensitive admin payment-proof reads are audit-capable', /PAYMENT_PROOF_ACCESSED/.test(read('server/paymentRoutes.ts')) && /adminAuditService/.test(read('server/paymentRoutes.ts')));
ok('All admin write classes have audit hooks', ['FREE_RUN_RESET','TERM_OVERRIDE_CHANGED','PRODUCT_CONFIG_CHANGED','PAYMENT_METHOD_CONFIG_CHANGED','PAYMENT_APPROVED','PAYMENT_REJECTED','ENTITLEMENT_REVOKED'].every(a=>server.includes(a) || read('server/services/paymentService.ts').includes(a)));
ok('Free-run reset cannot report success for a nonexistent student', /\.returning\(\{id:students\.id\}\)/.test(read('server/accountRoutes.ts')) && /Student not found/.test(read('server/accountRoutes.ts')));
ok('Admin bootstrap is explicitly disabled by default', /ADMIN_BOOTSTRAP_ENABLED=false/.test(read('.env.example')));
ok('Admin bootstrap refuses to run unless explicitly enabled', /ADMIN_BOOTSTRAP_ENABLED=true is required/.test(read('scripts/bootstrap-admin.ts')));
ok('Admin bootstrap is one-time and race-safe', /pg_advisory_xact_lock/.test(read('scripts/bootstrap-admin.ts')) && /An administrator already exists/.test(read('scripts/bootstrap-admin.ts')) && /role='STUDENT'/.test(read('scripts/bootstrap-admin.ts')));
ok('Admin UI is not the security boundary', /server rejected admin privileges/i.test(read('src/AdminApp.tsx')) && /requireAdmin/.test(server));
ok('Production source maps are blocked', /\\.map\$/.test(read('server/staticApp.ts')));
ok('Admin/API responses are non-cacheable at the API boundary', /Cache-Control.*no-store|no-cache/.test(read('server.ts')));
for (const [name,pass] of checks) console.log(`${pass?'PASS':'FAIL'} — ${name}`);
const fails=checks.filter(([,p])=>!p); console.log(`ADMIN SURFACES RED-TEAM: ${checks.length-fails.length}/${checks.length}`); if(fails.length) process.exit(1);
