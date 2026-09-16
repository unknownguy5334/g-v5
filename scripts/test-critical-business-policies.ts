import assert from 'node:assert/strict';
import { isMiuEmail } from '../server/authPolicy';
import { getCurrentAcademicContext } from '../server/services/academicContext';
import {
  evaluateScheduleAccess,
  resolvePurchaseContext,
  canStartFreeRun,
  shouldConsumeFreeRun,
} from '../server/services/purePolicies';
import { runOptimizer } from '../server/optimizer/optimizer';
import { generateICS, assertExportableSchedule } from '../src/utils/exportCalendar';
import type { Section, SchedulePreferences } from '../src/types';

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: 'SEC-1', name: 'Test Course', courseCode: 'TST101', sectionCode: 'TST101-01',
    courseKey: 'tst101', credits: 3,
    sessions: [{ id: 'm1', day: 'MON', start: '09:00', end: '10:00', type: 'Lecture' }],
    ...overrides,
  };
}

const prefs: SchedulePreferences = {
  targetCredits: 3, targetCourseCount: 1, mandatoryCourses: [], mandatoryCourseKeys: [],
};

// AUTH: real validation boundaries, not merely "does not throw".
assert.equal(isMiuEmail('student@miuegypt.edu.eg'), true);
assert.equal(isMiuEmail(' Student@MIUEGYPT.EDU.EG '), true);
assert.equal(isMiuEmail('@miuegypt.edu.eg'), false);
assert.equal(isMiuEmail('student@gmail.com'), false);
assert.equal(isMiuEmail('student@miuegypt.edu.eg.evil.com'), false);
assert.equal(isMiuEmail(null), false);

// ACADEMIC TERM: exact boundaries + academic-year roll.
const termCases = [
  ['2026-09-01', 'FALL', '2026–2027'],
  ['2027-01-19', 'FALL', '2026–2027'],
  ['2027-01-20', 'SPRING', '2026–2027'],
  ['2027-06-19', 'SPRING', '2026–2027'],
  ['2027-06-20', 'SUMMER', '2026–2027'],
  ['2027-08-31', 'SUMMER', '2026–2027'],
  ['2027-09-01', 'FALL', '2027–2028'],
] as const;
for (const [date, term, academicYear] of termCases) {
  const context = await getCurrentAcademicContext(new Date(`${date}T12:00:00Z`));
  assert.equal(context.term, term, `term mismatch for ${date}`);
  assert.equal(context.academicYear, academicYear, `academic year mismatch for ${date}`);
}

// PURCHASE: client cannot choose a future/different term.
assert.deepEqual(resolvePurchaseContext('CURRENT_TERM', { academicYear: '2026–2027', term: 'SPRING' }), {
  academicYear: '2026–2027', term: 'SPRING',
});
assert.deepEqual(resolvePurchaseContext('ACADEMIC_YEAR', { academicYear: '2026–2027', term: 'SUMMER' }), {
  academicYear: '2026–2027', term: null,
});

// ACCESS: entitlement scope, revocation, free-run precedence.
const context = { academicYear: '2026–2027' as const, term: 'SPRING' as const };
assert.deepEqual(evaluateScheduleAccess('used', context, []), {
  hasFreeRun: false, hasCurrentTerm: false, hasAcademicYear: false, hasScheduleAccess: false,
});
assert.equal(evaluateScheduleAccess('available', context, []).hasScheduleAccess, true);
assert.equal(evaluateScheduleAccess('used', context, [{ plan: 'CURRENT_TERM', academicYear: '2026–2027', term: 'SPRING', status: 'ACTIVE' }]).hasScheduleAccess, true);
assert.equal(evaluateScheduleAccess('used', context, [{ plan: 'CURRENT_TERM', academicYear: '2026–2027', term: 'FALL', status: 'ACTIVE' }]).hasScheduleAccess, false);
assert.equal(evaluateScheduleAccess('used', context, [{ plan: 'ACADEMIC_YEAR', academicYear: '2026–2027', term: null, status: 'REVOKED' }]).hasScheduleAccess, false);
assert.equal(evaluateScheduleAccess('used', context, [{ plan: 'ACADEMIC_YEAR', academicYear: '2026–2027', term: null, status: 'ACTIVE' }]).hasScheduleAccess, true);

// FREE RUN: resumable while in progress; consumed only after a successful result.
assert.equal(canStartFreeRun('available'), true);
assert.equal(canStartFreeRun('in-progress'), true);
assert.equal(canStartFreeRun('used'), false);
assert.equal(shouldConsumeFreeRun('FREE_RUN', false), false);
assert.equal(shouldConsumeFreeRun('FREE_RUN', true), true);
assert.equal(shouldConsumeFreeRun('PAID', true), false);

// CORE OPTIMIZER: empty/no-solution and valid result behavior.
const empty = runOptimizer({ courses: {}, fixedCourses: [], preferences: prefs });
assert.equal(Object.values(empty.byDayCount).flat().length, 0);
assert.match(empty.impossibleDiagnostic?.reason || '', /No valid schedule/i);
const valid = runOptimizer({ courses: { a: [section()] }, fixedCourses: [], preferences: prefs });
assert.ok((valid.byDayCount[1] || []).length > 0, 'valid schedule should produce a result');

// EXPORT: actual format sanity + invalid-result guard.
assert.doesNotThrow(() => assertExportableSchedule({ ...valid.byDayCount[1]![0] }));
const ics = generateICS(valid.byDayCount[1]![0], 1);
assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.match(ics, /BEGIN:VEVENT/);
assert.ok(ics.endsWith('\r\n'));
console.log('CRITICAL BUSINESS POLICY TESTS: PASS');
