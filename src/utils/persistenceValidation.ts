import type { Section, SchedulePreferences } from '../types';
import { normalizeCourseName, getCourseIdentityKey } from './courseUtils';
import { parseCreditHours } from './validation';
import { TARGET_CREDITS_MAX, TARGET_CREDITS_MIN, SECTION_CREDITS_MAX, SECTION_CREDITS_MIN, VALID_DAYS, isValidTargetCredits, sanitizePreferenceValues } from './preferenceValidation';
import { timeToMinutes } from './optimizer';

const VALID_DAYS_SET = new Set(VALID_DAYS);

export const MAX_SECTIONS_PER_SNAPSHOT = 500;
export const MAX_SESSIONS_PER_SECTION = 32;
export const MAX_MANDATORY_COURSES = 100;
export const MAX_MANDATORY_COURSE_KEYS = 100;

/**
 * Sanitizes a section array for ordinary recovery. Invalid individual records are omitted.
 */
export function sanitizeSections(value: unknown): Section[] {
  if (!Array.isArray(value) || value.length > MAX_SECTIONS_PER_SNAPSHOT) return [];
  return value.flatMap((item: any) => {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.sessions)) return [];
    if (item.sessions.length > MAX_SESSIONS_PER_SECTION) return [];
    const sessions = item.sessions.filter((sess: any) => {
      if (!sess || typeof sess.day !== 'string' || typeof sess.start !== 'string' || typeof sess.end !== 'string') return false;
      const start = timeToMinutes(sess.start);
      const end = timeToMinutes(sess.end);
      return VALID_DAYS_SET.has(sess.day) && Number.isFinite(start) && Number.isFinite(end) && start < end;
    }).map((sess: any) => ({
      id: typeof sess.id === 'string' ? sess.id.trim() : undefined,
      day: sess.day, start: sess.start, end: sess.end,
      type: typeof sess.type === 'string' ? sess.type : 'Other',
      customType: typeof sess.customType === 'string' ? sess.customType : undefined,
      rawType: typeof sess.rawType === 'string' ? sess.rawType.slice(0, 200) : undefined,
      rawStart: typeof sess.rawStart === 'string' ? sess.rawStart.slice(0, 100) : undefined,
      rawEnd: typeof sess.rawEnd === 'string' ? sess.rawEnd.slice(0, 100) : undefined,
      sourceNote: typeof sess.sourceNote === 'string' ? sess.sourceNote.slice(0, 500) : undefined,
      ambiguousTime: sess.ambiguousTime === true,
      resolvedFromAmbiguousTime: sess.resolvedFromAmbiguousTime === true,
      sourceEvidence: sess.sourceEvidence && typeof sess.sourceEvidence === 'object' ? {
        sourceImageIndexes: Array.isArray(sess.sourceEvidence.sourceImageIndexes) ? sess.sourceEvidence.sourceImageIndexes.filter((v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0).slice(0, 30) : undefined,
        sourceRecordIndex: Number.isInteger(sess.sourceEvidence.sourceRecordIndex) ? Number(sess.sourceEvidence.sourceRecordIndex) : undefined,
        confidence: Number.isFinite(Number(sess.sourceEvidence.confidence)) ? Number(sess.sourceEvidence.confidence) : undefined,
        ocrRunId: typeof sess.sourceEvidence.ocrRunId === 'string' ? sess.sourceEvidence.ocrRunId.slice(0, 100) : undefined,
        aliasOfSection: typeof sess.sourceEvidence.aliasOfSection === 'string' ? sess.sourceEvidence.aliasOfSection.slice(0, 100) : undefined,
      } : undefined,
    }));
    if (!item.id.trim() || !item.name.trim() || sessions.length === 0) return [];
    const credits = parseCreditHours(item.credits, { allowEmpty: true });
    const courseCode = typeof item.courseCode === 'string' ? item.courseCode.trim() : null;
    const sectionCode = typeof item.sectionCode === 'string' ? item.sectionCode.trim() : null;
    return [{
      id: item.id.trim(), name: item.name.trim(), courseKey: getCourseIdentityKey(courseCode, item.name), courseCode, sectionCode,
      rawSectionCode: typeof item.rawSectionCode === 'string' ? item.rawSectionCode.trim() : null,
      canonicalSectionKey: typeof item.canonicalSectionKey === 'string' ? item.canonicalSectionKey.trim() : null,
      sectionCodeMissing: item.sectionCodeMissing === true,
      needsReview: item.needsReview === true,
      reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons.filter((v: unknown): v is string => typeof v === 'string').slice(0, 30) : [],
      credits: Number.isFinite(credits) && credits >= SECTION_CREDITS_MIN && credits <= SECTION_CREDITS_MAX ? credits : null,
      sessions,
      instructor: typeof item.instructor === 'string' ? item.instructor.slice(0, 200) : null,
      otherInstructors: Array.isArray(item.otherInstructors) ? item.otherInstructors.filter((v: unknown): v is string => typeof v === 'string').slice(0, 20) : [],
      sourceKind: item.sourceKind === 'manual' || item.sourceKind === 'recovered' ? item.sourceKind : 'ocr',
      sourceImageIndexes: Array.isArray(item.sourceImageIndexes) ? item.sourceImageIndexes.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0).slice(0, 30) : [],
      ocrRunId: typeof item.ocrRunId === 'string' ? item.ocrRunId.slice(0, 100) : undefined,
      reviewGenerationId: typeof item.reviewGenerationId === 'string' ? item.reviewGenerationId.slice(0, 100) : undefined,
      workflowGenerationId: typeof item.workflowGenerationId === 'string' ? item.workflowGenerationId.slice(0, 100) : undefined,
      originalOcrCourseCode: typeof item.originalOcrCourseCode === 'string' ? item.originalOcrCourseCode.slice(0, 100) : null,
      originalOcrCourseName: typeof item.originalOcrCourseName === 'string' ? item.originalOcrCourseName.slice(0, 300) : null,
      editedFields: Array.isArray(item.editedFields) ? item.editedFields.filter((v): v is string => typeof v === 'string').slice(0, 30) : [],
      sourceEvidence: item.sourceEvidence && typeof item.sourceEvidence === 'object' ? { sourceImageIndexes: Array.isArray((item.sourceEvidence as any).sourceImageIndexes) ? (item.sourceEvidence as any).sourceImageIndexes.filter((v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0).slice(0,30) : [], ocrRunId: typeof (item.sourceEvidence as any).ocrRunId === 'string' ? String((item.sourceEvidence as any).ocrRunId).slice(0,100) : undefined } : undefined,
      userOverrides: item.userOverrides && typeof item.userOverrides === 'object' && !Array.isArray(item.userOverrides) ? Object.fromEntries(Object.entries(item.userOverrides as Record<string, unknown>).filter(([,v]) => ['string','number','boolean'].includes(typeof v) || v === null).slice(0, 30)) as Section['userOverrides'] : undefined,
    } as Section];
  });
}


