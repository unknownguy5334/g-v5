import {
  AchievableCreditSummary,
  DayOfWeek,
  OptimizationResult,
  OptimizerOutput,
  SchedulePreferences,
  Section,
  Session,
} from '../../src/types';
import { recordPerformanceMetric, startPerformanceTimer } from '../../src/utils/performanceTelemetry';
import { formatCourseDisplay, getCourseIdentityKey, getScheduleSignature } from '../../src/utils/courseUtils';
import { TARGET_COURSE_COUNT_MAX, isValidTargetCredits } from '../../src/utils/preferenceValidation';
import {
  ALL_DAYS,
  DAYS,
  getScheduleDailySpanMinutes,
  compareSchedules,
  normalizeDay,
  timeToMinutes,
  formatMinutes,
  formatTime12,
  findSessionConflict,
  conflicts,
  sessionsConflict,
  hasInternalConflict,
} from './optimizerCore';

export {
  ALL_DAYS,
  DAYS,
  getScheduleDailySpanMinutes,
  compareSchedules,
  normalizeDay,
  timeToMinutes,
  formatMinutes,
  formatTime12,
  findSessionConflict,
  conflicts,
  sessionsConflict,
  hasInternalConflict,
} from './optimizerCore';

const DEFAULT_DAY_BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const RESULT_LIMIT_PER_DAY = 3;
const MAX_SECTIONS_INPUT = 500;
const EPSILON = 0.001;

export interface OptimizerSearchBudget {
  maxCourseSubsetNodes: number;
  maxSectionNodes: number;
  maxResultsRetained: number;
  maxEstimatesAllowed?: number;
}

export const DEFAULT_SEARCH_BUDGET: OptimizerSearchBudget = {
  // Hard safety ceilings for real user searches. The previous unlimited full-search mode
  // could freeze the browser on a large section catalog. Results remain explicitly marked
  // as capped when a ceiling is reached, never silently presented as exhaustive.
  maxCourseSubsetNodes: 100_000,
  maxSectionNodes: 500_000,
  maxResultsRetained: 3,
};

export const ESTIMATE_SEARCH_BUDGET: OptimizerSearchBudget = {
  maxCourseSubsetNodes: 8_000,
  maxSectionNodes: 20_000,
  maxResultsRetained: 7,
};

export const DIAGNOSTIC_SEARCH_BUDGET: OptimizerSearchBudget = {
  maxCourseSubsetNodes: 1_500,
  maxSectionNodes: 5_000,
  maxResultsRetained: 7,
};

type OptimizerMode = 'full' | 'estimate' | 'diagnostic';

type CreditState = {
  status: 'known' | 'unknown' | 'conflicting';
  value: number | null;
};

type NormalizedSection = {
  section: Section;
  sessions: Array<{ day: DayOfWeek; start: number; end: number; session: Session }>;
  days: Set<DayOfWeek>;
  credit: number | null;
};

type SearchState = {
  sections: Section[];
  intervalsByDay: Record<DayOfWeek, Array<{ start: number; end: number }>>;
  occupiedDays: Set<DayOfWeek>;
  totalGap: number;
  totalCredits: number;
  earliestStartMinutes: number;
  latestEndMinutes: number;
};

type SearchControl = {
  mode: OptimizerMode;
  budget: OptimizerSearchBudget;
  courseSubsetNodes: number;
  sectionNodes: number;
  capped: boolean;
  cancelled: boolean;
  shouldCancel?: () => boolean;
};

export interface OptimizerParams {
  courses: Record<string, Section[]>;
  fixedCourses: Section[];
  targetCredits?: number;
  preferences: SchedulePreferences;
  shouldCancel?: () => boolean;
  mode?: OptimizerMode;
  searchBudget?: Partial<OptimizerSearchBudget>;
}

function resolveBudget(partial?: Partial<OptimizerSearchBudget>, mode: OptimizerMode = 'full'): OptimizerSearchBudget {
  const base = mode === 'estimate' ? ESTIMATE_SEARCH_BUDGET : mode === 'diagnostic' ? DIAGNOSTIC_SEARCH_BUDGET : DEFAULT_SEARCH_BUDGET;
  return {
    maxCourseSubsetNodes: Math.max(1, Math.floor(partial?.maxCourseSubsetNodes ?? base.maxCourseSubsetNodes)),
    maxSectionNodes: Math.max(1, Math.floor(partial?.maxSectionNodes ?? base.maxSectionNodes)),
    maxResultsRetained: Math.max(1, Math.floor(partial?.maxResultsRetained ?? base.maxResultsRetained)),
  };
}

