import React from 'react';
import type { SchedulePreferences } from '../types';
import type { GroupedCourse } from '../utils/courseUtils';
import { CREDIT_PRECISION_STEP, TARGET_CREDITS_MAX, TARGET_CREDITS_MIN, isValidTargetCredits } from '../utils/preferenceValidation';
import { MustTakeHelpModal } from './MustTakeHelpModal';
import { Check, Info, Plus } from 'lucide-react';

interface PreferenceValidationState {
  isValid: boolean;
  error?: string | null;
}

export interface SchedulePreferencesPanelProps {
  preferences: SchedulePreferences;
  onUpdatePreferences: (prefs: SchedulePreferences) => void;
  savedCourseGroups: GroupedCourse[];
  targetCreditsStr: string;
  setTargetCreditsStr: React.Dispatch<React.SetStateAction<string>>;
  targetCourseCountStr: string;
  setTargetCourseCountStr: React.Dispatch<React.SetStateAction<string>>;
  markUserSetTargetCourseCount: () => void;
  markUserSetTargetCredits: () => void;
  targetCreditsValidation: PreferenceValidationState;
  targetCourseCountValidation: PreferenceValidationState;
  unknownCreditCourseCount: number;
  mandatoryCourseKeys: string[];
  mandatoryCourses: string[];
  isGroupMandatory: (group: GroupedCourse) => boolean;
  handleToggleMandatoryCourse: (group: GroupedCourse) => void;
  handleClearAllMandatory: () => void;
  formatCourseDisplay: (courseCode?: string | null, courseName?: string | null) => string;
  onOpenTips?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  targetCreditsTouched?: boolean;
  setTargetCreditsTouched?: (v: boolean) => void;
  targetCourseCountTouched?: boolean;
  setTargetCourseCountTouched?: (v: boolean) => void;
}

