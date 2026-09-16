import fs from 'node:fs';

const read = (f) => fs.readFileSync(f, 'utf8');
const server = read('server.ts');
const optimizer = read('server/optimizerRoutes.ts');
const client = read('src/utils/optimizerWorkerClient.ts');
const app = read('src/App.tsx');
const checks = [
  ['API responses disable caching', server.includes("res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')")],
  ['API varies on auth state', server.includes("res.setHeader('Vary', 'Cookie, Authorization')")],
  ['full optimizer mode requires runId', optimizer.includes("if (typeof runId !== 'string'") && optimizer.includes("code: 'RUN_REQUIRED'")],
  ['full optimizer run is user-bound and active', optimizer.includes('eq(runSessions.studentId, user.id)') && optimizer.includes("eq(runSessions.status, 'IN_PROGRESS')") && optimizer.includes('gt(runSessions.expiresAt, new Date())')],
  ['optimizer has per-mode rate limiting', optimizer.includes("'optimizer_generate'") && optimizer.includes('allowPersistentRateLimit')],
  ['unsupported optimizer modes rejected', optimizer.includes("code: 'INVALID_MODE'")],
  ['client sends runId for full generation', app.includes('runId: activeScheduleRunIdRef.current || undefined')],
  ['client no longer advertises invalid capped mode', client.includes("mode?: 'full' | 'estimate' | 'diagnostic';")],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
if (failed) process.exit(1);
