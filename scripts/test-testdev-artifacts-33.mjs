import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const ok = (label, condition) => condition ? console.log(`PASS/VERIFIED: ${label}`) : failures.push(label);

const server = [
  'server.ts', ...fs.readdirSync(path.join(root, 'server')).filter((n) => n.endsWith('.ts')).map((n) => `server/${n}`),
].map(read).join('\n');

const packageJson = JSON.parse(read('package.json'));
const paymentTest = read('scripts/test-payment-access.ts');
const vite = read('vite.config.ts');
const build = read('scripts/build-server.mjs');

ok('No test/demo/debug HTTP route is registered in runtime server source', !/app\.(get|post|put|patch|delete)\(\s*['\"][^'\"]*(?:test|demo|debug|mock|fixture|seed)[^'\"]*['\"]/.test(server));
ok('Mutating payment test requires explicit opt-in', /ALLOW_MUTATING_TEST_DB/.test(paymentTest));
ok('Mutating payment test requires loopback DB', /localhost.*127\.0\.0\.1.*::1|hostname !== 'localhost'.*hostname !== '127\.0\.0\.1'.*hostname !== '::1'/s.test(paymentTest));
ok('Mutating payment test is excluded from aggregate npm test', !packageJson.scripts.test.includes('test-payment-access.ts'));
ok('Dedicated payment test remains explicit', /ALLOW_MUTATING_TEST_DB=true tsx scripts\/test-payment-access\.ts/.test(packageJson.scripts['test:payments'] || ''));
ok('Vite dev middleware only activates outside production', /config\.nodeEnv !== 'production'/.test(read('server/staticApp.ts')));
ok('Production build bundles server entry, not test scripts', /entryPoints: \['server\.ts'\]/.test(build) && !/scripts\/test-/.test(build));
ok('External Vite hosts are opt-in only', /ALLOW_EXTERNAL_VITE_HOST === 'true'/.test(vite));

if (failures.length) {
  console.error(`FAIL (${failures.length})`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('TEST/DEV ARTIFACT GATE PASSED');
