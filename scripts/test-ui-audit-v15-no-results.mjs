import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const step = fs.readFileSync(path.join(root, 'src/components/StepResults.tsx'), 'utf8');
const copy = fs.readFileSync(path.join(root, 'src/content/copy.ts'), 'utf8');
const checks = [
  ['completed no-results headline', step.includes("No schedule matches these choices."), 'zero-result state has a dedicated headline'],
  ['cancelled state', step.includes('Search canceled.'), 'cancelled searches have a separate state'],
  ['search again action', step.includes('Search again'), 'cancelled state offers a truthful retry action'],
  ['zero-result filter hidden', step.includes('totalFoundAll > 0') && step.includes('isCompletedNoResults'), 'empty states do not render the day filter'],
  ['no ranking on empty', step.includes('!isCompletedNoResults && !isCancelledSearch'), 'ranking control is hidden when results are absent'],
  ['target language', step.includes('<strong>Target:</strong>'), 'results expose target metadata directly'],
  ['recovery guidance', step.includes('target number of courses or total credits') && step.includes('must-take'), 'empty state points to real editable inputs'],
  ['no stale preference advice', copy.includes("review your must-take choices") && !copy.includes('course choices or preferences'), 'empty-state copy avoids removed preference concepts'],
  ['populated filter groups', step.includes('populatedDays'), 'empty day buckets are filtered out'],
];
let ok = 0;
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
  if (pass) ok++;
}
if (ok !== checks.length) process.exit(1);
console.log(`V15 no-results implementation contract: ${ok}/${checks.length} passed`);
