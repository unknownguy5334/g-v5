import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.vite']);
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.sh', '.sql', '.yml', '.yaml', '.toml', '.txt', '.env', '.example']);

const secretPatterns = [
  ['Google API key', /\bAIza[0-9A-Za-z_-]{20,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{15,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._-]{24,}\b/],
  ['basic credential', /\bBasic\s+[A-Za-z0-9+/=]{24,}\b/],
  ['credentialed database URL', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+:[^\s"']+@/i],
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else inspect(full);
  }
}

function inspect(file) {
  const rel = path.relative(root, file);
  if (rel === 'scripts/test-secrets-redteam-31.mjs') return;
  if (path.basename(file) === '.env.example') {
    const env = fs.readFileSync(file, 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, name, value] = match;
      if (/(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|DATABASE_URL|NEON_AUTH_URL)/i.test(name) && value.trim()) {
        failures.push(`${rel}: non-empty secret-bearing example variable ${name}`);
      }
    }
    return;
  }

  let text;
  try {
    if (!TEXT_EXTS.has(path.extname(file).toLowerCase())) {
      const buf = fs.readFileSync(file);
      text = buf.includes(0) ? '' : buf.toString('utf8');
    } else {
      text = fs.readFileSync(file, 'utf8');
    }
  } catch {
    return;
  }
  if (!text) return;

  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(`${rel}: possible ${label}`);
  }
}

walk(root);

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const required of ['.env', 'backups/', '*.dump', 'node_modules/']) {
  if (!gitignore.includes(required)) failures.push(`.gitignore: missing ${required}`);
}

if (fs.existsSync(path.join(root, '.git'))) failures.push('.git directory must not be shipped in the application archive.');
if (fs.existsSync(path.join(root, '.env'))) failures.push('.env must not be shipped.');

if (failures.length) {
  console.error('Secret/history scan failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Secret/history scan passed. No high-confidence credential patterns found, .env is absent, and local secret/backup paths are gitignored.');
