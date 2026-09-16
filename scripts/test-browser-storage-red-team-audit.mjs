import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('src/App.tsx');
const workflow = read('src/app/workflowPersistence.ts');
const persistence = read('src/app/persistence.ts');
const safe = read('src/utils/safeStorage.ts');

const allSource = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((x) => typeof x === 'string')
  .map((x) => path.join(root, 'src', x))
  .filter((x) => fs.statSync(x).isFile())
  .filter((x) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(x))
  .map((x) => fs.readFileSync(x, 'utf8')).join('\n');

let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
}

check(!/localStorage\.getItem\(['"]token['"]\)/.test(allSource), 'no legacy browser bearer-token lookup');
check(!/indexedDB\.|IDBDatabase|indexedDB\s*\(/i.test(allSource), 'no IndexedDB API dependency');
check(!/caches\.(open|match)|CacheStorage/i.test(allSource), 'no CacheStorage persistence channel');
check(app.includes("authStatus === 'unauthenticated'") && app.includes("initialDataRef.current = authStatus === 'unauthenticated'"), 'browser persistence hydration is restricted to resolved anonymous mode');
check(app.includes("if (authStatus !== 'unauthenticated')") && app.includes("return 'home';"), 'persisted workflow route is not read while auth is unresolved');
check(app.includes('const [accountDataReady') && app.includes('setAccountDataReady(false)'), 'account hydration locks the app before data is loaded');
check(app.includes('if (!accountDataReady) {') && app.includes('Loading your account'), 'storage-backed child UI is not mounted before the account gate opens');
check(app.includes('clearAllPersistedAppData();') && app.includes('authenticatedUserIdRef.current = null'), 'logout/account transitions clear prior account browser state');
check(app.includes('authenticatedUserIdRef.current !== userId'), 'stale account hydration responses are rejected');
check(app.includes('const coursesOk =') && app.includes('const schedulesOk =') && app.includes('if (!coursesOk || !schedulesOk)'), 'account hydration requires successful courses and schedules responses');
check(app.includes('let hydrated = false;') && app.includes('setAccountDataReady(true);'), 'authenticated writes unlock only after successful hydration');
check(app.includes('if (accountDataReady && user?.emailVerified && sections.length >= 0)'), 'authenticated course writes are gated by account readiness');
check(app.includes("if (!accountDataReady || authStatus !== 'unauthenticated') return;") && app.includes('createStorageEnvelope(sections'), 'anonymous/local course persistence is restricted to anonymous mode');
check(app.includes("if (!accountDataReady || authStatus !== 'unauthenticated') return;") && app.includes('createStorageEnvelope(preferences'), 'preference persistence is restricted to anonymous mode');
check(app.includes("if (!accountDataReady || authStatus !== 'unauthenticated') return;") && app.includes('if (optimizerOutput)'), 'optimizer result persistence is restricted to anonymous mode');
check(workflow.includes('sessionRemoveItem(key)') && workflow.includes('clearPendingReview'), 'pending OCR review is cleared from session storage');
check(workflow.includes('sessionRemoveItem(WORKFLOW_DRAFT_KEYS.manualForms)'), 'manual form persistence is cleared from session storage');
check(persistence.includes('LEGACY_STORAGE_KEY_SECTIONS') && persistence.includes('safeStorage.removeItem(legacyKey)'), 'legacy browser snapshots are migrated and removed');
check(safe.includes("function getStore(kind: 'local' | 'session')") && safe.includes('window.localStorage') && safe.includes('window.sessionStorage'), 'browser storage access is wrapped against storage exceptions');
check(persistence.includes('sanitizeSectionsSnapshot') && persistence.includes('sanitizePreferencesSnapshot'), 'stored course/preference snapshots are validated at the data boundary');
check(fs.statSync(path.join(root, 'scripts', 'test-browser-storage-red-team-audit.mjs')).isFile(), 'storage-domain regression gate is packaged');
check(workflow.includes('durable?: boolean') && workflow.includes('options.durable !== false'), 'authenticated workflow drafts can be limited to session storage');
check(read('src/components/StepAddCourses.tsx').includes("{ durable: authStatus === 'unauthenticated' }"), 'workflow draft callers disable durable storage for authenticated users');
check(read('src/components/StepAddCourses.tsx').includes("const previousAuthStatusRef = useRef<typeof authStatus | null>(null);") && read('src/components/StepAddCourses.tsx').includes('crossedAuthBoundary') && read('src/components/StepAddCourses.tsx').includes('setUploadedFiles([])') && read('src/components/StepAddCourses.tsx').includes('setPendingParsedSections(null)') && read('src/components/StepAddCourses.tsx').includes("setManualForms([createEmptyManualForm('1')])"), 'OCR/manual drafts and in-memory upload previews are cleared across auth boundaries');

console.log(`RESULT ${passed}/${passed + failed} PASS`);
process.exitCode = failed ? 1 : 0;
