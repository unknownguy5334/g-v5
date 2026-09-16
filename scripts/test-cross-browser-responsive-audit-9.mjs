import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stepAdd = fs.readFileSync(path.join(root, 'src/components/StepAddCourses.tsx'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'src/components/ModalShell.tsx'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'src/components/StepAddCourses.tsx'), 'utf8');
const browserCaps = fs.readFileSync(path.join(root, 'src/utils/browserCapabilities.ts'), 'utf8');
const imageOptimizer = fs.readFileSync(path.join(root, 'src/utils/imageOptimizer.ts'), 'utf8');
const imageAnalysis = fs.readFileSync(path.join(root, 'src/utils/imageFileAnalysis.ts'), 'utf8');
const dateFmt = fs.readFileSync(path.join(root, 'src/utils/dateFormatting.ts'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'src/AdminApp.tsx'), 'utf8');
const paymentHistory = fs.readFileSync(path.join(root, 'src/components/PaymentHistoryModal.tsx'), 'utf8');

const checks = [];
const ok = (name, pass, details='') => checks.push({name, pass, details});

ok('Viewport meta covers mobile safe-area behavior', /viewport-fit=cover/.test(index));
ok('Overflow-x has a compatibility fallback before clip', /overflow-x:\s*hidden;[\s\S]*overflow-x:\s*clip;/.test(css));
ok('Dynamic viewport heights have vh fallbacks', /height:\s*min\(90vh/.test(css) && /max-height:\s*90vh/.test(css) && /@supports not \(height:\s*100dvh\)/.test(css));
ok('Safe-area insets are used for bottom UI', /safe-area-inset-bottom/.test(css));
ok('Soft-keyboard visual viewport handling is guarded', /window\.visualViewport/.test(hook) && /if \(!viewport\) return;/.test(hook));
ok('Touch targets remain at least 44px in responsive controls', /min-height:\s*44px/.test(css) && /min-width:\s*44px/.test(css));
ok('Hover is not the only interaction state on touch devices', /@media \(hover:\s*none\)/.test(css) && /:focus-visible/.test(css));
ok('Payment screenshot input explicitly accepts common image formats', /accept="image\/png,image\/jpeg,image\/jpg,image\/webp"/.test(stepAdd) || /accept="image\/\*"/.test(stepAdd));
ok('Image optimizer has a createImageBitmap path plus FileReader fallback', /createImageBitmap/.test(imageOptimizer) && /FileReader/.test(imageOptimizer));
ok('Image analysis gracefully returns when createImageBitmap is unavailable', /createImageBitmap/.test(imageAnalysis) && /return null/.test(imageAnalysis));
ok('Browser capability detection avoids assuming advanced APIs exist', /typeof g\.Worker/.test(browserCaps) && /clipboard\?\.writeText/.test(browserCaps));
ok('Modal body is independently scrollable and bounded', /overflow-y-auto/.test(modal) && /dvh/.test(modal));
ok('Dates are formatted through an explicit cross-browser helper', /Intl\.DateTimeFormat/.test(dateFmt));
ok('Admin no longer calls Date#toLocaleString directly', !/new Date\([^)]*\)\.toLocaleString\(\)/.test(admin));
ok('Payment history no longer calls Date#toLocaleString directly', !/new Date\([^)]*\)\.toLocaleString\(\)/.test(paymentHistory));
ok('color-mix has a solid fallback', /background:\s*rgba\(237,238,238,\.92\);\s*background:\s*color-mix/.test(css));
ok('No unsupported fullscreen API is assumed for the mobile workflow', !/requestFullscreen|webkitRequestFullscreen/.test(stepAdd + hook));

let failed = 0;
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} — ${c.name}${c.details ? ` — ${c.details}` : ''}`);
  if (!c.pass) failed++;
}
console.log(`RESULT ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
