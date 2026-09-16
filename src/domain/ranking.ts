import type { OptimizationResult, SchedulePreferences } from '../types';
import { scheduleCanonicalSignature } from './results';

export const RANKING_CRITERIA = [
  { key: 'validity', label: 'Valid schedule options', weight: 1 },
] as const;

export function compareScheduleRanks(a: OptimizationResult, b: OptimizationResult, _preferences?: SchedulePreferences): number {
  return scheduleCanonicalSignature(a).localeCompare(scheduleCanonicalSignature(b));
}

export function rankingLabel(_preferences?: SchedulePreferences): string {
  return 'Valid schedules are grouped by class days. Up to 3 options are shown per day count.';
}
