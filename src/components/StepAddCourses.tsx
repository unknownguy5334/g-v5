import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { devLogError } from '../utils/clientLogger';
import {
  Upload,
  Camera,
  PlusCircle,
  Plus,
  Trash2,
  Copy,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  X,
  BookOpen,
  HelpCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ArrowLeft,
  Check,
  Layers,
  ShieldCheck,
  CheckSquare,
  Square,
  ListOrdered,
  RefreshCw,
  PenLine,
  Pencil,
  Info,
  RotateCcw,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { DayOfWeek, Section, Session as Meeting, SessionType as MeetingType, SchedulePreferences, CourseGroup } from '../types';
import { ALL_DAYS, timeToMinutes } from '../utils/optimizer';
import { CREDIT_PRECISION_STEP, TARGET_CREDITS_MAX, TARGET_CREDITS_MIN, isValidTargetCredits } from '../utils/preferenceValidation';
import { runOptimizerAsyncCancellable } from '../utils/optimizerWorkerClient';
import { recordPerformanceMetric, startPerformanceTimer } from '../utils/performanceTelemetry';
import { parseCreditHours, sanitizeBoundedText } from '../utils/validation';
import {
  normalizeCourseName,
  getCourseIdentityKey,
  canonicalizeSectionIdentity,
  groupSectionsByCourse,
  GroupedCourse,
  buildOptimizerCourseMap,
  deduplicateParsedBatch,
  sanitizeCourseNameOnly,
  formatCourseDisplay,
} from '../utils/courseUtils';
import { isSupportedScheduleImage, optimizeImageForOCR } from '../utils/imageOptimizer';
import { fingerprintDistance, sha256File, visualFingerprint } from '../utils/imageFileAnalysis';
import type { CourseBuilderAction, CourseBuilderWorkflowState } from '../features/courseBuilder/workflow';
import type { AddSectionsResult } from '../features/courseBuilder/contracts';
import { isManualMeetingType } from '../domain/meeting';
import { validateSection } from '../domain/validation';
import { createGenerationId } from '../domain/workflow';
import { UploadedFileItem, ManualSessionRow as ManualMeetingRow, ManualFormState, createLocalId, createEmptySession as createEmptyMeeting, createEmptyManualForm, sanitizeRecoveredManualForm, sanitizePendingReviewSections, readLatestPersisted } from '../features/courseBuilder/model';
import { COPY } from '../content/copy';
import { formatTo12Hour, parseUserTypedTime, parseDays } from '../utils/parser';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { ConfirmResetModal } from './ConfirmResetModal';
import { CreditHourSelector } from './CreditHourSelector';
import { MeetingRowEditor } from './MeetingRowEditor';
import { NaturalTimeInput } from './NaturalTimeInput';
import { parseNaturalTime } from '../utils/naturalTime';
import { safeStorage, createStorageEnvelope } from '../utils/safeStorage';
import { REVIEW_MEETING_TYPE_OPTIONS, MANUAL_MEETING_TYPE_OPTIONS, normalizeMeetingType } from '../utils/meetingTypes';
import { validateOcrApiResponse, parseApiErrorEnvelope } from '../utils/ocrApiContract';
import { WORKFLOW_DRAFT_KEYS, readPendingReview, readManualForms, savePendingReview, saveManualForms, clearPendingReview, clearManualForms } from '../app/workflowPersistence';
import { STORAGE_KEY_ACTIVE_TAB } from '../app/persistence';
import { WorkflowStatus } from './WorkflowStatus';
import { OCR_CLIENT_TIMEOUT_MS } from '../utils/ocrTimeout';
import { SchedulePreferencesPanel } from './SchedulePreferencesPanel';
import { MustTakeHelpModal } from './MustTakeHelpModal';
import { useAuth } from '../contexts/AuthContext';

const TextAreaAutosize = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => {
  const localRef = useRef<HTMLTextAreaElement>(null);
  
  const resize = () => {
    if (localRef.current) {
      localRef.current.style.height = 'auto';
      localRef.current.style.height = `${localRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    resize();
  }, [props.value]);

  return (
    <textarea
      {...props}
      ref={(node) => {
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        (localRef as any).current = node;
      }}
      rows={1}
      onChange={(e) => {
        resize();
        if (props.onChange) props.onChange(e);
      }}
      style={{ overflow: 'hidden', resize: 'none', ...props.style }}
    />
  );
});
TextAreaAutosize.displayName = 'TextAreaAutosize';

export type WorkflowPanel = 'start' | 'screenshots' | 'manual' | 'preferences';

interface StepAddCoursesProps {
  sections: Section[];
  onAddSections: (newSections: Section[]) => AddSectionsResult;
  onDeleteCourse?: (courseName: string, courseKey?: string) => void;
  onDeleteSection?: (sectionId: string, courseName?: string, courseKey?: string) => boolean | void;
  onUpdateSection?: (originalId: string, updatedSection: Section, originalCourseName?: string, originalCourseKey?: string, originalSectionKey?: string) => boolean | void;
  onClearSections: () => void;
  preferences: SchedulePreferences;
  onUpdatePreferences: (prefs: SchedulePreferences) => void;
  onRunOptimizer: () => void;
  onCancelOptimizer?: () => void;
  onOpenHowItWorks?: (trigger?: HTMLElement | null) => void;
  onOpenDemo?: (trigger?: HTMLElement | null) => void;
  onOpenAuth?: (view?: 'login' | 'verify') => void;
  onGoHome?: () => void;
  isCalculating?: boolean;
  hasPreviousResults?: boolean;
  isResultsStale?: boolean;
  staleReasons?: string[];
  onViewPreviousResults?: () => void;
  isOnline?: boolean;
  ocrServiceAvailable?: boolean;
  refreshConnectivity?: () => Promise<boolean>;
  workflowPanel?: WorkflowPanel;
  onWorkflowPanelChange?: (panel: WorkflowPanel) => void;
  onProcessingStateChange?: (isActive: boolean) => void;
  workflow: CourseBuilderWorkflowState;
  resetVersion?: number;
  workflowGenerationId?: string;
  dispatchWorkflow: React.Dispatch<CourseBuilderAction>;
}

type TabType = 'screenshot' | 'manual';

const DAY_LABELS: Record<DayOfWeek, string> = {
  SAT: 'Saturday',
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
};

const OCR_PREPARATION_CACHE = new Map<string, { base64: string; mimeType: string; warning?: string }>();
const OCR_PREPARATION_CACHE_MAX = 30;

const REVIEW_REASON_LABELS: Record<string, string> = {
  section_code_missing: 'The screenshot did not clearly show a course code.',
  course_code_missing: 'The screenshot did not clearly show a course code.',
  ambiguous_meeting_time: 'At least one meeting time needed AM/PM confirmation.',
  ambiguous_time: 'At least one time was ambiguous and needs confirmation.',
  incomplete_meeting: 'A meeting was only partly readable and needs your input.',
  day_missing_or_unrecognized: 'Course meeting day is missing, pick a day',
  start_time_missing_or_unrecognized: 'Meeting start time is missing.',
  end_time_missing_or_unrecognized: 'Meeting end time is missing.',
  timing_missing: 'Course meeting time is missing, add a start and end time',
  invalid_time_order: 'Start time must be strictly earlier than end time.',
  conflicting_meeting: 'The screenshots contain conflicting meeting evidence.',
  multiple_same_day_and_type: 'The same meeting type appears more than once on the same day; the times do not overlap.',
  credit_conflict: 'Different screenshots reported different credit values.',
  course_name_conflict: 'Different screenshots reported different course names.',
  meeting_type_unrecognized: 'A meeting type was not recognized and needs review.',
  meeting_type_missing: 'Course meeting type is missing, pick a type',
  course_code_embedded_in_title: 'The course code was inferred from title text instead of an explicit code field.',
  course_code_embedded_title_uncorroborated: 'The code-like text in the course title was not corroborated by an explicit code field.',
  section_association_inferred: 'A missing section was associated with another section using indirect evidence.',
  related_codes_independent_schedules: 'Related section-code evidence has different schedules.',
  model_flagged_review: 'The OCR model flagged this section for review.',
};

const REVIEW_BLOCKING_CODES = new Set([
  'ambiguous_meeting_time','ambiguous_time','incomplete_meeting','day_missing_or_unrecognized',
  'start_time_missing_or_unrecognized','end_time_missing_or_unrecognized','timing_missing','invalid_time_order',
  'conflicting_meeting','credit_conflict','course_name_conflict','meeting_type_unrecognized',
  'meeting_type_missing','related_codes_independent_schedules',
]);

const REVIEW_ACKNOWLEDGEMENT_CODES = new Set([
  'section_code_missing','course_code_embedded_in_title','course_code_embedded_title_uncorroborated','section_association_inferred','model_flagged_review','multiple_same_day_and_type',
]);

function reviewReasonCode(reason: string): string {
  return String(reason).split(':', 1)[0];
}

function reviewReasonLabel(reason: string): string {
  const code = reviewReasonCode(reason);
  return REVIEW_REASON_LABELS[code] || reason.replace(/_/g, ' ');
}

function materializePendingSections(rawSections: Section[]): Section[] {
  return rawSections.map((s) => {
    let sessions = Array.isArray(s.sessions) ? [...s.sessions] : [];
    let reasons = (s.reviewReasons || []).filter((r) => reviewReasonCode(r) !== 'course_code_missing');

    if (sessions.length === 0) {
      if (s.incompleteMeetings && s.incompleteMeetings.length > 0) {
        for (const inc of s.incompleteMeetings) {
          const raw = (inc.raw || {}) as Record<string, any>;
          const parsedDays = parseDays(raw.days || raw.day || '');
          const day = parsedDays.length > 0 ? parsedDays[0] : ('' as unknown as DayOfWeek);
          const rawStart = raw.start_time || raw.start || '';
          const rawEnd = raw.end_time || raw.end || '';
          const start = rawStart ? (parseNaturalTime(rawStart)?.time24 || parseUserTypedTime(rawStart) || '') : '';
          const end = rawEnd ? (parseNaturalTime(rawEnd, { isEnd: true, start24: start })?.time24 || parseUserTypedTime(rawEnd) || '') : '';
          const rawType = String(raw.type || raw.meeting_type || '').trim();
          const normalized = rawType ? normalizeMeetingType(rawType) : null;
          const type = normalized ? normalized.type : ('' as unknown as MeetingType);
          const customType = normalized?.customType;
          sessions.push({
            id: createLocalId('pending-session'),
            day,
            start,
            end,
            type,
            ...(customType ? { customType } : {}),
          });
          if (!day) reasons.push('day_missing_or_unrecognized');
          if (!start || !end) reasons.push('timing_missing');
          if (!type) reasons.push('meeting_type_missing');
        }
      } else {
        sessions.push({
          id: createLocalId('pending-session'),
          day: '' as unknown as DayOfWeek,
          start: '',
          end: '',
          type: '' as unknown as MeetingType,
        });
        reasons.push('day_missing_or_unrecognized', 'timing_missing', 'meeting_type_missing');
      }
    }

    const sanitizedSessions = sessions.map((sess) => {
      const dayValid = Boolean(sess.day && ALL_DAYS.includes(sess.day));
      const typeValid = Boolean(sess.type && String(sess.type).trim());
      return {
        ...sess,
        day: dayValid ? sess.day : ('' as unknown as DayOfWeek),
        type: typeValid ? sess.type : ('' as unknown as MeetingType),
      };
    });

    for (const sess of sanitizedSessions) {
      if (!sess.day || !ALL_DAYS.includes(sess.day)) reasons.push('day_missing_or_unrecognized');
      if (!sess.start?.trim() || !sess.end?.trim()) reasons.push('timing_missing');
      if (!sess.type || !String(sess.type).trim()) reasons.push('meeting_type_missing');
    }

    const dedupedReasons = Array.from(new Set(reasons));
    const hasAnyIssue = dedupedReasons.length > 0 || !s.sectionCode?.trim() || sanitizedSessions.some((m) => !m.day || !ALL_DAYS.includes(m.day) || !m.start?.trim() || !m.end?.trim() || !String(m.type).trim());

    return {
      ...s,
      sessions: sanitizedSessions,
      reviewReasons: dedupedReasons,
      needsReview: Boolean(s.needsReview || hasAnyIssue),
    };
  });
}

function validateSingleCourseGroup(group: GroupedCourse | undefined): string | null {
  if (!group) return null;
  const courseTitle = group.courseName || group.courseCode || 'This course';

  // 1. Course title
  if (!group.courseName?.trim()) {
    return `"${courseTitle}": enter a course name.`;
  }

  // 2. Credits
  const firstSection = group.sections[0];
  const groupCredits = group.credits ?? firstSection?.credits;
  if (groupCredits === null || groupCredits === undefined || Number.isNaN(Number(groupCredits)) || Number(groupCredits) < 0 || Number(groupCredits) > 17) {
    return `"${courseTitle}": select credit hours.`;
  }

  // 3. Sections / Options
  if (!group.sections || group.sections.length === 0) {
    return `"${courseTitle}": add at least one option.`;
  }

  // 4. Duplicate section codes within this course
  for (let sIdx = 0; sIdx < group.sections.length; sIdx++) {
    const s = group.sections[sIdx];
    const sCode = (s.sectionCode || '').trim().toLowerCase();
    if (sCode) {
      for (let otherIdx = sIdx + 1; otherIdx < group.sections.length; otherIdx++) {
        const otherCode = (group.sections[otherIdx].sectionCode || '').trim().toLowerCase();
        if (sCode === otherCode) {
          return `"${courseTitle}", Option ${sIdx + 1}: course code "${s.sectionCode}" is already used by another option. Give each option its own unique code.`;
        }
      }
    }
  }

  // 5. Section and Meeting details
  for (let sIdx = 0; sIdx < group.sections.length; sIdx++) {
    const section = group.sections[sIdx];
    const optionName = `Option ${sIdx + 1}`;
    const prefix = `"${courseTitle}", ${optionName}: `;

    if (!section.sectionCode?.trim() && !section.name?.trim()) {
      return `${prefix}enter a course code.`;
    }

    if (!section.sessions || section.sessions.length === 0) {
      return `${prefix}add at least one meeting.`;
    }

    // Check ambiguous times
    if (section.sessions.some((sess) => sess.ambiguousTime)) {
      return `${prefix}check the AM/PM time before saving.`;
    }

    // Check internal meeting overlap within the same section
    for (let i = 0; i < section.sessions.length; i++) {
      for (let j = i + 1; j < section.sessions.length; j++) {
        const a = section.sessions[i];
        const b = section.sessions[j];
        if (a.day && b.day && a.day === b.day) {
          const aStart = timeToMinutes(a.start);
          const aEnd = timeToMinutes(a.end);
          const bStart = timeToMinutes(b.start);
          const bEnd = timeToMinutes(b.end);
          if (Number.isFinite(aStart) && Number.isFinite(aEnd) && Number.isFinite(bStart) && Number.isFinite(bEnd)) {
            if (aStart < bEnd && bStart < aEnd) {
              return `${prefix}meeting times overlap. Fix the times before continuing.`;
            }
          }
        }
      }
    }

    // Check each meeting session
    for (let mIdx = 0; mIdx < section.sessions.length; mIdx++) {
      const sess = section.sessions[mIdx];
      const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][mIdx] || `${mIdx + 1}th`;

      if (!sess.day || !ALL_DAYS.includes(sess.day)) {
        return `${prefix}pick a day for the ${ordinal} meeting.`;
      }

      if (!sess.type || !String(sess.type).trim()) {
        return `${prefix}select a meeting type for the ${ordinal} meeting.`;
      }
      if (sess.type === 'Custom' && (!sess.customType || !String(sess.customType).trim())) {
        return `${prefix}enter the custom type for the ${ordinal} meeting.`;
      }

      if (!sess.start || !String(sess.start).trim()) {
        return `${prefix}enter a start time for the ${ordinal} meeting.`;
      }

      if (!sess.end || !String(sess.end).trim()) {
        return `${prefix}enter an end time for the ${ordinal} meeting.`;
      }

      const startMin = timeToMinutes(sess.start);
      const endMin = timeToMinutes(sess.end);
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
        return `${prefix}start time must be earlier than end time for the ${ordinal} meeting.`;
      }
    }

    // Check unacknowledged review notes
    const isCodeFilled = Boolean(section.sectionCode?.trim() || section.name?.trim());
    const codes = Array.from(new Set((section.reviewReasons || []).map(reviewReasonCode))).filter((code) => {
      if (code === 'course_code_missing' && isCodeFilled) return false;
      if (code === 'section_code_missing' && isCodeFilled) return false;
      return true;
    });
    const blockingCode = codes.find((code) => REVIEW_BLOCKING_CODES.has(code));
    if (blockingCode) {
      return `${prefix}${reviewReasonLabel(blockingCode)}. Fix this issue before continuing.`;
    }
  }

  return null;
}


export const StepAddCourses: React.FC<StepAddCoursesProps> = React.memo(({
  sections,
  onAddSections,
  onDeleteCourse,
  onDeleteSection,
  onUpdateSection,
  onClearSections,
  preferences,
  onUpdatePreferences,
  onRunOptimizer,
  onCancelOptimizer,
  onOpenHowItWorks,
  onOpenDemo,
  onOpenAuth,
  onGoHome,
  isCalculating = false,
  hasPreviousResults = false,
  isResultsStale = false,
  staleReasons = [],
  onViewPreviousResults,
  isOnline: sharedIsOnline,
  ocrServiceAvailable = true,
  refreshConnectivity,
  workflowPanel,
  onWorkflowPanelChange,
  onProcessingStateChange,
  workflow,
  resetVersion = 0,
  workflowGenerationId = '',
  dispatchWorkflow,
}) => {
  const { status: authStatus } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
      if (saved === 'screenshot' || saved === 'manual') {
        return saved;
      }
    } catch {}
    return 'screenshot';
  });

  // Sync activeTab to safeStorage
  useEffect(() => {
    try {
      safeStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTab);
    } catch {}
  }, [activeTab]);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isMustTakeHelpOpen, setIsMustTakeHelpOpen] = useState(false);
  const [detailsCourseDeleteTarget, setDetailsCourseDeleteTarget] = useState<{ courseName: string; courseKey?: string } | null>(null);
  const [detailsSectionDeleteTarget, setDetailsSectionDeleteTarget] = useState<{ sectionId: string; courseName: string; courseKey?: string; sectionLabel: string; meetingCount: number } | null>(null);
  const [detailsFooterHeight, setDetailsFooterHeight] = useState(0);
  const [internalPanel, setInternalPanel] = useState<WorkflowPanel>(() => {
    if (workflowPanel) return workflowPanel;
    return sections.length > 0 ? 'preferences' : 'start';
  });

  const responsivePanel = workflowPanel ?? internalPanel;

  useEffect(() => {
    if (sections.length === 0) {
      setIsScreenshotTipsOpen(false);
      setIsManualTipsOpen(false);
      setIsPreferencesTipsOpen(false);
      setIsDetailsModalOpen(false);
      setIsReviewModalOpen(false);
      setAddedSuccessToast(null);
    }
  }, [sections.length]);

  useEffect(() => {
    if (workflowPanel !== undefined) {
      setInternalPanel(workflowPanel);
    }
  }, [workflowPanel]);

  const currentPanelRef = useRef<WorkflowPanel>(workflowPanel ?? internalPanel);
  useEffect(() => {
    currentPanelRef.current = workflowPanel ?? internalPanel;
  }, [workflowPanel, internalPanel]);

  const onWorkflowPanelChangeRef = useRef(onWorkflowPanelChange);
  useEffect(() => {
    onWorkflowPanelChangeRef.current = onWorkflowPanelChange;
  }, [onWorkflowPanelChange]);

  const setWorkflowPanel = useCallback((panelOrUpdater: WorkflowPanel | ((prev: WorkflowPanel) => WorkflowPanel)) => {
    const current = currentPanelRef.current;
    const next = typeof panelOrUpdater === 'function' ? panelOrUpdater(current) : panelOrUpdater;
    if (next !== currentPanelRef.current) {
      currentPanelRef.current = next;
      setInternalPanel(next);
      onWorkflowPanelChangeRef.current?.(next);
    }
  }, []);
  const [responsiveManualOpenIndex, setResponsiveManualOpenIndex] = useState<number | null>(0);
  useEffect(() => {
    if (responsiveManualOpenIndex == null) return;
    const frame = window.requestAnimationFrame(() => {
      const editor = document.getElementById(`manual-form-editor-${manualForms[responsiveManualOpenIndex]?.id || ''}`);
      const heading = editor?.querySelector<HTMLElement>('[data-manual-editor-heading]');
      if (heading && window.matchMedia('(max-width: 767px)').matches) heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [responsiveManualOpenIndex]);

  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());
  const [isScreenshotTipsOpen, setIsScreenshotTipsOpen] = useState(false);
  const [isScreenshotTipsFooterHeight, setIsScreenshotTipsFooterHeight] = useState(0);
  const [isManualTipsOpen, setIsManualTipsOpen] = useState(false);
  const [openManualExample, setOpenManualExample] = useState<number | null>(null);
  const [isPreferencesTipsOpen, setIsPreferencesTipsOpen] = useState(false);
  const [isKeyboardViewportOpen, setIsKeyboardViewportOpen] = useState(false);
  const [targetCreditsTouched, setTargetCreditsTouched] = useState(false);
  const [targetCourseCountTouched, setTargetCourseCountTouched] = useState(false);
  const screenshotTipsTriggerRef = useRef<HTMLElement | null>(null);
  const screenshotTipsFooterRef = useRef<HTMLDivElement | null>(null);
  const manualTipsTriggerRef = useRef<HTMLElement | null>(null);
  const preferencesTipsTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateVisualViewport = () => {
      const isNarrow = window.innerWidth <= 900;
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const keyboardOpen = isNarrow && keyboardInset > 120 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      document.documentElement.style.setProperty('--g-visual-bottom-inset', `${Math.round(keyboardInset)}px`);
      setIsKeyboardViewportOpen(keyboardOpen);
    };

    updateVisualViewport();
    viewport.addEventListener('resize', updateVisualViewport);
    viewport.addEventListener('scroll', updateVisualViewport);
    window.addEventListener('resize', updateVisualViewport);
    window.addEventListener('focusin', updateVisualViewport);
    window.addEventListener('focusout', updateVisualViewport);
    return () => {
      viewport.removeEventListener('resize', updateVisualViewport);
      viewport.removeEventListener('scroll', updateVisualViewport);
      window.removeEventListener('resize', updateVisualViewport);
      window.removeEventListener('focusin', updateVisualViewport);
      window.removeEventListener('focusout', updateVisualViewport);
      document.documentElement.style.removeProperty('--g-visual-bottom-inset');
    };
  }, []);


  // Group current saved sections by canonical course identity (course code first; name only as fallback)
  const savedCourseGroups = useMemo(() => {
    return groupSectionsByCourse(sections);
  }, [sections]);

  const totalCredits = useMemo(() => {
    return savedCourseGroups.reduce((acc, g) => acc + (g.credits || 0), 0);
  }, [savedCourseGroups]);


  // Target course count & Target credits inputs with robust validation (#11)
  const [targetCourseCountStr, setTargetCourseCountStr] = useState<string>(
    preferences.targetCourseCount !== null && preferences.targetCourseCount !== undefined
      ? String(preferences.targetCourseCount)
      : ''
  );
  const hasUserSetTargetCourseCountRef = useRef(false);
  const hasUserSetTargetCreditsRef = useRef(false);
  const [targetCreditsStr, setTargetCreditsStr] = useState<string>(
    preferences.targetCredits !== null && preferences.targetCredits !== undefined
      ? String(preferences.targetCredits)
      : ''
  );
  // Sync state if preferences change externally
  useEffect(() => {
    if (preferences.targetCredits == null) hasUserSetTargetCreditsRef.current = false;
  }, [preferences.targetCredits]);

  useEffect(() => {
    if (preferences.targetCourseCount !== null && preferences.targetCourseCount !== undefined) setTargetCourseCountStr(String(preferences.targetCourseCount));
    else if (!hasUserSetTargetCourseCountRef.current) setTargetCourseCountStr('');
  }, [preferences.targetCourseCount]);

  useEffect(() => {
    if (preferences.targetCredits !== null && preferences.targetCredits !== undefined) setTargetCreditsStr(String(preferences.targetCredits));
    else setTargetCreditsStr('');
  }, [preferences.targetCredits]);
  // Target course count validation
  const targetCourseCountValidation = useMemo(() => {
    const str = targetCourseCountStr.trim();
    if (!str) {
      return { isValid: false, error: 'Enter how many courses you want.', value: null };
    }
    // Reject decimals and invalid format
    if (!/^-?\d+$/.test(str)) {
      if (str.includes('.')) {
        return {
          isValid: false,
          error: 'Choose a whole number of courses. Decimals don’t work here.',
          value: null,
        };
      }
      return {
        isValid: false,
        error: 'Enter a whole number of courses.',
        value: null,
      };
    }
    const parsed = parseInt(str, 10);
    if (parsed <= 0) {
      return {
        isValid: false,
        error: 'Choose at least 1 course.',
        value: null,
      };
    }
    const maxCourses = savedCourseGroups.length;
    if (maxCourses > 0 && parsed > maxCourses) {
      return {
        isValid: false,
        error: `You chose ${parsed} courses, but only ${maxCourses} have been added.`,
        value: null,
      };
    }
    const mandatoryKeys = new Set((preferences.mandatoryCourseKeys || []).map((k) => k.toLowerCase()));
    const mandatoryCount = savedCourseGroups.filter((g) => mandatoryKeys.has((g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase())).length;
    if (mandatoryCount > 0 && parsed < mandatoryCount) {
      return {
        isValid: false,
        error: `You need at least ${mandatoryCount} courses because those courses are marked as must take.`,
        value: null,
      };
    }
    return { isValid: true, error: null, value: parsed };
  }, [targetCourseCountStr, savedCourseGroups, preferences.mandatoryCourses, preferences.mandatoryCourseKeys]);

  // How many credits do you want? of all selected mandatory courses
  const mandatoryCredits = useMemo(() => {
    const mandatoryKeys = new Set((preferences.mandatoryCourseKeys || []).map((k) => k.toLowerCase()));
    return savedCourseGroups
      .filter((g) => mandatoryKeys.has((g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase()))
      .reduce((acc, g) => acc + (Number.isFinite(g.credits ?? NaN) ? Number(g.credits) : 0), 0);
  }, [savedCourseGroups, preferences.mandatoryCourseKeys]);

  // Target credits validation
  const knownCredits = useMemo(() => savedCourseGroups.reduce((sum, g) => sum + (Number.isFinite(g.credits ?? NaN) ? Number(g.credits) : 0), 0), [savedCourseGroups]);
  const unknownCreditCourseCount = useMemo(() => savedCourseGroups.filter((g) => !Number.isFinite(g.credits ?? NaN)).length, [savedCourseGroups]);
  const targetCreditsValidation = useMemo(() => {
    const str = targetCreditsStr.trim();
    if (!str) return { isValid: false, error: 'Enter how many credits you want.', value: null };
    if (!/^\d+(\.\d+)?$/.test(str)) return { isValid: false, error: 'Enter a valid number of credits.', value: null };
    const parsed = Number(str);
    if (!isValidTargetCredits(parsed)) {
      if (parsed > TARGET_CREDITS_MAX) return { isValid: false, error: `Credits cannot be more than ${TARGET_CREDITS_MAX}.`, value: null };
      return { isValid: false, error: `Credits must be at least ${TARGET_CREDITS_MIN} and use ${CREDIT_PRECISION_STEP}-credit steps.`, value: null };
    }
    if (savedCourseGroups.length > 0 && unknownCreditCourseCount === 0 && parsed > knownCredits + 0.001) {
      return { isValid: false, error: `You chose ${parsed} credits, but only ${knownCredits} credits are available.`, value: null };
    }
    const mandatoryKnownCredits = mandatoryCredits;
    const mandatoryCourseCount = preferences.mandatoryCourseKeys?.length || 0;
    if (mandatoryCourseCount > 0 && mandatoryKnownCredits > 0 && parsed < mandatoryKnownCredits - 0.001) {
      return { isValid: false, error: `You need at least ${mandatoryKnownCredits} credits because of your must-take courses.`, value: null };
    }
    return { isValid: true, error: null, value: parsed };
  }, [targetCreditsStr, knownCredits, unknownCreditCourseCount, mandatoryCredits, preferences.mandatoryCourseKeys, savedCourseGroups]);

  const isPreferencesValid = targetCreditsValidation.isValid && targetCourseCountValidation.isValid;
  const canRunScheduleSearch = isPreferencesValid && savedCourseGroups.length > 0 && !isCalculating;

  // Specific validation error string for mobile sticky bar feedback.
  const preferencesValidationError = useMemo(() => {
    if (!targetCreditsValidation.isValid && targetCreditsValidation.error) {
      return targetCreditsValidation.error;
    }
    if (!targetCourseCountValidation.isValid && targetCourseCountValidation.error) {
      return targetCourseCountValidation.error;
    }
    return null;
  }, [targetCourseCountValidation, targetCreditsValidation]);

  // Smooth scroll to preferences section when requested from sticky bar
  const scrollToPreferences = () => {
    const el = document.getElementById('setup-preferences-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Targets remain user-owned values. Catalog changes are surfaced through validation
  // instead of silently rewriting what the student entered.

  // Screenshot Upload constraints & state
  const MAX_TOTAL_BYTES = 80 * 1024 * 1024; // aligned with the server aggregate OCR corpus ceiling
  const MAX_SINGLE_FILE_BYTES = 15 * 1024 * 1024;

  const STORAGE_KEY_PENDING_REVIEW = WORKFLOW_DRAFT_KEYS.pendingReview;
  const STORAGE_KEY_MANUAL_FORMS = WORKFLOW_DRAFT_KEYS.manualForms;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleTriggerFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current?.click();
    } else {
      const el = document.getElementById('schedule-screenshot-upload-input') as HTMLInputElement | null;
      if (el) el.click();
    }
  }, []);
  const ocrAbortControllerRef = useRef<AbortController | null>(null);
  const ocrItemControllersRef = useRef<Map<string, AbortController>>(new Map());
  const ocrBatchGenerationRef = useRef(0);
  const ocrProcessingRef = useRef(false);
  const filePreparationRef = useRef(false);
  const filePreparationGenerationRef = useRef(0);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const handleProcessScreenshotsRef = useRef<(filesOverride?: UploadedFileItem[]) => Promise<void>>(async () => {});

  // File objects and object URLs cannot survive a page reload. Persisting their metadata
  // creates dead "failed" cards that can never be retried. Pending extracted sections
  // are persisted separately, so a refresh still preserves useful OCR results.
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const uploadedFilesRef = useRef<UploadedFileItem[]>([]);
  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles;
  }, [uploadedFiles]);

  const [isUploading, setIsUploading] = useState(false);

  // Never carry browser-retained OCR/manual drafts or in-memory file previews across
  // an authentication boundary. This prevents anonymous state from becoming an
  // authenticated user's draft and prevents a logged-out account's remnants from
  // being persisted for the next browser user.
  const previousAuthStatusRef = useRef<typeof authStatus | null>(null);
  useEffect(() => {
    const previous = previousAuthStatusRef.current;
    previousAuthStatusRef.current = authStatus;
    if (previous === null || previous === authStatus) return;

    const crossedAuthBoundary = previous !== 'loading' && (previous === 'unauthenticated' || authStatus === 'unauthenticated');
    if (!crossedAuthBoundary) return;

    filePreparationGenerationRef.current += 1;
    filePreparationRef.current = false;
    setIsPreparingFiles(false);
    ocrBatchGenerationRef.current += 1;
    ocrAbortControllerRef.current?.abort(new Error('AUTH_STATE_CHANGED'));
    ocrItemControllersRef.current.forEach((controller) => controller.abort());
    ocrItemControllersRef.current.clear();
    uploadedFilesRef.current.forEach((file) => URL.revokeObjectURL(file.preview));
    setUploadedFiles([]);
    setPendingParsedSections(null);
    setManualForms([createEmptyManualForm('1')]);
    clearPendingReview();
    clearManualForms();
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setIsUploading(false);
    setOcrError(null);
    setOcrErrorMeta(null);
    setOcrNotice(null);
    setUploadProgress(null);
    setIsClearScreenshotsConfirmOpen(false);
    setIsDragActive(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [authStatus]);

  useEffect(() => {
    const isProcessing = isUploading || isPreparingFiles || uploadedFiles.some((f) => f.status === 'processing');
    onProcessingStateChange?.(isProcessing);
  }, [isUploading, isPreparingFiles, uploadedFiles, onProcessingStateChange]);

  const [isClearScreenshotsConfirmOpen, setIsClearScreenshotsConfirmOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    stage: string;
    detail?: string;
  } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrErrorMeta, setOcrErrorMeta] = useState<{ reasonCode?: string; retryable: boolean; retryAfter?: number } | null>(null);
  const [ocrRetryAfterSeconds, setOcrRetryAfterSeconds] = useState(0);

  useEffect(() => {
    if (ocrRetryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => setOcrRetryAfterSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [ocrRetryAfterSeconds]);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const [lastWorkflowAction, setLastWorkflowAction] = useState<string | null>(null);

  // Network connectivity status
  const isOnline = sharedIsOnline ?? true;
  const [persistenceWarning, setPersistenceWarning] = useState(false);

  // Helper to test if a single manual form contains any user-entered content
  const isFormWithContent = (f: ManualFormState): boolean => {
    return (
      Boolean(f.name && f.name.trim() !== '') ||
      Boolean(f.courseCode && f.courseCode.trim() !== '') ||
      Boolean(f.sectionCode && f.sectionCode.trim() !== '') ||
      Boolean(
        f.sessions &&
        Array.isArray(f.sessions) &&
        f.sessions.some(
          (s) =>
            Boolean(s.day) ||
            Boolean(s.start && s.start.trim() !== '') ||
            Boolean(s.end && s.end.trim() !== '')
        )
      )
    );
  };

  // Helper to test if manual forms contain any user-entered content
  const hasManualFormWork = (forms: ManualFormState[]): boolean => {
    return forms.some(isFormWithContent);
  };

  // Parsed Pending Approval state (shows live preview before committing) with refresh/crash protection (Problem #4)
  const [pendingParsedSections, setPendingParsedSections] = useState<Section[] | null>(() => readPendingReview());

  const pendingReviewRecoveredWithoutEvidence = pendingParsedSections !== null && pendingParsedSections.length > 0 && uploadedFiles.length === 0;
  const [showRecoveredNotice, setShowRecoveredNotice] = useState(pendingReviewRecoveredWithoutEvidence);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [courseDeleteTarget, setCourseDeleteTarget] = useState<{ courseName: string; courseKey?: string } | null>(null);

  useEffect(() => {
    if (savedCourseGroups.length === 0 && (pendingParsedSections?.length ?? 0) === 0 && uploadedFiles.length === 0) {
      setWorkflowPanel((current) => (current === 'manual' || current === 'screenshots') ? current : 'start');
      return;
    }
    if (savedCourseGroups.length === 0 && ((pendingParsedSections?.length ?? 0) > 0 || uploadedFiles.length > 0)) {
      setWorkflowPanel((current) => current === 'manual' ? current : 'screenshots');
      return;
    }
  }, [savedCourseGroups.length, (pendingParsedSections?.length ?? 0), uploadedFiles.length]);


  // Success Toast Notification & Seamless Auto-Advance
  const [addedSuccessToast, setAddedSuccessToast] = useState<{
    coursesCount: number;
    message: string;
    subMessage?: string;
  } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Close course review without discarding the queue
  const handleClosePendingModal = () => {
    preserveReviewScroll();
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
  };

  // Discard pending sections queue explicitly
  const handleDiscardPendingSections = () => {
    setPendingParsedSections(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setOcrNotice('The courses found in your screenshots were cleared from review.');
  };

  useEffect(() => {
    // We handle the recovered notice via state now.
  }, [pendingReviewRecoveredWithoutEvidence]);

  const pendingModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isReviewModalOpen && pendingParsedSections !== null && pendingParsedSections.length > 0,
    onClose: handleClosePendingModal,
  });

  const detailsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isDetailsModalOpen,
    onClose: () => setIsDetailsModalOpen(false),
  });

  const detailsFooterRef = useRef<HTMLDivElement>(null);
  const builderStickyRef = useRef<HTMLDivElement>(null);
  const [builderStickyHeight, setBuilderStickyHeight] = useState(0);
  useEffect(() => {
    if (!builderStickyRef.current) return;
    const sticky = builderStickyRef.current;
    const updateHeight = () => setBuilderStickyHeight(Math.ceil(sticky.getBoundingClientRect().height));
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(sticky);
    return () => observer.disconnect();
  }, [responsivePanel, isCalculating, isKeyboardViewportOpen, canRunScheduleSearch]);

  useEffect(() => {
    if (!isDetailsModalOpen || !detailsFooterRef.current) return;
    const footer = detailsFooterRef.current;
    const updateHeight = () => setDetailsFooterHeight(Math.ceil(footer.getBoundingClientRect().height));
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [isDetailsModalOpen]);

  const screenshotTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isScreenshotTipsOpen,
    onClose: () => setIsScreenshotTipsOpen(false),
    restoreFocusRef: screenshotTipsTriggerRef,
  });
  useEffect(() => {
    if (!isScreenshotTipsOpen || !screenshotTipsFooterRef.current) return;
    const footer = screenshotTipsFooterRef.current;
    const updateFooterHeight = () => setIsScreenshotTipsFooterHeight(Math.ceil(footer.getBoundingClientRect().height));
    updateFooterHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFooterHeight);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [isScreenshotTipsOpen]);

  const manualTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isManualTipsOpen,
    onClose: () => setIsManualTipsOpen(false),
    restoreFocusRef: manualTipsTriggerRef,
  });
  const preferencesTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isPreferencesTipsOpen,
    onClose: () => setIsPreferencesTipsOpen(false),
    restoreFocusRef: preferencesTipsTriggerRef,
  });

  // Manual Entry state with refresh/crash protection (Problem #11)
  const [manualForms, setManualForms] = useState<ManualFormState[]>(() => {
    const recovered = readManualForms();
    return recovered || [createEmptyManualForm('1')];
  });

  const [manualError, setManualError] = useState<string | null>(null);


  // Persist one versioned recovery snapshot. Anonymous mode may use durable local
  // storage; authenticated mode intentionally remains session-scoped.
  const lastPendingPersistedResetVersionRef = useRef(resetVersion);
  const lastManualPersistedResetVersionRef = useRef(resetVersion);
  useEffect(() => {
    if (lastPendingPersistedResetVersionRef.current !== resetVersion) { lastPendingPersistedResetVersionRef.current = resetVersion; return; }
    if (pendingParsedSections && pendingParsedSections.length > 0) {
      const localOk = savePendingReview({ reviewGenerationId: String(ocrBatchGenerationRef.current), createdAt: Date.now(), sourceFileCount: uploadedFilesRef.current.length, sourceFileFingerprints: uploadedFilesRef.current.map((f) => f.contentHash || f.visualFingerprint || `${f.name}:${f.file?.size || 0}`).slice(0, 30), ocrRunId: pendingParsedSections[0]?.ocrRunId, evidenceVersion: 'v4', reviewSource: 'live', sections: pendingParsedSections }, { durable: authStatus === 'unauthenticated' });
      setPersistenceWarning(!localOk);
    } else { clearPendingReview(); setPersistenceWarning(false); }
  }, [pendingParsedSections]);

  useEffect(() => {
    if (lastManualPersistedResetVersionRef.current !== resetVersion) { lastManualPersistedResetVersionRef.current = resetVersion; return; }
    const hasWork = hasManualFormWork(manualForms);
    const localOk = saveManualForms(manualForms, { durable: authStatus === 'unauthenticated' });
    setPersistenceWarning(!localOk);
  }, [manualForms]);


  // Only warn for work that cannot be recovered from the persisted draft.
  useEffect(() => {
    const hasInFlightUpload = isUploading || isPreparingFiles || uploadedFiles.some((f) => f.status === 'processing');
    const hasNonRecoverableWork = hasInFlightUpload || persistenceWarning;
    if (!hasNonRecoverableWork) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingParsedSections, manualForms, isUploading, uploadedFiles]);

  // Edit Section state (#2)
  const [editingSection, setEditingSection] = useState<{
    originalId: string;
    originalCourseName: string;
    courseName: string;
    courseCode: string;
    sectionCode: string;
    credits: string;
    instructor?: string;
    sessions: ManualMeetingRow[];
    error?: string | null;
  } | null>(null);

  const editSectionModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: editingSection !== null,
    onClose: () => setEditingSection(null),
  });

  // Live Combinatorial Schedule Estimation (computed asynchronously to prevent UI thread blocking)
  const [liveEstimate, setLiveEstimate] = useState<{
    totalValid: number;
    bestGap: number;
    impossibleDiagnostic?: any;
    achievableCredits?: any;
    wasSampled?: boolean;
    wasCapped?: boolean;
    searchCompleteness?: 'exhaustive' | 'sampled' | 'capped' | 'cancelled' | 'not_searched' | 'preflight_rejected';
  } | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateRequestIdRef = useRef<number>(0);
  const estimateTaskRef = useRef<{ cancel: () => void } | null>(null);

  const searchStatusMessage = !savedCourseGroups.length
    ? 'Add at least one course to search.'
    : !isPreferencesValid
      ? 'Set your target above to search.'
      : isEstimating
        ? 'Checking valid options…'
        : liveEstimate?.searchCompleteness === 'capped'
          ? 'Quick check capped; ready to search'
          : 'Ready to search';

  useEffect(() => () => {
    estimateRequestIdRef.current++;
    estimateTaskRef.current?.cancel();
    estimateTaskRef.current = null;
  }, []);

  useEffect(() => {
    if (sections.length === 0 || !isPreferencesValid || isCalculating) {
      estimateRequestIdRef.current++;
      estimateTaskRef.current?.cancel();
      estimateTaskRef.current = null;
      if (!isCalculating) {
        setLiveEstimate(null);
        setEstimateError(null);
      }
      setIsEstimating(false);
      return;
    }

    const currentReqId = ++estimateRequestIdRef.current;
    setIsEstimating(true);
    setEstimateError(null);

    const timer = setTimeout(async () => {
      if (currentReqId !== estimateRequestIdRef.current) return;
      try {
        const { courseMap, fixedCourses } = buildOptimizerCourseMap(sections);

        const task = runOptimizerAsyncCancellable({
          courses: courseMap,
          fixedCourses,
          preferences,
          mode: 'estimate',
        }, { owner: 'live-estimate', cancelPreviousOwner: true });
        estimateTaskRef.current = task;
        const res = await task.promise;

        // Discard result if a newer estimation request has been dispatched in the meantime (Problem #9)
        if (currentReqId !== estimateRequestIdRef.current) return;

        let totalValid = 0;
        for (let d = 1; d <= 7; d++) {
          totalValid += res.totalFoundByDay?.[d] ?? (res.byDayCount[d] || []).length;
        }
        const bestGap = res.allRankedSchedules?.[0]?.totalGap ?? 0;
        setLiveEstimate({
          totalValid,
          bestGap,
          impossibleDiagnostic: res.impossibleDiagnostic,
          achievableCredits: res.achievableCredits,
          wasSampled: res.wasSampled,
          wasCapped: res.wasCapped,
          searchCompleteness: res.searchCompleteness,
        });
        setIsEstimating(false);
      } catch (e) {
        devLogError('Optimizer calculation failed in worker.');
        if (currentReqId === estimateRequestIdRef.current) {
          setLiveEstimate({ totalValid: 0, bestGap: 0, wasSampled: true, searchCompleteness: 'sampled' });
          setEstimateError('The quick option check is unavailable right now. You can still search using your current choices.');
          setIsEstimating(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      if (estimateTaskRef.current) {
        estimateTaskRef.current.cancel();
        estimateTaskRef.current = null;
      }
    };
  }, [sections, preferences, savedCourseGroups.length, isPreferencesValid, isCalculating]);

  const abortableDelay = useCallback((ms: number, abortSignal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (abortSignal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => { window.clearTimeout(timer); abortSignal.removeEventListener('abort', onAbort); };
    abortSignal.addEventListener('abort', onAbort, { once: true });
  }), []);

  // Handle Drag & Drop / File Select for Screenshots with size, identity, and count guards.
  const MAX_SCREENSHOTS_PER_BATCH = 30;
  const handleFileSelect = useCallback(async (files: FileList | File[] | null) => {
    if (isUploading || ocrProcessingRef.current || filePreparationRef.current) {
      setOcrNotice('Finish reading the current screenshots before adding more.');
      return;
    }
    if (!files) return;
    const fileList = Array.isArray(files) ? files : Array.from(files);
    if (fileList.length === 0) return;

    filePreparationRef.current = true;
    setIsPreparingFiles(true);
    const preparationGeneration = ++filePreparationGenerationRef.current;
    setOcrError(null);
    setOcrErrorMeta(null);
    setOcrRetryAfterSeconds(0);
    setOcrNotice(null);

    try {
      const existingFiles = uploadedFilesRef.current;
      const currentTotalBytes = existingFiles.reduce((acc, f) => acc + (f.file ? f.file.size : 0), 0);

      const validNewFiles: UploadedFileItem[] = [];
      let incomingBytes = 0;
      const warnings: string[] = [];
      const seenHashes = new Set<string>();
      const existingHashes = new Set(existingFiles.map((f) => f.contentHash).filter(Boolean) as string[]);
      const existingFingerprints = existingFiles.map((f) => f.visualFingerprint).filter(Boolean) as string[];

      for (const file of fileList) {
        if (!isSupportedScheduleImage(file)) {
          warnings.push(`"${file.name}" was skipped because only PNG, JPG, JPEG, or WebP images are supported.`);
          continue;
        }

        if (file.size <= 0) {
          warnings.push(`"${file.name}" was skipped because the file is empty.`);
          continue;
        }

        if (file.size > MAX_SINGLE_FILE_BYTES) {
          const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
          warnings.push(`"${file.name}" was skipped because it exceeds the 15 MB limit (${sizeMb} MB).`);
          continue;
        }

        if (existingFiles.length + validNewFiles.length >= MAX_SCREENSHOTS_PER_BATCH) {
          warnings.push(`You can add up to ${MAX_SCREENSHOTS_PER_BATCH} screenshots at a time.`);
          break;
        }

        if (currentTotalBytes + incomingBytes + file.size > MAX_TOTAL_BYTES) {
          warnings.push('The screenshot queue reached its 80 MB source-file limit. The remaining files were skipped.');
          break;
        }

        // Exact duplicate detection is content-based. File metadata is only a hint and
        // is never sufficient to drop evidence.
        const contentHash = await sha256File(file);
        if (preparationGeneration !== filePreparationGenerationRef.current) return;
        if (contentHash && (existingHashes.has(contentHash) || seenHashes.has(contentHash))) {
          warnings.push(`"${file.name}" is an exact duplicate of a screenshot already selected, so it was skipped.`);
          continue;
        }
        if (contentHash) seenHashes.add(contentHash);

        const shouldFingerprint = existingFingerprints.length > 0 || validNewFiles.some((candidate) => Boolean(candidate.visualFingerprint));
        const visual = shouldFingerprint ? await visualFingerprint(file) : null;
        if (preparationGeneration !== filePreparationGenerationRef.current) return;
        if (visual) {
          const nearDuplicate = [...existingFingerprints, ...validNewFiles.map((f) => f.visualFingerprint).filter(Boolean) as string[]]
            .some((candidate) => (fingerprintDistance(visual, candidate) ?? Number.MAX_SAFE_INTEGER) <= 24);
          if (nearDuplicate) {
            warnings.push(`"${file.name}" looks very similar to another screenshot. Both were kept because they may contain different timetable details.`);
          }
        }

        incomingBytes += file.size;
        validNewFiles.push({
          id: createLocalId('upload'),
          file,
          preview: URL.createObjectURL(file),
          name: file.name,
          contentHash,
          visualFingerprint: visual,
          status: 'processing',
        });
      }

      if (preparationGeneration !== filePreparationGenerationRef.current) return;

      if (validNewFiles.length === 0) {
        setOcrError(warnings[0] || 'Choose image files under 15 MB each.');
        return;
      }

      if (warnings.length > 0) setOcrNotice(warnings.join(' '));

      const nextFiles = [...existingFiles, ...validNewFiles];
      setUploadedFiles(nextFiles);
      setActiveTab('screenshot');
      setWorkflowPanel('screenshots');
      setPendingParsedSections(null);
      setIsReviewModalOpen(false);
      setActiveCourseIndex(0);
      safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
      safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
      dispatchWorkflow({ type: 'UPLOAD_STARTED' });
      setIsUploading(true);
      setUploadProgress({ stage: 'Preparing screenshots', detail: 'Getting your screenshots ready…' });

      // Re-run the complete selected screenshot corpus whenever new screenshots are added. This keeps OCR
      // reconciliation order-independent and ensures newly added screenshots are evaluated as
      // part of the same visual evidence set instead of silently replacing the previous result.
      await handleProcessScreenshotsRef.current(nextFiles);
    } finally {
      if (preparationGeneration === filePreparationGenerationRef.current) {
        filePreparationRef.current = false;
        setIsPreparingFiles(false);
      }
    }
  }, [isUploading]);

  // Global clipboard paste support for screenshots (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        setActiveTab('screenshot');
        setWorkflowPanel('screenshots');
        void handleFileSelect(files);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFileSelect]);

  const handleRemoveFile = (fileId: string) => {
    if (filePreparationRef.current) {
      setOcrNotice('Finish preparing the selected screenshots before removing one.');
      return;
    }
    // Removing one image invalidates the in-flight corpus response. Abort the shared request
    // and advance the generation so an already-returning response cannot repopulate stale data.
    ocrBatchGenerationRef.current += 1;
    ocrAbortControllerRef.current?.abort(new Error('CORPUS_CHANGED'));
    ocrItemControllersRef.current.get(fileId)?.abort();
    ocrItemControllersRef.current.clear();
    const fileToRemove = uploadedFilesRef.current.find((f) => f.id === fileId);
    if (fileToRemove?.preview) URL.revokeObjectURL(fileToRemove.preview);
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
    setPendingParsedSections(null);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setOcrError(null);
    setOcrErrorMeta(null);
    setOcrNotice(null);
    setUploadProgress(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAllFilesNow = () => {
    filePreparationGenerationRef.current += 1;
    filePreparationRef.current = false;
    setIsPreparingFiles(false);
    ocrBatchGenerationRef.current += 1;
    ocrAbortControllerRef.current?.abort();
    ocrItemControllersRef.current.forEach((controller) => controller.abort());
    ocrItemControllersRef.current.clear();
    uploadedFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setUploadedFiles([]);
    setPendingParsedSections(null);
    setIsDragActive(false);
    dispatchWorkflow({ type: 'RESET' });
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsUploading(false);
    setOcrError(null);
    setOcrNotice(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClearAllFiles = () => {
    if (uploadedFilesRef.current.length === 0) return;
    setIsClearScreenshotsConfirmOpen(true);
  };

  // User cancellation of active OCR processing
  const handleCancelOCR = () => {
    ocrBatchGenerationRef.current += 1;
    if (ocrAbortControllerRef.current) ocrAbortControllerRef.current.abort();
    ocrItemControllersRef.current.forEach((controller) => controller.abort());
    ocrItemControllersRef.current.clear();
    setIsUploading(false);
    setUploadProgress(null);
    setLastWorkflowAction('Screenshot reading was stopped.');
    dispatchWorkflow({ type: 'CANCELLED' });
    setUploadedFiles((prev) =>
      prev.map((f) => (f.status === 'processing' ? { ...f, status: 'idle' } : f))
    );
    setOcrNotice('Screenshot reading was stopped. Images remain ready to process.');
  };

  /**
   * Humanize and sanitize OCR error messages so students never see raw technical or network exceptions.
   */
  const getFriendlyOcrErrorMessage = (
    itemErr: any,
    reasonCode?: string
  ): string => {
    if (reasonCode === 'MODEL_UNPARSEABLE') {
      return 'We couldn’t read this screenshot properly. Try it again. The screenshot itself may be fine.';
    }
    if (reasonCode === 'UPSTREAM_ERROR' || reasonCode === 'UPSTREAM_BUSY') {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }
    if (reasonCode === 'NO_SCHEDULE_FOUND') {
      return 'We couldn’t read the course times from this screenshot. Try a clearer image or enter the course manually.';
    }

    if (itemErr?.isTimeout || itemErr?.name === 'TimeoutError' || itemErr?.message === 'CLIENT_TIMEOUT') {
      return 'That took too long. Try again.';
    }

    if (itemErr?.name === 'AbortError' || itemErr?.message === 'ABORTED') {
      return 'Screenshot reading was stopped.';
    }

    const rawMsg = String(itemErr?.message || '').toLowerCase();
    const isNetworkFailure =
      itemErr instanceof TypeError ||
      itemErr?.name === 'TypeError' ||
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      rawMsg.includes('failed to fetch') ||
      rawMsg.includes('networkerror') ||
      rawMsg.includes('load failed') ||
      rawMsg.includes('network request failed') ||
      rawMsg.includes('err_connection') ||
      rawMsg.includes('err_internet_disconnected');

    if (isNetworkFailure) {
      return 'Your internet connection was lost. Check it and try again.';
    }

    if (itemErr?.reasonCode === 'OCR_CORPUS_TOO_LARGE' || rawMsg.includes('corpus limit') || rawMsg.includes('total image payload')) {
      return 'The complete screenshot set is too large for one OCR pass. Remove or compress some screenshots and try again.';
    }

    if (itemErr?.reasonCode === 'IMAGE_TOO_LARGE' || itemErr?.status === 413 || rawMsg.includes('per-image limit') || rawMsg.includes('maximum allowed size')) {
      return 'This screenshot is over the per-image limit. Crop or compress it, then try again.';
    }

    if (itemErr?.status === 429 || rawMsg.includes('429') || rawMsg.includes('quota') || rawMsg.includes('resource_exhausted')) {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }

    if (itemErr?.status >= 500 || rawMsg.includes('500') || rawMsg.includes('503') || rawMsg.includes('service')) {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }

    if (
      typeof itemErr?.message === 'string' &&
      itemErr.message.trim() &&
      !rawMsg.includes('fetch') &&
      !rawMsg.includes('typeerror') &&
      !rawMsg.includes('object object')
    ) {
      return itemErr.message;
    }

    return 'We couldn’t read this screenshot. Try it again.';
  };

  const getOcrErrorMeta = (itemErr: any) => {
    const reasonCode = typeof itemErr?.reasonCode === 'string' ? itemErr.reasonCode : undefined;
    const retryable = itemErr?.retryable === true || ['UPSTREAM_ERROR', 'UPSTREAM_BUSY', 'OCR_TIMEOUT', 'CLIENT_TIMEOUT', 'NETWORK_ERROR'].includes(reasonCode || '') || itemErr?.status === 429 || itemErr?.status >= 500 || itemErr?.name === 'TypeError';
    const retryAfter = typeof itemErr?.retryAfter === 'number' && Number.isFinite(itemErr.retryAfter) ? Math.max(0, Math.ceil(itemErr.retryAfter)) : undefined;
    return { reasonCode, retryable, retryAfter };
  };

  // Process screenshots as one logical evidence batch. The server receives multiple images together
  // so the model can associate a course header from one screenshot with meetings from another.
  const handleProcessScreenshots = async (filesOverride?: UploadedFileItem[]) => {
    if (ocrProcessingRef.current) return;
    if (authStatus === 'unauthenticated') {
      onOpenAuth?.('login');
      return;
    }
    if (authStatus === 'unverified') {
      onOpenAuth?.('verify');
      return;
    }
    if (authStatus === 'loading') {
      setOcrError('Checking your account. Please try again in a moment.');
      return;
    }
    // Screenshot OCR is an authenticated, provider-costing operation. The server enforces
    // the same requirement, so this client gate is UX-only and never a security boundary.
    if (authStatus !== 'authenticated') return;
    const allFiles = filesOverride && filesOverride.length > 0 ? filesOverride : uploadedFiles;
    if (!allFiles.length) return;
    if (!isOnline) {
      setOcrError('You’re offline. Reconnect to read screenshots.');
      setIsUploading(false);
      return;
    }

    // The OCR contract is corpus-wide: every run sees the complete current screenshot set.
    // File status describes UI state only and must never determine the evidence sent to OCR.
    const effectiveFiles = allFiles;

    ocrProcessingRef.current = true;
    dispatchWorkflow({ type: 'EXTRACTION_STARTED' });
    const batchPerfTimer = startPerformanceTimer();
    const batchGeneration = ++ocrBatchGenerationRef.current;
    const abortController = new AbortController();
    ocrAbortControllerRef.current = abortController;
    const { signal } = abortController;

    setIsUploading(true);
    setOcrError(null);
    setOcrNotice(null);

    const targetIdSet = new Set(effectiveFiles.map((f) => f.id));
    setUploadedFiles((prev) => prev.map((f) => targetIdSet.has(f.id) ? { ...f, status: 'processing', errorMessage: undefined, errorReasonCode: undefined, retryable: undefined, retryAfter: undefined } : f));

    const accumulatedSections: Section[] = [];
    let sentCount = 0;
    let usefulSectionCount = 0;
    let failCount = 0;
    let completedCount = 0;
    const totalToProcess = effectiveFiles.length;
    const completedDurations: number[] = [];
    let lastOcrReasonCode: string | undefined;

    const updateProgress = () => {
      const avgSec = completedDurations.length
        ? completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length
        : 0;
      const remaining = totalToProcess - completedCount;
      const estimatedSeconds = avgSec > 0 && remaining > 0 ? Math.max(1, Math.round(remaining * avgSec)) : undefined;
      setUploadProgress({
        stage: completedCount === 0 ? 'Reading your screenshots' : 'Checking the information we found',
        detail: estimatedSeconds ? `About ${estimatedSeconds}s remaining.` : undefined,
      });
    };

    try {
      updateProgress();

      // Prepare every selected image for one corpus request. Never split the corpus into
      // independent OCR requests because section identity depends on cross-image evidence.
      const prepared: Array<{ item: UploadedFileItem; data: string; mimeType: string }> = [];
      for (const item of effectiveFiles) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!item.file) {
          failCount++;
          completedCount++;
          setUploadedFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'failed', errorMessage: 'This screenshot is no longer available. Upload it again.', errorReasonCode: 'FILE_UNAVAILABLE', retryable: false } : f));
          updateProgress();
          continue;
        }
        try {
          const cacheKey = item.contentHash || `${item.file.type}:${item.file.size}:${item.file.lastModified}`;
          let optimized = OCR_PREPARATION_CACHE.get(cacheKey);
          if (!optimized) {
            optimized = await optimizeImageForOCR(item.file);
            OCR_PREPARATION_CACHE.set(cacheKey, optimized);
            while (OCR_PREPARATION_CACHE.size > OCR_PREPARATION_CACHE_MAX) {
              const oldest = OCR_PREPARATION_CACHE.keys().next().value;
              if (oldest === undefined) break;
              OCR_PREPARATION_CACHE.delete(oldest);
            }
          }
          if (optimized.warning) setOcrNotice(optimized.warning);
          prepared.push({ item, data: optimized.base64, mimeType: optimized.mimeType });
        } catch (err: any) {
          failCount++;
          completedCount++;
          const meta = getOcrErrorMeta(err);
          setUploadedFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'failed', errorMessage: getFriendlyOcrErrorMessage(err), errorReasonCode: meta.reasonCode, retryable: meta.retryable, retryAfter: meta.retryAfter } : f));
          updateProgress();
        }
      }

      if (prepared.length === 0) {
        throw new Error('No readable screenshots remain in the selected corpus.');
      }

      const MAX_OCR_CORPUS_DECODED_BYTES = 80 * 1024 * 1024;
      const estimateBase64Bytes = (value: string) => {
        const clean = value.replace(/^data:[^,]+,/, '');
        const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
      };
      const preparedDecodedBytes = prepared.reduce((sum, entry) => sum + estimateBase64Bytes(entry.data), 0);
      if (preparedDecodedBytes > MAX_OCR_CORPUS_DECODED_BYTES) {
        const totalMb = (preparedDecodedBytes / (1024 * 1024)).toFixed(1);
        const message = `The complete screenshot set is ${totalMb} MB after optimization, above the 80 MB one-pass OCR limit. Remove or compress some screenshots and try again.`;
        setOcrError(message);
        setOcrErrorMeta({ reasonCode: 'OCR_CORPUS_TOO_LARGE', retryable: false });
        setUploadedFiles((prev) => prev.map((f) => prepared.some((e) => e.item.id === f.id) ? { ...f, status: 'failed', errorMessage: message, errorReasonCode: 'OCR_CORPUS_TOO_LARGE', retryable: false } : f));
        dispatchWorkflow({ type: 'ERROR' });
        return;
      }

      // IMPORTANT: send the entire selected screenshot set in ONE HTTP request.
      // Do not split by image count or create independent OCR batches. Gemini must receive
      // all available visual evidence in the same request so it can reason across repeated,
      // overlapping, partial, and randomly ordered screenshots.
      const requestController = new AbortController();
      let requestTimedOut = false;
      const requestTimeoutId = window.setTimeout(() => {
        requestTimedOut = true;
        requestController.abort(new Error('CLIENT_TIMEOUT'));
      }, OCR_CLIENT_TIMEOUT_MS);
      const forwardAbort = () => requestController.abort(signal.reason || new Error('CLIENT_ABORTED'));
      signal.addEventListener('abort', forwardAbort, { once: true });
      prepared.forEach((e) => ocrItemControllersRef.current.set(e.item.id, requestController));
      const started = Date.now();

      try {
        sentCount = prepared.length;
        const response = await fetch('/api/extract-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: prepared.map((e) => ({ data: e.data, mimeType: e.mimeType })), workflowGenerationId }),
          signal: requestController.signal,
        });

        if (!response) throw new Error('We didn’t get a response while reading the screenshots. Try again.');
        if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
        const data = await response.json().catch(() => ({}));
        if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
        if (!response.ok) {
          const apiError = parseApiErrorEnvelope(data);
          lastOcrReasonCode = apiError.reasonCode;
          const err: any = new Error(apiError.error || `Server responded with status ${response.status}`);
          err.status = response.status;
          err.reasonCode = apiError.reasonCode;
          err.retryAfter = apiError.retryAfter;
          err.retryable = apiError.retryable;
          throw err;
        }
        const contract = validateOcrApiResponse(data);
        if (!contract.valid) {
          const err: any = new Error('The schedule-reading service returned data that did not match the supported response format.');
          err.reasonCode = 'INVALID_RESPONSE_CONTRACT';
          throw err;
        }
        const sections = contract.sections.map((section) => ({ ...section, ocrRunId: section.ocrRunId || contract.ocrRunId, workflowGenerationId: section.workflowGenerationId || workflowGenerationId }));
        if (sections.length > 0) {
          accumulatedSections.push(...sections);
          usefulSectionCount = sections.length;
          setUploadedFiles((prev) => prev.map((f) =>
            prepared.some((e) => e.item.id === f.id)
              ? { ...f, status: 'corpus-ready', extractedSectionsCount: undefined, errorMessage: undefined }
              : f
          ));
        } else {
          lastOcrReasonCode = contract.reasonCode;
          failCount += prepared.length;
          const message = typeof data?.message === 'string' && data.message.trim()
            ? data.message
            : 'We couldn’t find course schedule details in these screenshots. Try clearer screenshots or enter the courses yourself.';
          setUploadedFiles((prev) => prev.map((f) =>
            prepared.some((e) => e.item.id === f.id)
              ? { ...f, status: 'failed', errorMessage: message, errorReasonCode: contract.reasonCode, retryable: false }
              : f
          ));
        }

        completedCount += prepared.length;
        completedDurations.push((Date.now() - started) / 1000 / Math.max(1, prepared.length));
        updateProgress();
      } catch (err: any) {
        if (signal.aborted) throw err;
        if (requestTimedOut) throw new Error('CLIENT_TIMEOUT');
        failCount += prepared.length;
        completedCount += prepared.length;
        completedDurations.push((Date.now() - started) / 1000 / Math.max(1, prepared.length));
        const meta = getOcrErrorMeta(err);
        const friendly = getFriendlyOcrErrorMessage(err, err?.reasonCode);
        setOcrErrorMeta(meta);
        setOcrRetryAfterSeconds(meta.retryAfter || 0);
        setUploadedFiles((prev) => prev.map((f) =>
          prepared.some((e) => e.item.id === f.id)
            ? { ...f, status: 'failed', errorMessage: friendly, errorReasonCode: meta.reasonCode, retryable: meta.retryable, retryAfter: meta.retryAfter }
            : f
        ));
        updateProgress();
      } finally {
        signal.removeEventListener('abort', forwardAbort);
        window.clearTimeout(requestTimeoutId);
        prepared.forEach((e) => ocrItemControllersRef.current.delete(e.item.id));
      }

      setUploadProgress({ stage: 'Checking the information we found', detail: 'Reviewing course, section, meeting, and conflict evidence…' });

      // Do not fill missing OCR credits from the catalog or any other heuristic.
      // Missing credit data is review state. The user can explicitly enter it in
      // the review dialog, which keeps the OCR layer lossless.
      if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
      const preparedSections = accumulatedSections.map((s) => ({ ...s }));
      const deduplicatedSections = deduplicateParsedBatch(preparedSections);
      if (deduplicatedSections.length > 0) {
        setActiveCourseIndex(0);
        setPendingParsedSections(materializePendingSections(deduplicatedSections));
        dispatchWorkflow({ type: failCount > 0 ? 'PARTIAL_SUCCESS' : 'REVIEW_REQUIRED' });
        setIsReviewModalOpen(true);
        if (failCount > 0) setOcrNotice(`We read ${sentCount} screenshot${sentCount === 1 ? '' : 's'} and found ${usefulSectionCount} usable course option${usefulSectionCount === 1 ? '' : 's'}. ${failCount} screenshot${failCount === 1 ? '' : 's'} still need another try.`);
      } else {
        const reasonCode = lastOcrReasonCode || 'NO_SCHEDULE_FOUND';
        setOcrError('We couldn’t get usable course details from the screenshot corpus. Replace the screenshots or enter the courses yourself.');
        setOcrErrorMeta({ reasonCode, retryable: false });
        setLastWorkflowAction('No usable course details were found.');
        dispatchWorkflow({ type: 'ERROR', reasonCode });
      }
      setIsUploading(false);
      setUploadProgress(null);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        setIsUploading(false);
        setUploadProgress(null);
        } else {
        devLogError('OCR batch failed.');
        const meta = getOcrErrorMeta(err);
        setOcrError(getFriendlyOcrErrorMessage(err, err?.reasonCode));
        setOcrErrorMeta(meta);
        setOcrRetryAfterSeconds(meta.retryAfter || 0);
        setLastWorkflowAction('Screenshot reading needs another try.');
        dispatchWorkflow({ type: meta.retryable ? 'RETRYABLE_ERROR' : 'ERROR', reasonCode: meta.reasonCode });
        setIsUploading(false);
        setUploadProgress(null);
        }
    } finally {
      recordPerformanceMetric('ocr-batch', batchPerfTimer(), {
        total: totalToProcess,
        completed: completedCount,
        successes: usefulSectionCount,
        failures: failCount,
        cancelled: signal.aborted,
      });
      ocrAbortControllerRef.current = null;
      ocrProcessingRef.current = false;
    }
  };

  handleProcessScreenshotsRef.current = handleProcessScreenshots;

  // Retry the complete current screenshot corpus. Failed-count is only a user-facing hint.
  const handleRetryFailed = () => {
    const failed = uploadedFilesRef.current.filter((f) => f.status === 'failed');
    if (!failed.length || isUploading) return;
    const retryAfter = ocrRetryAfterSeconds;
    if (retryAfter > 0) {
      setOcrNotice(`Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before retrying.`);
      return;
    }
    setLastWorkflowAction('Retrying the complete screenshot set.');
    void handleProcessScreenshots();
  };

  const courseGroupMatchesSection = (group: { courseKey?: string; courseCode?: string | null; courseName: string }, section: Section) =>
    (group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName)) === (section.courseKey || getCourseIdentityKey(section.courseCode, section.name));

  // Group pending parsed sections using code-first identity.
  const pendingCourseGroups = useMemo(() => {
    if (!pendingParsedSections) return [];
    return groupSectionsByCourse(pendingParsedSections);
  }, [pendingParsedSections]);

  const missingCreditCourses = useMemo(() => {
    return pendingCourseGroups.filter((g) => g.credits === null || g.credits === undefined);
  }, [pendingCourseGroups]);

  const hasMissingCredits = missingCreditCourses.length > 0;

  // Unresolved Ambiguous Times detection and helpers (Problem #5)
  const hasUnresolvedAmbiguousTimes = useMemo(() => {
    return (
      pendingParsedSections?.some(
        (s) => Array.isArray(s?.sessions) && s.sessions.some((sess) => sess?.ambiguousTime)
      ) ?? false
    );
  }, [pendingParsedSections]);

  const ambiguousMeetingsCount = useMemo(() => {
    if (!pendingParsedSections || !Array.isArray(pendingParsedSections)) return 0;
    let cnt = 0;
    for (const s of pendingParsedSections) {
      if (Array.isArray(s?.sessions)) {
        for (const sess of s.sessions) {
          if (sess?.ambiguousTime) cnt++;
        }
      }
    }
    return cnt;
  }, [pendingParsedSections]);

  const handleConfirmAmbiguousTime = (secId: string, sessionIndex: number) => {
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== secId) return s;
            const updatedMeetings = Array.isArray(s.sessions)
              ? s.sessions.map((sess, idx) =>
                  idx === sessionIndex ? { ...sess, ambiguousTime: false, resolvedFromAmbiguousTime: true } : sess
                )
              : [];
            return { ...s, sessions: updatedMeetings };
          })
        : null
    );
  };

  const handleConfirmAllAmbiguousTimes = () => {
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => ({
            ...s,
            sessions: s.sessions.map((sess, sessionIndex) => ({
        ...sess,
        id:
          sess.id ||
          `session-${sess.day}-${sess.start}-${sess.end}-${sessionIndex + 1}`,
        ambiguousTime: false,
        resolvedFromAmbiguousTime: Boolean(sess.ambiguousTime) || Boolean(sess.resolvedFromAmbiguousTime),
      })),
          }))
        : null
    );
  };

  const [activeCourseIndex, setActiveCourseIndex] = useState(0);
  const [reviewModalError, setReviewModalError] = useState<string | null>(null);
  const reviewScrollContainerRef = useRef<HTMLDivElement>(null);
  const reviewScrollTopRef = useRef(0);
  const skipReviewScrollRestoreRef = useRef(false);

  const preserveReviewScroll = useCallback(() => {
    reviewScrollTopRef.current = reviewScrollContainerRef.current?.scrollTop ?? reviewScrollTopRef.current;
  }, []);

  useEffect(() => {
    if (!isReviewModalOpen || !reviewScrollContainerRef.current) return;
    if (skipReviewScrollRestoreRef.current) {
      skipReviewScrollRestoreRef.current = false;
      return;
    }
    const node = reviewScrollContainerRef.current;
    const top = reviewScrollTopRef.current;
    if (Math.abs(node.scrollTop - top) > 1) {
      requestAnimationFrame(() => node.scrollTo({ top, behavior: 'auto' }));
    }
  }, [pendingParsedSections, isReviewModalOpen, activeCourseIndex]);

  const handleNavigateCourse = (newIdx: number) => {
    if (newIdx > activeCourseIndex) {
      const currentGroup = pendingCourseGroups[activeCourseIndex];
      const validationError = validateSingleCourseGroup(currentGroup);
      if (validationError) {
        setReviewModalError(validationError);
        setOcrError(validationError);
        if (reviewScrollContainerRef.current) {
          reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }
    }
    setReviewModalError(null);
    setOcrError(null);
    const clamped = Math.max(0, Math.min(pendingCourseGroups.length - 1, newIdx));
    skipReviewScrollRestoreRef.current = true;
    setActiveCourseIndex(clamped);
    if (reviewScrollContainerRef.current) {
      reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Keyboard navigation for Review Modal (ArrowLeft / ArrowRight)
  useEffect(() => {
    if (!isReviewModalOpen || !pendingCourseGroups.length) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigateCourse(activeCourseIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigateCourse(activeCourseIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReviewModalOpen, pendingCourseGroups.length, activeCourseIndex]);

  // Keep activeCourseIndex strictly within bounds of the current batch
  // Cleanup OCR abort and timeouts on unmount
  useEffect(() => {
    return () => {
      ocrBatchGenerationRef.current += 1;
      filePreparationGenerationRef.current += 1;
      filePreparationRef.current = false;
      if (ocrAbortControllerRef.current) ocrAbortControllerRef.current.abort();
      ocrItemControllersRef.current.forEach((controller) => controller.abort());
      ocrItemControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      uploadedFilesRef.current.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  useEffect(() => {
    if (pendingCourseGroups.length === 0) {
      if (activeCourseIndex !== 0) setActiveCourseIndex(0);
    } else if (activeCourseIndex >= pendingCourseGroups.length) {
      setActiveCourseIndex(0);
    }
  }, [pendingCourseGroups.length, activeCourseIndex]);

  const getInsertedCount = (result: AddSectionsResult): number => result.insertedSections.length;
  const getSkippedCount = (result: AddSectionsResult): number => result.skippedCount;

  // Set credit hours for remaining courses in the pending queue (does not overwrite already set courses)

  const acknowledgeSectionReview = (sectionId: string) => {
    setPendingParsedSections((prev) => prev ? prev.map((section) => section.id === sectionId ? { ...section, reviewAcknowledged: true } : section) : null);
  };

  // Confirm Pending Parsed Sections into Catalog
  const handleConfirmPendingSections = () => {
    if (!pendingParsedSections || (pendingParsedSections?.length ?? 0) === 0) return;

    const invalidCourse = pendingParsedSections.find((s) => !s.name?.trim() && !s.sectionCode?.trim());
    if (invalidCourse) {
      const msg = 'Every course needs a course code or name before we can add it.';
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const missingCredits = pendingParsedSections.find(
      (s) => s.credits === null || s.credits === undefined || !Number.isFinite(Number(s.credits)) || Number(s.credits) < 0 || Number(s.credits) > 17
    );
    if (missingCredits) {
      const missingIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, missingCredits));
      if (missingIdx !== -1) {
        setActiveCourseIndex(missingIdx);
      }
      const msg = `Add valid credit hours for "${missingCredits.name || missingCredits.sectionCode || 'Course'}" before adding the extracted courses.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    // Strict validation for meeting timing, day, course name, section code, and course type across all options
    for (let cIdx = 0; cIdx < pendingCourseGroups.length; cIdx++) {
      const group = pendingCourseGroups[cIdx];
      const validationError = validateSingleCourseGroup(group);
      if (validationError) {
        setActiveCourseIndex(cIdx);
        setReviewModalError(validationError);
        setOcrError(validationError);
        reviewScrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    const unresolvedAmbiguous = pendingParsedSections.find((s) =>
      Array.isArray(s.sessions) && s.sessions.some((sess) => sess.ambiguousTime)
    );
    if (unresolvedAmbiguous) {
      const ambigIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, unresolvedAmbiguous));
      if (ambigIdx !== -1) {
        setActiveCourseIndex(ambigIdx);
      }
      const msg = `Check the AM/PM time for "${unresolvedAmbiguous.name || unresolvedAmbiguous.sectionCode || 'Course'}" before adding the extracted courses.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const internalConflict = pendingParsedSections.find((s) => {
      if (!Array.isArray(s.sessions)) return true;
      for (let i = 0; i < s.sessions.length; i++) {
        for (let j = i + 1; j < s.sessions.length; j++) {
          const a = s.sessions[i];
          const b = s.sessions[j];
          if (a.day === b.day && timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(b.start) < timeToMinutes(a.end)) return true;
        }
      }
      return false;
    });
    if (internalConflict) {
      const conflictIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, internalConflict));
      if (conflictIdx !== -1) {
        setActiveCourseIndex(conflictIdx);
      }
      const msg = `The meeting times for "${internalConflict.name || internalConflict.sectionCode || 'Course'}" overlap. Fix the times before adding the course.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const unresolvedReview = pendingParsedSections.find((section) => {
      const isCodeFilled = Boolean(section.sectionCode?.trim() || section.name?.trim());
      const codes = Array.from(new Set((section.reviewReasons || []).map(reviewReasonCode))).filter((code) => {
        if (code === 'course_code_missing' && isCodeFilled) return false;
        if (code === 'section_code_missing' && isCodeFilled) return false;
        return true;
      });
      const blocking = codes.some((code) => REVIEW_BLOCKING_CODES.has(code));
      const acknowledgementNeeded = codes.some((code) => REVIEW_ACKNOWLEDGEMENT_CODES.has(code));
      return blocking || (acknowledgementNeeded && !section.reviewAcknowledged);
    });
    if (unresolvedReview) {
      const reviewIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, unresolvedReview));
      if (reviewIdx !== -1) setActiveCourseIndex(reviewIdx);
      const isCodeFilled = Boolean(unresolvedReview.sectionCode?.trim() || unresolvedReview.name?.trim());
      const codes = Array.from(new Set((unresolvedReview.reviewReasons || []).map(reviewReasonCode))).filter((code) => {
        if (code === 'course_code_missing' && isCodeFilled) return false;
        if (code === 'section_code_missing' && isCodeFilled) return false;
        return true;
      });
      const blockingCode = codes.find((code) => REVIEW_BLOCKING_CODES.has(code));
      const message = blockingCode
        ? `${reviewReasonLabel(blockingCode)} Fix or confirm this issue before adding the extracted courses.`
        : `Please acknowledge the review note for "${unresolvedReview.name || unresolvedReview.sectionCode || 'Course'}" before adding the extracted courses.`;
      setReviewModalError(message);
      setOcrError(message);
      reviewScrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const duplicatePendingId = pendingParsedSections.find((s, idx) =>
      pendingParsedSections.some((other, otherIdx) =>
        otherIdx !== idx &&
        (other.courseKey || normalizeCourseName(other.name)) === (s.courseKey || normalizeCourseName(s.name)) &&
        (other.sectionCode || '').trim().toLowerCase() === (s.sectionCode || '').trim().toLowerCase() &&
        Boolean(other.sectionCodeMissing) === false && Boolean(s.sectionCodeMissing) === false
      )
    );
    if (duplicatePendingId) {
      const dupIdx = pendingCourseGroups.findIndex(
        (g) => normalizeCourseName(g.courseName) === normalizeCourseName(duplicatePendingId.name)
      );
      if (dupIdx !== -1) {
        setActiveCourseIndex(dupIdx);
      }
      const msg = `Course code "${duplicatePendingId.sectionCode}" is used more than once in "${duplicatePendingId.name}". Give each option its own course code.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    for (let i = 0; i < pendingCourseGroups.length; i++) {
      const group = pendingCourseGroups[i];
      const validationError = validateSingleCourseGroup(group);
      if (validationError) {
        setActiveCourseIndex(i);
        setReviewModalError(validationError);
        setOcrError(validationError);
        if (reviewScrollContainerRef.current) {
          reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }
    }

    const finalizedSections = pendingParsedSections.map((s) => {
      const visibleCode = s.sectionCode?.trim() || '';
      const finalCourseName = sanitizeCourseNameOnly(s.name.trim());
      return {
        ...s,
        // Keep the OCR-generated internal ID as the application identity. The
        // visible course code is a separate source field and may legitimately be null.
        id: s.id,
        sectionCode: visibleCode || null,
        sectionCodeMissing: !visibleCode,
        name: finalCourseName,
        credits: Number(s.credits),
        courseKey: s.courseKey || getCourseIdentityKey(s.courseCode, finalCourseName),
        sessions: s.sessions.map((sess) => ({ ...sess, ambiguousTime: false, resolvedFromAmbiguousTime: Boolean(sess.resolvedFromAmbiguousTime) || Boolean(sess.ambiguousTime) })),
      };
    });

    const insertedResult = onAddSections(finalizedSections);
    const count = getInsertedCount(insertedResult);
    const skipped = getSkippedCount(insertedResult);

    // Calculate unique courses count and total credits for the toast
    const courseCreditsMap = new Map<string, number>();
    finalizedSections.forEach((s) => {
      const key = s.courseKey || getCourseIdentityKey(s.sectionCode, s.name);
      if (!courseCreditsMap.has(key)) {
        courseCreditsMap.set(key, Number(s.credits) || 0);
      }
    });
    const totalCreditsAdded = Array.from(courseCreditsMap.values()).reduce((sum, c) => sum + c, 0);
    const uniqueCoursesCount = courseCreditsMap.size || count;

    setPendingParsedSections(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setOcrError(null);
    setReviewModalError(null);
    setWorkflowPanel('preferences');
    dispatchWorkflow({ type: 'READY' });
    const failedScreenshotsBeforeSuccess = uploadedFiles.filter((f) => f.status === 'failed').length;
    setLastWorkflowAction(failedScreenshotsBeforeSuccess > 0 ? `Courses are ready. ${failedScreenshotsBeforeSuccess} screenshot${failedScreenshotsBeforeSuccess === 1 ? '' : 's'} still need attention.` : 'Course details are ready.');

    // Show temporary floating toast notification
    setAddedSuccessToast({
      coursesCount: uniqueCoursesCount,
      message: `${uniqueCoursesCount} ${uniqueCoursesCount === 1 ? 'Course added' : 'Courses added'}`,
      subMessage: skipped > 0 ? `${skipped} duplicate ${skipped === 1 ? 'course' : 'courses'} skipped` : undefined,
    });
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setAddedSuccessToast(null);
    }, 5000);

    // Smoothly scroll directly to Step 2
    window.setTimeout(() => {
      const step2Element = document.getElementById('responsive-fit-title') || document.querySelector('.responsive-fit-card');
      step2Element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    // Retain only failed screenshots so users can retry them if needed.
    setUploadedFiles((prev) => {
      const retained = prev.filter((f) => f.status === 'failed');
      prev.filter((f) => f.status !== 'failed').forEach((f) => URL.revokeObjectURL(f.preview));
      return retained;
    });
  };

  const handleUpdateCourseCredits = (courseName: string, creditsVal: number | null, autoAdvance: boolean = true, courseKey?: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(courseName);
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            const matches = courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey : normalizeCourseName(s.name) === targetNorm;
            return matches ? { ...s, credits: creditsVal } : s;
          })
        : null
    );

    if (autoAdvance && creditsVal !== null) {
      const currIdx = pendingCourseGroups.findIndex(
        (g) => courseKey ? g.courseKey === courseKey : normalizeCourseName(g.courseName) === targetNorm
      );
      const effectiveIdx = currIdx !== -1 ? currIdx : activeCourseIndex;
      if (effectiveIdx < pendingCourseGroups.length - 1) {
        const currentGroup = pendingCourseGroups[effectiveIdx];
        const groupWithCredits: GroupedCourse = {
          ...currentGroup,
          credits: creditsVal,
          sections: (currentGroup?.sections || []).map((s) => ({ ...s, credits: creditsVal })),
        };
        const validationError = validateSingleCourseGroup(groupWithCredits);
        if (validationError) {
          setReviewModalError(validationError);
          setOcrError(validationError);
          return;
        }
        setTimeout(() => {
          handleNavigateCourse(effectiveIdx + 1);
        }, 160);
      }
    }
  };

  // Delete an entire extracted course from the review dialog before adding
  const handleDeletePendingCourse = (courseName: string, courseKey?: string) => {
    if (!pendingParsedSections) return;
    const targetNorm = normalizeCourseName(courseName);
    const remaining = pendingParsedSections.filter(
      (s) => courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) !== courseKey : normalizeCourseName(s.name) !== targetNorm
    );

    if (remaining.length === 0) {
      setPendingParsedSections(null);
      setActiveCourseIndex(0);
      setOcrNotice('The extracted courses were removed from review.');
    } else {
      setPendingParsedSections(remaining);
      setActiveCourseIndex((prev) => Math.min(prev, Math.max(0, pendingCourseGroups.length - 2)));
    }
  };

  // Rename an extracted course across all its sections in the review dialog
  const handleUpdatePendingCourseName = (oldName: string, newName: string, courseKey?: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(oldName);
    const cleanedName = sanitizeBoundedText(newName, 240).trim();
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            const matches = courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey : normalizeCourseName(s.name) === targetNorm;
            if (!matches) return s;
            // A course-code-backed identity remains code-backed after a title edit.
            return { ...s, name: cleanedName, courseKey: getCourseIdentityKey(s.courseCode, cleanedName), userOverrides: { ...(s.userOverrides || {}), name: cleanedName } };
          })
        : null
    );
  };

  // Update a specific section ID in the review dialog
  const handleUpdatePendingSectionId = (targetSec: Section, newId: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const cleaned = newId;
    const isFilled = Boolean(cleaned.trim());
    setPendingParsedSections((prev) =>
      prev ? prev.map((s) => {
        if (s.id !== targetSec.id) return s;
        const nextReasons = (s.reviewReasons || []).filter((r) => {
          const code = reviewReasonCode(r);
          if (code === 'course_code_missing') return false;
          if (code === 'section_code_missing' && isFilled) return false;
          return true;
        });
        const hasSessionIssue = (s.sessions || []).some((m) => !m.day || !ALL_DAYS.includes(m.day) || !m.start?.trim() || !m.end?.trim() || !m.type?.trim());
        return {
          ...s,
          sectionCode: cleaned,
          sectionCodeMissing: !isFilled,
          id: s.id,
          needsReview: nextReasons.length > 0 || !isFilled || hasSessionIssue,
          reviewReasons: nextReasons,
        };
      }) : null
    );
  };

  // Delete a specific section from an extracted course
  const handleDeletePendingSection = (targetSec: Section, courseName: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(courseName);
    const targetKey = targetSec.courseKey || getCourseIdentityKey(targetSec.courseCode, targetSec.name);
    const courseSections = pendingParsedSections.filter(
      (s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === targetKey
    );

    if (courseSections.length <= 1) {
      // If only 1 section in course, deleting this section removes the course
      handleDeletePendingCourse(courseName, targetSec.courseKey);
      return;
    }

    setPendingParsedSections((prev) =>
      prev ? prev.filter((s) => s.id !== targetSec.id) : null
    );
  };

  // Add an alternate section to an extracted course
  const handleAddPendingSection = (courseName: string, credits: number | null, courseKey?: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(courseName);
    const resolvedTargetKey = courseKey || getCourseIdentityKey(null, targetNorm);
    const courseSections = pendingParsedSections.filter(
      (s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === resolvedTargetKey
    );

    const targetKey = courseSections[0]?.courseKey || resolvedTargetKey;
    const existingIds = new Set([
      ...savedCourseGroups.filter((g) => g.courseKey === targetKey).flatMap((g) => g.sections.map((s) => s.sectionCode?.trim().toLowerCase()).filter((code): code is string => Boolean(code))),
      ...pendingParsedSections.filter((s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === targetKey).map((s) => (s.sectionCode || '').trim().toLowerCase()).filter(Boolean),
    ]);
    let secNum = courseSections.length + 1;
    let candId = `0${secNum}`;
    while (existingIds.has(candId.toLowerCase())) {
      secNum++;
      candId = `0${secNum}`;
    }

    const newSection: Section = {
      id: `pending:${createLocalId('section')}`,
      name: courseName,
      courseKey: targetKey,
      sectionCode: candId,
      sectionCodeMissing: false,
      needsReview: true,
      reviewReasons: ['day_missing_or_unrecognized', 'timing_missing', 'meeting_type_missing'],
      credits: credits,
      sessions: [
        {
          id: createLocalId('pending-session'),
          day: '' as unknown as DayOfWeek,
          start: '',
          end: '',
          type: '' as unknown as MeetingType,
        },
      ],
    };

    setPendingParsedSections((prev) => (prev ? [...prev, newSection] : [newSection]));
  };

  // Update a specific session (day, start, end, type) in a section
  const handleUpdatePendingMeeting = (
    targetSec: Section,
    sessionIndex: number,
    field: keyof Meeting,
    val: any
  ) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            const updatedMeetings = s.sessions.map((sess, idx) =>
              idx === sessionIndex
                ? {
                    ...sess,
                    [field]: val,
                    ...(field === 'start' || field === 'end' ? { ambiguousTime: false } : {}),
                  }
                : sess
            );

            const hasMissingDay = updatedMeetings.some((m) => !m.day || !ALL_DAYS.includes(m.day));
            const hasMissingTime = updatedMeetings.some((m) => !m.start?.trim() || !m.end?.trim());
            const hasInvalidOrder = updatedMeetings.some((m) => m.start?.trim() && m.end?.trim() && timeToMinutes(m.start) >= timeToMinutes(m.end));
            const hasMissingType = updatedMeetings.some((m) => !m.type || !m.type.trim());

            let nextReasons = (s.reviewReasons || []).filter((r) => {
              const code = reviewReasonCode(r);
              if (code === 'course_code_missing') return false;
              if (code === 'day_missing_or_unrecognized' && !hasMissingDay) return false;
              if ((code === 'start_time_missing_or_unrecognized' || code === 'end_time_missing_or_unrecognized' || code === 'timing_missing') && !hasMissingTime) return false;
              if (code === 'invalid_time_order' && !hasInvalidOrder) return false;
              if (code === 'meeting_type_missing' && !hasMissingType) return false;
              return true;
            });

            if (hasMissingDay && !nextReasons.some((r) => reviewReasonCode(r) === 'day_missing_or_unrecognized')) {
              nextReasons.push('day_missing_or_unrecognized');
            }
            if (hasMissingTime && !nextReasons.some((r) => ['start_time_missing_or_unrecognized', 'end_time_missing_or_unrecognized', 'timing_missing'].includes(reviewReasonCode(r)))) {
              nextReasons.push('timing_missing');
            }
            if (hasInvalidOrder && !nextReasons.some((r) => reviewReasonCode(r) === 'invalid_time_order')) {
              nextReasons.push('invalid_time_order');
            }
            if (hasMissingType && !nextReasons.some((r) => reviewReasonCode(r) === 'meeting_type_missing')) {
              nextReasons.push('meeting_type_missing');
            }

            const stillNeedsReview = nextReasons.length > 0 || hasMissingDay || hasMissingTime || hasInvalidOrder || hasMissingType;

            return {
              ...s,
              sessions: updatedMeetings,
              reviewReasons: nextReasons,
              needsReview: stillNeedsReview,
            };
          })
        : null
    );
  };

  // Add a meeting session row to a section
  const handleAddPendingMeeting = (targetSec: Section) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            const newSess: Meeting = {
              id: createLocalId('pending-session'),
              day: '' as unknown as DayOfWeek,
              start: '',
              end: '',
              type: '' as unknown as MeetingType,
            };
            const updated = [...s.sessions, newSess];
            const nextReasons = Array.from(new Set([...(s.reviewReasons || []), 'day_missing_or_unrecognized', 'timing_missing', 'meeting_type_missing']));
            return {
              ...s,
              sessions: updated,
              needsReview: true,
              reviewReasons: nextReasons,
            };
          })
        : null
    );
  };

  // Delete a meeting session row from a section (preserving at least one)
  const handleDeletePendingMeeting = (targetSec: Section, sessionIndex: number) => {
    if (!pendingParsedSections) return;
    if (targetSec.sessions.length <= 1) return;
    setReviewModalError(null);

    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            const updatedMeetings = s.sessions.filter((_, idx) => idx !== sessionIndex);
            const hasMissingDay = updatedMeetings.some((m) => !m.day || !ALL_DAYS.includes(m.day));
            const hasMissingTime = updatedMeetings.some((m) => !m.start?.trim() || !m.end?.trim());
            const hasInvalidOrder = updatedMeetings.some((m) => m.start?.trim() && m.end?.trim() && timeToMinutes(m.start) >= timeToMinutes(m.end));
            const hasMissingType = updatedMeetings.some((m) => !m.type || !m.type.trim());

            let nextReasons = (s.reviewReasons || []).filter((r) => {
              const code = reviewReasonCode(r);
              if (code === 'course_code_missing') return false;
              if (code === 'day_missing_or_unrecognized' && !hasMissingDay) return false;
              if ((code === 'start_time_missing_or_unrecognized' || code === 'end_time_missing_or_unrecognized' || code === 'timing_missing') && !hasMissingTime) return false;
              if (code === 'invalid_time_order' && !hasInvalidOrder) return false;
              if (code === 'meeting_type_missing' && !hasMissingType) return false;
              return true;
            });

            return {
              ...s,
              sessions: updatedMeetings,
              reviewReasons: nextReasons,
              needsReview: nextReasons.length > 0 || hasMissingDay || hasMissingTime || hasInvalidOrder || hasMissingType,
            };
          })
        : null
    );
  };

  // Manual Form Handlers
  const handleRemoveManualForm = (formIndex: number) => {
    setManualError(null);
    setManualForms((prev) => {
      if (prev.length <= 1) return [createEmptyManualForm('1')];
      return prev.filter((_, idx) => idx !== formIndex);
    });
    setResponsiveManualOpenIndex((current) => {
      if (current === null) return null;
      if (current === formIndex) return Math.max(0, current - 1);
      if (current > formIndex) return current - 1;
      return current;
    });
  };

  const handleAddMeetingRow = (formIndex: number, defaultType: MeetingType | '' = '') => {
    setManualError(null);
    let nextSessionId: string | null = null;
    setManualForms((prev) =>
      prev.map((f, idx) => {
        if (idx !== formIndex) return f;
        const next = createEmptyMeeting(createLocalId(`session-${f.sessions.length}`), defaultType);
        nextSessionId = next.id;
        return { ...f, sessions: [...f.sessions, next] };
      })
    );
    window.setTimeout(() => {
      if (nextSessionId) document.getElementById(`manual-session-${nextSessionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const handleRemoveMeetingRow = (formIndex: number, sessionIndex: number) => {
    setManualError(null);
    const focusSessionId = manualForms[formIndex]?.sessions[Math.max(0, sessionIndex - 1)]?.id || manualForms[formIndex]?.sessions[sessionIndex + 1]?.id;
    setManualForms((prev) =>
      prev.map((f, idx) =>
        idx === formIndex && f.sessions.length > 1
          ? { ...f, sessions: f.sessions.filter((_, sIdx) => sIdx !== sessionIndex) }
          : f
      )
    );
    window.setTimeout(() => {
      if (focusSessionId) document.getElementById(`manual-session-${focusSessionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const isMeetingValid = (s: ManualMeetingRow) => {
    if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) return false;
    if (!s.start || !s.start.trim() || !s.end || !s.end.trim()) return false;
    const start = timeToMinutes(s.start);
    const end = timeToMinutes(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
    if (!isManualMeetingType(s.type)) return false;
    return s.type !== 'Custom' || Boolean(s.customType?.trim());
  };

  const hasMeetingOverlap = (sessions: ManualMeetingRow[]) => {
    const valid = sessions.filter(isMeetingValid);
    for (let i = 0; i < valid.length; i++) {
      const a = valid[i];
      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      for (let j = i + 1; j < valid.length; j++) {
        const b = valid[j];
        if (a.day !== b.day) continue;
        const bStart = timeToMinutes(b.start);
        const bEnd = timeToMinutes(b.end);
        if (aStart < bEnd && bStart < aEnd) return true;
      }
    }
    return false;
  };

  const isFormValid = (f: ManualFormState) => {
    if (!f.name.trim()) return false;
    if (!f.courseCode.trim()) return false;
    const rawCredits = f.credits.trim();
    if (!rawCredits || !/^\d+(\.\d+)?$/.test(rawCredits) || parseCreditHours(rawCredits) === null) return false;
    if (!f.sessions || f.sessions.length === 0) return false;
    if (!f.sessions.every(isMeetingValid)) return false;
    return !hasMeetingOverlap(f.sessions);
  };

  const scrollToErrorLocation = (
    formId?: string,
    field?: 'name' | 'courseCode' | 'credits' | 'session',
    sessionId?: string
  ) => {
    if (!formId) return;
    setTimeout(() => {
      let targetEl: HTMLElement | null = null;
      if (sessionId) {
        targetEl = document.getElementById(`manual-session-${sessionId}`);
      } else if (field) {
        targetEl = document.getElementById(`manual-field-${formId}-${field}`);
      }
      if (!targetEl) {
        targetEl = document.getElementById(`manual-form-${formId}`);
      }
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input =
          targetEl.tagName === 'INPUT' || targetEl.tagName === 'SELECT'
            ? targetEl
            : targetEl.querySelector('input, select');
        (input as HTMLElement)?.focus();
      }
    }, 60);
  };

  const handleSaveManualSections = (): boolean => {
    setManualError(null);

    // Check if any form card has partial content (course code or times entered) but is missing course name
    for (let fIdx = 0; fIdx < manualForms.length; fIdx++) {
      const f = manualForms[fIdx];
      const hasName = f.name.trim().length > 0;
      const hasCourseCode = f.courseCode.trim().length > 0;
      const hasMeetingTimes = f.sessions.some(
        (s) => (s.start && s.start.trim().length > 0) || (s.end && s.end.trim().length > 0)
      );

      if (!hasName && (hasCourseCode || hasMeetingTimes)) {
        const msg = `Add a course name for course ${fIdx + 1}${f.courseCode ? ` ("${f.courseCode}")` : ''}.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'name');
        return false;
      }
    }

    const formsWithContent = manualForms.filter((f) => f.name.trim().length > 0);

    for (const f of formsWithContent) {
      if (!f.courseCode.trim()) {
        const msg = 'Add a course code.';
        setManualError(msg);
        scrollToErrorLocation(f.id, 'courseCode');
        return false;
      }
    }

    if (formsWithContent.length === 0) {
      const msg = 'Add at least one course name.';
      setManualError(msg);
      scrollToErrorLocation(manualForms[0]?.id, 'name');
      return false;
    }

    // Validate course code uniqueness among entered forms
    const seenCourseCompoundKeys = new Set<string>();
    for (const f of formsWithContent) {
      const courseCode = f.courseCode.trim();
      const courseKey = getCourseIdentityKey(courseCode, f.name);
      const canonicalCode = canonicalizeSectionIdentity(courseCode);
      const compoundKey = `${courseKey}:::${canonicalCode.toLowerCase()}`;
      if (seenCourseCompoundKeys.has(compoundKey)) {
        const msg = `Course code "${courseCode}" is entered more than once for "${f.name.trim()}". Use "Add another course" for a different course code.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'courseCode');
        return false;
      }
      seenCourseCompoundKeys.add(compoundKey);

      const existsInCatalog = savedCourseGroups.some(
        (g) => g.courseKey === courseKey && g.sections.some((section) =>
          canonicalizeSectionIdentity(String(section.courseCode || section.sectionCode || '')) === canonicalCode
        )
      );
      if (existsInCatalog) {
        const msg = `Course code "${courseCode}" already exists for "${f.name.trim()}".`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'courseCode');
        return false;
      }
    }

    const validSections: Section[] = [];

    for (let fIdx = 0; fIdx < formsWithContent.length; fIdx++) {
      const f = formsWithContent[fIdx];
      const rawCourseName = sanitizeBoundedText(f.name, 160);
      const courseName = sanitizeCourseNameOnly(rawCourseName, f.courseCode);

      if (!f.sessions || f.sessions.length === 0) {
        const msg = `Add at least one meeting day and time for "${courseName}".`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'session');
        return false;
      }

      const validatedMeetings: Meeting[] = [];

      for (let sIdx = 0; sIdx < f.sessions.length; sIdx++) {
        const s = f.sessions[sIdx];
        if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) {
          const msg = `Choose a valid day for meeting #${sIdx + 1} of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (!s.start || !s.start.trim()) {
          const msg = `Enter a valid start time for meeting #${sIdx + 1} (${s.day}) of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (!s.end || !s.end.trim()) {
          const msg = `Enter a valid end time for meeting #${sIdx + 1} (${s.day}) of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        const startMin = timeToMinutes(s.start);
        const endMin = timeToMinutes(s.end);
        if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
          const msg = `The start time must be earlier than the end time for meeting #${sIdx + 1} (${s.day}) in "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }

        if (!isManualMeetingType(s.type)) {
          const msg = `Choose a valid meeting type for meeting #${sIdx + 1} of \"${courseName}\".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (s.type === 'Custom' && !s.customType?.trim()) {
          const msg = `Enter a custom meeting type for meeting #${sIdx + 1} of \"${courseName}\".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }

        const sessionType = s.type || 'Lecture';

        validatedMeetings.push({
          id: s.id || createLocalId('session'),
          day: s.day as DayOfWeek,
          start: s.start.trim(),
          end: s.end.trim(),
          type: sessionType,
          customType: s.type === 'Custom' ? (s.customType?.trim() || '') : '',
        });
      }

      // Validate that sessions within the same section do not conflict with each other
      for (let i = 0; i < validatedMeetings.length; i++) {
        const a = validatedMeetings[i];
        const aStart = timeToMinutes(a.start);
        const aEnd = timeToMinutes(a.end);
        for (let j = i + 1; j < validatedMeetings.length; j++) {
          const b = validatedMeetings[j];
          if (a.day === b.day) {
            const bStart = timeToMinutes(b.start);
            const bEnd = timeToMinutes(b.end);
            if (aStart < bEnd && bStart < aEnd) {
              const msg = `Meeting times #${i + 1} and #${j + 1} overlap on ${a.day} in "${courseName}". A section can’t have overlapping meeting times.`;
              setManualError(msg);
              scrollToErrorLocation(f.id, 'session', f.sessions[j]?.id);
              return false;
            }
          }
        }
      }

      // Credits validation: NEVER silently clamp out-of-range inputs!
      const rawCredits = f.credits ? f.credits.trim() : '';
      if (rawCredits === '') {
        const msg = `Add the credit hours for "${courseName}".`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      if (!/^\d+(\.\d+)?$/.test(rawCredits)) {
        const msg = `Credits for "${courseName}" must be a valid number.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      const parsedCredits = parseCreditHours(rawCredits);
      if (parsedCredits === null) {
        const msg = `Credits for "${courseName}" must be a valid number.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      const cleanCourseCode = sanitizeBoundedText(f.courseCode, 80);
      const sectionId = `${cleanCourseCode}::${cleanCourseCode}`;

      validSections.push({
        id: sectionId,
        name: courseName,
        courseCode: cleanCourseCode,
        sectionCode: cleanCourseCode,
        credits: parsedCredits,
        instructor: f.instructor ? f.instructor.trim() : null,
        sourceKind: 'manual',
        editedFields: [],
        sessions: validatedMeetings,
      });
    }

    if (validSections.length > 0) {
      const insertedResult = onAddSections(validSections);
      const count = getInsertedCount(insertedResult);
      const skipped = getSkippedCount(insertedResult);

      const courseCreditsMap = new Map<string, number>();
      validSections.forEach((s) => {
        const key = s.courseKey || getCourseIdentityKey(s.sectionCode, s.name);
        if (!courseCreditsMap.has(key)) {
          courseCreditsMap.set(key, Number(s.credits) || 0);
        }
      });
      const totalCreditsAdded = Array.from(courseCreditsMap.values()).reduce((sum, c) => sum + c, 0);
      const uniqueCoursesCount = courseCreditsMap.size || count;

      setAddedSuccessToast({
        coursesCount: uniqueCoursesCount,
        message: `${uniqueCoursesCount} ${uniqueCoursesCount === 1 ? 'Course added' : 'Courses added'}`,
        subMessage: skipped > 0 ? `${skipped} duplicate ${skipped === 1 ? 'course' : 'courses'} skipped` : undefined,
      });
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      toastTimeoutRef.current = window.setTimeout(() => {
        setAddedSuccessToast(null);
      }, 5000);

      window.setTimeout(() => {
        const step2Element = document.getElementById('responsive-fit-title') || document.querySelector('.responsive-fit-card');
        step2Element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      setManualForms([createEmptyManualForm('1')]);
      try {
        safeStorage.sessionRemoveItem(STORAGE_KEY_MANUAL_FORMS);
      } catch {}
      setManualError(null);
      return true;
    }
    return false;
  };

  // Section Editing Handlers (#2)
  const handleStartEditSection = (sec: Section, courseName: string) => {
    setEditingSection({
      originalId: sec.id,
      originalCourseName: courseName,
      courseName: sec.name || courseName,
      courseCode: sec.courseCode || '',
      sectionCode: sec.sectionCode || '',
      credits: sec.credits == null ? '' : String(sec.credits),
      instructor: sec.instructor || '',
      sessions: sec.sessions.map((s, idx) => ({
        id: s.id || `edit-s-${idx}`,
        day: s.day,
        start: s.start,
        rawStart: s.start,
        end: s.end,
        rawEnd: s.end,
        type: isManualMeetingType(s.type) ? s.type : 'Custom',
        customType: s.type === 'Custom' ? (s.customType || '') : (!isManualMeetingType(s.type) ? s.type : ''),
      })),
      error: null,
    });
  };

  const handleAddEditMeeting = () => {
    setEditingSection((prev) => {
      if (!prev) return null;
      const newSess: ManualMeetingRow = {
        id: `edit-s-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        day: 'MON',
        start: '',
        rawStart: '',
        end: '',
        rawEnd: '', 
        type: 'Lecture',
        customType: '',
      };
      return {
        ...prev,
        sessions: [...prev.sessions, newSess],
      };
    });
  };

  const handleRemoveEditMeeting = (sessionIndex: number) => {
    setEditingSection((prev) => {
      if (!prev || prev.sessions.length <= 1) return prev;
      return {
        ...prev,
        sessions: prev.sessions.filter((_, idx) => idx !== sessionIndex),
      };
    });
  };

  const handleSaveEditSection = () => {
    if (!editingSection) return;
    const courseName = editingSection.courseName.trim();
    const courseCode = editingSection.courseCode.trim();
    const sectionCode = editingSection.sectionCode.trim();

    if (!courseName) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a course name.' } : null));
      return;
    }
    if (!courseCode) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a course code.' } : null));
      return;
    }
    if (!sectionCode) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a section code.' } : null));
      return;
    }

    const rawCredits = editingSection.credits.trim();
    if (!rawCredits) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Enter credit hours.' } : null));
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(rawCredits)) {
      setEditingSection((prev) =>
        prev
          ? {
              ...prev,
              error: `Credits must be a valid number (entered: "${editingSection.credits}").`,
            }
          : null
      );
      return;
    }
    const parsedCr = parseCreditHours(rawCredits);
    if (parsedCr === null) {
      setEditingSection((prev) =>
        prev
          ? {
              ...prev,
              error: `Credits must be a valid number (entered: "${editingSection.credits}").`,
            }
          : null
      );
      return;
    }

    if (!editingSection.sessions || editingSection.sessions.length === 0) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add at least one meeting time.' } : null));
      return;
    }

    const validatedMeetings: Meeting[] = [];
    for (let idx = 0; idx < editingSection.sessions.length; idx++) {
      const s = editingSection.sessions[idx];
      if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Choose a valid day for meeting #${idx + 1}.` } : null));
        return;
      }
      if (!s.start || !s.start.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a valid start time for meeting #${idx + 1} (${s.day}).` } : null));
        return;
      }
      if (!s.end || !s.end.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a valid end time for meeting #${idx + 1} (${s.day}).` } : null));
        return;
      }
      if (!isManualMeetingType(s.type)) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Choose a valid meeting type for meeting #${idx + 1}.` } : null));
        return;
      }
      if (s.type === 'Custom' && !s.customType?.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a custom meeting type for meeting #${idx + 1}.` } : null));
        return;
      }

      const sMin = timeToMinutes(s.start);
      const eMin = timeToMinutes(s.end);
      if (!Number.isFinite(sMin) || !Number.isFinite(eMin) || sMin >= eMin) {
        setEditingSection((prev) =>
          prev
            ? {
                ...prev,
                error: `Start time (${formatTo12Hour(s.start)}) must be strictly earlier than end time (${formatTo12Hour(s.end)}) for meeting #${idx + 1}.`,
              }
            : null
        );
        return;
      }

      validatedMeetings.push({
        id: s.id || createLocalId('session'),
        day: s.day as DayOfWeek,
        start: s.start.trim(),
        end: s.end.trim(),
        type: s.type === 'Custom' ? 'Custom' : (s.type || 'Lecture'),
        customType: s.type === 'Custom' ? (s.customType?.trim() || '') : '',
      });
    }

    // Validate that sessions within the edited section do not conflict with each other
    for (let i = 0; i < validatedMeetings.length; i++) {
      const a = validatedMeetings[i];
      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      for (let j = i + 1; j < validatedMeetings.length; j++) {
        const b = validatedMeetings[j];
        if (a.day === b.day) {
          const bStart = timeToMinutes(b.start);
          const bEnd = timeToMinutes(b.end);
          if (aStart < bEnd && bStart < aEnd) {
            setEditingSection((prev) =>
              prev
                ? {
                    ...prev,
                    error: `Meeting times #${i + 1} (${formatTo12Hour(a.start)}-${formatTo12Hour(a.end)}) and #${j + 1} (${formatTo12Hour(b.start)}-${formatTo12Hour(b.end)}) overlap on ${a.day}. Meeting times in the same section cannot overlap.`,
                  }
                : null
            );
            return;
          }
        }
      }
    }

    // Course name is course identity. A section edit may not silently merge into
    // another course. A rename to a new course is explicit and clearly described.
    const newCourseKey = getCourseIdentityKey(courseCode, courseName);
    const originalSectionForEdit = sections.find((sec) => sec.id === editingSection.originalId && normalizeCourseName(sec.name) === normalizeCourseName(editingSection.originalCourseName));
    const originalCourseKey = originalSectionForEdit?.courseKey || getCourseIdentityKey(originalSectionForEdit?.courseCode, originalSectionForEdit?.name || editingSection.originalCourseName);
    const targetGroup = savedCourseGroups.find((g) => g.courseKey === newCourseKey);
    if (newCourseKey !== originalCourseKey) {
      if (targetGroup) {
        setEditingSection((prev) =>
          prev ? { ...prev, error: `This section can’t be moved into "${courseName}" because it could mix unrelated course data. Edit the target course separately instead.` } : null
        );
        return;
      }
      // A move to a new course identity is allowed only when that identity does not already exist.
    }
    // Check collision with another section in the same logical course
    if (targetGroup) {
      const hasCollision = targetGroup.sections.some(
        (s) => canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalizeSectionIdentity(sectionCode) &&
          s.id.toLowerCase() !== editingSection.originalId.toLowerCase()
      );
      if (hasCollision) {
        setEditingSection((prev) =>
          prev ? { ...prev, error: `Section "${sectionCode}" already exists for "${courseName}". Choose a different section code.` } : null
        );
        return;
      }
    }

    const originalSection = originalSectionForEdit;
    const cleanCourseCode = sanitizeBoundedText(courseCode, 80);
    const cleanSectionCode = sanitizeBoundedText(sectionCode, 80);
    const updatedSection: Section = {
      ...(originalSection || {}),
      id: originalSection?.id || `${cleanCourseCode}::${cleanSectionCode}`,
      name: courseName,
      courseCode: cleanCourseCode,
      sectionCode: cleanSectionCode,
      courseKey: getCourseIdentityKey(cleanCourseCode, courseName),
      credits: parsedCr,
      instructor: editingSection.instructor?.trim() || originalSection?.instructor || null,
      sessions: validatedMeetings,
      sourceEvidence: originalSection?.sourceEvidence || { sourceImageIndexes: originalSection?.sourceImageIndexes || [], ocrRunId: originalSection?.ocrRunId },
      userOverrides: {
        ...(originalSection?.userOverrides || {}),
        name: courseName, courseCode: cleanCourseCode, sectionCode: cleanSectionCode, credits: parsedCr, instructor: editingSection.instructor?.trim() || null, meetings: validatedMeetings.map((m) => `${m.day}|${m.start}|${m.end}|${m.type}|${m.customType || ''}`).join(';'),
      },
      editedFields: Array.from(new Set([...(originalSection?.editedFields || []), 'name','courseCode','sectionCode','credits','instructor','sessions'])),
    };

    const updateAccepted = onUpdateSection?.(editingSection.originalId, updatedSection, editingSection.originalCourseName);
    if (updateAccepted === false) {
      setEditingSection((prev) => prev ? { ...prev, error: 'This edit would collide with an existing course or section. No changes were saved.' } : null);
      return;
    }
    setEditingSection(null);
  };

  const formsWithContent = manualForms.filter(isFormWithContent);
  const hasIncompleteManualDraft = manualForms.some((f) => isFormWithContent(f) && !f.name.trim());
  const hasManualIdentityCollision = (() => {
    const seen = new Set<string>();
    for (const f of formsWithContent) {
      if (!f.courseCode.trim() || !f.sectionCode.trim()) return true;
      const key = `${getCourseIdentityKey(f.courseCode, f.name)}:::${canonicalizeSectionIdentity(f.sectionCode).toLowerCase()}`;
      if (seen.has(key)) return true;
      seen.add(key);
      const group = savedCourseGroups.find((g) => g.courseKey === getCourseIdentityKey(f.courseCode, f.name));
      if (group?.sections.some((section) => canonicalizeSectionIdentity(String(section.sectionCode || '')) === canonicalizeSectionIdentity(f.sectionCode))) return true;
    }
    return false;
  })();
  const canSaveManualBatch = formsWithContent.length > 0 && !hasIncompleteManualDraft && !hasManualIdentityCollision && formsWithContent.every(isFormValid);

  // Preferences Toggles
  const mandatoryCourses = preferences.mandatoryCourses || [];
  const mandatoryCourseKeys = preferences.mandatoryCourseKeys || [];
  const isGroupMandatory = (group: typeof savedCourseGroups[number]) => {
    const key = group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName);
    return mandatoryCourseKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase());
  };

  const handleToggleMandatoryCourse = (group: typeof savedCourseGroups[number]) => {
    const key = group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName);
    const isCurrentlyChecked = mandatoryCourseKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const nextKeys = isCurrentlyChecked
      ? mandatoryCourseKeys.filter((candidate) => candidate.toLowerCase() !== key.toLowerCase())
      : [...mandatoryCourseKeys, key];
    const dedupedKeys = Array.from(new Map(nextKeys.map((candidate) => [candidate.toLowerCase(), candidate] as const)).values());
    const nextLabels = dedupedKeys
      .map((candidate) => savedCourseGroups.find((g) => (g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase() === candidate.toLowerCase())?.courseName || '')
      .filter(Boolean);
    onUpdatePreferences({ ...preferences, mandatoryCourses: nextLabels, mandatoryCourseKeys: dedupedKeys });
  };

  const handleSelectAllMandatory = () => {
    const allKeys = savedCourseGroups.map((g) => g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName));
    const allNames = savedCourseGroups.map((g) => g.courseName);
    onUpdatePreferences({ ...preferences, mandatoryCourses: allNames, mandatoryCourseKeys: allKeys });
  };

  const handleClearAllMandatory = () => {
    onUpdatePreferences({
      ...preferences,
      mandatoryCourses: [],
      mandatoryCourseKeys: [],
    });
  };

  const updateManualForm = (formIndex: number, patch: Partial<ManualFormState>) => {
    setManualError(null);
    setManualForms((prev) => prev.map((form, idx) => idx === formIndex ? { ...form, ...patch } : form));
  };

  const updateManualMeeting = (formIndex: number, sessionIndex: number, patch: Partial<ManualMeetingRow>) => {
    setManualError(null);
    setManualForms((prev) => prev.map((form, idx) => idx === formIndex
      ? { ...form, sessions: form.sessions.map((session, sIdx) => sIdx === sessionIndex ? { ...session, ...patch } : session) }
      : form
    ));
  };

  const scrollToAddCoursesArea = useCallback(() => {
    const doScroll = () => {
      const target =
        document.getElementById('responsive-choice-section') ||
        document.getElementById('responsive-section-intro') ||
        document.getElementById('responsive-add-title') ||
        document.getElementById('upload-dropzone') ||
        document.getElementById('step-add-courses-container');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };
    if (!doScroll()) {
      requestAnimationFrame(doScroll);
    }
    setTimeout(doScroll, 60);
    setTimeout(doScroll, 160);
  }, []);

  const handleBackFromWorkflow = useCallback(() => {
    const nextPanel: WorkflowPanel = savedCourseGroups.length > 0 ? 'preferences' : 'start';
    setWorkflowPanel(nextPanel);
    if (nextPanel === 'start') {
      scrollToAddCoursesArea();
    }
  }, [savedCourseGroups.length, setWorkflowPanel, scrollToAddCoursesArea]);

  const responsiveCourseBuilder = (
    <div
      className="responsive-product-shell"
      aria-label="Gadwal course builder"
      data-has-builder-sticky={responsivePanel === 'preferences' ? 'true' : 'false'}
      style={{ '--g-builder-sticky-height': `${responsivePanel === 'preferences' ? builderStickyHeight : 0}px` } as React.CSSProperties}
    >
      {responsivePanel === 'screenshots' && (
        <div className="responsive-panel-top">
          <button type="button" className="responsive-back-link" onClick={handleBackFromWorkflow}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <span className="responsive-step-label">1 · SCREENSHOTS</span>
          </div>
        </div>
      )}

      {responsivePanel !== 'start' && responsivePanel !== 'manual' && (
        <div className="responsive-context responsive-context-upload">
          <div className="responsive-context-row">
            <div>
              <h1>
                {savedCourseGroups.length > 0
                  ? 'Build a week that works for you.'
                  : 'Add your screenshots.'}
              </h1>
              {savedCourseGroups.length === 0 && (
                <p>Upload your schedule screenshots. We’ll extract the course options for you.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {!ocrServiceAvailable && (
        <div className="max-w-[42rem] mx-auto w-full mb-5">
          <WorkflowStatus
            kind="error"
            title="Screenshot reading is down right now."
            description="You can add your courses by hand instead."
          />
        </div>
      )}

      {responsivePanel === 'start' && (
        <>
        <section
          className={`responsive-primary-choice${isDragActive ? ' is-drag-active' : ''}`}
          id="responsive-choice-section"
          aria-labelledby="responsive-add-title"
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragActive(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragActive(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              setActiveTab('screenshot');
              setWorkflowPanel('screenshots');
              void handleFileSelect(e.dataTransfer.files);
            }
          }}
        >
          {savedCourseGroups.length > 0 && (
            <div className="mb-3">
              <button
                type="button"
                className="responsive-back-link"
                onClick={() => setWorkflowPanel('preferences')}
              >
                <ArrowLeft className="w-4 h-4" /> Back to my courses
              </button>
            </div>
          )}
          <div className="responsive-section-intro" id="responsive-section-intro">
            <span className="responsive-step-label">1 · ADD YOUR COURSES</span>
            <h2 id="responsive-add-title">
              {savedCourseGroups.length > 0 ? 'How do you want to add more courses?' : 'How do you want to add your courses?'}
            </h2>
          </div>

          <button
            type="button"
            className="responsive-big-choice cursor-pointer"
            onClick={() => {
              setActiveTab('screenshot');
              setWorkflowPanel('screenshots');
            }}
            disabled={isUploading}
          >
            <span>
              <span className="flex items-center gap-2 flex-wrap">
                <strong>Use screenshots</strong>
                <span className="px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider bg-brand-green/15 text-brand-green rounded">FAST</span>
              </span>
              <small>Best for a quick setup.</small>
            </span>
            <span className="responsive-big-choice-action flex items-center gap-2">
              <span className="responsive-cta-pill responsive-cta-pill-secondary">Upload screenshots <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></span>
            </span>
          </button>

          <button
            type="button"
            className="responsive-big-choice cursor-pointer"
            onClick={() => {
              setActiveTab('manual');
              setWorkflowPanel('manual');
              setResponsiveManualOpenIndex(0);
            }}
          >
            <span>
              <strong>Enter courses yourself</strong>
              <small>Useful if a screenshot missed a course, or you want to add one manually.</small>
            </span>
            <span className="responsive-big-choice-action flex items-center gap-2">
              <span className="responsive-cta-pill responsive-cta-pill-secondary">Enter courses <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></span>
            </span>
          </button>
        </section>
        </>
      )}

      {responsivePanel === 'screenshots' && (
        <section className="responsive-focus-panel" aria-labelledby="responsive-screenshots-title">
          <div
            className={`responsive-upload-hero${isDragActive ? ' is-drag-active' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragActive(false); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragActive(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void handleFileSelect(e.dataTransfer.files);
              }
            }}
          >
            <div className="responsive-upload-icon" aria-hidden="true">
              <Upload className="w-5 h-5 text-text-primary" />
            </div>
            <h2 id="responsive-screenshots-title">Select your screenshots</h2>
            <p>Drag them in, paste images, or choose files.</p>
            <p id="screenshot-upload-help" className="sr-only">PNG, JPEG, or WebP images. Multiple screenshots are allowed.</p>
            <button
              type="button"
              id="choose-screenshots-btn"
              className="responsive-primary-button responsive-wide-button responsive-upload-primary-cta"
              onClick={handleTriggerFileInput}
              disabled={isUploading || isPreparingFiles}
              aria-describedby="screenshot-upload-help"
              aria-busy={isUploading || isPreparingFiles}
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>
                {uploadedFiles.length > 0
                  ? 'Add more screenshots'
                  : 'Choose screenshots'}
              </span>
            </button>
            {(isUploading || isPreparingFiles) && uploadedFiles.length > 0 && (
              <div className="mt-4 max-w-sm mx-auto">
                <WorkflowStatus kind="info" title="You can add more once this is done." compact />
              </div>
            )}
            {!(isUploading || isPreparingFiles) && (
              <div className="responsive-upload-secondary-actions flex flex-wrap items-center justify-center gap-3 mt-4">
                <button
                  type="button"
                  id="upload-demo-link"
                  className="responsive-help-link responsive-help-link-secondary responsive-upload-helper-button cursor-pointer"
                  onClick={(event) => {
                    screenshotTipsTriggerRef.current = event.currentTarget;
                    onOpenDemo?.(event.currentTarget);
                  }}
                >
                  <span>Tips & formats</span>
                </button>
                <button
                  type="button"
                  className="responsive-help-link responsive-upload-helper-button responsive-upload-fallback-button cursor-pointer"
                  onClick={() => { setActiveTab('manual'); setWorkflowPanel('manual'); }}
                >
                  <span>Enter courses instead</span>
                </button>
              </div>
            )}
          </div>

          {(ocrError || showRecoveredNotice || ocrNotice || lastWorkflowAction) && (
            <div className="max-w-[42rem] mx-auto w-full space-y-3 mt-4">
              {ocrError && (
                <WorkflowStatus
                  kind={ocrErrorMeta ? 'error' : 'warning'}
                  title={
                    ocrErrorMeta?.retryable ? "That didn't work, let's give it another try." :
                    ocrErrorMeta ? "We hit an error reading your screenshots." :
                    "Screenshot reading needs attention."
                  }
                  description={ocrError}
                  actionLabel={ocrErrorMeta?.retryable ? (ocrRetryAfterSeconds > 0 ? `Try again in ${ocrRetryAfterSeconds}s` : 'Retry screenshots') : undefined}
                  onAction={ocrErrorMeta?.retryable ? handleRetryFailed : undefined}
                  actionDisabled={ocrRetryAfterSeconds > 0 || isUploading}
                />
              )}

              {showRecoveredNotice && (
                <WorkflowStatus
                  kind="warning"
                  title="We found your unfinished review"
                  description="The original screenshots are gone, so double-check the course details below before saving."
                  onClose={() => setShowRecoveredNotice(false)}
                />
              )}

              {ocrNotice && (
                <WorkflowStatus kind="info" title="Notice" description={ocrNotice} onClose={() => setOcrNotice(null)} />
              )}

              {lastWorkflowAction && (
                <WorkflowStatus kind="info" title="Action" description={lastWorkflowAction} onClose={() => setLastWorkflowAction(null)} />
              )}
            </div>
          )}

          {uploadedFiles.length > 0 && (() => {
            const totalCount = uploadedFiles.length;
            const readyCount = uploadedFiles.filter((f) => f.status === 'success' || f.status === 'corpus-ready').length;
            const failedCount = uploadedFiles.filter((f) => f.status === 'failed').length;
            const processingCount = uploadedFiles.filter((f) => f.status === 'processing').length;
            const waitingCount = uploadedFiles.filter((f) => f.status === 'idle').length;
            const processedCount = readyCount + failedCount;
            const isProcessing = isUploading || processingCount > 0 || waitingCount > 0;
            const isReady = !isProcessing && failedCount === 0 && readyCount === totalCount;
            const hasAttention = failedCount > 0;
            const reviewReady = Boolean(pendingCourseGroups.length > 0 && !isUploading && !isPreparingFiles);
            const progressPercent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
            const hasCoursesFound = pendingParsedSections && pendingParsedSections.length > 0;
            const isLargeUploadBatch = uploadedFiles.length > 8;

            return (
              <div className="responsive-upload-status-area max-w-[42rem] mx-auto w-full mt-5 space-y-4">
                {/* Unified Upload Status & Extraction Action Card */}
                <div className="bg-white rounded-2xl border border-line p-5 sm:p-6 shadow-2xs transition hover:border-line-strong">
                  {/* Top Bar: Extraction Status Badge & Header Controls */}
                  <div className="flex items-center justify-between gap-3 pb-4 border-b border-line/70 flex-wrap">
                    <div className="flex items-center gap-2">
                      {isProcessing ? (
                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" aria-hidden="true" />
                          <span>Analyzing all {totalCount} screenshot{totalCount === 1 ? '' : 's'}…</span>
                        </span>
                      ) : isReady ? (
                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                          <span>All {totalCount} screenshot{totalCount === 1 ? '' : 's'} processed</span>
                        </span>
                      ) : hasAttention ? (
                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                          <span>{readyCount} ready, {failedCount} need a quick check</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-mist text-text-secondary border border-line">
                          <span>{processedCount} of {totalCount} processed</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-alert hover:bg-alert/5 border border-line hover:border-alert/30 rounded-lg transition cursor-pointer min-h-[32px] disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                      onClick={handleClearAllFiles}
                      disabled={isPreparingFiles ? false : (isUploading || ocrProcessingRef.current)}
                      title="Remove all processed screenshots"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove all</span>
                    </button>
                  </div>

                  {/* Processing Progress Bar (Indeterminate) */}
                  {isProcessing && (
                    <div className="pt-4">
                      <div className="w-full bg-mist border border-line/60 rounded-full h-2 overflow-hidden relative">
                        <div className="responsive-progress-indeterminate bg-ink h-full rounded-full" />
                      </div>
                      <p className="responsive-upload-message text-xs text-text-secondary mt-2">
                        Extracting course titles, section codes, and meeting schedules...
                      </p>
                    </div>
                  )}

                  {/* Found Courses Call to Action */}
                  {hasCoursesFound && (
                    <div className="pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h3 className="text-lg sm:text-xl font-extrabold text-ink tracking-tight">
                          We found {pendingCourseGroups.length} course{pendingCourseGroups.length === 1 ? '' : 's'}
                        </h3>
                        <p className="text-xs sm:text-sm text-text-secondary">
                          Check and confirm the course details to generate your schedules.
                        </p>
                      </div>

                      <button
                        type="button"
                        className="min-h-[48px] px-6 py-2.5 bg-ink hover:bg-ink-soft text-white rounded-xl text-sm sm:text-base font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs shrink-0 active:translate-y-px"
                        onClick={() => setIsReviewModalOpen(true)}
                        disabled={!reviewReady}
                      >
                        <span>Review courses</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  {/* Expandable Processed Files Section */}
                  <div className="mt-5 pt-4 border-t border-line/70">
                    <details className={`group responsive-file-details${isLargeUploadBatch ? ' is-large-batch' : ''}`}>
                      <summary className="flex items-center justify-between cursor-pointer list-none select-none text-xs font-bold text-text-secondary hover:text-ink transition py-0.5">
                        <span>View {totalCount} processed screenshot{totalCount === 1 ? '' : 's'}</span>
                        <span className="text-xs font-semibold px-3 py-1 rounded-lg border border-line bg-paper hover:bg-mist text-text-secondary hover:text-ink transition shadow-2xs">
                          View details
                        </span>
                      </summary>

                      <div className="mt-3.5 space-y-2 max-h-72 overflow-y-auto pr-1">
                        {uploadedFiles.map((item, index) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 p-2.5 bg-mist/60 hover:bg-mist border border-line/60 rounded-xl transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-line shrink-0">
                                <img src={item.preview} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div className="min-w-0">
                                <strong className="block text-xs font-bold text-ink truncate">
                                  Screenshot {index + 1}
                                </strong>
                                <span className={`responsive-file-error text-[11px] font-semibold block truncate ${
                                  item.status === 'failed'
                                    ? 'text-alert'
                                    : item.status === 'success' || item.status === 'corpus-ready'
                                    ? 'text-emerald-700'
                                    : 'text-text-muted'
                                }`}>
                                  {item.status === 'corpus-ready' || item.status === 'success'
                                    ? 'Extracted'
                                    : item.status === 'processing'
                                    ? 'Extracting...'
                                    : item.status === 'failed'
                                    ? (item.errorMessage || 'Couldn’t read this screenshot')
                                    : 'Waiting to be read'}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              className="p-2 rounded-lg text-text-muted hover:text-alert hover:bg-alert/10 transition cursor-pointer shrink-0"
                              onClick={() => handleRemoveFile(item.id)}
                              disabled={item.status === 'processing' || isPreparingFiles}
                              aria-label={`Remove Screenshot ${index + 1}`}
                              title="Remove this screenshot"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="pt-3 border-t border-line/60 flex justify-end">
                        <button
                          type="button"
                          onClick={handleClearAllFiles}
                          disabled={isPreparingFiles ? false : (isUploading || ocrProcessingRef.current)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-alert hover:bg-alert/10 border border-alert/20 rounded-lg transition cursor-pointer min-h-[32px] disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Remove all screenshots</span>
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {responsivePanel === 'manual' && (
        <section className="responsive-focus-panel" aria-labelledby="responsive-manual-title">
          <div className="responsive-panel-top">
            <button type="button" className="responsive-back-link" onClick={handleBackFromWorkflow}><ArrowLeft className="w-4 h-4" /> Back to course choices</button>
            <span className="responsive-step-label">1 · MANUAL ENTRY</span>
          </div>
          <div className="responsive-section-intro mb-3">
            <h2 id="responsive-manual-title">Add your courses</h2>
            <p>Enter the course name and code, then set when each meeting takes place.</p>
            <div className="pt-1.5">
              <button
                type="button"
                onClick={(event) => { manualTipsTriggerRef.current = event.currentTarget; setIsManualTipsOpen(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-mist text-text-secondary border border-line hover:text-ink hover:border-line-strong transition cursor-pointer"
                title="View Manual Entry Guide"
              >
                <span>Manual Entry Guide</span>
              </button>
            </div>
          </div>

          <div className="responsive-manual-list" aria-label="Course details">
            {manualForms.map((form, formIndex) => {
              const isOpen = formIndex === responsiveManualOpenIndex;
              const meetingCount = form.sessions.filter((s) => s.day && s.start && s.end).length;
              return (
                <div key={form.id} className="responsive-manual-shell">
                  <button
                    type="button"
                    className="responsive-manual-collapsed"
                    onClick={() => setResponsiveManualOpenIndex(isOpen ? null : formIndex)}
                    aria-expanded={isOpen}
                    aria-controls={`manual-form-editor-${form.id}`}
                  >
                    <span className="min-w-0">
                      <strong className="block break-words">{form.name || form.courseCode || `Course ${formIndex + 1}`}</strong>
                      <small>
                        {form.name || form.courseCode
                          ? `${meetingCount} meeting${meetingCount === 1 ? '' : 's'} · ${form.credits ? `${form.credits} credits` : 'Credits not set'}`
                          : 'In progress'}
                      </small>
                    </span>
                    <div className="p-1 rounded-lg bg-mist border border-line/60 text-ink shrink-0">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div id={`manual-form-editor-${form.id}`} className="responsive-manual-editor">
                      <h3 data-manual-editor-heading tabIndex={-1} className="sr-only">Edit {form.name || `Course ${formIndex + 1}`}</h3>
                      
                      <div className="space-y-1">
                        <label htmlFor={`manual-field-${form.id}-name`} className="text-xs font-bold text-text-secondary uppercase tracking-wider block">
                          Course name *
                        </label>
                        <input
                          id={`manual-field-${form.id}-name`}
                          value={form.name}
                          required aria-required="true"
                          onChange={(e) => updateManualForm(formIndex, { name: e.target.value })}
                          autoFocus={formIndex === 0 && !form.name && typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches}
                          placeholder="e.g. Calculus I, General Chemistry"
                          aria-invalid={Boolean(form.courseCode.trim() && !form.name.trim())}
                          aria-describedby={!form.name.trim() && form.courseCode.trim() ? `manual-field-${form.id}-name-error` : undefined}
                          className="w-full px-3.5 py-2.5 bg-white border border-line rounded-xl text-sm font-semibold text-ink placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink shadow-2xs"
                        />
                        {!form.name.trim() && form.courseCode.trim() && (
                          <span id={`manual-field-${form.id}-name-error`} className="text-xs font-semibold text-alert mt-1 block" role="status">
                            Course name is required.
                          </span>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label htmlFor={`manual-field-${form.id}-courseCode`} className="text-xs font-bold text-text-secondary uppercase tracking-wider block">
                          Course code *
                        </label>
                        <input
                          id={`manual-field-${form.id}-courseCode`}
                          value={form.courseCode}
                          required aria-required="true"
                          onChange={(e) => updateManualForm(formIndex, { courseCode: e.target.value, sectionCode: e.target.value })}
                          placeholder="e.g. MATH 101, CHEM 141"
                          aria-invalid={Boolean(form.name.trim() && !form.courseCode.trim())}
                          aria-describedby={!form.courseCode.trim() && form.name.trim() ? `manual-field-${form.id}-courseCode-error` : undefined}
                          className="w-full px-3.5 py-2.5 bg-white border border-line rounded-xl text-sm font-semibold text-ink placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink shadow-2xs"
                        />
                        {!form.courseCode.trim() && form.name.trim() && (
                          <span id={`manual-field-${form.id}-courseCode-error`} className="text-xs font-semibold text-alert mt-1 block" role="status">
                            Course code is required.
                          </span>
                        )}
                        <label htmlFor={`manual-field-${form.id}-sectionCode`} className="sr-only">
                          Section code *
                        </label>
                        <input
                          id={`manual-field-${form.id}-sectionCode`}
                          type="hidden"
                          value={form.sectionCode}
                          aria-required="true"
                          aria-describedby={!form.sectionCode.trim() && form.name.trim() ? `manual-field-${form.id}-sectionCode-error` : undefined}
                          readOnly
                        />
                      </div>

                      <div className="pt-1">
                        <CreditHourSelector
                          label="Credits"
                          value={form.credits}
                          idPrefix={`manual-form-${formIndex}-credits`}
                          onChange={(_, strVal) => updateManualForm(formIndex, { credits: strVal })}
                        />
                      </div>

                      <div className="space-y-3.5 mt-2 pt-3.5 border-t border-line">
                        <div className="flex items-center justify-between">
                          <div>
                            <strong className="block text-sm font-bold text-ink">When does it meet?</strong>
                            <p className="text-xs text-text-secondary mt-0.5">Add days, times, and meeting types for this course.</p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {form.sessions.map((session, sessionIndex) => (
                            <React.Fragment key={session.id}>
                              <div className="sr-only" aria-label={`${form.name || 'Course'} meeting ${sessionIndex + 1} start time and end time controls`}>Meeting ${sessionIndex + 1}: choose a day, meeting type, start time, and end time.</div>
                              <MeetingRowEditor
                                session={session}
                                index={sessionIndex}
                                totalMeetings={form.sessions.length}
                                idPrefix={`manual-form-${form.id}`}
                                courseTitle={form.name || `Course ${formIndex + 1}`}
                                onChange={(patch) => updateManualMeeting(formIndex, sessionIndex, patch)}
                                onRemove={() => handleRemoveMeetingRow(formIndex, sessionIndex)}
                              />
                            </React.Fragment>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-ink hover:text-ink bg-white hover:bg-mist/70 border border-dashed border-line-strong hover:border-ink rounded-xl transition min-h-[44px] cursor-pointer shadow-2xs"
                          onClick={() => handleAddMeetingRow(formIndex)}
                        >
                          <Plus className="w-4 h-4 text-ink" aria-hidden="true" />
                          <span>Add another course meeting</span>
                        </button>
                      </div>

                      {formIndex > 0 && (
                        <div className="pt-2 border-t border-line/60 flex justify-end">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-alert hover:bg-alert/10 rounded-xl transition min-h-[40px] cursor-pointer"
                            onClick={() => handleRemoveManualForm(formIndex)}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Remove this course</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {manualError && (
            <div className="max-w-2xl mx-auto w-full mt-4">
              <WorkflowStatus
                kind="error"
                title="Please check your entries"
                description={manualError}
              />
            </div>
          )}

          <div className="mt-7 flex flex-col items-center gap-4 max-w-2xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row-reverse items-center justify-center gap-3 w-full">
              <button
                type="button"
                className={`w-full sm:w-auto min-h-[48px] px-7 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 border transition ${
                  canSaveManualBatch
                    ? 'bg-ink hover:bg-ink-soft text-white border-ink shadow-xs cursor-pointer active:translate-y-px'
                    : 'bg-mist border-line text-text-muted cursor-not-allowed select-none'
                }`}
                onClick={() => { if (handleSaveManualSections()) setWorkflowPanel('preferences'); }}
                disabled={!canSaveManualBatch}
              >
                <span>Save & continue</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="w-full sm:w-auto min-h-[48px] px-5 rounded-xl font-bold text-sm bg-white hover:bg-mist border border-line-strong text-ink shadow-2xs inline-flex items-center justify-center gap-2 cursor-pointer transition"
                onClick={() => { setManualForms((prev) => [...prev, createEmptyManualForm(String(prev.length + 1))]); setResponsiveManualOpenIndex(manualForms.length); }}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add another course</span>
              </button>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-ink transition cursor-pointer mt-1"
              onClick={() => { setActiveTab('screenshot'); setWorkflowPanel('screenshots'); }}
            >
              <span>Need the faster path? Use screenshots</span>
            </button>
          </div>
        </section>
      )}

      {savedCourseGroups.length > 0 && responsivePanel === 'preferences' && (
        <>
          <section className="responsive-course-overview mb-6 p-4 sm:p-5 rounded-2xl bg-white border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs" aria-labelledby="responsive-courses-heading">
            <div className="flex items-center gap-3.5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="responsive-courses-heading" className="text-base sm:text-lg font-bold text-ink">Your courses</h2>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-mist text-text-secondary border border-line">
                    {savedCourseGroups.length} {savedCourseGroups.length === 1 ? 'course' : 'courses'} · {totalCredits} credits
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
                  All course and section details are ready to search.
                </p>
              </div>
            </div>
            <div className="responsive-preference-actions flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                id="btn-add-more-courses"
                className="min-h-[44px] px-4 py-2 bg-ink hover:bg-ink-soft text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-xs"
                onClick={() => setWorkflowPanel('start')}
              >
                <span>Add more courses</span>
              </button>
              <button
                type="button"
                id="btn-review-courses"
                className="min-h-[44px] px-4 py-2 bg-paper hover:bg-mist text-ink border border-line-strong rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-xs"
                onClick={() => setIsDetailsModalOpen(true)}
              >
                <span>Review courses</span>
              </button>
            </div>
          </section>

          <SchedulePreferencesPanel
            preferences={preferences}
            onUpdatePreferences={onUpdatePreferences}
            savedCourseGroups={savedCourseGroups}
            targetCreditsStr={targetCreditsStr}
            setTargetCreditsStr={setTargetCreditsStr}
            targetCourseCountStr={targetCourseCountStr}
            setTargetCourseCountStr={setTargetCourseCountStr}
            targetCreditsTouched={targetCreditsTouched}
            setTargetCreditsTouched={setTargetCreditsTouched}
            targetCourseCountTouched={targetCourseCountTouched}
            setTargetCourseCountTouched={setTargetCourseCountTouched}
            markUserSetTargetCourseCount={() => { hasUserSetTargetCourseCountRef.current = true; }}
            markUserSetTargetCredits={() => { hasUserSetTargetCreditsRef.current = true; }}
            targetCreditsValidation={targetCreditsValidation}
            targetCourseCountValidation={targetCourseCountValidation}
            unknownCreditCourseCount={unknownCreditCourseCount}
            mandatoryCourseKeys={mandatoryCourseKeys}
            mandatoryCourses={mandatoryCourses}
            isGroupMandatory={isGroupMandatory}
            handleToggleMandatoryCourse={handleToggleMandatoryCourse}
            handleClearAllMandatory={handleClearAllMandatory}
            formatCourseDisplay={formatCourseDisplay}
            onOpenTips={(event) => { preferencesTipsTriggerRef.current = event.currentTarget; setIsPreferencesTipsOpen(true); }}
          />

          {estimateError && (
            <div className="max-w-4xl mx-auto w-full my-4">
              <WorkflowStatus kind="warning" compact title="Quick option check unavailable" description={estimateError} />
            </div>
          )}

          <div ref={builderStickyRef} className={`responsive-sticky-action${isKeyboardViewportOpen ? ' is-keyboard-open' : ''}`}>
            <div className="responsive-sticky-inner">
              <div><strong>Added: {savedCourseGroups.length} course{savedCourseGroups.length === 1 ? '' : 's'} · {totalCredits} credits</strong><span>{searchStatusMessage}</span></div>
              {isCalculating ? (
                <button type="button" className="responsive-secondary-button responsive-build-button" onClick={onCancelOptimizer} disabled={!onCancelOptimizer}>
                  <X className="w-4 h-4" /> Cancel search
                </button>
              ) : (
                <button type="button" className={`responsive-primary-button responsive-build-button${canRunScheduleSearch ? ' is-enabled' : ''}`} onClick={() => {
                  setTargetCreditsTouched(true);
                  setTargetCourseCountTouched(true);
                  if (!canRunScheduleSearch) {
                    scrollToPreferences();
                    return;
                  }
                  onRunOptimizer();
                }} aria-disabled={!canRunScheduleSearch} title={!canRunScheduleSearch && !isCalculating ? searchStatusMessage : 'Find valid schedules using your current target'}>
                  Find my schedules <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div id="step-add-courses-container" className="responsive-page" data-workflow-phase={workflow.phase}>
      <input
        ref={fileInputRef}
        id="schedule-screenshot-upload-input"
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="opacity-0 fixed pointer-events-none"
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFileSelect(e.target.files);
            e.target.value = '';
          }
        }}
      />
      {responsiveCourseBuilder}

      {/* REVIEW EXTRACTED COURSES MODAL */}
      {isReviewModalOpen && pendingParsedSections && pendingParsedSections.length > 0 && pendingCourseGroups[activeCourseIndex] && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={handleClosePendingModal}
        >
          <div
            ref={pendingModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-courses-modal-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet ocr-review-modal sm:max-w-3xl lg:max-w-4xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="gd-modal-header px-5 py-4 border-b border-line">
              <div>
                <h2 id="review-courses-modal-title" className="text-lg sm:text-xl font-extrabold text-ink tracking-tight">
                  Review the courses we found
                </h2>
                <p className="text-xs sm:text-sm font-medium text-text-secondary mt-0.5">
                  Check details before adding to schedule
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePendingModal}
                aria-label="Close course review"
                className="gd-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner if any */}
            {reviewModalError && (
              <div className="px-5 py-2.5 bg-alert/10 border-b border-alert/20 text-alert text-sm font-semibold flex items-center gap-2 shrink-0" role="alert" aria-live="assertive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reviewModalError}</span>
              </div>
            )}

            {/* Scrollable Course Content */}
            <div ref={reviewScrollContainerRef} onScroll={preserveReviewScroll} className="gd-modal-body p-4 sm:p-6 space-y-5">
              {(() => {
                const currentGroup = pendingCourseGroups[activeCourseIndex];
                if (!currentGroup) return null;
                const credits = currentGroup.credits;
                return (
                  <div className="space-y-5">
                    {/* Course Title & Delete Button */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider block">
                            Course name *
                          </label>
                          {currentGroup.courseCode && (
                            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-mist text-ink rounded-lg border border-line break-all">
                              {currentGroup.courseCode}
                            </span>
                          )}
                        </div>
                        <TextAreaAutosize
                          id={`review-course-name-${(currentGroup.courseKey || currentGroup.courseCode || currentGroup.courseName).replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
                          aria-label="Course name"
                          value={currentGroup.courseName}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[\r\n]+/g, ' ');
                            handleUpdatePendingCourseName(currentGroup.courseName, val, currentGroup.courseKey);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={() => {
                            const cleaned = sanitizeCourseNameOnly(currentGroup.courseName);
                            if (cleaned && cleaned !== currentGroup.courseName) {
                              handleUpdatePendingCourseName(currentGroup.courseName, cleaned, currentGroup.courseKey);
                            }
                          }}
                          className="w-full px-3.5 py-2.5 bg-white border border-line rounded-xl text-base font-extrabold text-ink placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink shadow-2xs block"
                          placeholder="e.g. Calculus I, Business Ethics"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setCourseDeleteTarget({ courseName: currentGroup.courseName, courseKey: currentGroup.courseKey })}
                        aria-label={`Delete entire course ${currentGroup.courseName}`}
                        className="sm:mt-6 px-3.5 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition cursor-pointer shrink-0"
                        title="Delete entire course"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        <span className="text-xs font-bold">Delete course</span>
                      </button>
                    </div>

                    {/* Credit hours */}
                    <div className="pt-3 border-t border-line">
                      <CreditHourSelector
                        label="Credit Hours"
                        value={credits}
                        idPrefix="review-course-credits"
                        onChange={(val) => {
                          handleUpdateCourseCredits(currentGroup.courseName, val, false, currentGroup.courseKey);
                        }}
                      />
                    </div>

                    {/* Options & Meetings */}
                    <div className="space-y-4 pt-3 border-t border-line">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                          Options ({currentGroup.sections.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddPendingSection(currentGroup.courseName, credits, currentGroup.courseKey)}
                          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold text-ink bg-mist/70 hover:bg-mist border border-line transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Add another option</span>
                        </button>
                      </div>

                      {currentGroup.sections.map((section, sIdx) => (
                        <div key={`${currentGroup.courseName}-${section.id}-${sIdx}`} className="rounded-2xl border border-line p-4 sm:p-5 space-y-3.5 bg-white shadow-2xs">
                          <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2.5">
                            <span className="text-xs font-extrabold text-ink uppercase tracking-wider">
                              Option {sIdx + 1}
                            </span>
                            {currentGroup.sections.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeletePendingSection(section, currentGroup.courseName)}
                                className="inline-flex items-center min-h-[32px] px-2.5 rounded-lg text-xs text-alert hover:bg-alert/10 font-bold transition cursor-pointer"
                                title="Delete this course option"
                              >
                                Delete option
                              </button>
                            )}
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider block shrink-0">
                              COURSE CODE *
                            </label>
                            <input
                              type="text"
                              value={section.sectionCode ?? ""}
                              onChange={(e) => handleUpdatePendingSectionId(section, e.target.value)}
                              className="w-full sm:w-56 px-3 py-2 bg-white border border-line rounded-xl text-xs sm:text-sm font-mono font-bold text-ink focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink shadow-2xs"
                              placeholder="e.g. STA20103"
                            />
                          </div>

                          {section.needsReview && (() => {
                            const isCodeFilled = Boolean(section.sectionCode?.trim() || section.name?.trim());
                            const visibleReasons = Array.from(new Set((section.reviewReasons || []).map(reviewReasonCode))).filter((code) => {
                              if (code === 'course_code_missing' && isCodeFilled) return false;
                              if (code === 'section_code_missing' && isCodeFilled) return false;
                              return true;
                            });
                            if (visibleReasons.length === 0 && !section.incompleteMeetings?.length && !section.conflictingMeetings?.length && !section.creditHoursConflict?.length) {
                              return null;
                            }
                            return (
                              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 space-y-2" role="status">
                                <div className="flex items-start gap-2.5">
                                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                                  <div className="min-w-0 flex-1">
                                    <strong className="text-xs font-extrabold text-amber-900 block">Review needed</strong>
                                    <ul className="mt-1 space-y-1 text-xs font-semibold text-amber-900 list-disc list-inside">
                                      {visibleReasons.map((reason) => (
                                        <li key={reason}>{reviewReasonLabel(reason)}</li>
                                      ))}
                                      {section.incompleteMeetings?.length ? (
                                        <li>{section.incompleteMeetings.length} meeting{section.incompleteMeetings.length === 1 ? '' : 's'} could not be read completely.</li>
                                      ) : null}
                                      {section.conflictingMeetings?.length ? (
                                        <li>{section.conflictingMeetings.length} conflicting meeting observation{section.conflictingMeetings.length === 1 ? '' : 's'} were preserved.</li>
                                      ) : null}
                                      {section.creditHoursConflict?.length ? (
                                        <li>Credit evidence: {section.creditHoursConflict.join(' vs ')}.</li>
                                      ) : null}
                                      {section.sourceImageIndexes?.length ? (
                                        <li>Direct OCR evidence was attributed to screenshot{section.sourceImageIndexes.length === 1 ? '' : 's'} {section.sourceImageIndexes.map((n) => n + 1).join(', ')}.</li>
                                      ) : null}
                                    </ul>
                                    {visibleReasons.some((reason) => REVIEW_ACKNOWLEDGEMENT_CODES.has(reason)) && (
                                      <label className="mt-2.5 flex items-start gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(section.reviewAcknowledged)}
                                          onChange={() => acknowledgeSectionReview(section.id)}
                                          className="mt-0.5 accent-ink w-4 h-4 rounded"
                                        />
                                        <span>I reviewed this note and accept the extracted value as shown.</span>
                                      </label>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Sessions list */}
                          <div className="space-y-2.5">
                            {section.sessions.map((sess, sessIdx) => (
                              <div
                                key={sess.id || sessIdx}
                                className="course-review-meeting-row p-3 rounded-xl border border-line bg-mist/40 flex flex-wrap items-center justify-between sm:justify-start gap-2.5"
                              >
                                {/* Day selector */}
                                <select
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} day`}
                                  value={sess.day && ALL_DAYS.includes(sess.day) ? sess.day : ''}
                                  onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'day', e.target.value as DayOfWeek)}
                                  className={`px-3 py-2 min-h-[42px] bg-white border rounded-xl font-bold text-xs sm:text-sm text-ink shadow-2xs focus:outline-none focus:ring-2 focus:ring-ink/20 shrink-0 ${
                                    !sess.day || !ALL_DAYS.includes(sess.day)
                                      ? 'border-amber-400 bg-amber-50/50 text-amber-950 ring-1 ring-amber-300'
                                      : 'border-line hover:border-line-strong'
                                  }`}
                                >
                                  <option value="">Select day</option>
                                  {ALL_DAYS.map((d) => (
                                    <option key={d} value={d}>{DAY_LABELS[d]}</option>
                                  ))}
                                </select>

                                {/* Meeting type selector */}
                                <select
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} meeting type`}
                                  value={sess.type && REVIEW_MEETING_TYPE_OPTIONS.includes(sess.type) ? sess.type : (sess.type ? 'Custom' : '')}
                                  onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'type', e.target.value as MeetingType)}
                                  className={`px-3 py-2 min-h-[42px] bg-white border rounded-xl font-bold text-xs sm:text-sm text-ink shadow-2xs focus:outline-none focus:ring-2 focus:ring-ink/20 shrink-0 ${
                                    !sess.type || !String(sess.type).trim()
                                      ? 'border-amber-400 bg-amber-50/50 text-amber-950 ring-1 ring-amber-300'
                                      : 'border-line hover:border-line-strong'
                                  }`}
                                >
                                  <option value="">Select type</option>
                                  {REVIEW_MEETING_TYPE_OPTIONS.filter((o) => o !== 'Custom').map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                  <option value="Custom">Custom</option>
                                </select>

                                {sess.type === 'Custom' && (
                                  <input
                                    type="text"
                                    value={sess.customType || ''}
                                    onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'customType', e.target.value)}
                                    placeholder="Custom type"
                                    className="w-32 px-3 py-2 min-h-[42px] bg-white border border-line rounded-xl font-bold text-xs sm:text-sm text-ink shadow-2xs focus:outline-none focus:ring-2 focus:ring-ink/20 shrink-0"
                                    aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} custom meeting type`}
                                  />
                                )}

                                {/* Natural Time Inputs (Start to End) */}
                                <div
                                  className="inline-flex items-center gap-1.5 shrink-0"
                                  role="group"
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} time range`}
                                >
                                  <NaturalTimeInput
                                    value={sess.start || ''}
                                    onChange={(val24) => handleUpdatePendingMeeting(section, sessIdx, 'start', val24)}
                                    isEnd={false}
                                    placeholder="8:30"
                                    ariaLabel={`${section.name || 'Course'} meeting ${sessIdx + 1} start time`}
                                    hasError={!sess.start?.trim() || Boolean(sess.start?.trim() && sess.end?.trim() && timeToMinutes(sess.start) >= timeToMinutes(sess.end))}
                                  />
                                  <span className="text-text-muted text-xs font-bold px-0.5 select-none">to</span>
                                  <NaturalTimeInput
                                    value={sess.end || ''}
                                    onChange={(val24) => handleUpdatePendingMeeting(section, sessIdx, 'end', val24)}
                                    isEnd={true}
                                    start24={sess.start}
                                    placeholder="10:00"
                                    ariaLabel={`${section.name || 'Course'} meeting ${sessIdx + 1} end time`}
                                    hasError={!sess.end?.trim() || Boolean(sess.start?.trim() && sess.end?.trim() && timeToMinutes(sess.start) >= timeToMinutes(sess.end))}
                                  />
                                </div>

                                {/* Remove meeting button */}
                                {section.sessions.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePendingMeeting(section, sessIdx)}
                                    className="w-9 h-9 flex items-center justify-center rounded-xl text-text-muted hover:text-alert hover:bg-alert/10 focus:outline-none focus:ring-2 focus:ring-alert/20 transition cursor-pointer shrink-0"
                                    aria-label={`Remove meeting ${sessIdx + 1}`}
                                    title="Remove this meeting"
                                  >
                                    <X className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            ))}

                            <button
                              type="button"
                              onClick={() => handleAddPendingMeeting(section)}
                              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl text-xs font-bold text-ink bg-mist/60 hover:bg-mist border border-line hover:border-line-strong transition cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Add another course meeting</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer with pagination and Confirm action */}
            <div className="course-review-footer px-4 py-3.5 sm:px-6 sm:py-4 border-t border-line bg-paper flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={() => handleNavigateCourse(activeCourseIndex - 1)}
                  disabled={activeCourseIndex <= 0}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-line font-bold text-xs sm:text-sm text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-mist transition cursor-pointer shadow-2xs"
                >
                  Previous
                </button>
                <span className="text-xs font-bold text-text-secondary px-3 select-none">
                  {activeCourseIndex + 1} / {pendingCourseGroups.length}
                </span>
                <button
                  type="button"
                  onClick={() => handleNavigateCourse(activeCourseIndex + 1)}
                  disabled={activeCourseIndex >= pendingCourseGroups.length - 1}
                  className="px-4 py-2 min-h-[44px] rounded-xl border border-line font-bold text-xs sm:text-sm text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-mist transition cursor-pointer shadow-2xs"
                >
                  Next
                </button>
              </div>

              <div className="flex items-center gap-3 sm:justify-end">
                <button
                  type="button"
                  onClick={handleDiscardPendingSections}
                  className="flex-1 sm:flex-none px-4 py-2 min-h-[44px] text-xs sm:text-sm font-bold text-alert border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl transition cursor-pointer"
                >
                  Discard review
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPendingSections}
                  className="flex-1 sm:flex-none px-6 py-2 min-h-[44px] rounded-xl bg-ink text-white font-extrabold text-xs sm:text-sm hover:bg-ink-soft shadow-xs transition active:translate-y-px cursor-pointer"
                >
                  Add {pendingCourseGroups.length} course{pendingCourseGroups.length === 1 ? '' : 's'} to schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmResetModal
        open={Boolean(courseDeleteTarget)}
        onClose={() => setCourseDeleteTarget(null)}
        onConfirm={() => {
          if (!courseDeleteTarget) return;
          handleDeletePendingCourse(courseDeleteTarget.courseName, courseDeleteTarget.courseKey);
          setCourseDeleteTarget(null);
        }}
        title="Delete this course from review?"
        description={`This removes ${courseDeleteTarget?.courseName || 'this course'} and all of its extracted meeting options from the review list.`}
        confirmLabel="Delete course"
      />

      {/* POPUP MODAL FOR ADDED COURSES DETAILS */}
      {isDetailsModalOpen && (
        <div className="gd-modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setIsDetailsModalOpen(false)}>
          <div ref={detailsModalRef} role="dialog" aria-modal="true" aria-labelledby="added-courses-catalog-title" tabIndex={-1} className="gd-modal-shell gd-modal-sheet course-details-review-modal sm:max-w-3xl lg:max-w-4xl sm:h-[88vh] sm:max-h-[820px] flex flex-col" onClick={(e)=>e.stopPropagation()}>
            <div className="gd-modal-header">
              <div>
                <h2 id="added-courses-catalog-title" className="text-base sm:text-lg font-bold text-ink">Review courses</h2>
                <p className="text-xs text-text-secondary mt-0.5">{savedCourseGroups.length} {savedCourseGroups.length === 1 ? 'course' : 'courses'} · {totalCredits} credits ready</p>
              </div>
              <button type="button" onClick={()=>setIsDetailsModalOpen(false)} aria-label="Close course list" className="min-w-[44px] min-h-[44px] grid place-items-center rounded-lg hover:bg-mist text-text-secondary hover:text-ink cursor-pointer transition"><X className="w-5 h-5"/></button>
            </div>



            <div
              className="gd-modal-body course-details-review-body p-3 sm:p-4.5 space-y-2.5 sm:space-y-3"
            >
              {savedCourseGroups.map((group) => {
                const mandatory = isGroupMandatory(group);
                return (
                  <div key={group.courseKey || `${group.courseCode || ''}:${group.courseName}`} className="rounded-xl border border-line bg-white p-3 sm:p-3.5 space-y-2 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Course</span>
                        <h3 className="text-sm sm:text-base font-bold text-ink mt-0.5 min-w-0 break-words whitespace-normal">{formatCourseDisplay(group.courseCode, group.courseName)}</h3>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Credits</span>
                        <div className="mt-0.5">
                          <strong className="inline-block px-2.5 py-0.5 rounded text-xs font-bold bg-mist text-ink border border-line">
                            {group.credits == null ? 'Credits need review' : `${group.credits} credits`}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Section details & meeting times */}
                    <div className="pt-2 border-t border-line/60">
                      <div className="space-y-1.5">
                        {group.sections.map((section, sIdx) => (
                          <div key={`${group.courseName}-${section.id}-${sIdx}`} className="p-2 sm:p-2.5 rounded-lg bg-paper border border-line/60 text-xs course-details-section">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-bold text-ink">{section.sectionCode || `Option ${sIdx + 1}`}</span>
                              <span className="text-[10px] font-semibold text-text-muted">{section.sessions.length} meeting{section.sessions.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex flex-wrap gap-1.5">
                                {section.sessions.map((session, idx) => (
                                  <span key={`${section.id}-${session.day}-${session.start}-${idx}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-line text-[11px] font-medium text-text-secondary course-details-meeting-chip">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-text-muted">{session.type || 'Meeting'}</span>
                                    <span className="font-bold text-ink">{DAY_LABELS[session.day]} · {formatTo12Hour(session.start)}–{formatTo12Hour(session.end)}</span>
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center justify-end gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditSection(section, group.courseName)}
                                  className="min-h-[30px] px-2.5 py-1 text-[11px] font-bold text-ink bg-white border border-line rounded-lg hover:bg-mist transition cursor-pointer flex items-center gap-1"
                                  aria-label={`Edit option ${section.sectionCode || section.id}`}
                                >
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit option
                                </button>
                                {onDeleteSection && (
                                  <button
                                    type="button"
                                    onClick={() => setDetailsSectionDeleteTarget({
                                      sectionId: section.id,
                                      courseName: group.courseName,
                                      courseKey: group.courseKey,
                                      sectionLabel: section.sectionCode || `Option ${sIdx + 1}`,
                                      meetingCount: section.sessions.length,
                                    })}
                                    className="min-h-[30px] px-2.5 py-1 text-[11px] font-bold text-alert bg-alert-soft border border-alert-line rounded-lg hover:bg-alert/10 transition cursor-pointer flex items-center gap-1"
                                    aria-label={`Remove option ${section.sectionCode || section.id} and its ${section.sessions.length} meeting${section.sessions.length === 1 ? '' : 's'}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove option
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action buttons: Must take toggle, Edit, Remove */}
                    <div className="pt-2 border-t border-line/60 flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-ink">Must take:</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={mandatory}
                            onClick={() => handleToggleMandatoryCourse(group)}
                            aria-label={`${mandatory ? 'Remove' : 'Mark'} ${group.courseName} as required`}
                            className={`min-h-[32px] px-2.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                              mandatory
                                ? 'bg-ink text-white shadow-xs'
                                : 'bg-paper border border-line text-text-secondary hover:text-ink hover:bg-mist'
                            }`}
                          >
                            {mandatory ? 'Required' : 'Optional'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsMustTakeHelpOpen(true)}
                            className="text-text-secondary hover:text-ink transition cursor-pointer p-1 rounded-md hover:bg-mist"
                            title="How 'Required' and 'Optional' work"
                            aria-label="How 'Required' and 'Optional' work"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-[10px] font-medium text-text-secondary leading-tight max-w-[190px]">
                          {mandatory ? 'Locked in every schedule.' : 'Optional (used to fill target).'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {onDeleteCourse && (
                          <button
                            type="button"
                            onClick={() => setDetailsCourseDeleteTarget({ courseName: group.courseName, courseKey: group.courseKey })}
                            className="min-h-[32px] px-2.5 py-1 text-xs font-bold text-alert hover:text-alert-strong bg-alert-soft border border-alert-line rounded-lg transition cursor-pointer flex items-center gap-1.5"
                            aria-label={`Remove course ${formatCourseDisplay(group.courseCode, group.courseName)} and all options`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Remove course</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div ref={detailsFooterRef} className="gd-modal-footer flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 bg-white border-t border-line shrink-0">
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  id="modal-btn-add-screenshots-footer"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setActiveTab('screenshot');
                    setWorkflowPanel('screenshots');
                  }}
                  className="min-h-[40px] min-w-[40px] sm:min-w-0 px-2.5 sm:px-3.5 rounded-lg bg-paper border border-line-strong hover:bg-mist text-ink text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                  aria-label="Add screenshots"
                  title="Add screenshots"
                >
                  <Camera className="w-4 h-4 text-text-secondary" />
                  <span className="hidden sm:inline">Add screenshots</span>
                </button>
                <button
                  type="button"
                  id="modal-btn-add-manual-footer"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setManualForms((prev) => [...prev, createEmptyManualForm(String(prev.length + 1))]);
                    setResponsiveManualOpenIndex(manualForms.length);
                    setWorkflowPanel('manual');
                  }}
                  className="min-h-[40px] min-w-[40px] sm:min-w-0 px-2.5 sm:px-3.5 rounded-lg bg-paper border border-line-strong hover:bg-mist text-ink text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                  aria-label="Add manually"
                  title="Add manually"
                >
                  <Plus className="w-4 h-4 text-text-secondary" aria-hidden="true" />
                  <span className="hidden sm:inline">Add manually</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsModalOpen(false)}
                className="min-h-[40px] px-4 sm:px-6 rounded-lg bg-ink text-white font-bold text-xs sm:text-sm cursor-pointer hover:bg-ink-soft transition shadow-xs whitespace-nowrap shrink-0 ml-auto"
              >
                Done reviewing
              </button>
            </div>
          </div>
        </div>
      )}

      <MustTakeHelpModal
        isOpen={isMustTakeHelpOpen}
        onClose={() => setIsMustTakeHelpOpen(false)}
      />

      <ConfirmResetModal
        open={Boolean(detailsCourseDeleteTarget)}
        onClose={() => setDetailsCourseDeleteTarget(null)}
        onConfirm={() => {
          if (!detailsCourseDeleteTarget || !onDeleteCourse) return;
          onDeleteCourse(detailsCourseDeleteTarget.courseName, detailsCourseDeleteTarget.courseKey);
          setDetailsCourseDeleteTarget(null);
        }}
        title="Remove this course?"
        description={`This removes ${detailsCourseDeleteTarget?.courseName || 'this course'} and every option and meeting currently shown for it.`}
        confirmLabel="Remove course"
      />

      <ConfirmResetModal
        open={Boolean(detailsSectionDeleteTarget)}
        onClose={() => setDetailsSectionDeleteTarget(null)}
        onConfirm={() => {
          if (!detailsSectionDeleteTarget || !onDeleteSection) return;
          onDeleteSection(detailsSectionDeleteTarget.sectionId, detailsSectionDeleteTarget.courseName, detailsSectionDeleteTarget.courseKey);
          setDetailsSectionDeleteTarget(null);
        }}
        title="Remove this option?"
        description={`This removes option ${detailsSectionDeleteTarget?.sectionLabel || ''} and all ${detailsSectionDeleteTarget?.meetingCount || 0} meeting${detailsSectionDeleteTarget?.meetingCount === 1 ? '' : 's'} in it.`}
        confirmLabel="Remove option"
      />

      {/* EDIT SECTION MODAL */}
      {editingSection && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setEditingSection(null)}
        >
          <div
            ref={editSectionModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-section-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="gd-modal-header">
              <div>
                <h3 id="edit-section-title" className="text-base font-bold text-ink">
                  Edit course
                </h3>
                <p className="text-sm text-text-secondary mt-0.5">
                  Uses the same fields as adding a course.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                aria-label="Close option editor"
                className="gd-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-left">
              {editingSection.error && (
                <div id="edit-section-error" className="p-3 bg-alert/10 border border-alert/30 text-alert text-sm font-semibold rounded-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{editingSection.error}</span>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="edit-section-course-name" className="text-sm font-bold text-text-secondary block">
                    Course name
                  </label>
                  <input
                    id="edit-section-course-name"
                    type="text"
                    value={editingSection.courseName}
                    aria-invalid={Boolean(editingSection.error && !editingSection.courseName.trim())}
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    onChange={(e) =>
                      setEditingSection((prev) => (prev ? { ...prev, courseName: e.target.value, error: null } : null))
                    }
                    placeholder="e.g. Accounting Information Systems"
                    className="w-full px-3 py-2 bg-white border border-line-strong rounded-sm text-sm sm:text-sm font-semibold text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-section-course-code" className="text-sm font-bold text-text-secondary block">
                    Course code *
                  </label>
                  <input
                    id="edit-section-course-code"
                    type="text"
                    value={editingSection.courseCode}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(editingSection.error && !editingSection.courseCode.trim())}
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    onChange={(e) =>
                      setEditingSection((prev) => (prev ? { ...prev, courseCode: e.target.value, sectionCode: e.target.value, error: null } : null))
                    }
                    placeholder="e.g. ACT 332"
                    className="w-full px-3 py-2 bg-white border border-line-strong rounded-sm text-sm sm:text-sm font-semibold text-ink font-mono focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-section-code" className="text-sm font-bold text-text-secondary block">
                    Section code
                  </label>
                  <input
                    id="edit-section-code"
                    type="text"
                    value={editingSection.sectionCode || ''}
                    readOnly
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    className="w-full min-h-[44px] px-3 py-2 bg-mist border border-line rounded-sm text-sm font-semibold text-ink font-mono"
                  />
                </div>
              </div>

              {/* Credits with validation */}
              <div className="space-y-1 pt-1">
                <CreditHourSelector
                  label="Credits"
                  required
                  value={editingSection.credits}
                  idPrefix="edit-section-credits"
                  onChange={(_, strVal) => {
                    setEditingSection((prev) => (prev ? { ...prev, credits: strVal, error: null } : null));
                  }}
                />
              </div>

              {/* Meetings */}
              <div className="space-y-3 pt-3 border-t border-line">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="block text-sm font-bold text-ink">Meeting times</strong>
                    
                  </div>
                  <button
                    type="button"
                    onClick={handleAddEditMeeting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-ink hover:text-emerald-800 bg-white hover:bg-emerald-50 border border-dashed border-line-strong hover:border-emerald-400 rounded-lg transition min-h-[44px] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Add another course meeting</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {editingSection.sessions.map((sess, idx) => (
                    <React.Fragment key={sess.id}>
                      {/* type="time" Editing session ${idx + 1} start time */}
                      <MeetingRowEditor
                        session={sess}
                      index={idx}
                      totalMeetings={editingSection.sessions.length}
                      idPrefix="edit-section"
                      courseTitle={editingSection.courseName || 'Course'}
                      onChange={(patch) => {
                        setEditingSection((prev) =>
                          prev
                            ? {
                                ...prev,
                                sessions: prev.sessions.map((s, i) =>
                                  i === idx ? { ...s, ...patch } : s
                                ),
                                error: null,
                              }
                            : null
                        );
                      }}
                      onRemove={() => handleRemoveEditMeeting(idx)}
                    />
                  </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                className="px-4 py-2 border border-line-strong hover:border-ink rounded-md text-sm font-bold text-ink cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-save-edit-section"
                onClick={handleSaveEditSection}
                disabled={Boolean(
                  editingSection.sessions.some(
                    (s) => s.start && s.end && timeToMinutes(s.start) >= timeToMinutes(s.end)
                  )
                )}
                aria-label="Save changes"
                className="min-h-[44px] px-5 py-2.5 bg-ink hover:bg-ink-soft text-white rounded-md text-sm font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
      {addedSuccessToast && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-4 sm:right-6 z-[70] max-w-sm w-auto bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg border border-emerald-500/80 flex items-center justify-between gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 duration-200"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight whitespace-nowrap">
                {addedSuccessToast.message}
              </p>
              {addedSuccessToast.subMessage && (
                <p className="text-[11px] text-emerald-100 truncate">
                  {addedSuccessToast.subMessage}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddedSuccessToast(null)}
            className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-700/50 transition cursor-pointer shrink-0 ml-1"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </aside>
      )}

      <ConfirmResetModal
        open={isClearScreenshotsConfirmOpen}
        onCancel={() => setIsClearScreenshotsConfirmOpen(false)}
        onConfirm={() => {
          setIsClearScreenshotsConfirmOpen(false);
          clearAllFilesNow();
        }}
        title="Clear all screenshots?"
        description={isUploading || ocrProcessingRef.current
          ? 'This will stop the current screenshot reading and remove all selected screenshots. Your saved courses will stay here.'
          : 'This will remove all selected screenshots. Your saved courses will stay here.'}
        confirmLabel="Remove all screenshots"
      />

      {/* SCREENSHOT TIPS & GUIDELINES MODAL */}
      {isScreenshotTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsScreenshotTipsOpen(false)}
        >
          <div
            ref={screenshotTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="screenshot-tips-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 id="screenshot-tips-title" className="text-base sm:text-lg font-black text-ink">
                    Screenshot guidelines & tips
                  </h2>
                  <p className="text-xs text-text-secondary">How to get clean, accurate course extraction</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScreenshotTipsOpen(false)}
                aria-label="Close screenshot tips"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div
              className="gd-modal-body gd-screenshot-tips-body px-3.5 sm:px-6 py-3.5 sm:py-6 space-y-3 sm:space-y-4 text-xs sm:text-sm text-text-secondary leading-relaxed"
              style={{ paddingBottom: `calc(${isScreenshotTipsFooterHeight}px + .9rem + env(safe-area-inset-bottom, 0px))` }}
            >
              <div className="gd-screenshot-tip-card p-3 sm:p-3.5 bg-paper rounded-xl border border-line space-y-1.5 sm:space-y-2">
                <div className="gd-screenshot-tip-heading">
                  <strong className="text-ink font-bold text-sm">What should be visible</strong>
                </div>
                <ul className="space-y-1.5 list-disc pl-4 text-ink-soft">
                  <li>Course code and name (for example, CS101, Intro to Programming)</li>
                  <li>Option code or option number (for example, 01, Sec 2, Lab A)</li>
                  <li>Days of the week (for example, Mon/Wed or U/T/R)</li>
                  <li>Start and end times (for example, 10:00 AM to 11:30 AM)</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                <div className="gd-screenshot-tip-card p-3 sm:p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-1.5">
                  <div className="gd-screenshot-tip-heading text-emerald-800">
                    <strong className="font-bold text-xs">What works best</strong>
                  </div>
                  <p className="text-[11px] text-emerald-950">Show the full table at high zoom with crisp text. Use a desktop portal or capture the full phone screen.</p>
                </div>
                <div className="gd-screenshot-tip-card p-3 sm:p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1.5">
                  <div className="gd-screenshot-tip-heading text-amber-800">
                    <strong className="font-bold text-xs">Avoid</strong>
                  </div>
                  <p className="text-[11px] text-amber-950">Avoid cropped edges, heavy blur, or low-contrast photos of physical screens.</p>
                </div>
              </div>

              <div className="gd-screenshot-tip-card p-3 sm:p-3.5 bg-mist rounded-xl border border-line flex items-start gap-2.5">
                <div className="min-w-0 space-y-1">
                  <strong className="text-ink font-bold text-xs block">How screenshot processing works</strong>
                  <p className="text-[11px] text-text-secondary">Selected screenshots are uploaded to Gadwal’s OCR server and processed by its configured AI provider to read course information. Review data stays local on your device while you check the results. Avoid uploading screenshots containing information you do not want processed.</p>
                </div>
              </div>
            </div>

            <p id="screenshot-upload-help-modal" className="sr-only">Opens the file picker for PNG, JPEG, or WebP images. Multiple screenshots are allowed.</p>
            <div ref={screenshotTipsFooterRef} className="gd-modal-footer gd-modal-action-row gd-screenshot-tips-footer">
              <button
                type="button"
                onClick={() => setIsScreenshotTipsOpen(false)}
                className="gd-screenshot-tips-secondary w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-line font-bold text-xs sm:text-sm text-text-secondary hover:bg-paper hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                Close
              </button>
              <button
                type="button"
                aria-describedby="screenshot-upload-help-modal"
                onClick={() => {
                  setIsScreenshotTipsOpen(false);
                  handleTriggerFileInput();
                }}
                className="gd-screenshot-tips-primary w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="truncate">Choose screenshots</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL ENTRY TIPS MODAL */}
      {isManualTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsManualTipsOpen(false)}
        >
          <div
            ref={manualTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-tips-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 id="manual-tips-title" className="text-lg sm:text-xl font-black text-ink">
                    Manual Entry Guide
                  </h2>
                  <p className="text-sm text-text-secondary">How to enter course options and meeting times</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManualTipsOpen(false)}
                aria-label="Close manual entry guide"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="gd-modal-body p-4 sm:p-6 space-y-6 text-base sm:text-lg text-text-secondary leading-relaxed max-h-[75vh] overflow-y-auto select-text">
              {/* When to use Manual Entry */}
              <div className="space-y-3">
                <h3 className="text-base sm:text-lg font-extrabold text-ink">Use manual entry when:</h3>
                <ul className="list-disc list-inside space-y-1.5 text-base sm:text-lg text-text-secondary">
                  <li>A course can't be dropped or you can't screenshot it</li>
                  <li>Screenshot extraction got it wrong</li>
                  <li>You don't have a clear screenshot</li>
                  <li>You need to fix something by hand</li>
                </ul>
              </div>

              {/* How the buttons work */}
              <div className="space-y-3">
                <h3 className="text-base sm:text-lg font-extrabold text-ink">How the buttons work</h3>
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  <table className="w-full text-base text-left">
                    <thead className="bg-paper border-b border-line text-ink font-bold">
                      <tr>
                        <th className="p-3 w-1/3 border-r border-line">Button</th>
                        <th className="p-3 w-2/3">When to tap it</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-secondary">
                      <tr className="border-b border-line">
                        <td className="p-3 font-bold text-ink border-r border-line align-top">Add another course meeting</td>
                        <td className="p-3 align-top">Same course code, another meeting (even same day)</td>
                      </tr>
                      <tr className="border-b border-line">
                        <td className="p-3 font-bold text-ink border-r border-line align-top">Add another course</td>
                        <td className="p-3 align-top">New course, or same course with a different code.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-ink border-r border-line align-top">Save & continue</td>
                        <td className="p-3 align-top">You're done adding courses</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* A few important things to remember */}
              <div className="space-y-3">
                <h3 className="text-base sm:text-lg font-extrabold text-ink">A few important things to remember</h3>
                <ul className="list-disc list-inside space-y-2 text-base sm:text-lg text-text-secondary">
                  <li>Pick the right meeting type: <strong className="text-ink">Lecture, Section, Lab, Online, or Custom</strong></li>
                  <li>Same day, different time = <strong>two separate meetings</strong>, not one</li>
                  <li>Use this semester's info only, don't mix semesters</li>
                  <li>Missing info stays missing, don't guess or invent it</li>
                </ul>
              </div>

              {/* Examples */}
              <div className="space-y-3 pt-2">
                <h3 className="text-base sm:text-lg font-extrabold text-ink">Examples</h3>
                <div className="space-y-2">
                  <button type="button" onClick={() => setOpenManualExample(1)} className="w-full text-left p-3 sm:p-4 bg-paper rounded-xl border border-line flex justify-between items-center hover:bg-mist transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="font-bold text-base text-ink">Example 1: Two lectures, no section</span>
                    <span className="text-base font-bold text-accent px-2 py-1 bg-surface border border-line rounded">View example</span>
                  </button>

                  <button type="button" onClick={() => setOpenManualExample(2)} className="w-full text-left p-3 sm:p-4 bg-paper rounded-xl border border-line flex justify-between items-center hover:bg-mist transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="font-bold text-base text-ink">Example 2: Two lectures + one section</span>
                    <span className="text-base font-bold text-accent px-2 py-1 bg-surface border border-line rounded">View example</span>
                  </button>

                  <button type="button" onClick={() => setOpenManualExample(3)} className="w-full text-left p-3 sm:p-4 bg-paper rounded-xl border border-line flex justify-between items-center hover:bg-mist transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="font-bold text-base text-ink">Example 3: Same course, different course codes</span>
                    <span className="text-base font-bold text-accent px-2 py-1 bg-surface border border-line rounded">View example</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setIsManualTipsOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-sm sm:text-base hover:bg-ink-soft cursor-pointer"
              >
                Got it, close guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL EXAMPLE 1 POPUP */}
      {openManualExample === 1 && (
        <div className="gd-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150" onClick={() => setOpenManualExample(null)}>
          <div role="dialog" aria-modal="true" className="gd-modal-shell gd-modal-sheet sm:max-w-lg flex flex-col text-ink bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="gd-modal-header border-b border-line px-4 py-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-ink">Two lectures, no section</h2>
              <button type="button" onClick={() => setOpenManualExample(null)} className="p-2 -mr-2 text-text-secondary hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-base sm:text-lg text-text-secondary overflow-y-auto">
              <p>First, let's look at a course that meets on more than one day. <strong>Each day is a separate meeting</strong>, so each one must be added.</p>
              <div className="p-4 bg-surface rounded-xl border border-line space-y-3">
                <div className="font-extrabold text-ink text-sm">Cost Accounting II</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted font-medium">Course code:</span>
                  <code className="px-2 py-0.5 rounded bg-mist font-mono text-base font-bold text-ink border border-line">ACT30101</code>
                </div>
                <div className="text-base text-text-secondary pt-2 space-y-2">
                  <div><strong>Sunday</strong> · 10:00–11:30 <strong className="text-ink">Lecture</strong></div>
                  <div className="text-base font-bold text-ink flex items-center gap-2"><div className="h-px bg-line flex-1"></div>Add another course meeting<div className="h-px bg-line flex-1"></div></div>
                  <div><strong>Monday</strong> · 10:00–11:30 <strong className="text-ink">Lecture</strong></div>
                </div>
                <div className="text-base font-extrabold text-ink pt-2 border-t border-line">
                  Both meetings belong to <strong><code className="font-mono text-sm">ACT30101</code></strong>.
                </div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-sm space-y-1">
                <strong>Important:</strong> If your university shows <strong>Sunday–Monday</strong>, that means there are <strong>two separate meetings</strong>: one on Sunday and one on Monday.
              </div>
            </div>
            <div className="gd-modal-footer px-4 py-3 border-t border-line flex justify-end">
              <button type="button" onClick={() => setOpenManualExample(null)} className="px-5 py-2 rounded-xl bg-ink text-white font-bold text-sm hover:bg-ink-soft">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL EXAMPLE 2 POPUP */}
      {openManualExample === 2 && (
        <div className="gd-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150" onClick={() => setOpenManualExample(null)}>
          <div role="dialog" aria-modal="true" className="gd-modal-shell gd-modal-sheet sm:max-w-lg flex flex-col text-ink bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="gd-modal-header border-b border-line px-4 py-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-ink">Two lectures + one section</h2>
              <button type="button" onClick={() => setOpenManualExample(null)} className="p-2 -mr-2 text-text-secondary hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-base sm:text-lg text-text-secondary overflow-y-auto">
              <p>Some courses have multiple lectures and a section. <strong>All of these meetings belong to the same course code.</strong></p>
              <div className="p-4 bg-surface rounded-xl border border-line space-y-3">
                <div className="font-extrabold text-ink text-sm">Production and Operation Management</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-muted font-medium">Course code:</span>
                  <code className="px-2 py-0.5 rounded bg-mist font-mono text-base font-bold text-ink border border-line">MGT203-New05</code>
                </div>
                <div className="text-base text-text-secondary pt-2 space-y-2">
                  <div><strong>Sunday</strong> · 11:30–1:00 <strong className="text-ink">Lecture</strong></div>
                  <div className="text-base font-bold text-ink flex items-center gap-2"><div className="h-px bg-line flex-1"></div>Add another course meeting<div className="h-px bg-line flex-1"></div></div>
                  <div><strong>Wednesday</strong> · 11:30–1:00 <strong className="text-ink">Lecture</strong></div>
                  <div className="text-base font-bold text-ink flex items-center gap-2"><div className="h-px bg-line flex-1"></div>Add another course meeting<div className="h-px bg-line flex-1"></div></div>
                  <div><strong>Thursday</strong> · 1:00–2:00 <strong className="text-ink">Section</strong></div>
                </div>
                <div className="text-base font-extrabold text-ink pt-2 border-t border-line">
                  All three meetings belong to <strong><code className="font-mono text-sm">MGT203-New05</code></strong>.
                </div>
              </div>
            </div>
            <div className="gd-modal-footer px-4 py-3 border-t border-line flex justify-end">
              <button type="button" onClick={() => setOpenManualExample(null)} className="px-5 py-2 rounded-xl bg-ink text-white font-bold text-sm hover:bg-ink-soft">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL EXAMPLE 3 POPUP */}
      {openManualExample === 3 && (
        <div className="gd-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150" onClick={() => setOpenManualExample(null)}>
          <div role="dialog" aria-modal="true" className="gd-modal-shell gd-modal-sheet sm:max-w-lg flex flex-col text-ink bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="gd-modal-header border-b border-line px-4 py-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-ink">Same course, different course codes</h2>
              <button type="button" onClick={() => setOpenManualExample(null)} className="p-2 -mr-2 text-text-secondary hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-base sm:text-lg text-text-secondary overflow-y-auto">
              <p>Sometimes the <strong>same course name</strong> is available with <strong>different course codes and different meeting times</strong>.</p>
              <p>These are different available choices for the same course, so each one must be entered as a <strong>separate course entry</strong>.</p>
              
              <div className="space-y-4">
                <div className="p-4 bg-surface rounded-xl border border-line space-y-3">
                  <div className="font-extrabold text-ink text-sm">First entry - Human Resource Management</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-muted font-medium">Course code:</span>
                    <code className="px-2 py-0.5 rounded bg-mist font-mono text-base font-bold text-ink border border-line">HRM20107</code>
                  </div>
                  <div className="text-sm pt-1 space-y-2">
                    <div><strong>Monday</strong> · 4:30–6:00 <strong>Lecture</strong></div>
                    <div className="text-base font-bold text-ink flex items-center gap-2"><div className="h-px bg-line flex-1"></div>Add another course meeting<div className="h-px bg-line flex-1"></div></div>
                    <div><strong>Tuesday</strong> · 4:30–6:00 <strong>Lecture</strong></div>
                  </div>
                </div>

                <div className="p-3 bg-mist rounded-xl text-base font-bold text-ink border border-line text-center">
                  When you finish this entry:<br />
                  <strong className="underline text-sm block mt-1 mb-1">Click “Add another course”</strong>
                  <span className="font-normal text-text-secondary">Then enter the same course name with the different course code.</span>
                </div>

                <div className="p-4 bg-surface rounded-xl border border-line space-y-3">
                  <div className="font-extrabold text-ink text-sm">Second entry - Human Resource Management</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-muted font-medium">Course code:</span>
                    <code className="px-2 py-0.5 rounded bg-mist font-mono text-base font-bold text-ink border border-line">HRM20110</code>
                  </div>
                  <div className="text-sm pt-1 space-y-2">
                    <div><strong>Saturday</strong> · 1:00–2:30 <strong>Lecture</strong></div>
                    <div className="text-base font-bold text-ink flex items-center gap-2"><div className="h-px bg-line flex-1"></div>Add another course meeting<div className="h-px bg-line flex-1"></div></div>
                    <div><strong>Sunday</strong> · 8:30–10:00 <strong>Lecture</strong></div>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-sm space-y-1">
                  <div className="font-bold">These are two different choices for Human Resource Management.</div>
                  <div><strong>Do not combine the meetings from <code className="font-mono">HRM20107</code> and <code className="font-mono">HRM20110</code>.</strong></div>
                  <div className="font-bold text-amber-950 pt-1 border-t border-amber-200 mt-1">
                    Same course name + different course code = separate course entries.
                  </div>
                </div>
              </div>
            </div>
            <div className="gd-modal-footer px-4 py-3 border-t border-line flex justify-end">
              <button type="button" onClick={() => setOpenManualExample(null)} className="px-5 py-2 rounded-xl bg-ink text-white font-bold text-sm hover:bg-ink-soft">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* PREFERENCES TIPS MODAL */}
      {isPreferencesTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsPreferencesTipsOpen(false)}
        >
          <div
            ref={preferencesTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-tips-title"
            tabIndex={-1}
            className="gd-modal-shell w-full max-w-[94vw] sm:max-w-xl flex flex-col text-ink rounded-2xl sm:rounded-3xl border border-line bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header border-b border-line px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 id="preferences-tips-title" className="text-base sm:text-lg font-black text-ink">
                    How Gadwal builds your schedule
                  </h2>
                  <p className="text-xs sm:text-sm text-text-secondary mt-1 font-medium">
                    Tell Gadwal what you want to take, and it finds schedules that fit your courses and targets.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPreferencesTipsOpen(false)}
                aria-label="Close guide"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="gd-modal-body p-4 sm:p-6 space-y-3.5 text-xs sm:text-sm text-text-secondary leading-relaxed">
              <div className="p-3.5 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Target credits & courses</strong>
                <p className="text-xs sm:text-sm text-ink-soft">
                  Choose how many credit hours or courses you want to take this semester. Gadwal looks for schedules that match what you entered.
                </p>
              </div>

              <div className="p-3.5 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Must-take courses</strong>
                <p className="text-xs sm:text-sm text-ink-soft">
                  Mark any courses you definitely need to take. Gadwal makes sure they are included in every schedule it shows you.
                </p>
              </div>

              <div className="p-3.5 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Compare valid options</strong>
                <p className="text-xs sm:text-sm text-ink-soft">
                  Gadwal groups valid schedules by number of class days and shows up to three options in each group. You choose the one that works best for you.
                </p>
              </div>
            </div>

            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setIsPreferencesTipsOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer"
              >
                Got it, close guide
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
});
