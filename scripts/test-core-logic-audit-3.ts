import assert from 'node:assert/strict';
import { runOptimizer } from '../server/optimizer/optimizer';
import type { Section, SchedulePreferences, OptimizationResult } from '../src/types';
import { timeToMinutes } from '../server/optimizer/optimizerCore';
import { assertExportableSchedule, generateICS } from '../src/utils/exportCalendar';

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: 'SEC-1',
    name: 'Test Course',
    courseCode: 'TST101',
    sectionCode: 'TST101-01',
    courseKey: 'tst101',
    credits: 3,
    sessions: [{ id: 'm1', day: 'MON', start: '09:00', end: '10:00', type: 'Lecture' }],
    ...overrides,
  };
}

const prefs: SchedulePreferences = {
  targetCredits: 3,
  targetCourseCount: 1,
  mandatoryCourses: [],
  mandatoryCourseKeys: [],
};

// 1. Empty input must fail clearly, not crash or pretend a result exists.
const empty = runOptimizer({ courses: {}, fixedCourses: [], preferences: prefs });
assert.equal(empty.searchCompleteness, 'exhaustive');
assert.equal(Object.values(empty.byDayCount).flat().length, 0);
assert.match(empty.impossibleDiagnostic?.reason || '', /No valid schedule/i);

// 2. Malformed runtime objects must be rejected safely rather than crashing.
const malformed = runOptimizer({
  courses: { bad: [{ ...(section() as any), id: 123, sessions: null } as any] },
  fixedCourses: [],
  preferences: prefs,
});
assert.equal(malformed.searchCompleteness, 'exhaustive');
assert.equal(Object.values(malformed.byDayCount).flat().length, 0);

// 3. Non-finite/out-of-range preferences must be rejected rather than coerced into undefined behavior.
const badPrefs = runOptimizer({
  courses: {},
  fixedCourses: [],
  preferences: { ...prefs, targetCredits: Number.POSITIVE_INFINITY } as any,
});
assert.equal(badPrefs.searchCompleteness, 'preflight_rejected');
assert.match(badPrefs.impossibleDiagnostic?.reason || '', /target|credits/i);

// 4. Ambiguous OCR time must not silently become 1AM/2AM/etc. until confirmed.
const ambiguous = runOptimizer({
  courses: { tst101: [section({ sessions: [{ id: 'm1', day: 'MON', start: '01:00', end: '02:00', type: 'Lecture', ambiguousTime: true }] })] },
  fixedCourses: [],
  preferences: prefs,
});
assert.equal(ambiguous.searchCompleteness, 'exhaustive');
assert.equal(Object.values(ambiguous.byDayCount).flat().length, 0);
assert.match(ambiguous.impossibleDiagnostic?.reason || '', /No valid schedule/i);
assert.ok(Number.isNaN(timeToMinutes('25:00')));
assert.equal(timeToMinutes('09:30'), 570);

// 5. A legitimate no-solution case must explain the absence rather than return an empty success.
const impossible = runOptimizer({
  courses: {
    a: [section({ id: 'A', name: 'A', courseCode: 'A101', courseKey: 'a', sectionCode: 'A101-01', credits: 3, sessions: [{ day: 'MON', start: '09:00', end: '10:00', type: 'Lecture' }] })],
    b: [section({ id: 'B', name: 'B', courseCode: 'B101', courseKey: 'b', sectionCode: 'B101-01', credits: 3, sessions: [{ day: 'MON', start: '09:30', end: '10:30', type: 'Lecture' }] })],
  },
  fixedCourses: [],
  preferences: { ...prefs, targetCredits: 6, targetCourseCount: 2 },
});
assert.equal(impossible.searchCompleteness, 'exhaustive');
assert.equal(Object.values(impossible.byDayCount).flat().length, 0);
assert.match(impossible.impossibleDiagnostic?.reason || '', /No valid schedule/i);

// 6. Search must stop safely at a finite cap and must report that it is partial.
const manyCourses: Record<string, Section[]> = {};
for (let i = 0; i < 8; i++) {
  manyCourses[`c${i}`] = [section({ id: `C${i}`, name: `C${i}`, courseCode: `C${i}`, courseKey: `c${i}`, sectionCode: `${i}-01`, credits: 1, sessions: [{ day: 'MON', start: `${String(8 + i).padStart(2, '0')}:00`, end: `${String(9 + i).padStart(2, '0')}:00`, type: 'Lecture' }] })];
}
const capped = runOptimizer({
  courses: manyCourses,
  fixedCourses: [],
  preferences: { targetCredits: 4, targetCourseCount: 4, mandatoryCourses: [], mandatoryCourseKeys: [] },
  searchBudget: { maxCourseSubsetNodes: 3, maxSectionNodes: 100 },
});
assert.equal(capped.searchCompleteness, 'capped');
assert.equal(capped.wasCapped, true);
assert.notEqual(capped.searchCompleteness, 'exhaustive');

// 7. Results are bounded to Top 3 per day, avoiding unbounded memory growth.
const options = ['09:00','10:00','11:00','12:00','13:00'].map((start, i) =>
  section({ id: `S${i}`, name: `Course ${i}`, courseCode: `CRS${i}`, courseKey: `crs${i}`, sectionCode: `CRS${i}-01`, credits: 3,
    sessions: [{ day: 'TUE', start, end: `${String(Number(start.slice(0,2))+1).padStart(2,'0')}:00`, type: 'Lecture' }] })
);
const ranked = runOptimizer({
  courses: { a: options },
  fixedCourses: [],
  preferences: { targetCredits: 3, targetCourseCount: 1, mandatoryCourses: [], mandatoryCourseKeys: [] },
});
assert.ok((ranked.byDayCount[1] || []).length <= 3);

// 8. Export must reject conflicts and unresolved ambiguity.
const overlapping: OptimizationResult = {
  id: 'bad', sections: [
    section({ id: 'A', name: 'A', courseKey: 'a', courseCode: 'A', sectionCode: 'A-01' }),
    section({ id: 'B', name: 'B', courseKey: 'b', courseCode: 'B', sectionCode: 'B-01' }),
  ],
  days: ['MON'], numDays: 1, totalGap: 0, totalCredits: 6, earliestStartMinutes: 540, latestEndMinutes: 600,
};
assert.throws(() => assertExportableSchedule(overlapping), /conflict/i);

const ambiguousExport: OptimizationResult = {
  ...overlapping,
  sections: [section({ sessions: [{ day: 'MON', start: '01:00', end: '02:00', type: 'Lecture', ambiguousTime: true }] })],
};
assert.throws(() => assertExportableSchedule(ambiguousExport), /ambiguous/i);

const valid: OptimizationResult = {
  ...overlapping,
  id: 'good',
  sections: [section()],
};
assert.doesNotThrow(() => assertExportableSchedule(valid));
const ics = generateICS(valid, 1);
assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.ok(ics.endsWith('\r\n'));
assert.match(ics, /BEGIN:VEVENT/);
assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=16/);

console.log('CORE LOGIC AUDIT 3 TESTS: PASS');
