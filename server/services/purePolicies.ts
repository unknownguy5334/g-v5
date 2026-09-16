export type AcademicTerm = 'FALL' | 'SPRING' | 'SUMMER';
export type FreeRunStatus = 'available' | 'in-progress' | 'used';
export type AccessPlan = 'CURRENT_TERM' | 'ACADEMIC_YEAR';

export interface AcademicContextSnapshot {
  academicYear: string;
  term: AcademicTerm;
}

export interface EntitlementSnapshot {
  plan: AccessPlan;
  academicYear: string;
  term: AcademicTerm | null;
  status: 'ACTIVE' | 'REVOKED';
}

export interface AccessPolicyResult {
  hasFreeRun: boolean;
  hasCurrentTerm: boolean;
  hasAcademicYear: boolean;
  hasScheduleAccess: boolean;
}

/**
 * Pure access decision logic. Database/session retrieval belongs to accessService.ts;
 * this function owns only the business rule, making the rule directly testable.
 */
export function evaluateScheduleAccess(
  freeRunStatus: FreeRunStatus,
  context: AcademicContextSnapshot,
  entitlements: EntitlementSnapshot[],
): AccessPolicyResult {
  const hasFreeRun = freeRunStatus === 'available' || freeRunStatus === 'in-progress';
  const active = entitlements.filter((e) => e.status === 'ACTIVE');
  const hasAcademicYear = active.some(
    (e) => e.plan === 'ACADEMIC_YEAR' && e.academicYear === context.academicYear,
  );
  const hasCurrentTerm = active.some(
    (e) =>
      e.plan === 'CURRENT_TERM' &&
      e.academicYear === context.academicYear &&
      e.term === context.term,
  );

  return {
    hasFreeRun,
    hasCurrentTerm,
    hasAcademicYear,
    hasScheduleAccess: hasFreeRun || hasAcademicYear || hasCurrentTerm,
  };
}

/** Server-authoritative purchase context. Clients never choose the academic period. */
export function resolvePurchaseContext(
  plan: AccessPlan,
  context: AcademicContextSnapshot,
): { academicYear: string; term: AcademicTerm | null } {
  return {
    academicYear: context.academicYear,
    term: plan === 'CURRENT_TERM' ? context.term : null,
  };
}

/** Allowed free-run state transitions. */
export function canStartFreeRun(status: FreeRunStatus): boolean {
  return status === 'available' || status === 'in-progress';
}

export function isRunExpired(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const time = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}

/**
 * A PAID run is only continuable while the entitlement that authorized that run
 * remains active and still covers the current academic access period. This prevents
 * revocation or term-boundary changes from leaving a stale privileged run usable.
 */
export function canContinuePaidRun(
  runContext: AcademicContextSnapshot,
  currentContext: AcademicContextSnapshot,
  entitlements: EntitlementSnapshot[],
): boolean {
  if (runContext.academicYear !== currentContext.academicYear) return false;
  const active = entitlements.filter((e) => e.status === 'ACTIVE');

  const academicYearCoversRunAndNow = active.some(
    (e) => e.plan === 'ACADEMIC_YEAR' && e.academicYear === runContext.academicYear,
  );
  if (academicYearCoversRunAndNow) return true;

  return active.some(
    (e) =>
      e.plan === 'CURRENT_TERM' &&
      e.academicYear === runContext.academicYear &&
      e.term === runContext.term &&
      e.academicYear === currentContext.academicYear &&
      e.term === currentContext.term,
  );
}

export function shouldConsumeFreeRun(accessType: 'FREE_RUN' | 'PAID', hasSuccessfulResult: boolean): boolean {
  return accessType === 'FREE_RUN' && hasSuccessfulResult;
}