/** Pending OCR review persistence keeps incomplete evidence; it is intentionally less strict than catalog persistence. */
export function sanitizePendingReviewSnapshot(value: unknown): Section[] | null {
  if (!Array.isArray(value) || value.length > MAX_SECTIONS_PER_SNAPSHOT) return null;
  return value.flatMap((item: any) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    if (Array.isArray(item.sessions) && item.sessions.length > MAX_SESSIONS_PER_SECTION) return [];
    const sessions = Array.isArray(item.sessions) ? item.sessions.filter((s: any) => s && typeof s.day === 'string' && typeof s.start === 'string' && typeof s.end === 'string').map((s: any) => ({
      id: typeof s.id === 'string' ? s.id.trim() : undefined, day: s.day, start: s.start, end: s.end,
      type: typeof s.type === 'string' ? s.type : 'Other', customType: typeof s.customType === 'string' ? s.customType.slice(0, 200) : undefined,
      rawType: typeof s.rawType === 'string' ? s.rawType.slice(0, 200) : undefined, rawStart: typeof s.rawStart === 'string' ? s.rawStart.slice(0, 100) : undefined, rawEnd: typeof s.rawEnd === 'string' ? s.rawEnd.slice(0, 100) : undefined,
      ambiguousTime: s.ambiguousTime === true, resolvedFromAmbiguousTime: s.resolvedFromAmbiguousTime === true,
    })) : [];
    return [{ id: item.id.trim(), name: item.name.trim(), courseKey: getCourseIdentityKey(typeof item.courseCode === 'string' ? item.courseCode : null, item.name), courseCode: typeof item.courseCode === 'string' ? item.courseCode.trim() : null, sectionCode: typeof item.sectionCode === 'string' ? item.sectionCode.trim() : null, rawSectionCode: typeof item.rawSectionCode === 'string' ? item.rawSectionCode.trim() : null, canonicalSectionKey: typeof item.canonicalSectionKey === 'string' ? item.canonicalSectionKey.trim() : null, sectionCodeMissing: item.sectionCodeMissing === true, needsReview: item.needsReview === true, reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons.filter((v: unknown): v is string => typeof v === 'string').slice(0, 30) : [], credits: Number.isFinite(Number(item.credits)) ? Number(item.credits) : null, sessions, instructor: typeof item.instructor === 'string' ? item.instructor.slice(0, 200) : null, sourceImageIndexes: Array.isArray(item.sourceImageIndexes) ? item.sourceImageIndexes.filter((v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0).slice(0, 30) : [], ocrRunId: typeof item.ocrRunId === 'string' ? item.ocrRunId.slice(0, 100) : undefined, workflowGenerationId: typeof item.workflowGenerationId === 'string' ? item.workflowGenerationId.slice(0, 100) : undefined, sourceKind: 'recovered' as const, editedFields: Array.isArray(item.editedFields) ? item.editedFields.filter((v: unknown): v is string => typeof v === 'string').slice(0, 30) : [], sourceEvidence: item.sourceEvidence && typeof item.sourceEvidence === 'object' ? { sourceImageIndexes: Array.isArray(item.sourceEvidence.sourceImageIndexes) ? item.sourceEvidence.sourceImageIndexes.filter((v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0).slice(0, 30) : [], ocrRunId: typeof item.sourceEvidence.ocrRunId === 'string' ? item.sourceEvidence.ocrRunId.slice(0, 100) : undefined } : undefined, userOverrides: item.userOverrides && typeof item.userOverrides === 'object' && !Array.isArray(item.userOverrides) ? Object.fromEntries(Object.entries(item.userOverrides).filter(([, v]) => ['string','number','boolean'].includes(typeof v) || v === null).slice(0, 30)) : undefined } as Section];
  });
}

/**
 * Strict persistence validation. A non-empty snapshot is accepted only when every
 * stored section is structurally valid; this prevents partial corruption from being
 * mistaken for a healthy current snapshot during legacy migration.
 */
export function sanitizeSectionsSnapshot(value: unknown): Section[] | null {
  if (!Array.isArray(value) || value.length > MAX_SECTIONS_PER_SNAPSHOT) return null;
  if (value.length === 0) return [];
  const sanitized = sanitizeSections(value);
  if (sanitized.length !== value.length) return null;
  // A semantically corrupt nested session must invalidate the whole snapshot rather than
  // silently dropping only the bad child and risking a false-positive recovery decision.
  for (let i = 0; i < value.length; i++) {
    const rawItem = value[i] as any;
    if (!Array.isArray(rawItem?.sessions) || sanitized[i]?.sessions.length !== rawItem.sessions.length) return null;
  }
  return sanitized;
}

export function sanitizePreferences(value: unknown): SchedulePreferences {
  return sanitizePreferenceValues(value);
}

const PREFERENCE_KEYS = new Set<keyof SchedulePreferences>([
  'targetCredits', 'targetCourseCount', 'mandatoryCourses', 'mandatoryCourseKeys',
]);

export function sanitizePreferencesSnapshot(value: unknown): SchedulePreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = value as Record<string, unknown>;
  const keys = Object.keys(parsed);
  if (keys.length === 0 || !keys.some((key) => PREFERENCE_KEYS.has(key as keyof SchedulePreferences))) return null;

  if ('targetCredits' in parsed && parsed.targetCredits !== null && !isValidTargetCredits(parsed.targetCredits)) return null;
  if ('targetCourseCount' in parsed && parsed.targetCourseCount !== null &&
      (!Number.isInteger(parsed.targetCourseCount) || Number(parsed.targetCourseCount) <= 0 || Number(parsed.targetCourseCount) > 40)) return null;
  if ('mandatoryCourses' in parsed && (!Array.isArray(parsed.mandatoryCourses) || parsed.mandatoryCourses.length > MAX_MANDATORY_COURSES || !parsed.mandatoryCourses.every((v) => typeof v === 'string'))) return null;
  if ('mandatoryCourseKeys' in parsed && (!Array.isArray(parsed.mandatoryCourseKeys) || parsed.mandatoryCourseKeys.length > MAX_MANDATORY_COURSE_KEYS || !parsed.mandatoryCourseKeys.every((v) => typeof v === 'string'))) return null;

  return sanitizePreferenceValues(value);
}
