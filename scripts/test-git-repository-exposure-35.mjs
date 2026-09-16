import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '.vite'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else files.push(full);
  }
}
walk(root);

const bannedNames = /(?:^|\/)(?:\.git(?:modules|config|index|objects|refs)?|\.svn|\.hg|\.bzr)(?:$|\/)|(?:\.pem|\.key|\.p12|\.pfx)$/i;
const credentialName = /(?:^|\/)(?:credentials|passwd|password|secrets?)(?:[._-]|$)/i;
const archiveOrBackup = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar|bak|old|orig|rej|swp|swo|dump|backup)$/i;
for (const file of files) {
  const rel = path.relative(root, file);
  assert(!bannedNames.test(rel), `forbidden VCS/credential filename present: ${rel}`);
  if (!rel.endsWith('test-secrets-redteam-31.mjs') && !rel.endsWith('SECRETS_HISTORY_RED_TEAM_FINAL_REPORT.md')) assert(!credentialName.test(rel), `credential-like filename present: ${rel}`);
  assert(!archiveOrBackup.test(rel), `archive/backup artifact present: ${rel}`);
}

assert(!fs.existsSync(path.join(root, '.git')), '.git directory must not be shipped');
assert(!fs.existsSync(path.join(root, '.svn')), '.svn directory must not be shipped');
assert(!fs.existsSync(path.join(root, '.hg')), '.hg directory must not be shipped');
assert(!fs.existsSync(path.join(root, '.bzr')), '.bzr directory must not be shipped');

const workflow = read('.github/workflows/ci.yml');
assert(workflow.includes('permissions:\n  contents: read'), 'CI workflow must use minimum repository read permissions');
assert(!workflow.includes('pull_request_target:'), 'CI must not execute untrusted pull requests in a privileged pull_request_target context');
assert(!/uses:\s+[^@\s]+@(?![0-9a-f]{40}\b)/m.test(workflow), 'all GitHub Actions must be immutable 40-character SHA references');
assert(workflow.includes('persist-credentials: false'), 'checkout must not persist repository credentials in the workspace');
assert(!/secrets\./.test(workflow), 'CI must not expose repository secrets to untrusted test/build steps');

const gcloud = read('.gcloudignore');
for (const required of ['.git/', '.github/', '.env', 'backups/', '*_RED_TEAM_FINAL_REPORT.md', 'scripts/test-*.mjs', 'scripts/test-*.ts']) {
  assert(gcloud.includes(required), `.gcloudignore missing ${required}`);
}

const gitignore = read('.gitignore');
for (const required of ['.env', '.env.*', 'backups/', '*.dump', '*.backup', '*.log']) {
  assert(gitignore.includes(required), `.gitignore missing ${required}`);
}

const packageJson = JSON.parse(read('package.json'));
assert(packageJson.private === true, 'package must remain private to prevent accidental npm publication');
assert(!packageJson.repository && !packageJson.homepage && !packageJson.bugs, 'package metadata must not introduce unintended external repository/publication metadata');

const suspiciousText = [];
const patterns = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:]+:[^\s@]+@/i,
  /Bearer\s+[A-Za-z0-9._-]{24,}/,
];
for (const file of files) {
  const rel = path.relative(root, file);
  if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp') || file.endsWith('.ico')) continue;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const pattern of patterns) {
    if (pattern.test(text)) suspiciousText.push(rel);
  }
}
assert(suspiciousText.length === 0, `high-confidence credential pattern(s) present: ${suspiciousText.join(', ')}`);

const release = read('scripts/verify-release-config.mjs');
assert(release.includes("const lockNames = ['package-lock.json'];"), 'release verification must continue to enforce a lockfile before deployment');

if (failures.length) {
  console.error(`Git/repository exposure gate failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Git/repository exposure gate passed. ${files.length} shipped files scanned for VCS, credential, archive, workflow, and publication metadata exposure.`);