function createSearchControl(params: OptimizerParams, mode: OptimizerMode): SearchControl {
  return {
    mode,
    budget: resolveBudget(params.searchBudget, mode),
    courseSubsetNodes: 0,
    sectionNodes: 0,
    capped: false,
    cancelled: false,
    shouldCancel: params.shouldCancel,
  };
}

function stopRequested(control: SearchControl): boolean {
  if (control.cancelled) return true;
  if (control.shouldCancel?.()) {
    control.cancelled = true;
    return true;
  }
  return false;
}

function markCourseNode(control: SearchControl): boolean {
  if (stopRequested(control)) return false;
  control.courseSubsetNodes += 1;
  if (Number.isFinite(control.budget.maxCourseSubsetNodes) && control.courseSubsetNodes > control.budget.maxCourseSubsetNodes) {
    control.capped = true;
    return false;
  }
  return true;
}

function markSectionNode(control: SearchControl): boolean {
  if (stopRequested(control)) return false;
  control.sectionNodes += 1;
  if (Number.isFinite(control.budget.maxSectionNodes) && control.sectionNodes > control.budget.maxSectionNodes) {
    control.capped = true;
    return false;
  }
  return true;
}

function uniqueCourseMap(courses: Record<string, Section[]>): Record<string, Section[]> {
  const normalized: Record<string, Section[]> = {};

  for (const [rawDisplay, sections] of Object.entries(courses || {})) {
    const candidates = Array.isArray(sections) ? sections : [];
    if (candidates.length === 0) continue;
    const fallbackName = rawDisplay.includes(':') ? rawDisplay.slice(rawDisplay.indexOf(':') + 1).trim() : rawDisplay.trim();
    const first = candidates[0];
    const courseKey = first?.courseKey || getCourseIdentityKey(first?.courseCode || null, first?.name || fallbackName);
    if (!courseKey) continue;
    if (!normalized[courseKey]) normalized[courseKey] = [];

    for (const section of candidates) {
      const normalizedSection: Section = {
        ...section,
        courseKey,
        name: section.name?.trim() || first.name?.trim() || fallbackName,
      };
      normalized[courseKey].push(normalizedSection);
    }
  }

  for (const courseKey of Object.keys(normalized)) {
    const seen = new Set<string>();
    normalized[courseKey] = normalized[courseKey].filter((section) => {
      const sectionId = typeof section.id === 'string' ? section.id.trim().toLowerCase() : '';
      const sectionCode = typeof section.sectionCode === 'string' ? section.sectionCode.trim().toLowerCase() : '';
      const signature = `${sectionId}:::${sectionCode}:::${(Array.isArray(section.sessions) ? section.sessions : [])
        .map((session) => `${session.day}:${session.start}-${session.end}:${session.type || ''}:${session.type === 'Custom' ? (session.customType || '').trim().toLowerCase() : ''}`)
        .sort()
        .join('|')}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  return normalized;
}

function mandatoryCourseKeys(preferences: SchedulePreferences): Set<string> {
  return new Set((preferences.mandatoryCourseKeys || [])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim().toLowerCase()));
}

function normalizeCreditState(sections: Section[]): CreditState {
  const values = sections
    .flatMap((section) => {
      if (Array.isArray(section.creditHoursConflict) && section.creditHoursConflict.length > 1) {
        return section.creditHoursConflict.filter((value) => Number.isFinite(value));
      }
      return Number.isFinite(section.credits ?? NaN) ? [Number(section.credits)] : [];
    })
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return { status: 'unknown', value: null };
  const unique = Array.from(new Set(values.map((value) => Math.round(value * 1000) / 1000)));
  if (unique.length !== 1) return { status: 'conflicting', value: null };
  return { status: 'known', value: unique[0] };
}

function normalizeSection(section: Section): NormalizedSection | null {
  if (!section || typeof section !== 'object' || !Array.isArray(section.sessions) || section.sessions.length === 0) return null;
  if (hasInternalConflict(section.sessions)) return null;

  const sessions: NormalizedSection['sessions'] = [];
  const days = new Set<DayOfWeek>();
  for (const session of section.sessions) {
    if (session?.ambiguousTime && !session?.resolvedFromAmbiguousTime) return null;
    const day = normalizeDay(session?.day);
    const start = timeToMinutes(session?.start);
    const end = timeToMinutes(session?.end);
    // Gadwal currently models every schedulable meeting as a real day/time interval.
    // Missing day/time data is therefore intentionally invalid rather than inferred.
    if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
    sessions.push({ day, start, end, session: { ...session, day } });
    days.add(day);
  }
  return {
    section,
    sessions,
    days,
    credit: Number.isFinite(section.credits ?? NaN) ? Number(section.credits) : null,
  };
}

function validateSection(section: Section): boolean {
  return normalizeSection(section) !== null;
}

function fixedCourseKeys(fixedCourses: Section[]): string[] {
  return fixedCourses.map((section) => {
    const raw = typeof section.courseKey === 'string' && section.courseKey.trim()
      ? section.courseKey
      : getCourseIdentityKey(section.courseCode, section.name);
    return typeof raw === 'string' ? raw.trim() : '';
  }).filter(Boolean);
}

function fixedConflict(fixedCourses: Section[]): { invalid: boolean; duplicateCourseKey?: string } {
  const seen = new Set<string>();
  for (let i = 0; i < fixedCourses.length; i += 1) {
    if (!validateSection(fixedCourses[i])) return { invalid: true };
    const key = fixedCourseKeys([fixedCourses[i]])[0].toLowerCase();
    if (seen.has(key)) return { invalid: false, duplicateCourseKey: key };
    seen.add(key);
    for (let j = i + 1; j < fixedCourses.length; j += 1) {
      if (sessionsConflict(fixedCourses[i].sessions, fixedCourses[j].sessions)) return { invalid: true };
    }
  }
  return { invalid: false };
}

function conflictsWithChosen(candidate: Section, fixedCourses: Section[], chosen: Section[]): boolean {
  for (const fixed of fixedCourses) {
    if (sessionsConflict(fixed.sessions, candidate.sessions)) return true;
  }
  for (const current of chosen) {
    if (sessionsConflict(current.sessions, candidate.sessions)) return true;
  }
  return false;
}

export function calculateMetrics(sections: Section[]): {
  days: DayOfWeek[];
  numDays: number;
  totalGap: number;
  totalCredits: number;
  earliestStartMinutes: number;
  latestEndMinutes: number;
} | null {
  const daySessions: Record<DayOfWeek, Session[]> = { SAT: [], SUN: [], MON: [], TUE: [], WED: [], THU: [], FRI: [] };
  let totalCredits = 0;
  let earliestStartMinutes = Number.POSITIVE_INFINITY;
  let latestEndMinutes = 0;

  for (const section of sections) {
    if (Number.isFinite(section.credits ?? NaN)) totalCredits += Number(section.credits);
    for (const session of section.sessions) {
      const day = normalizeDay(session.day);
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
      daySessions[day].push({ ...session, day });
      earliestStartMinutes = Math.min(earliestStartMinutes, start);
      latestEndMinutes = Math.max(latestEndMinutes, end);
    }
  }

  const days = ALL_DAYS.filter((day) => daySessions[day].length > 0);
  let totalGap = 0;
  for (const day of ALL_DAYS) {
    const sessionsForDay = [...daySessions[day]].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    let previousEnd = -Infinity;
    for (let i = 0; i < sessionsForDay.length; i += 1) {
      const sStart = timeToMinutes(sessionsForDay[i].start);
      const sEnd = timeToMinutes(sessionsForDay[i].end);
      if (Number.isFinite(previousEnd) && sStart > previousEnd) {
        totalGap += (sStart - previousEnd);
      }
      previousEnd = Number.isFinite(previousEnd) ? Math.max(previousEnd, sEnd) : sEnd;
    }
  }

  return {
    days,
    numDays: days.length,
    totalGap,
    totalCredits,
    earliestStartMinutes: Number.isFinite(earliestStartMinutes) ? earliestStartMinutes : 0,
    latestEndMinutes,
  };
}

function createEmptySearchState(): SearchState {
  return {
    sections: [],
    intervalsByDay: { SAT: [], SUN: [], MON: [], TUE: [], WED: [], THU: [], FRI: [] },
    occupiedDays: new Set(),
    totalGap: 0,
    totalCredits: 0,
    earliestStartMinutes: Number.POSITIVE_INFINITY,
    latestEndMinutes: 0,
  };
}

function insertInterval(state: SearchState, day: DayOfWeek, start: number, end: number): void {
  const list = state.intervalsByDay[day];
  let index = 0;
  while (index < list.length && list[index].start < start) index += 1;
  const previous = list[index - 1];
  const next = list[index];
  if (previous && next) state.totalGap -= Math.max(0, next.start - previous.end);
  if (previous) state.totalGap += Math.max(0, start - previous.end);
  if (next) state.totalGap += Math.max(0, next.start - end);
  list.splice(index, 0, { start, end });
}

function removeInterval(state: SearchState, day: DayOfWeek, start: number, end: number): void {
  const list = state.intervalsByDay[day];
  const index = list.findIndex((item) => item.start === start && item.end === end);
  if (index < 0) return;
  const previous = list[index - 1];
  const next = list[index + 1];
  if (previous) state.totalGap -= Math.max(0, start - previous.end);
  if (next) state.totalGap -= Math.max(0, next.start - end);
  if (previous && next) state.totalGap += Math.max(0, next.start - previous.end);
  list.splice(index, 1);
}

function addNormalizedSection(state: SearchState, normalized: NormalizedSection): void {
  for (const session of normalized.sessions) insertInterval(state, session.day, session.start, session.end);
  for (const day of normalized.days) state.occupiedDays.add(day);
  state.sections.push(normalized.section);
  if (normalized.credit != null) state.totalCredits += normalized.credit;
  for (const session of normalized.sessions) {
    state.earliestStartMinutes = Math.min(state.earliestStartMinutes, session.start);
    state.latestEndMinutes = Math.max(state.latestEndMinutes, session.end);
  }
}

function removeNormalizedSection(state: SearchState, normalized: NormalizedSection): void {
  for (let i = normalized.sessions.length - 1; i >= 0; i -= 1) {
    const session = normalized.sessions[i];
    removeInterval(state, session.day, session.start, session.end);
  }
  state.sections.pop();
  if (normalized.credit != null) state.totalCredits -= normalized.credit;
  state.occupiedDays.clear();
  for (const section of state.sections) {
    for (const session of section.sessions) {
      const day = normalizeDay(session.day);
      if (day) state.occupiedDays.add(day);
    }
  }
  state.earliestStartMinutes = Number.POSITIVE_INFINITY;
  state.latestEndMinutes = 0;
  for (const section of state.sections) {
    for (const session of section.sessions) {
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (Number.isFinite(start)) state.earliestStartMinutes = Math.min(state.earliestStartMinutes, start);
      if (Number.isFinite(end)) state.latestEndMinutes = Math.max(state.latestEndMinutes, end);
    }
  }
}

function stateToMetrics(state: SearchState): ReturnType<typeof calculateMetrics> {
  return {
    days: ALL_DAYS.filter((day) => state.intervalsByDay[day].length > 0),
    numDays: state.occupiedDays.size,
    totalGap: state.totalGap,
    totalCredits: Math.round(state.totalCredits * 1000) / 1000,
    earliestStartMinutes: Number.isFinite(state.earliestStartMinutes) ? state.earliestStartMinutes : 0,
    latestEndMinutes: state.latestEndMinutes,
  };
}

export function compareSchedulesForPreferences(a: OptimizationResult, b: OptimizationResult, _preferences?: SchedulePreferences): number {
  const gapDiff = compareSchedules(a, b);
  if (gapDiff !== 0) return gapDiff;
  const dayDiff = a.numDays - b.numDays;
  if (dayDiff !== 0) return dayDiff;
  return 0;
}

export function compareSchedulesDeterministically(a: OptimizationResult, b: OptimizationResult, preferences?: SchedulePreferences): number {
  const rankingDiff = compareSchedulesForPreferences(a, b, preferences);
  if (rankingDiff !== 0) return rankingDiff;
  return getScheduleSignature(a).localeCompare(getScheduleSignature(b));
}

function canAddSectionEarly(
  normalized: NormalizedSection,
  state: SearchState,
): boolean {
  for (const session of normalized.sessions) {
    const existing = state.intervalsByDay[session.day];
    for (const interval of existing) {
      if (session.start < interval.end && interval.start < session.end) return false;
    }
  }
  return true;
}

/** Shared section-branch traversal used by every search mode. The caller owns
 * constraint/state updates through onSection and receives one immutable leaf list. */
function enumerateSectionCombinations(
  sectionLists: Section[][],
  control: SearchControl,
  onSection: (section: Section, chosen: Section[]) => (() => void) | null,
  onLeaf: (chosen: Section[]) => void,
): void {
  const chosen: Section[] = [];
  const visit = (depth: number) => {
    if (!markSectionNode(control)) return;
    if (depth === sectionLists.length) {
      onLeaf([...chosen]);
      return;
    }
    for (const section of sectionLists[depth] || []) {
      if (stopRequested(control)) return;
      const undo = onSection(section, chosen);
      if (!undo) continue;
      chosen.push(section);
      visit(depth + 1);
      chosen.pop();
      undo();
    }
  };
  visit(0);
}

/** Shared exhaustive traversal used by both the normal optimizer and achievable-credit analysis. */
function enumerateCourseSubsets(
  subjects: string[],
  mandatorySubjects: string[],
  targetCourseCount: number | null,
  targetCredits: number | null,
  creditsByCourse: Map<string, number>,
  onSubset: (subset: string[]) => void,
  control?: SearchControl,
  fixedCount = 0,
): void {
  const mandatorySet = new Set(mandatorySubjects);
  const electiveSubjects = subjects.filter((subject) => !mandatorySet.has(subject));
  const mandatoryCredits = mandatorySubjects.reduce((sum, key) => sum + (creditsByCourse.get(key) ?? 0), 0);
  const remainingTarget = targetCredits == null ? null : targetCredits - mandatoryCredits;
  if (remainingTarget != null && remainingTarget < -EPSILON) return;

  const chosen: string[] = [];
  const recurse = (index: number, currentCredits: number) => {
    if (control && !markCourseNode(control)) return;
    if (index >= electiveSubjects.length) {
      if (remainingTarget != null && Math.abs(currentCredits - remainingTarget) > EPSILON) return;
      if (targetCourseCount != null && fixedCount + mandatorySubjects.length + chosen.length !== targetCourseCount) return;
      const subset = [...mandatorySubjects, ...chosen];
      if (subset.length > 0 || fixedCount > 0) onSubset(subset);
      return;
    }

    const remainingCount = electiveSubjects.length - index;
    if (targetCourseCount != null) {
      const needed = targetCourseCount - fixedCount - mandatorySubjects.length - chosen.length;
      if (needed < 0 || needed > remainingCount) return;
    }

    const subject = electiveSubjects[index];
    recurse(index + 1, currentCredits);

    const credit = creditsByCourse.get(subject);
    if (remainingTarget != null && credit == null) return;
    const nextCredits = currentCredits + (credit ?? 0);
    if (remainingTarget != null && nextCredits > remainingTarget + EPSILON) return;
    chosen.push(subject);
    recurse(index + 1, nextCredits);
    chosen.pop();
  };

  if (electiveSubjects.length === 0) {
    if (targetCourseCount == null || fixedCount + mandatorySubjects.length === targetCourseCount) {
      if (remainingTarget == null || Math.abs(remainingTarget) <= EPSILON) onSubset([...mandatorySubjects]);
    }
    return;
  }
  recurse(0, 0);
}

export function runOptimizer({
  courses,
  fixedCourses,
  preferences,
  shouldCancel,
  mode = 'full',
  searchBudget,
}: OptimizerParams): OptimizerOutput {
  const perfTimer = startPerformanceTimer();
  const safeCourses = (courses && typeof courses === 'object' && !Array.isArray(courses)) ? courses : {};
  const safeFixedCourses = Array.isArray(fixedCourses) ? fixedCourses.filter((section): section is Section => !!section && typeof section === 'object') : [];
  const safePreferences: SchedulePreferences = {
    targetCredits: isValidTargetCredits(preferences?.targetCredits) && preferences.targetCredits > 0 ? preferences.targetCredits : null,
    targetCourseCount: Number.isInteger(preferences?.targetCourseCount) && Number(preferences.targetCourseCount) > 0 && Number(preferences.targetCourseCount) <= TARGET_COURSE_COUNT_MAX
      ? Number(preferences.targetCourseCount)
      : null,
    mandatoryCourses: Array.isArray(preferences?.mandatoryCourses) ? preferences.mandatoryCourses.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [],
    mandatoryCourseKeys: Array.isArray(preferences?.mandatoryCourseKeys) ? preferences.mandatoryCourseKeys.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [],
  };
  const normalizedCourses = uniqueCourseMap(safeCourses);
  const rawSectionCount = Object.values(normalizedCourses).reduce((sum, list) => sum + list.length, safeFixedCourses.length);
  if (rawSectionCount > MAX_SECTIONS_INPUT) {
    return {
      allSectionsConsidered: [],
      allRankedSchedules: [],
      byDayCount: Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, []])) as Record<number, OptimizationResult[]>,
      totalFoundByDay: Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, 0])),
      totalCombinationsEvaluated: 0,
      searchCompleteness: 'preflight_rejected',
      wasCapped: false,
      wasSampled: false,
      searchStats: { candidateCourseSubsets: 0, schedulesEvaluated: 0, schedulesReturned: 0 },
      preferencesUsed: safePreferences,
      impossibleDiagnostic: {
        reason: `This search contains ${rawSectionCount} sections, which is above the safe maximum of ${MAX_SECTIONS_INPUT} sections.`,
        suggestion: 'Reduce duplicate/unused sections or split the search into smaller course sets, then try again.',
      },
    };
  }
  const fixed = safeFixedCourses
    ? safeFixedCourses.map((section) => ({
        ...section,
        courseKey: typeof section.courseKey === 'string' && section.courseKey.trim() ? section.courseKey.trim() : getCourseIdentityKey(section.courseCode, section.name),
      }))
    : [];

  const allSections = [...fixed, ...Object.values(normalizedCourses).flat()];
  const output: OptimizerOutput = {
    allSectionsConsidered: allSections,
    allRankedSchedules: [],
    byDayCount: Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, []])) as Record<number, OptimizationResult[]>,
    totalFoundByDay: Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, 0])),
    totalCombinationsEvaluated: 0,
    searchCompleteness: 'not_searched',
    wasCapped: false,
    wasSampled: false,
    searchStats: { candidateCourseSubsets: 0, schedulesEvaluated: 0, schedulesReturned: 0 },
    preferencesUsed: safePreferences,
  };

  const control = createSearchControl(
    { courses: safeCourses, fixedCourses: fixed, preferences: safePreferences, shouldCancel, mode, searchBudget },
    mode,
  );

  const fixedConflictState = fixedConflict(fixed);
  if (fixedConflictState.invalid) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: 'One or more selected sections have invalid or overlapping meeting times.',
      suggestion: 'Review the selected section meeting times.',
    };
    return output;
  }
  if (fixedConflictState.duplicateCourseKey) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `The fixed schedule contains more than one section of the same course (${fixedConflictState.duplicateCourseKey}).`,
      suggestion: 'Keep only one section for each course before building.',
    };
    return output;
  }

  const fixedKeys = new Set(fixedCourseKeys(fixed).map((key) => key.toLowerCase()));
  const candidateSubjects = Object.keys(normalizedCourses)
    .filter((key) => !fixedKeys.has(key.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const mandatorySet = mandatoryCourseKeys(safePreferences);
  const displayByCourseKey = new Map<string, string>();
  for (const [courseKey, sections] of Object.entries(normalizedCourses)) {
    const section = sections[0];
    displayByCourseKey.set(
      courseKey,
      formatCourseDisplay(section?.courseCode, section?.name) || courseKey,
    );
  }

  const validCourses: Record<string, Section[]> = {};
  const creditsByCourse = new Map<string, number>();
  for (const subject of candidateSubjects) {
    const valid = (normalizedCourses[subject] || []).filter(validateSection);
    if (valid.length > 0) validCourses[subject] = valid;
    const creditState = normalizeCreditState(valid);
    if (creditState.status === 'known' && creditState.value != null) {
      creditsByCourse.set(subject, creditState.value);
    }
  }

  const mandatorySubjects = candidateSubjects.filter((key) => mandatorySet.has(key.toLowerCase()));
  const missingMandatoryCourses = Array.from(mandatorySet)
    .filter((required) =>
      !fixedKeys.has(required.toLowerCase()) &&
      !candidateSubjects.some((candidate) => candidate.toLowerCase() === required.toLowerCase()))
    .map((required) => displayByCourseKey.get(required) || required);

  const unschedulableMandatory = mandatorySubjects
    .filter((key) => (validCourses[key] || []).length === 0)
    .map((key) => displayByCourseKey.get(key) || key);

  if (missingMandatoryCourses.length > 0 || unschedulableMandatory.length > 0) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `A required course could not be scheduled: ${[...missingMandatoryCourses, ...unschedulableMandatory].join(', ')}.`,
      suggestion: 'Add or repair a valid section for every required course.',
    };
    return output;
  }

  const targetCredits = safePreferences.targetCredits != null
    ? Number(safePreferences.targetCredits)
    : null;
  const targetCourseCount = safePreferences.targetCourseCount != null
    ? Math.floor(Number(safePreferences.targetCourseCount))
    : null;

  if (targetCredits == null || targetCourseCount == null) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: 'Choose your total credits and total number of courses before searching.',
      suggestion: 'Enter both values, then search again.',
    };
    return output;
  }

  const fixedCreditStates = fixed.map((section) => normalizeCreditState([section]));
  if (fixedCreditStates.some((state) => state.status !== 'known')) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: 'A selected course has missing or conflicting credit information, so the exact credit target cannot be verified.',
      suggestion: 'Review the credit value for each selected course.',
    };
    return output;
  }

  const fixedCredits = fixedCreditStates.reduce((sum, state) => sum + (state.value ?? 0), 0);
  if (fixed.length > targetCourseCount) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `The fixed schedule already contains ${fixed.length} courses, above your target of ${targetCourseCount}.`,
      suggestion: 'Increase the course target or remove one fixed course.',
    };
    return output;
  }
  if (fixedCredits > targetCredits + EPSILON) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `Your fixed courses already total ${fixedCredits} credits, above the ${targetCredits}-credit target.`,
      suggestion: 'Increase the target credits or change the fixed courses.',
    };
    return output;
  }

  const mandatoryCourseCount = fixed.length + mandatorySubjects.length;
  if (mandatoryCourseCount > targetCourseCount) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `Your mandatory courses already require ${mandatoryCourseCount} courses, above your target of ${targetCourseCount}.`,
      suggestion: 'Increase your course target or unmark a course as mandatory.',
    };
    return output;
  }

  const mandatoryCreditTotal =
    fixedCredits +
    mandatorySubjects.reduce((sum, key) => sum + (creditsByCourse.get(key) ?? 0), 0);
  if (mandatoryCreditTotal > targetCredits + EPSILON) {
    output.searchCompleteness = 'preflight_rejected';
    output.impossibleDiagnostic = {
      reason: `Mandatory courses require ${mandatoryCreditTotal} credits, which exceeds your target of ${targetCredits} credits.`,
      suggestion: 'Increase your target credits or unmark a course as mandatory.',
    };
    return output;
  }

  const topByDay: Record<number, OptimizationResult[]> =
    Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, []]));
  const resultCounts: Record<number, number> =
    Object.fromEntries(DEFAULT_DAY_BUCKETS.map((day) => [day, 0]));
  let scheduleId = 0;

  const considerCandidate = (
    sections: Section[],
    metrics: NonNullable<ReturnType<typeof calculateMetrics>>,
  ) => {
    if (metrics.numDays < 1 || metrics.numDays > 7) return;
    const candidate: OptimizationResult = {
      id: `sch-${++scheduleId}`,
      sections: [...sections],
      days: metrics.days,
      numDays: metrics.numDays,
      totalGap: metrics.totalGap,
      totalCredits: metrics.totalCredits,
      creditsComplete: sections.every(
        (section) =>
          Number.isFinite(section.credits ?? NaN) &&
          !(Array.isArray(section.creditHoursConflict) && section.creditHoursConflict.length > 1),
      ),
      earliestStartMinutes: metrics.earliestStartMinutes,
      latestEndMinutes: metrics.latestEndMinutes,
    };
    resultCounts[metrics.numDays] += 1;
    const bucket = topByDay[metrics.numDays];
    bucket.push(candidate);
    bucket.sort(compareSchedulesDeterministically);
    if (bucket.length > RESULT_LIMIT_PER_DAY) bucket.length = RESULT_LIMIT_PER_DAY;
  };

  const processSubset = (subset: string[]) => {
    if (stopRequested(control)) return;
    output.searchStats!.candidateCourseSubsets += 1;

    const sectionLists = subset.map((subject) => validCourses[subject] || []);
    if (sectionLists.some((list) => list.length === 0)) return;

    const currentState = createEmptySearchState();
    for (const fixedSection of fixed) {
      const normalized = normalizeSection(fixedSection);
      if (!normalized) return;
      addNormalizedSection(currentState, normalized);
    }

    enumerateSectionCombinations(
      sectionLists,
      control,
      (section, chosen) => {
        const normalized = normalizeSection(section);
        if (!normalized) return null;
        const courseKey = normalized.section.courseKey || getCourseIdentityKey(
          normalized.section.courseCode,
          normalized.section.name,
        );
        if (
          chosen.some(
            (item) =>
              (item.courseKey || getCourseIdentityKey(item.courseCode, item.name)) === courseKey,
          )
        ) return null;
        if (!canAddSectionEarly(normalized, currentState)) return null;
        if (conflictsWithChosen(normalized.section, fixed, chosen)) return null;
        addNormalizedSection(currentState, normalized);
        return () => removeNormalizedSection(currentState, normalized);
      },
      (chosen) => {
        output.totalCombinationsEvaluated += 1;
        output.searchStats!.schedulesEvaluated += 1;
        const metrics = stateToMetrics(currentState);
        if (Math.abs(metrics.totalCredits - targetCredits) > EPSILON) return;
        if (chosen.length !== targetCourseCount) return;

        const verified = calculateMetrics(chosen);
        if (!verified) return;
        if (Math.abs(verified.totalCredits - targetCredits) > EPSILON) return;
        if (verified.numDays < 1 || verified.numDays > 7) return;

        considerCandidate(chosen, verified);
      },
    );
  };

  const subsetSubjects = candidateSubjects;
  const exactTargetCredits = targetCredits - fixedCredits;

  enumerateCourseSubsets(
    subsetSubjects,
    mandatorySubjects,
    targetCourseCount,
    exactTargetCredits,
    creditsByCourse,
    processSubset,
    control,
    fixed.length,
  );

  if (control.cancelled) {
    output.searchCompleteness = 'cancelled';
  } else if (control.capped) {
    output.searchCompleteness = 'capped';
  } else {
    output.searchCompleteness = 'exhaustive';
  }
  output.wasCapped = control.capped;

  for (const dayCount of DEFAULT_DAY_BUCKETS) {
    const bucket = topByDay[dayCount];
    // Preserve the actual ranking comparator used while candidates are admitted.
    // Sorting by signature here would overwrite gap/day ranking and could return a
    // worse schedule ahead of a better one.
    bucket.sort(compareSchedulesDeterministically);
    output.byDayCount[dayCount] = bucket.slice(0, RESULT_LIMIT_PER_DAY).map((schedule, index) => ({
      ...schedule,
      categoryRank: index + 1,
      scheduleSignature: getScheduleSignature(schedule),
      isTie: false,
      tieReason: undefined,
    }));
    output.totalFoundByDay[dayCount] = resultCounts[dayCount];
  }

  output.searchStats!.schedulesReturned =
    DEFAULT_DAY_BUCKETS.reduce((sum, day) => sum + output.byDayCount[day].length, 0);
  output.searchStats!.courseSubsetNodes = control.courseSubsetNodes;
  output.searchStats!.sectionNodes = control.sectionNodes;

  if (
    DEFAULT_DAY_BUCKETS.every((day) => output.totalFoundByDay[day] === 0) &&
    output.searchCompleteness === 'exhaustive'
  ) {
    output.impossibleDiagnostic = {
      reason: `No valid schedule matches exactly ${targetCourseCount} course(s) and ${targetCredits} credits with the available course sections.`,
      suggestion: 'Review your course selection, credits, or mandatory courses.',
    };
  }

  output.diagnostics = DEFAULT_DAY_BUCKETS
    .filter((day) => output.byDayCount[day].length === 0)
    .map((day) =>
      output.searchCompleteness === 'exhaustive'
        ? `No valid schedule exists for ${day} campus days.`
        : `No complete schedule was found for ${day} campus days within the completed search.`,
    );

  output.allRankedSchedules = Object.values(output.byDayCount)
    .flat()
    .sort((a, b) => compareSchedulesDeterministically(a, b, safePreferences));

  recordPerformanceMetric('optimizer', perfTimer(), {
    combinations: output.totalCombinationsEvaluated,
    results: output.searchStats?.schedulesReturned || 0,
    completeness: output.searchCompleteness,
  });

  return output;
}
