import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Copy, X } from 'lucide-react';
import { OptimizationResult, OptimizerOutput, DayOfWeek, SchedulePreferences, Section } from '../types';
import { formatTo12Hour } from '../utils/parser';
import { groupSectionsByCourse, formatCourseDisplay } from '../utils/courseUtils';
import { getCourseCreditSummary, getSortedScheduleDaySessions, RESULT_DAY_FULL_NAMES, RESULT_DAY_ORDER } from '../utils/resultsPresentation';
import { formatScheduleAsText, copyToClipboardDetailed } from '../utils/export';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { safeStorage } from '../utils/safeStorage';

interface StepResultsProps {
  optimizerOutput: OptimizerOutput;
  preferences: SchedulePreferences;
  sections: Section[];
  onBackToSetup: () => void;
  isStale?: boolean;
  staleChangeSummary?: {
    reasons: string[];
    deletedCourseNames: string[];
    modifiedCourseNames: string[];
    addedCourseNames: string[];
    hasStructuralCourseChange: boolean;
    hasPreferenceChange: boolean;
  };
  onRecomputeSchedules?: () => void;
  onCancelOptimizer?: () => void;
  isCalculating?: boolean;
}

type DayFilter = 'all' | 1 | 2 | 3 | 4 | 5 | 6 | 7;
const ScheduleExportMenu = lazy(() => import('./ScheduleExportMenu').then((m) => ({ default: m.ScheduleExportMenu })));
const DAY_NAMES: Record<DayOfWeek,string> = RESULT_DAY_FULL_NAMES;
const MAX_DISPLAY = 3;

function formatCourseWithCode(sec: Section): string {
  let name = (sec.name || '').trim();
  const rawCode = (sec.courseCode || '').trim();
  const rawSec = (sec.sectionCode || '').trim();

  // If both distinct courseCode and sectionCode are available
  if (rawCode && rawSec && rawCode.toLowerCase() !== rawSec.toLowerCase()) {
    if (name) {
      return `${name} · ${rawCode} (Sec. ${rawSec})`;
    }
    return `${rawCode} (Sec. ${rawSec})`;
  }

  const singleCode = rawCode || rawSec || (sec.id && !sec.id.startsWith('sec_') ? sec.id.trim() : '');
  if (!singleCode) {
    return name || 'Untitled Course';
  }

  // If the name already has "(code)" or "code" in it, strip to avoid duplicates
  if (name.includes(`(${singleCode})`)) {
    name = name.replace(`(${singleCode})`, '').trim();
  }

  // Check for hyphenated source codes like "BUS302-New03"
  const hyphenMatch = singleCode.match(/^([A-Za-z]{2,8}\s*\d{1,4})[-_]([A-Za-z0-9]+)$/);
  if (hyphenMatch) {
    const [, cCode, sCode] = hyphenMatch;
    if (name) {
      return `${name} · ${cCode} (Sec. ${sCode})`;
    }
    return `${cCode} (Sec. ${sCode})`;
  }

  // If the singleCode already includes "sec" or "section"
  if (/^(sec|section)\b/i.test(singleCode)) {
    return name ? `${name} · ${singleCode}` : singleCode;
  }

  // Single code representing a section (e.g. STA20106)
  if (name) {
    return `${name} · Section ${singleCode}`;
  }
  return `Section ${singleCode}`;
}