export const SchedulePreferencesPanel = React.memo(function SchedulePreferencesPanel({
  preferences,
  onUpdatePreferences,
  savedCourseGroups,
  targetCreditsStr,
  setTargetCreditsStr,
  targetCourseCountStr,
  setTargetCourseCountStr,
  markUserSetTargetCourseCount,
  markUserSetTargetCredits,
  targetCreditsValidation,
  targetCourseCountValidation,
  targetCreditsTouched,
  setTargetCreditsTouched,
  targetCourseCountTouched,
  setTargetCourseCountTouched,
  unknownCreditCourseCount,
  mandatoryCourseKeys,
  mandatoryCourses,
  isGroupMandatory,
  handleToggleMandatoryCourse,
  handleClearAllMandatory,
  formatCourseDisplay,
  onOpenTips,
}: SchedulePreferencesPanelProps) {
  const [isHelpOpen, setIsHelpOpen] = React.useState(false);

  return (
    <>
      <section className="bg-white rounded-2xl border border-line p-5 sm:p-7 shadow-xs space-y-6" aria-labelledby="responsive-fit-title">
        {/* Step 2 Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-5 border-b border-line">
          <div>
            <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
              2 · SET TARGETS
            </span>
            <h2 id="responsive-fit-title" className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight mt-1">
              Choose how many courses and credits you want
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Gadwal checks the valid combinations and shows up to three options for each number of class days.
            </p>
          </div>
          {onOpenTips && (
            <button
              type="button"
              onClick={onOpenTips}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-text-secondary hover:text-ink bg-mist border border-line hover:border-line-strong transition cursor-pointer shrink-0 self-start"
              title="How scheduling works"
              aria-label="Open tips"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
              <span>How scheduling works</span>
            </button>
          )}
        </div>

        {/* Schedule Target Section */}
        <div className="space-y-3" aria-labelledby="schedule-target-title">
          <div>
            <h3 id="schedule-target-title" className="text-sm sm:text-base font-bold text-ink">
              Schedule target
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Set your target credits and course count.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Target Credits Box */}
            <div className="p-4 rounded-xl bg-mist/40 border border-line space-y-2">
              <label htmlFor="target-credits-input" className="block text-xs sm:text-sm font-bold text-ink">
                How many credits do you want?
              </label>
              <input
                type="number"
                min={TARGET_CREDITS_MIN}
                max={TARGET_CREDITS_MAX}
                step={CREDIT_PRECISION_STEP}
                inputMode="decimal"
                value={targetCreditsStr}
                onChange={(e) => {
                  markUserSetTargetCredits();
                  const value = e.target.value;
                  setTargetCreditsStr(value);
                  const trimmed = value.trim();
                  if (!trimmed) {
                    onUpdatePreferences({ ...preferences, targetCredits: null });
                    return;
                  }
                  const parsed = Number(trimmed);
                  if (isValidTargetCredits(parsed)) onUpdatePreferences({ ...preferences, targetCredits: parsed });
                }}
                placeholder="e.g. 15"
                onBlur={() => setTargetCreditsTouched?.(true)}
                className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-line-strong rounded-xl text-base font-bold text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:border-ink focus-visible:outline-none transition shadow-2xs"
                id="target-credits-input"
                aria-label="How many credits do you want?"
                aria-invalid={!targetCreditsValidation.isValid}
                aria-describedby={!targetCreditsValidation.isValid && targetCreditsValidation.error ? 'target-credits-error' : undefined}
              />
              {targetCreditsTouched && !targetCreditsValidation.isValid && targetCreditsValidation.error && (
                <p id="target-credits-error" className="text-xs font-bold text-alert mt-1" role="alert">
                  {targetCreditsValidation.error}
                </p>
              )}
            </div>

            {/* Target Courses Box */}
            <div className="p-4 rounded-xl bg-mist/40 border border-line space-y-2">
              <label htmlFor="target-course-count-input" className="block text-xs sm:text-sm font-bold text-ink">
                How many courses do you want?
              </label>
              <input
                type="number"
                min="1"
                max={Math.max(1, savedCourseGroups.length)}
                step="1"
                inputMode="numeric"
                value={targetCourseCountStr}
                onChange={(e) => {
                  markUserSetTargetCourseCount();
                  const value = e.target.value;
                  setTargetCourseCountStr(value);
                  const parsed = parseInt(value.trim(), 10);
                  onUpdatePreferences({
                    ...preferences,
                    targetCourseCount: Number.isNaN(parsed) || value.trim() === '' ? null : parsed,
                  });
                }}
                placeholder={savedCourseGroups.length > 0 ? `e.g. ${Math.min(4, savedCourseGroups.length)}` : 'e.g. 4'}
                onBlur={() => setTargetCourseCountTouched?.(true)}
                className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-line-strong rounded-xl text-base font-bold text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:border-ink focus-visible:outline-none transition shadow-2xs"
                id="target-course-count-input"
                aria-label="How many courses do you want?"
                aria-invalid={!targetCourseCountValidation.isValid}
                aria-describedby={!targetCourseCountValidation.isValid && targetCourseCountValidation.error ? 'target-course-count-error' : undefined}
              />
              {targetCourseCountTouched && !targetCourseCountValidation.isValid && targetCourseCountValidation.error && (
                <p id="target-course-count-error" className="text-xs font-bold text-alert mt-1" role="alert">
                  {targetCourseCountValidation.error}
                </p>
              )}
            </div>
          </div>
        </div>

        {unknownCreditCourseCount > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-semibold flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              {unknownCreditCourseCount} course{unknownCreditCourseCount === 1 ? '' : 's'} have unknown credits, so an exact-credit schedule cannot be verified yet.
            </span>
          </div>
        )}

        {/* Must-Take Courses Section */}
        <div className="pt-4 border-t border-line space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-ink">Courses you must take</h3>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-mist text-text-secondary border border-line" aria-live="polite">
                  {mandatoryCourseKeys.length} of {savedCourseGroups.length} required
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">
                Click any course to require it in every schedule (or leave optional).
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-secondary hover:text-ink bg-mist/60 hover:bg-mist border border-line transition cursor-pointer"
                title="How must-take courses work"
                aria-label="How must-take courses work"
              >
                <Info className="w-3.5 h-3.5" aria-hidden="true" />
                <span>How this works</span>
              </button>
              {mandatoryCourses.length > 0 && (
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-alert hover:bg-alert/10 transition cursor-pointer"
                  onClick={handleClearAllMandatory}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {savedCourseGroups.map((group) => {
              const checked = isGroupMandatory(group);
              const label = formatCourseDisplay(group.courseCode, group.courseName);
              return (
                <button
                  key={group.courseKey || `${group.courseCode || ''}:${group.courseName}`}
                  type="button"
                  onClick={() => handleToggleMandatoryCourse(group)}
                  className={`group relative w-full min-h-[60px] rounded-xl border p-4 text-left flex items-center gap-3.5 transition-all duration-150 cursor-pointer ${
                    checked
                      ? 'border-ink bg-ink/[0.04] ring-2 ring-ink shadow-xs'
                      : 'border-line bg-white hover:border-ink/80 hover:bg-mist/30 hover:shadow-xs'
                  }`}
                  aria-pressed={checked}
                  role="switch"
                  aria-checked={checked}
                >
                  {/* Visual Checkbox */}
                  <div
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'border-ink bg-ink text-white'
                        : 'border-line-strong bg-white group-hover:border-ink group-hover:bg-mist'
                    }`}
                    aria-hidden="true"
                  >
                    {checked && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>

                  {/* Course Details */}
                  <div className="min-w-0 flex-1">
                    <strong className="block text-sm font-extrabold text-ink truncate group-hover:text-ink">
                      {label}
                    </strong>
                    <span className="text-xs text-text-secondary mt-0.5 block">
                      {group.credits != null ? `${group.credits} credits` : 'Credit value needed'}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div className="shrink-0">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold transition select-none ${
                        checked
                          ? 'bg-ink text-white shadow-2xs'
                          : 'bg-mist text-text-secondary border border-line group-hover:bg-white group-hover:text-ink group-hover:border-line-strong'
                      }`}
                    >
                      {checked ? 'Required' : 'Optional'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <MustTakeHelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </>
  );
});

