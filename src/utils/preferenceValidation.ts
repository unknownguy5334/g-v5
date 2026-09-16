import { DayOfWeek, SchedulePreferences, Section } from '../types';
import { getCourseIdentityKey, normalizeCourseName } from './courseUtils';

export const VALID_DAYS: readonly DayOfWeek[] = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
export const TARGET_CREDITS_MIN = 0.5;
export const TARGET_CREDITS_MAX = 100;
export const SECTION_CREDITS_MIN = 0;
export const SECTION_CREDITS_MAX = 17;
export const SECTION_CREDITS_STEP = 0.5;
export const CREDIT_PRECISION_STEP = 0.5;
export const TARGET_COURSE_COUNT_MAX = 40;

export function isValidTargetCredits(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TARGET_CREDITS_MIN &&
    value <= TARGET_CREDITS_MAX &&
    Math.abs(value / CREDIT_PRECISION_STEP - Math.round(value / CREDIT_PRECISION_STEP)) < 1e-9;
}

export function normalizeMandatoryCourses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const norm = normalizeCourseName(trimmed);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    result.push(trimmed);
  }
  return result;
}

export function normalizeMandatoryCourseKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function sanitizePreferenceValues(value: unknown): SchedulePreferences {
  const parsed = value && typeof value === 'object' ? value as Partial<SchedulePreferences> : {};
  const targetCredits = isValidTargetCredits(parsed.targetCredits) ? parsed.targetCredits : null;
  const rawTargetCourseCount = Number.isInteger(parsed.targetCourseCount as number) ? Number(parsed.targetCourseCount) : NaN;
  const targetCourseCount =
    Number.isFinite(rawTargetCourseCount) &&
    rawTargetCourseCount > 0 &&
    rawTargetCourseCount <= TARGET_COURSE_COUNT_MAX
      ? Math.floor(rawTargetCourseCount)
      : null;

  return {
    targetCredits,
    targetCourseCount,
    mandatoryCourses: normalizeMandatoryCourses(parsed.mandatoryCourses),
    mandatoryCourseKeys: normalizeMandatoryCourseKeys(parsed.mandatoryCourseKeys),
  };
}

export function reconcilePreferencesWithCatalog(
  preferences: SchedulePreferences,
  catalogSections: Section[],
  _totalCredits: number,
): SchedulePreferences {
  const courseGroups = new Map<string, Section>();
  for (const section of catalogSections) {
    const key = section.courseKey || getCourseIdentityKey(section.courseCode, section.name);
    if (!courseGroups.has(key)) courseGroups.set(key, section);
  }
  const groups = Array.from(courseGroups.entries());
  const existingKeys = new Set(groups.map(([key]) => key));
  const mandatoryCourseKeys = normalizeMandatoryCourseKeys(preferences.mandatoryCourseKeys)
    .filter((key) => existingKeys.has(key));

  for (const legacyName of normalizeMandatoryCourses(preferences.mandatoryCourses)) {
    const matches = groups.filter(([, section]) => normalizeCourseName(section.name) === legacyName);
    if (matches.length === 1 && !mandatoryCourseKeys.some((key) => key.toLowerCase() === matches[0][0].toLowerCase())) {
      mandatoryCourseKeys.push(matches[0][0]);
    }
  }

  const uniqueMandatoryKeys = Array.from(new Set(mandatoryCourseKeys));
  const mandatoryCourses = groups
    .filter(([key]) => uniqueMandatoryKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()))
    .map(([, section]) => section.name.trim())
    .filter(Boolean);

  return {
    targetCredits: preferences.targetCredits,
    targetCourseCount: preferences.targetCourseCount,
    mandatoryCourses: Array.from(new Set(mandatoryCourses)),
    mandatoryCourseKeys: uniqueMandatoryKeys,
  };
}