function getMeetingTypeBadge(meetingType: string): string {
  const norm = meetingType.toLowerCase();
  if (norm.includes('lecture')) {
    return 'bg-blue-50 text-blue-800 border-blue-200';
  }
  if (norm.includes('section')) {
    return 'bg-purple-50 text-purple-800 border-purple-200';
  }
  if (norm.includes('lab')) {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  if (norm.includes('tutorial') || norm.includes('recitation') || norm.includes('discussion')) {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  return 'bg-mist text-ink border-line';
}

export const StepResults: React.FC<StepResultsProps> = ({
  optimizerOutput,
  preferences,
  sections,
  onBackToSetup,
  isStale = false,
  staleChangeSummary,
  onRecomputeSchedules,
  onCancelOptimizer,
  isCalculating = false,
}) => {
  const filterStorageKey = `gadwal_results_filter_v2:${optimizerOutput.workflowGenerationId || optimizerOutput.generatedInputsSignature || 'current'}`;
  const [selectedDayFilter, setSelectedDayFilter] = useState<DayFilter>(() => {
    const saved = safeStorage.getItem(filterStorageKey);
    return saved === 'all' || ['1','2','3','4','5','6','7'].includes(String(saved)) ? (saved === 'all' ? 'all' : Number(saved) as DayFilter) : 'all';
  });
  
  const [activeWeekModal, setActiveWeekModal] = useState<{ schedule: OptimizationResult; rank: number } | null>(null);
  const weekModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: activeWeekModal !== null,
    onClose: () => setActiveWeekModal(null),
  });
  const [isModalCopied, setIsModalCopied] = useState(false);

  const generatedPreferences = optimizerOutput.preferencesUsed;
  const generatedSections = optimizerOutput.sectionsSnapshotComplete === false || !Array.isArray(optimizerOutput.sectionsSnapshot) ? [] : optimizerOutput.sectionsSnapshot;
  const generatedGroups = useMemo(() => groupSectionsByCourse(generatedSections), [generatedSections]);
  const currentGroups = useMemo(() => groupSectionsByCourse(sections), [sections]);
  const generatedCreditSummary = useMemo(() => getCourseCreditSummary(generatedSections), [generatedSections]);
  const currentCreditSummary = useMemo(() => getCourseCreditSummary(sections), [sections]);

  const completeness = optimizerOutput.searchCompleteness || 'not_searched';
  const isPartial = completeness !== 'exhaustive';

  useEffect(() => {
    safeStorage.setItem(filterStorageKey, String(selectedDayFilter));
  }, [filterStorageKey, selectedDayFilter]);

  const rankedByDay = useMemo(() => {
    const result: Record<number, OptimizationResult[]> = {};
    for (const d of [1,2,3,4,5,6,7]) {
      result[d] = [...(optimizerOutput.byDayCount[d] || [])];
    }
    return result;
  }, [optimizerOutput.byDayCount]);

  const allRankedSchedules = useMemo(() => {
    return optimizerOutput.allRankedSchedules || [];
  }, [optimizerOutput.allRankedSchedules]);

  const totalFoundByDay = useMemo(() => {
    const result: Record<number,number> = {};
    for (const d of [1,2,3,4,5,6,7]) result[d] = optimizerOutput.totalFoundByDay?.[d] ?? (optimizerOutput.byDayCount[d] || []).length;
    return result;
  }, [optimizerOutput]);
  const totalFoundAll = Object.values(totalFoundByDay).reduce((sum,n) => sum+n, 0);
  const isCompletedNoResults = !isStale && !isCalculating && completeness === 'exhaustive' && totalFoundAll === 0;
  const isCancelledSearch = !isStale && !isCalculating && completeness === 'cancelled';
  const generatedTitle = completeness === 'exhaustive'
    ? (isCompletedNoResults ? 'No schedule matches these choices.' : 'Here are your best schedule options.')
    : (isCancelledSearch ? 'Search canceled.' : 'Here are the best schedules found so far.');

  useEffect(() => {
    if (isStale || selectedDayFilter === 'all') return;
    if ((totalFoundByDay[selectedDayFilter] || 0) > 0) return;
    const firstPopulated = ([1,2,3,4,5,6,7] as const).find((d) => (totalFoundByDay[d] || 0) > 0);
    setSelectedDayFilter(firstPopulated ?? 'all');
  }, [optimizerOutput.generatedAt, optimizerOutput.totalFoundByDay, selectedDayFilter, totalFoundByDay, isStale]);

  const activeSchedules = useMemo(() => {
    if (isStale) return [];
    return selectedDayFilter === 'all' ? allRankedSchedules : (rankedByDay[selectedDayFilter] || []);
  }, [allRankedSchedules, rankedByDay, selectedDayFilter, isStale]);

  // Display top 3 schedules
  const displayedSchedules = activeSchedules.slice(0, MAX_DISPLAY);
  const populatedDays = ([1,2,3,4,5,6,7] as const).filter((d) => (totalFoundByDay[d] || 0) > 0);

  const categoryRankMap = useMemo(() => Object.fromEntries(([1,2,3,4,5,6,7] as const).flatMap((d) => (rankedByDay[d] || []).slice(0,5).map((s,i)=>[s.id,i+1]))), [rankedByDay]);

  const activeScopeLabel = selectedDayFilter === 'all' ? 'best schedule' : `${selectedDayFilter}-day schedule`;
  const staleCurrentMismatch = isStale && currentGroups.length !== generatedGroups.length;

  const responsiveResults = (
    <div className="responsive-results-shell" aria-label="Gadwal schedule results">
      {isStale && (
        <div className="mt-3 p-4 rounded-xl border border-red-300 bg-red-50 text-red-950" role="alert">
          <strong>These schedules are from an earlier search and are not verified against your current choices.</strong>
          <p className="mt-1 text-sm">{staleChangeSummary?.reasons?.[0] || 'Your courses or preferences changed after these schedules were built.'}</p>
          {staleCurrentMismatch && <p className="mt-1 text-sm font-semibold">Current catalog: {currentGroups.length} courses · {currentCreditSummary.knownCredits} known credits. Generated catalog: {generatedGroups.length} courses · {generatedCreditSummary.knownCredits} known credits.</p>}
          {onRecomputeSchedules && <button type="button" className="responsive-primary-button mt-3 min-h-[44px]" onClick={onRecomputeSchedules} disabled={isCalculating}>Recalculate schedules</button>}
        </div>
      )}
      <div className="responsive-results-head">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" className="responsive-text-action min-h-[44px]" onClick={onBackToSetup}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Change choices or add courses</span>
            <span className="sm:hidden">Change choices</span>
          </button>
        </div>
        <div className="mt-2">
          <h1>{generatedTitle}</h1>
        </div>
        <div id="results-target-summary" className="responsive-preference-summary" aria-label="Target used to build these schedules">
          <strong>Target:</strong>
          <span className="font-semibold text-ink">{generatedPreferences ? (generatedPreferences.targetCourseCount != null ? `${generatedPreferences.targetCourseCount} courses` : 'Course count not set') : 'Original preferences unavailable'}</span>
          <span className="text-line-strong select-none" aria-hidden="true">·</span>
          <span className="font-semibold text-ink">{generatedPreferences ? (generatedPreferences.targetCredits != null ? `${generatedPreferences.targetCredits} credits` : 'Credits not set') : 'Target credits unavailable'}</span>
          <span className="text-line-strong select-none" aria-hidden="true">·</span>
          <span className="font-semibold text-ink">{generatedPreferences ? `${(generatedPreferences.mandatoryCourseKeys || []).length} must-take` : 'Must-take settings unavailable'}</span>
          {isStale && <span className="font-bold text-red-700 select-none">· Generated preferences shown</span>}
        </div>
      </div>
      {isPartial && !isCompletedNoResults && !isCancelledSearch && completeness === 'capped' && (
        <div className="mt-3 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm" role="status">
          <strong>Search limit reached.</strong>
          <p className="mt-1">We reached the work limit before every valid combination could be checked. Some schedules may still exist.</p>
        </div>
      )}
      {isCalculating && (
        <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-mist" role="status">
          <span className="text-sm font-semibold text-ink">Finding your best schedules…</span>
          {onCancelOptimizer && <button type="button" className="responsive-secondary-button min-h-[44px]" onClick={onCancelOptimizer}>Cancel search</button>}
        </div>
      )}
      {isCancelledSearch && (
        <div className="mt-3 p-3 rounded-xl border border-line bg-mist" role="status">
          <strong className="text-ink">Search canceled.</strong>
          <p className="mt-1 text-sm text-text-secondary">No completed result set was produced. You can run the search again with the same choices or change them first.</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            {onRecomputeSchedules && <button type="button" className="responsive-primary-button min-h-[44px]" onClick={onRecomputeSchedules} disabled={isCalculating}>Search again</button>}
            <button type="button" className="responsive-secondary-button min-h-[44px]" onClick={onBackToSetup}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Change choices or add courses</span>
              <span className="sm:hidden">Change choices</span>
            </button>
          </div>
        </div>
      )}
      {!isCompletedNoResults && !isCancelledSearch && totalFoundAll > 0 && (
        <div id="schedule-days-filter-bar" className="responsive-filter-strip" role="region" aria-label="Campus day filter">
          <span className="text-xs font-bold text-text-muted uppercase tracking-wider shrink-0 select-none">Campus days</span>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap" role="group" aria-label="Filter schedules by campus days">
            {/* Best Button */}
            <button
              type="button"
              id="filter-day-best"
              onClick={() => setSelectedDayFilter('all')}
              className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs sm:text-sm transition-all duration-150 inline-flex items-center justify-center gap-1.5 ${
                selectedDayFilter === 'all'
                  ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs ring-2 ring-emerald-500/20 cursor-pointer'
                  : allRankedSchedules.length > 0
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400 font-semibold cursor-pointer'
                    : 'opacity-40 bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
              }`}
              aria-pressed={selectedDayFilter === 'all'}
              title={`Best schedules across all days (${allRankedSchedules.length} total)`}
            >
              <span className="font-bold">Best</span>
              {allRankedSchedules.length > 0 && (
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                    selectedDayFilter === 'all'
                      ? 'bg-emerald-700 text-emerald-100'
                      : 'bg-emerald-200/80 text-emerald-900'
                  }`}
                >
                  {Math.min(MAX_DISPLAY, allRankedSchedules.length)}
                </span>
              )}
            </button>

            {/* Days 1 through 7 */}
            {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => {
              const count = (rankedByDay[d] || []).length;
              const hasSchedules = count > 0;
              const isSelected = selectedDayFilter === d;

              return (
                <button
                  key={d}
                  type="button"
                  id={`filter-day-${d}`}
                  disabled={!hasSchedules}
                  onClick={() => {
                    if (hasSchedules) {
                      setSelectedDayFilter(d);
                    }
                  }}
                  className={`min-h-[44px] px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs sm:text-sm transition-all duration-150 inline-flex items-center justify-center gap-1 ${
                    !hasSchedules
                      ? 'opacity-40 bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
                      : isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs ring-2 ring-emerald-500/20 cursor-pointer'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400 font-semibold cursor-pointer'
                  }`}
                  aria-pressed={isSelected}
                  aria-disabled={!hasSchedules}
                  title={
                    hasSchedules
                      ? `${d} ${d === 1 ? 'day' : 'days'} (${count} ${count === 1 ? 'schedule' : 'schedules'})`
                      : `No schedules found for ${d} ${d === 1 ? 'day' : 'days'}`
                  }
                >
                  <span className="hidden sm:inline font-semibold">{d === 1 ? '1 Day' : `${d} Days`}</span>
                  <span className="sm:hidden font-bold">{d}d</span>
                  {hasSchedules && (
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                        isSelected
                          ? 'bg-emerald-700 text-emerald-100'
                          : 'bg-emerald-200/80 text-emerald-900'
                      }`}
                    >
                      {Math.min(MAX_DISPLAY, count)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {displayedSchedules.length === 0 ? (
        <div className={`responsive-empty-state ${isStale ? 'border-red-200 bg-red-50/40' : ''} ${isCompletedNoResults ? 'responsive-empty-state-no-results' : ''}`}>
          <h2>{isStale ? 'These results need to be recalculated.' : generatedTitle}</h2>
          <p>{isStale
            ? 'The current course list or target choices changed after these schedules were generated.'
            : isCancelledSearch
              ? 'The search was canceled before a complete result set was produced.'
              : optimizerOutput.impossibleDiagnostic?.reason || (completeness === 'exhaustive' ? 'We couldn’t find valid combinations for these choices.' : 'No schedules found so far.')}</p>
          {!isStale && isCompletedNoResults && (
            <p className="responsive-empty-guidance">Try changing the target number of courses or total credits, review which courses are marked must-take, or add/review the available course options.</p>
          )}
          {!isStale && isCompletedNoResults && optimizerOutput.impossibleDiagnostic?.suggestion && (
            <p className="responsive-empty-guidance responsive-empty-guidance-secondary">{optimizerOutput.impossibleDiagnostic.suggestion}</p>
          )}
          <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
            <button type="button" className="responsive-primary-button responsive-wide-button min-h-[44px]" onClick={onBackToSetup}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Change choices or add courses</span>
              <span className="sm:hidden">Change choices</span>
            </button>
            {isCancelledSearch && onRecomputeSchedules && <button type="button" className="responsive-secondary-button responsive-wide-button min-h-[44px]" onClick={onRecomputeSchedules} disabled={isCalculating}>Search again</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-text-secondary mt-3 mb-1.5 px-0.5">
            <span className="font-medium text-text-muted">Up to 3 valid options are shown for each number of class days.</span>
          </div>

          <div className="responsive-schedule-list">
            {displayedSchedules.map((schedule, index)=>{
              const categoryRank = schedule.categoryRank || categoryRankMap[schedule.id] || index + 1;
              const rank = selectedDayFilter === 'all' ? index + 1 : categoryRank;
              const isTie = false;
              const gap = schedule.totalGap === 0 ? '0m total gap' : (() => { const total = Math.max(0, Math.round(schedule.totalGap)); const hours = Math.floor(total / 60); const minutes = total % 60; return hours > 0 ? `${hours}h${minutes ? ` ${minutes}m` : ''} total gap` : `${minutes}m total gap`; })();

              const rankCardBorder = rank === 1 
                ? 'border-[#34D399]' 
                : rank === 2 
                  ? 'border-[#93C5FD]' 
                  : rank === 3 
                    ? 'border-[#D1D5DB]' 
                    : 'border-line';

              const gapBadgeClass = rank === 1
                ? 'bg-[#ECFDF3] text-[#16A34A] border-[#34D399]'
                : rank === 2
                  ? 'bg-[#EFF6FF] text-[#2563EB] border-[#93C5FD]'
                  : rank === 3
                    ? 'bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB]'
                    : 'bg-paper text-ink border-line';

              return (
                <article
                  className={`p-4 sm:p-5 rounded-2xl border bg-white shadow-none transition-colors ${rankCardBorder}`}
                  key={schedule.id}
                >
                  {/* Header: Title and Export menu */}
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
                    <h2 className="text-base sm:text-lg font-bold text-ink">Schedule #{rank}</h2>
                    <Suspense fallback={null}>
                      <ScheduleExportMenu schedule={schedule} rank={rank} />
                    </Suspense>
                  </div>

                  {/* Visible: Total gap time (badge alone in row 1; days/courses/credits pinned together in row 2) */}
                  <div className="py-3 flex flex-col gap-2 border-b border-line">
                    <div className="flex items-center">
                      <span className={`text-sm sm:text-base font-extrabold px-2.5 py-1 rounded-lg border inline-flex items-center ${gapBadgeClass}`} aria-label={`Total gaps: ${gap}`}>
                        Total gaps: {gap}
                      </span>
                    </div>
                    <div className="responsive-schedule-secondary flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-text-secondary flex-nowrap whitespace-nowrap overflow-x-auto">
                      <span className="font-semibold text-ink">{schedule.numDays} {schedule.numDays === 1 ? 'day' : 'days'}</span>
                      <span className="text-line-strong" aria-hidden="true">·</span>
                      <span className="font-semibold text-ink">{schedule.sections.length} {schedule.sections.length === 1 ? 'course' : 'courses'}</span>
                      <span className="text-line-strong" aria-hidden="true">·</span>
                      <span className="font-semibold text-ink">{schedule.totalCredits} credits</span>

                    </div>
                  </div>

                  {/* Full Course names with their course codes in parenthesis */}
                  <div className="py-3">
                    <ul className="space-y-2">
                      {schedule.sections.map((sec) => (
                        <li key={sec.id || sec.courseKey || sec.name} className="text-sm font-medium text-ink flex items-baseline gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0 mt-1.5" aria-hidden="true" />
                          <span>{formatCourseWithCode(sec)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Button to click to show the entire week in a popup modal */}
                  <button
                    type="button"
                    className="w-full mt-2 min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-ink bg-paper hover:bg-mist border border-line rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    onClick={() => setActiveWeekModal({ schedule, rank })}
                  >
                    <span>View entire week</span>
                  </button>
                </article>
              );
            })}
          </div>

          {/* Bottom Action Row: spans 100% full width below the grid */}
          <div className="w-full pt-6 pb-2 flex flex-col sm:flex-row items-center justify-start gap-3 border-t border-line mt-6">
            <button type="button" className="responsive-secondary-button responsive-wide-button sm:w-auto min-h-[44px]" onClick={onBackToSetup}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Change choices or add courses</span>
              <span className="sm:hidden">Change choices</span>
            </button>
          </div>
        </>
      )}

      {/* Week Schedule Popup Modal */}
      {activeWeekModal && (() => {
        const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;
        const { schedule, rank } = activeWeekModal;
        const detailId = `week-details-${schedule.id || rank}`;
        const gap = schedule.totalGap === 0 ? '0m total gap' : (() => {
          const total = Math.max(0, Math.round(schedule.totalGap));
          const hours = Math.floor(total / 60);
          const minutes = total % 60;
          return hours > 0 ? `${hours}h${minutes ? ` ${minutes}m` : ''} total gap` : `${minutes}m total gap`;
        })();
        const daySessions = getSortedScheduleDaySessions(schedule);

        const modalGapBadgeClass = rank === 1
          ? 'bg-[#ECFDF3] text-[#16A34A] border-[#34D399]'
          : rank === 2
            ? 'bg-[#EFF6FF] text-[#2563EB] border-[#93C5FD]'
            : rank === 3
              ? 'bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB]'
              : 'bg-paper text-ink border-line';

        const modalContent = (
          <div
            className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
            onClick={() => setActiveWeekModal(null)}
          >
            <div
              ref={weekModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${detailId}-title`}
              tabIndex={-1}
              className="gd-modal-shell gd-modal-sheet w-full sm:max-w-2xl max-h-[88vh] flex flex-col text-ink bg-white rounded-2xl border border-line shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="gd-modal-header p-4 sm:p-5 border-b border-line flex items-center justify-between bg-white shrink-0">
                <div>
                  <h2 id={`${detailId}-title`} className="text-base sm:text-lg font-bold text-ink">Schedule #{rank}: Entire Week</h2>
                  <div className="flex flex-col gap-1.5 mt-2">
                    <div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md border inline-flex items-center ${modalGapBadgeClass}`} aria-label={`Total gaps: ${gap}`}>Total gaps: {gap}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-secondary flex-nowrap whitespace-nowrap overflow-x-auto">
                      <span className="font-semibold text-ink">{schedule.numDays} {schedule.numDays === 1 ? 'day' : 'days'}</span>
                      <span>·</span>
                      <span className="font-semibold text-ink">{schedule.sections.length} {schedule.sections.length === 1 ? 'course' : 'courses'}</span>
                      <span>·</span>
                      <span className="font-semibold text-ink">{schedule.totalCredits} credits</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveWeekModal(null)}
                  aria-label="Close week schedule"
                  className="gd-modal-close"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <div className="gd-modal-body p-4 sm:p-6 overflow-y-auto space-y-5" role="region" aria-labelledby={`${detailId}-title`}>
                <div className="sr-only" aria-label="Accessible schedule summary for Schedule">{RESULT_DAY_ORDER.map((day) => { const sessions = daySessions[day]; if (!sessions?.length) return null; return <p key={`sr-${day}`}>{DAY_NAMES[day]}: {sessions.map((item) => `${formatCourseWithCode(item.section)} ${formatTo12Hour(item.session.start)} to ${formatTo12Hour(item.session.end)}`).join('; ')}</p>; })}</div>
                {RESULT_DAY_ORDER.map((day) => {
                  const sessions = daySessions[day];
                  if (!sessions || sessions.length === 0) return null;
                  return (
                    <div key={day} className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-ink pb-1 border-b border-line">
                        <span>{DAY_NAMES[day]}</span>
                        <span className="font-normal text-text-secondary">
                          {sessions.length} {sessions.length === 1 ? 'meeting' : 'meetings'}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {sessions.map((item, i) => {
                          const sec = item.section;
                          const session = item.session;
                          const gapMinutes = item.gapBeforeMinutes;
                          const meetingType = session.type === 'Custom' ? (session.customType || 'Custom') : (session.type || 'Lecture');

                          return (
                            <React.Fragment key={`${sec.id || sec.name}-${session.start}-${session.end}-${i}`}>
                              {gapMinutes > 0 && (
                                <div className="py-1 px-3 text-xs text-text-secondary bg-paper rounded-lg border border-dashed border-line text-center font-medium">
                                  ↓ {gapMinutes} min gap between courses
                                </div>
                              )}
                              <div className="p-3 rounded-xl border border-line bg-white flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-ink">
                                    {formatCourseWithCode(sec)}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold border uppercase tracking-wider ${getMeetingTypeBadge(meetingType)}`}>
                                      {meetingType}
                                    </span>
                                    {sec.credits != null && (
                                      <span className="text-xs text-text-secondary">
                                        · {sec.credits} credits
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-xs font-bold text-ink shrink-0 text-right whitespace-nowrap">
                                  {formatTo12Hour(session.start)} to {formatTo12Hour(session.end)}
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 border-t border-line flex items-center justify-between gap-3 bg-paper shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    const text = formatScheduleAsText(schedule, rank);
                    const res = await copyToClipboardDetailed(text);
                    if (res.success) {
                      setIsModalCopied(true);
                      setTimeout(() => setIsModalCopied(false), 1500);
                    }
                  }}
                  className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-line bg-white hover:bg-mist text-xs sm:text-sm font-semibold text-ink cursor-pointer transition-colors"
                >
                  {isModalCopied ? <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <Copy className="w-4 h-4 text-text-secondary" aria-hidden="true" />}
                  <span className={isModalCopied ? 'text-emerald-700 font-bold' : ''}>
                    {isModalCopied ? 'Copied to clipboard!' : 'Copy as text'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveWeekModal(null)}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-ink text-white text-xs sm:text-sm font-bold hover:bg-ink-soft cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
        return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;
      })()}
    </div>
  );
  return <div className="responsive-results-shell-wrap">{responsiveResults}</div>;
};
