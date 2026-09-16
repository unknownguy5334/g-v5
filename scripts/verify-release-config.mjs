import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lockNames = ['package-lock.json'];
const lock = lockNames.find((name) => fs.existsSync(name));
if (!lock) {
  console.error('Release dependency lockfile missing. Generate package-lock.json with npm install before deployment.');
  process.exit(1);
}
if (!packageJson.scripts?.build || !packageJson.scripts?.start || !packageJson.scripts?.['verify:predeploy']) {
  console.error('Production build/start scripts are missing.');
  process.exit(1);
}
for (const required of ['.github/workflows/ci.yml', 'OPERATIONS.md', 'scripts/backup-database.sh']) {
  if (!fs.existsSync(required)) { console.error(`Release operations file missing: ${required}`); process.exit(1); }
}
console.log(`Release configuration OK: ${lock}`);
