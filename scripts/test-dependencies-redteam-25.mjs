import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
const ok = (condition, message) => {
  if (condition) console.log(`PASS ${message}`);
  else { console.error(`FAIL ${message}`); failures.push(message); }
};

const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};
const requiredExact = [
  ['@google/genai', '2.22.0'],
  ['@tailwindcss/vite', '4.3.3'],
  ['@vitejs/plugin-react', '6.1.1'],
  ['dotenv', '17.4.2'],
  ['express', '4.22.3'],
  ['multer', '2.4.0'],
  ['esbuild', '0.28.2'],
  ['vite', '6.4.3'],
  ['react', '19.3.0'],
  ['react-dom', '19.3.0'],
  ['tailwindcss', '4.3.3'],
];
for (const [name, version] of requiredExact) {
  ok(deps[name] === version || devDeps[name] === version, `${name} is pinned to ${version}`);
}

for (const name of Object.keys(deps)) {
  ok(!/^[~^*<>=]/.test(String(deps[name])), `production dependency ${name} is exact-pinned`);
}
for (const name of Object.keys(devDeps)) {
  ok(!/^[~^*<>=]/.test(String(devDeps[name])), `development dependency ${name} is exact-pinned`);
}

ok(Number(String(pkg.engines?.node ?? '').replace(/^[^0-9]*/, '').split('.')[0]) >= 22, 'Node engine requires a maintained Node 22+ line');
ok(pkg.packageManager === 'npm@10.9.8', 'npm toolchain is explicitly pinned');

for (const removed of ['@neondatabase/serverless', 'jszip', 'motion']) {
  ok(!(removed in deps), `${removed} unused direct dependency removed`);
}
ok(!('autoprefixer' in devDeps), 'unused autoprefixer development dependency removed');

const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'];
const trackedLock = lockfiles.find((name) => fs.existsSync(path.join(root, name)));
if (trackedLock) console.log(`PASS dependency lockfile present: ${trackedLock}`);
else console.log('WARN dependency lockfile absent; transitive dependency audit remains environment-limited');

if (failures.length) process.exit(1);
