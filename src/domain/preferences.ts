import type { SchedulePreferences } from '../types';

export const TARGET_CREDITS_MIN = 0.5;
export const TARGET_CREDITS_MAX = 100;
export const CREDIT_PRECISION = 0.5;

export function canonicalizePreferences(preferences: SchedulePreferences): SchedulePreferences {
  const targetCredits = preferences.targetCredits == null
    ? null
    : Math.round(Number(preferences.targetCredits) / CREDIT_PRECISION) * CREDIT_PRECISION;
  const rawTargetCourseCount = preferences.targetCourseCount == null
    ? null
    : Math.floor(Number(preferences.targetCourseCount));
  const targetCourseCount = Number.isFinite(rawTargetCourseCount)
    ? Math.min(40, Math.max(1, rawTargetCourseCount as number))
    : null;

  return {
    targetCredits:
      Number.isFinite(targetCredits) &&
      targetCredits! >= TARGET_CREDITS_MIN &&
      targetCredits! <= TARGET_CREDITS_MAX
        ? targetCredits
        : null,
    targetCourseCount: Number.isFinite(targetCourseCount) ? targetCourseCount : null,
    mandatoryCourseKeys: Array.from(
      new Set((preferences.mandatoryCourseKeys || []).map(String).map((v) => v.trim().toLowerCase()).filter(Boolean)),
    ).sort(),
    mandatoryCourses: Array.from(
      new Set((preferences.mandatoryCourses || []).map(String).map((v) => v.trim()).filter(Boolean)),
    ).sort(),
  };
}

export function preferencesSemanticKey(preferences: SchedulePreferences): string {
  const p = canonicalizePreferences(preferences);
  return JSON.stringify(p);
}

export function arePreferencesSemanticallyEqual(a: SchedulePreferences, b: SchedulePreferences): boolean {
  return preferencesSemanticKey(a) === preferencesSemanticKey(b);
}

export function isValidCreditsValue(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) &&
    n >= TARGET_CREDITS_MIN &&
    n <= TARGET_CREDITS_MAX &&
    Math.abs(n / CREDIT_PRECISION - Math.round(n / CREDIT_PRECISION)) < 1e-9;
}
