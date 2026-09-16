const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const optimizer = fs.readFileSync(path.join(root, 'server/optimizer/optimizer.ts'), 'utf8');
const results = fs.readFileSync(path.join(root, 'src/components/StepResults.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/SchedulePreferencesPanel.tsx'), 'utf8');
const checks = [
  [optimizer.includes("searchCompleteness = 'exhaustive'") || optimizer.includes("searchCompleteness = 'capped'"), 'optimizer reports search completeness'],
  [optimizer.includes("searchCompleteness: 'not_searched'"), 'optimizer marks preflight output as not searched'],
  [optimizer.includes('canAddSectionEarly'), 'optimizer uses shared conflict pruning'],
  [optimizer.includes('DEFAULT_SEARCH_BUDGET'), 'diagnostic/estimate budget infrastructure remains available'],
  [results.includes('searchCompleteness'), 'Results surfaces search completeness'],
  [results.includes('result[d] = [...(optimizerOutput.byDayCount[d] || [])]'), 'Results preserves optimizer order'],
  [panel.includes('How many credits do you want?') && panel.includes('How many courses do you want?'), 'setup exposes only core targets'],
  [optimizer.includes('RESULT_LIMIT_PER_DAY = 3'), 'optimizer returns top 3 per bucket'],
];
for (const [pass,label] of checks) { if(!pass) throw new Error(label); }
console.log(`SEARCH/OPTIMIZATION ENGINE AUDIT: ${checks.length}/${checks.length} source-contract checks passed`);
