import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const forbidden = [
  /postgres(?:ql)?:\/\/[^\s"']+/i,
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/,
  /ADMIN_DIAGNOSTIC_TOKEN/i,
  /x-gadwal-admin-token/i,
];
const secretEnvNames = /(DATABASE_URL|GEMINI_API_KEY|GOOGLE_API_KEY|ADMIN_.*TOKEN|.*_SECRET|.*_PRIVATE_KEY)/i;
const failures=[];
function walk(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','.git','dist','coverage'].includes(entry.name)) continue;
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) walk(full); else {
      const rel=path.relative(root,full);
      if (rel === 'scripts/security-scan.mjs' || rel === 'scripts/test-adversarial-audit-8.mjs' || /^scripts\/test-.*\.(mjs|js|cjs|ts)$/.test(rel)) continue;
      if (!/\.(ts|tsx|js|mjs|cjs|json|html|css|env|example)$/i.test(rel)) continue;
      if (rel === '.env.example') continue;
      const text=fs.readFileSync(full,'utf8');
      const activeText=text.split(/\r?\n/).filter(line => !/^\s*(#|\/\/|\*|\/\*)/.test(line)).join('\n');
      for (const re of forbidden) if (re.test(activeText)) failures.push(`${rel}: matched ${re}`);
      if (/^\.env$/i.test(entry.name) || /^\.env\./i.test(entry.name)) {
        for (const line of text.split(/\r?\n/)) {
          const m=line.match(/^([A-Z0-9_]+)=(.+)$/);
          if (m && secretEnvNames.test(m[1]) && m[2].trim() && !/^['\"]?$/.test(m[2].trim())) failures.push(`${rel}: possible secret value in ${m[1]}`);
        }
      }
    }
  }
}
walk(root);
if (failures.length) {
  console.error('Security scan failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('Security source scan passed.');
