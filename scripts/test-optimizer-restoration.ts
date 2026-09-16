import assert from 'node:assert/strict';
import { runOptimizer } from '../server/optimizer/optimizer';
import type { DayOfWeek, SchedulePreferences, Section, Session } from '../src/types';

const makeSession = (id: string, day: DayOfWeek, start: string, end: string, type = 'Lecture'): Session => ({
  id, day, start, end, type: type as any,
});

const makeSection = (
  id: string,
  courseCode: string,
  name: string,
  credits: number,
  sessions: Session[],
  sectionCode = '01',
): Section => ({
  id,
  courseCode,
  courseKey: `code:${courseCode.toLowerCase()}`,
  name,
  credits,
  sectionCode,
  sessions,
});

const prefs = (overrides: Partial<SchedulePreferences> = {}): SchedulePreferences => ({
  targetCredits: null,
  targetCourseCount: null,
  mandatoryCourses: [],
  mandatoryCourseKeys: [],
  ...overrides,
});

const flatten = (output: ReturnType<typeof runOptimizer>) =>
  Object.values(output.byDayCount).flat();

console.log('=== GADWAL SIMPLIFIED OPTIMIZER REGRESSION TESTS ===');

// 1. Exact course count + exact credits.
{
  const courses = {
    'code:a': [makeSection('a1', 'A', 'A', 3, [makeSession('sa', 'MON', '08:00', '09:00')])],
    'code:b': [makeSection('b1', 'B', 'B', 3, [makeSession('sb', 'TUE', '08:00', '09:00')])],
    'code:c': [makeSection('c1', 'C', 'C', 3, [makeSession('sc', 'WED', '08:00', '09:00')])],
    'code:d': [makeSection('d1', 'D', 'D', 6, [makeSession('sd', 'THU', '08:00', '09:00')])],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 9, targetCourseCount: 3 }),
  });
  assert.ok(flatten(output).length > 0);
  assert.ok(flatten(output).every((s) => s.sections.length === 3 && s.totalCredits === 9));
  console.log('✓ exact course count + exact credits');
}

// 2. Mandatory courses always included.
{
  const courses = {
    'code:m': [makeSection('m1', 'M', 'Mandatory', 3, [makeSession('sm', 'MON', '08:00', '09:00')])],
    'code:e1': [makeSection('e1', 'E1', 'Elective 1', 3, [makeSession('se1', 'TUE', '08:00', '09:00')])],
    'code:e2': [makeSection('e2', 'E2', 'Elective 2', 3, [makeSession('se2', 'WED', '08:00', '09:00')])],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({
      targetCredits: 6,
      targetCourseCount: 2,
      mandatoryCourseKeys: ['code:m'],
    }),
  });
  assert.ok(flatten(output).length > 0);
  assert.ok(flatten(output).every((s) => s.sections.some((sec) => sec.courseCode === 'M')));
  console.log('✓ mandatory inclusion');
}

// 3. No day preference: multiple day buckets are automatically produced.
{
  const courses = {
    'code:a': [
      makeSection('a1', 'A', 'A', 3, [
        makeSession('sa1', 'MON', '08:00', '09:00'),
        makeSession('sa2', 'TUE', '08:00', '09:00'),
      ]),
      makeSection('a2', 'A', 'A', 3, [makeSession('sa2b', 'MON', '08:00', '09:00')]),
    ],
    'code:b': [
      makeSection('b1', 'B', 'B', 3, [makeSession('sb1', 'WED', '08:00', '09:00')]),
      makeSection('b2', 'B', 'B', 3, [makeSession('sb2', 'TUE', '10:00', '11:00')]),
    ],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  assert.ok((output.totalFoundByDay[2] || 0) > 0);
  assert.ok((output.totalFoundByDay[3] || 0) > 0);
  assert.equal(output.byDayCount[1]?.length, 0);
  console.log('✓ automatic 1..7 campus-day grouping');
}

// 4. Gap-only ranking.
{
  const courses = {
    'code:a': [
      makeSection('a1', 'A', 'A', 3, [
        makeSession('a1m', 'MON', '08:00', '09:00'),
        makeSession('a1x', 'MON', '13:00', '14:00'),
      ]),
      makeSection('a2', 'A', 'A', 3, [
        makeSession('a2m', 'MON', '08:00', '09:00'),
        makeSession('a2x', 'MON', '10:00', '11:00'),
      ]),
    ],
    'code:b': [
      makeSection('b1', 'B', 'B', 3, [makeSession('b1m', 'TUE', '08:00', '09:00')]),
    ],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  const twoDay = output.byDayCount[2] || [];
  assert.ok(twoDay.length >= 2);
  assert.ok(twoDay[0].totalGap <= twoDay[1].totalGap);
  console.log('✓ gap-only ranking');
}

// 5. Top 3 per bucket, not one selected bucket.
{
  const courses = {
    'code:a': [makeSection('a', 'A', 'A', 3, [makeSession('a', 'MON', '08:00', '09:00')])],
    'code:b': [makeSection('b', 'B', 'B', 3, [makeSession('b', 'TUE', '08:00', '09:00')])],
    'code:c': [makeSection('c', 'C', 'C', 3, [makeSession('c', 'WED', '08:00', '09:00')])],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  for (const day of [1,2,3,4,5,6,7]) assert.ok((output.byDayCount[day] || []).length <= 3);
  console.log('✓ top 3 per bucket');
}

// 6. Section/tutorial sessions count for conflicts.
{
  const courses = {
    'code:a': [makeSection('a', 'A', 'A', 3, [
      makeSession('al', 'MON', '08:00', '09:00', 'Lecture'),
      makeSession('at', 'MON', '10:00', '12:00', 'Tutorial'),
    ])],
    'code:b': [makeSection('b', 'B', 'B', 3, [makeSession('b', 'MON', '11:00', '12:30')])],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  assert.equal(flatten(output).length, 0);
  console.log('✓ secondary sessions participate in conflicts');
}

// 7. Back-to-back sessions are valid.
{
  const courses = {
    'code:a': [makeSection('a', 'A', 'A', 3, [makeSession('a', 'MON', '08:00', '09:00')])],
    'code:b': [makeSection('b', 'B', 'B', 3, [makeSession('b', 'MON', '09:00', '10:00')])],
  };
  const output = runOptimizer({
    courses,
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  assert.ok(flatten(output).length > 0);
  assert.equal(flatten(output)[0].totalGap, 0);
  console.log('✓ back-to-back sessions');
}

// 8. Full search does not cap away a late optimal section combination.
{
  const aSections = Array.from({ length: 80 }, (_, i) =>
    makeSection(`a${i}`, 'A', 'A', 3, [makeSession(`sa${i}`, 'MON', `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:00`, `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:30`)], String(i)),
  );
  const bSections = [
    makeSection('b1', 'B', 'B', 3, [makeSession('b1', 'MON', '15:00', '16:00')]),
    makeSection('b2', 'B', 'B', 3, [makeSession('b2', 'MON', '08:30', '09:00')]),
  ];
  const output = runOptimizer({
    courses: { 'code:a': aSections, 'code:b': bSections },
    fixedCourses: [],
    preferences: prefs({ targetCredits: 6, targetCourseCount: 2 }),
  });
  assert.equal(output.searchCompleteness, 'exhaustive');
  assert.ok((output.totalFoundByDay[1] || 0) > 0);
  console.log('✓ exhaustive full search');
}

console.log('ALL OPTIMIZER RESTORATION TESTS PASSED');
