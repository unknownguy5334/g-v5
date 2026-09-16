import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else files.push(abs);
  }
}
walk(root);
let passed = 0;
let failed = 0;
function check(ok, label) {
  if (ok) { passed += 1; console.log(`PASS ${label}`); }
  else { failed += 1; console.error(`FAIL ${label}`); }
}

const runtimeFiles = files.filter((f) => { const rel = path.relative(root, f); return rel.startsWith('src/') || rel.startsWith('server/') || rel.startsWith('public/') || rel === 'index.html'; });
const allSource = runtimeFiles.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
const auth = read('src/contexts/AuthContext.tsx');
const app = read('src/App.tsx');
const storage = read('src/utils/safeStorage.ts');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const server = read('server.ts');

check(!/navigator\.serviceWorker|serviceWorker\.register|CacheStorage|caches\.open|indexedDB\.open|new WebSocket\(|new EventSource\(|new BroadcastChannel\(/i.test(allSource), 'no service worker/cache storage/IndexedDB/socket/BroadcastChannel runtime dependency');
check(!/window\.(?:opener|parent|top).*postMessage|window\.addEventListener\(['\"]message['\"]/.test(allSource), 'no cross-window message receiver/sender');
check(/const AUTH_BOUNDARY_STORAGE_KEY = 'gadwal_auth_boundary_v1'/.test(auth), 'auth boundary sentinel exists');
check(/addEventListener\('storage', handleStorage\)/.test(auth) && /void refreshSession\(\)/.test(auth), 'cross-tab storage events force session revalidation');
check(/signalAuthBoundary\(\)/g.test(auth), 'login/signup/logout signal auth-boundary transitions');
check(app.includes('clearAllPersistedAppData();') && app.includes('authenticatedUserIdRef.current = null'), 'App clears browser state when auth leaves an authenticated identity');
check(storage.includes('window.localStorage') && storage.includes('window.sessionStorage'), 'storage access is isolated through safeStorage');
check(!/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|srcdoc/i.test(allSource), 'no direct HTML injection sink in browser source');
check(!/window\.open\(/.test(allSource) || /window\.open\([^;]*noopener,noreferrer/.test(allSource), 'popup fallback uses noopener/noreferrer');
check(manifest.start_url === '/' && manifest.display === 'standalone', 'manifest has bounded same-origin start URL');
check(/Cache-Control.*private, no-store, no-cache, must-revalidate/.test(server), 'API responses are explicitly non-cacheable');
check(/app\.set\("etag", false\)/.test(server), 'ETag generation is disabled');
check(fs.existsSync(path.join(root, 'scripts', 'test-browser-behavior-redteam-36.mjs')), 'browser behavior regression gate is packaged');

console.log(`RESULT ${passed}/${passed + failed} PASS`);
process.exitCode = failed ? 1 : 0;
