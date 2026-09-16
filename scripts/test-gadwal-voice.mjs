import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = [];
const assert = (cond, msg) => { if (!cond) fail.push(msg); };

const userFacingFiles = [
  'src/content/copy.ts',
  'src/components/Header.tsx',
  'src/components/HeroBanner.tsx',
  'src/components/StudentGapPosts.tsx',
  'src/components/HowItWorksModal.tsx',
  'src/components/DemoModal.tsx',
  'src/components/PrivacyModal.tsx',
  'src/components/ScheduleExportMenu.tsx',
  'src/components/StepAddCourses.tsx',
  'src/components/StepResults.tsx',
  'src/components/ConfirmResetModal.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/App.tsx',
].filter((p) => fs.existsSync(path.join(root, p)));

const source = userFacingFiles.map(read).join('\n');

assert(!source.includes('—'), 'No em dash exists in user-facing source files.');

const banned = [
  'leverage', 'streamline', 'facilitate', 'maximize productivity', 'innovative solution',
  'intelligent platform', 'next generation', 'cutting edge', 'seamless experience',
  'robust solution', 'comprehensive platform', 'advanced ecosystem', 'personalized solution',
  'unlock your potential', 'revolutionize', 'supercharge', 'elevate', 'enhance your workflow',
  'powered by AI', 'AI driven', 'intelligent scheduling', 'smart optimization',
  'effortless automation', 'personalized intelligence', 'AI powered experience',
  'revolutionary technology', 'sophisticated algorithms', 'Get started', 'Proceed', 'Submit',
  'Optimization Preferences', 'Maximum Academic Load', 'Schedule Generation', 'Optimization Results',
];
for (const phrase of banned) assert(!source.toLowerCase().includes(phrase.toLowerCase()), `Banned or generic phrase remains: ${phrase}`);

const copy = read('src/content/copy.ts');
const required = [
  'Stop wasting hours between courses.',
  'Have you ever had a course at 10 AM and your next one was at 1 PM?',
  'That’s 3 hours stuck on campus, waiting around for your next course.',
  'Nobody wants to spend their day like that.',
  'Gadwal finds you a schedule that actually makes sense.',
  'Find my best schedule',
  'Learn how',
  'You choose the courses you want.',
  'grouped by class-day count',
  'up to three valid schedule options',
  'no course conflicts',
];
for (const s of required) assert(copy.includes(s), `Canonical copy missing: ${s}`);

const hero = read('src/components/HeroBanner.tsx');
assert(hero.includes('id="hero-btn-primary"'), 'Hero primary CTA anchor exists.');
assert(!hero.includes('id="how-gadwal-works"'), 'How Gadwal works is not in the front page directly.');
assert(hero.includes('min-h-[52px]'), 'Hero CTA has a comfortable mobile touch target.');
for (const old of ['Your Current Week', 'Gadwal Finds A Better Option', '7h wasted waiting', 'Try section 1', 'Schedule gap comparison proof']) {
  assert(!hero.includes(old), `Old card-heavy hero content remains: ${old}`);
}
assert(!hero.includes('bg-gradient-'), 'Hero avoids generic gradient treatment.');
assert(!hero.includes('backdrop-blur'), 'Hero avoids glassmorphism treatment.');

const css = read('src/index.css');
assert(!css.includes('Noto Kufi Arabic'), 'No Arabic-only font declaration remains.');
assert(css.includes('Inter, ui-sans-serif, system-ui'), 'English-friendly system font stack is present.');
assert(source.includes('Student posts'), 'Hero includes student schedule-gap proof content without asserting unverifiable provenance.');

assert(!fs.existsSync(path.join(root, 'public/screenshot-example.svg')), 'Removed unused Example screenshot asset.');

if (fail.length) {
  console.error(`VOICE AUDIT FAILED (${fail.length})`);
  for (const f of fail) console.error(`- ${f}`);
  process.exit(1);
}
console.log('VOICE AUDIT PASSED');
console.log(`Checked ${userFacingFiles.length} user-facing source files, canonical homepage copy, mobile hero composition, font stack, and example asset.`);
