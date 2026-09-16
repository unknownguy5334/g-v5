import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const demoModalSrc = read('src/components/DemoModal.tsx');
const copySrc = read('src/content/copy.ts');
const headerSrc = read('src/components/Header.tsx');
const appSrc = read('src/App.tsx');
const stepAddSrc = read('src/components/StepAddCourses.tsx');
const cssSrc = read('src/index.css');

let passedTests = 0;
let totalTests = 0;
function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) { passedTests++; console.log(`✓ [PASS] ${message}`); }
  else { console.error(`✗ [FAIL] ${message}`); process.exitCode = 1; }
}

console.log('=== RUNNING Gadwal SCREENSHOT GUIDE MODAL VERIFICATION (CURRENT 5-STEP FLOW) ===\n');

assert(copySrc.includes("title: 'Screenshot guide'"), 'Screenshot guide title exists in canonical copy.');
assert(copySrc.includes('demo: {'), 'Demo copy object exists.');
for (const titleToken of ['step1Title', 'step2Title', 'step3Title', 'step4Title', 'step5Title']) {
  assert(copySrc.includes(`${titleToken}:`), `${titleToken} exists in canonical copy.`);
}

const expectedAssets = [
  'step1-advising-icon.svg',
  'step2-registered-courses.svg',
  'step4-course-options.svg',
  'step5-single-option-nutrition.svg',
];
for (const asset of expectedAssets) {
  assert(fs.existsSync(path.join(root, 'public/demo', asset)), `Guide asset exists: ${asset}`);
  assert(demoModalSrc.includes(asset), `Guide renders asset: ${asset}`);
}

assert(demoModalSrc.includes('currentStep === 1') && demoModalSrc.includes('currentStep === 5'), 'DemoModal implements the complete five-step flow.');
assert(demoModalSrc.includes('currentStep < 5'), 'Next navigation stops at the fifth step.');
assert(!demoModalSrc.includes('currentStep === 6') && !demoModalSrc.includes('currentStep === 7'), 'Removed legacy sixth/seventh steps are absent.');
assert(demoModalSrc.includes('goToPrev') && demoModalSrc.includes('goToNext'), 'Previous/next navigation exists.');
assert(demoModalSrc.includes('demo-modal-prev') && demoModalSrc.includes('demo-modal-next'), 'Stable navigation hooks exist.');
assert(demoModalSrc.includes('id="demo-modal-btn-action"'), 'Final action has a stable hook.');
assert(demoModalSrc.includes('{currentStep} / 5'), 'Footer progress matches the current five-step flow.');
assert(demoModalSrc.includes('aria-label={`Step ${currentStep} of 5`}'), 'Current step has an accessible label.');
assert(demoModalSrc.includes('role="dialog"') && demoModalSrc.includes('aria-modal="true"'), 'Dialog semantics are present.');
assert(demoModalSrc.includes('useModalAccessibility'), 'Modal focus management is present.');
assert(demoModalSrc.includes('ArrowLeft') && demoModalSrc.includes('ArrowRight'), 'Keyboard step navigation exists.');
assert(demoModalSrc.includes('disabled={currentStep === 1}'), 'Previous is disabled on the first step.');
assert(demoModalSrc.includes('Tap to enlarge') && demoModalSrc.includes('gd-guide-lightbox'), 'Image enlargement affordance exists.');
assert(cssSrc.includes('@media (max-width: 639px)'), 'Guide has a mobile breakpoint.');
assert(cssSrc.includes('.gd-modal-guide-timeline'), 'Guide timeline styling hook exists.');
assert(!demoModalSrc.includes('—'), 'No em dash remains in the screenshot guide.');
assert(!demoModalSrc.includes('Get started'), 'Generic Get started wording is absent.');
assert(!demoModalSrc.includes('Proceed'), 'Generic Proceed wording is absent.');
assert(!demoModalSrc.includes('Submit'), 'Generic Submit wording is absent.');
assert(headerSrc.includes('id="header-btn-demo"') && headerSrc.includes('id="mobile-menu-demo"'), 'Header opens the guide from desktop and mobile controls.');
assert(appSrc.includes('DemoModal'), 'App renders the guide modal.');
assert(stepAddSrc.includes('id="upload-demo-link"'), 'Course entry exposes the screenshot guide entry point.');

console.log(`\nINTERACTIVE GUIDE MODAL AUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED.\n`);
