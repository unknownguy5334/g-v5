import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const assert = (name, ok, evidence) => { checks.push({ name, ok, evidence }); if (!ok) throw new Error(`${name}: ${evidence}`); };

const publicProfile = read('server/profileRoutes.ts');
assert('public academic context omits internal override source', /res\.json\(\{ ok: true, academicYear: context\.academicYear, term: context\.term \}\)/.test(publicProfile), 'route returns only academicYear and term');
assert('public academic context does not spread internal context', !/res\.json\(\{ ok: true, \.\.\.context \}\)/.test(publicProfile), 'no context spread at public boundary');

const health = read('server/healthRoutes.ts');
assert('public health payload is generic', /status: ready \? 'ok' : 'degraded',\s*ready/.test(health), 'no dependency payload fields');
assert('detailed DB health is admin-only', /\['\/health\/db', '\/api\/health\/db'\], requireAdmin/.test(health), 'DB diagnostics gated');
assert('detailed auth health is admin-only', /\['\/health\/neon-auth', '\/api\/health\/neon-auth'\], requireAdmin/.test(health), 'auth diagnostics gated');

const optimizer = read('server/optimizerRoutes.ts');
assert('optimizer strips search statistics', /delete \(result as any\)\.searchStats/.test(optimizer), 'searchStats removed from browser payload');
assert('optimizer strips diagnostics', /delete \(result as any\)\.diagnostics/.test(optimizer), 'diagnostics removed from browser payload');
assert('diagnostic optimizer mode is admin-only', /normalizedMode === 'diagnostic' && user\.role !== 'ADMIN'/.test(optimizer), 'diagnostic mode access control');

const session = read('server/authRoutes.ts');
assert('upstream auth session is not forwarded', /Do not expose the upstream session object/.test(session) && /session: \{ authenticated: true \}/.test(session), 'sanitized session response');

const clientFiles = [
  'src/App.tsx','src/components/ErrorBoundary.tsx','src/components/StepAddCourses.tsx','src/components/ScheduleExportMenu.tsx',
  'src/utils/export.ts','src/utils/safeStorage.ts','src/utils/performanceTelemetry.ts'
];
for (const file of clientFiles) {
  const s = read(file);
  assert(`client diagnostics sanitized in ${file}`, !/console\.(log|debug|info|warn|error)\([^\n]*\b(err|error|e|exception)\b/.test(s), 'no raw exception logging at client call sites');
}
const logger = read('src/utils/clientLogger.ts');
assert('client logger is dev-only', /import\.meta\.env\.DEV/.test(logger), 'console diagnostics gated to development builds');

const rawConsoleFiles = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','dist'].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) {
      const rel = path.relative(root, full).replaceAll('\\','/');
      const text = fs.readFileSync(full, 'utf8');
      if (rel.startsWith('src/') && /console\.(log|debug|info|warn|error)\(/.test(text) && rel !== 'src/utils/clientLogger.ts') rawConsoleFiles.push(rel);
    }
  }
}
walk(path.join(root, 'src'));
assert('all browser console diagnostics route through logger', rawConsoleFiles.length === 0, `direct console calls remain: ${rawConsoleFiles.join(', ')}`);

console.log(`Information leakage red-team gate: ${checks.length}/${checks.length} PASS/VERIFIED`);
for (const c of checks) console.log(`PASS/VERIFIED ${c.name} — ${c.evidence}`);
