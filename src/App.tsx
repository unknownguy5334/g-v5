/**
import { devLogError, devLogWarn } from './utils/clientLogger';
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useReducer, useCallback } from 'react';
import { AlertCircle, Compass, WifiOff, RefreshCw } from 'lucide-react';
import { AppStep, OptimizerOutput, SchedulePreferences, Section } from './types';
import { Header } from './components/Header';
import {
  STORAGE_KEY_SECTIONS, STORAGE_KEY_PREFS, STORAGE_KEY_OPTIMIZER, STORAGE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION,
  LEGACY_STORAGE_KEY_SECTIONS, LEGACY_STORAGE_KEY_PREFS, DEFAULT_PREFERENCES,
  readSavedOptimizerOutput, readSavedSections, readSavedPreferences, normalizePathname, CURRENT_RESULT_CONTRACT_VERSION, saveCurrentStep, readSavedCurrentStep, clearAllPersistedAppData, readFavoriteSignatures, saveFavoriteSignatures, migrateSnapshot,

} from './app/persistence';
import { courseBuilderWorkflowReducer, initialCourseBuilderWorkflow, reconcileCourseBuilderWorkflow, type CourseBuilderAction } from './features/courseBuilder/workflow';
import { HeroBanner } from './components/HeroBanner';
import { StepAddCourses, WorkflowPanel } from './components/StepAddCourses';
import { ConfirmResetModal } from './components/ConfirmResetModal';
import { cancelOptimizerOwner, disposeOptimizerWorker, runOptimizerAsyncCancellable } from './utils/optimizerWorkerClient';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  normalizeCourseName,
  getCourseIdentityKey,
  buildOptimizerCourseMap,
  deduplicateSections,
  computeInputsSignature,
  getInputsChangeSummary,
  canonicalizeSectionIdentity,
  computeSectionsSignature,
  areSchedulePreferencesEqual,
} from './utils/courseUtils';
import { safeStorage, createStorageEnvelope } from './utils/safeStorage';
import { sanitizeSectionsSnapshot, sanitizePreferencesSnapshot } from './utils/persistenceValidation';
import { WorkflowStatus } from './components/WorkflowStatus';
import { normalizeMandatoryCourses, normalizeMandatoryCourseKeys, reconcilePreferencesWithCatalog, sanitizePreferenceValues } from './utils/preferenceValidation';
import { resetBodyScrollLock } from './hooks/useModalAccessibility';
import { createGenerationId } from './domain/workflow';
import { cloneDomain } from './domain/clone';
import { APP_VERSION } from './domain/storage';
import { RESET_COORDINATOR } from './app/resetCoordinator';
import { scheduleCanonicalSignature } from './domain/results';
import { AddSectionsResult } from './features/courseBuilder/contracts';
import { updateSection as updateSectionDomain } from './domain/course';
import { getInfoModalFromHash, getInfoModalFromHash as getCanonicalInfoModalFromHash, getStepHash, isAppStep, INFO_MODAL_HASHES, STEP_HASHES, type InfoModal } from './app/navigation';
import { queueStorageWrite, cancelQueuedStorageWrite } from './utils/persistenceQueue';
import { useAuth } from './contexts/AuthContext';
import { VerificationBanner } from './components/VerificationBanner';
import { AuthModal, AuthModalView } from './components/AuthModal';
import { UpgradeModal } from './components/UpgradeModal';
import { AccountCenter } from './components/AccountCenter';
import { OnboardingModal } from './components/OnboardingModal';
import { fetchJson } from './services/resilientFetch';

const HowItWorksModal = lazy(() => import('./components/HowItWorksModal').then((m) => ({ default: m.HowItWorksModal })));
const DemoModal = lazy(() => import('./components/DemoModal').then((m) => ({ default: m.DemoModal })));
const PrivacyModal = lazy(() => import('./components/PrivacyModal').then((m) => ({ default: m.PrivacyModal })));
const PricingModal = lazy(() => import('./components/PricingModal').then((m) => ({ default: m.PricingModal })));
const AccessBillingModal = lazy(() => import('./components/AccessBillingModal').then((m) => ({ default: m.AccessBillingModal })));
const AboutUsModal = lazy(() => import('./components/AboutUsModal').then((m) => ({ default: m.AboutUsModal })));
const ContactUsModal = lazy(() => import('./components/ContactUsModal').then((m) => ({ default: m.ContactUsModal })));
const DeliveryShippingModal = lazy(() => import('./components/DeliveryShippingModal').then((m) => ({ default: m.DeliveryShippingModal })));
const RefundPolicyModal = lazy(() => import('./components/RefundPolicyModal').then((m) => ({ default: m.RefundPolicyModal })));
const StepResults = lazy(() => import('./components/StepResults').then((m) => ({ default: m.StepResults })));
const RAW_FEEDBACK_EMAIL = String(import.meta.env.VITE_FEEDBACK_EMAIL || '').trim();
const FEEDBACK_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RAW_FEEDBACK_EMAIL) ? RAW_FEEDBACK_EMAIL : '';
const initialWorkflowGenerationId = createGenerationId('wf');


export default function App() {
  const { user, status: authStatus, logout } = useAuth();
  const [workflow, dispatchWorkflow] = useReducer(courseBuilderWorkflowReducer, initialCourseBuilderWorkflow);
  const { isOnline, ocrServiceAvailable, refreshConnectivity } = useOnlineStatus();
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [persistenceWarning, setPersistenceWarning] = useState(false);
  const [optimizerErrorMessage, setOptimizerErrorMessage] = useState<string | null>(null);
  const optimizerErrorRef = useRef<HTMLDivElement | null>(null);
  const [optimizerErrorMeta, setOptimizerErrorMeta] = useState<{ code: string; retryable: boolean } | null>(null);
  const [lastWorkflowAction, setLastWorkflowAction] = useState<string | null>(null);
  const [isProcessingActive, setIsProcessingActive] = useState(false);
  const [accessState, setAccessState] = useState<any>(null);
  const [isAccountCenterOpen, setIsAccountCenterOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isAccessBillingModalOpen, setIsAccessBillingModalOpen] = useState(false);

  useEffect(() => {
    if (!lastWorkflowAction) return;
    const timer = window.setTimeout(() => setLastWorkflowAction(null), 5000);
    return () => window.clearTimeout(timer);
  }, [lastWorkflowAction]);
  const [resetAnnouncement, setResetAnnouncement] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const workflowGenerationRef = useRef(initialWorkflowGenerationId);
  const resetGenerationRef = useRef(0);
  const resetAnnouncementTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!optimizerErrorMessage) return;
    const frame = window.requestAnimationFrame(() => optimizerErrorRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [optimizerErrorMessage]);


  useEffect(() => {
    resetBodyScrollLock();
    if (typeof window !== 'undefined') {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  useEffect(() => {
    // Persistence readers perform schema-aware migration at the data boundary.
    safeStorage.setItem(STORAGE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  }, []);

  // Read and sanitize persisted state once per mount. Reuse these values across
  // all lazy state initializers to avoid repeated synchronous storage reads/parses
  // during navigation and other App re-renders.
  const initialDataRef = useRef<{
    sections: Section[];
    preferences: SchedulePreferences;
    optimizerOutput: OptimizerOutput | null;
  } | null>(null);
  if (initialDataRef.current === null) {
    // Persisted academic data belongs to anonymous browser state only. Never read it
    // while authentication is unresolved or an authenticated identity is active.
    initialDataRef.current = authStatus === 'unauthenticated'
      ? {
          sections: readSavedSections(),
          preferences: readSavedPreferences(),
          optimizerOutput: readSavedOptimizerOutput(),
        }
      : { sections: [], preferences: DEFAULT_PREFERENCES, optimizerOutput: null };
  }
  const {
    sections: initialSections,
    preferences: initialPreferences,
    optimizerOutput: initialOptimizerOutput,
  } = initialDataRef.current;

  // Optimizer output state (hydrated from localStorage)
  const [optimizerOutput, setOptimizerOutput] = useState<OptimizerOutput | null>(() => initialOptimizerOutput);

  const optimizerOutputRef = useRef<OptimizerOutput | null>(optimizerOutput);
  const [isCalculating, setIsCalculating] = useState(false);
  const [accountDataReady, setAccountDataReady] = useState(authStatus === 'unauthenticated');
  const [accountDataLoadError, setAccountDataLoadError] = useState<string | null>(null);
  const [accountSyncAttempt, setAccountSyncAttempt] = useState(0);
  const authenticatedUserIdRef = useRef<string | null>(authStatus === 'authenticated' && user?.emailVerified ? user.id : null);
  const optimizerRequestIdRef = useRef(0);
  const optimizerTaskRef = useRef<{ cancel: () => void } | null>(null);
  const activeScheduleRunIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (resetAnnouncementTimerRef.current !== null) window.clearTimeout(resetAnnouncementTimerRef.current);
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    disposeOptimizerWorker();
  }, []);

  useEffect(() => {
    optimizerOutputRef.current = optimizerOutput;
    if (!accountDataReady || authStatus !== 'unauthenticated') return;
    try {
      if (optimizerOutput) {
        const ok = safeStorage.setItem(
          STORAGE_KEY_OPTIMIZER,
          JSON.stringify(createStorageEnvelope({ ...optimizerOutput, resultContractVersion: optimizerOutput.resultContractVersion || CURRENT_RESULT_CONTRACT_VERSION }, CURRENT_SCHEMA_VERSION))
        );
        setPersistenceWarning(!ok);
      } else {
        safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);
      }
      activeScheduleRunIdRef.current = null;
    } catch (e) {
      devLogError('Failed to save optimizer output.');
    }
  }, [optimizerOutput, accountDataReady, authStatus]);

  // Main app flow: home (front page), setup (build a week), then results (review schedules).
  // Hydrated from URL hash (#results / #setup / #home) or persistent storage
  const [currentStep, setCurrentStep] = useState<AppStep>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const pathname = typeof window !== 'undefined' ? normalizePathname(window.location.pathname) : '';
    const hasSavedResults = Boolean(initialOptimizerOutput && initialOptimizerOutput.signatureStatus === 'verified' && initialOptimizerOutput.sectionsSnapshotComplete === true && initialOptimizerOutput.preferencesSnapshotComplete === true && Array.isArray(initialOptimizerOutput.byDayCount));

    if ((hash === '#results' || pathname === '/results') && hasSavedResults) {
      return 'results';
    }
    if (hash === '#setup' || pathname === '/setup') {
      return 'setup';
    }
    if (hash === '#home' || pathname === '/home') {
      return 'home';
    }
    if (authStatus !== 'unauthenticated') {
      return 'home';
    }
    try {
      const savedStep = readSavedCurrentStep();
      if (savedStep === 'results' && hasSavedResults) {
        return 'results';
      }
      if (savedStep === 'setup' && initialSections.length > 0) {
        return 'setup';
      }
      if (savedStep === 'home') {
        return 'home';
      }
    } catch {}
    if (initialSections.length > 0) {
      return 'setup';
    }
    return 'home';
  });

  // Unknown route detection for 404 feedback (Problem #4)
  const [unknownRouteNotice, setUnknownRouteNotice] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    // Normalize away a trailing slash (some hosting providers/CDNs append one
    // automatically on deep links, e.g. "/results/") so a legitimate route isn't
    // mistaken for an unknown one. Query strings and hash fragments are already
    // excluded from `pathname` by the browser, but the trailing-slash case wasn't
    // previously handled.
    const pathname = normalizePathname(window.location.pathname);
    // Known valid root paths: '/', '', '/index.html', '/results', '/setup', '/home', or '/reset-password'
    if (pathname && pathname !== '/' && pathname !== '/index.html' && pathname !== '/results' && pathname !== '/setup' && pathname !== '/home' && pathname !== '/reset-password') {
      return pathname;
    }
    return null;
  });

  // Normalize unknown path gracefully via replaceState
  useEffect(() => {
    if (unknownRouteNotice && typeof window !== 'undefined') {
      const currentHash = window.location.hash;
      const targetHash = currentHash === '#results' || currentHash === '#setup' || currentHash === '#home'
        ? currentHash
        : '#home';
      window.history.replaceState({ step: currentStep }, '', targetHash);
    }
  }, [unknownRouteNotice, currentStep]);

  // Course sections catalog state with schema validation
  const [sections, setSections] = useState<Section[]>(() => initialSections);

  // Active workflow panel within course builder ('start' | 'screenshots' | 'manual' | 'preferences')
  const [workflowPanel, setWorkflowPanel] = useState<WorkflowPanel>(() => {
    if (initialSections.length > 0) {
      return 'preferences';
    }
    return 'start';
  });

  const workflowPanelRef = useRef<WorkflowPanel>(workflowPanel);
  const scrollTaskRef = useRef<{ generation: number; raf?: number; timers: number[] }>({ generation: 0, timers: [] });
  const pageScrollPositionsRef = useRef<Record<AppStep, number>>({ home: 0, setup: 0, results: 0 });
  useEffect(() => {
    workflowPanelRef.current = workflowPanel;
  }, [workflowPanel]);

  // Smoothly scroll to the Add Courses choice section at the bottom of the home page
  
  // Sync account access separately from account-owned course/schedule data.
  useEffect(() => {
    if (!user?.emailVerified) return;
    fetchJson('/api/access', { credentials: 'same-origin', timeoutMs: 8_000 })
      .then(({ response, data }) => {
        if (response.ok && (data as any).ok) setAccessState(data as any);
      })
      .catch(() => setLastWorkflowAction('Your account status could not be refreshed. Please try again.'));
  }, [user?.emailVerified, user?.id]);

  const sectionsRefStr = useRef<string>('');
  useEffect(() => {
    if (accountDataReady && user?.emailVerified && sections.length >= 0) {
      const current = JSON.stringify(sections);
      if (current !== sectionsRefStr.current) {
        sectionsRefStr.current = current;
        fetchJson('/api/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ courses: sections }),
          timeoutMs: 8_000
        }).then(({ response, data }) => {
          if (!response.ok) throw new Error((data as any).error || 'Could not save your courses.');
        }).catch((err) => setLastWorkflowAction(err instanceof Error ? err.message : 'Could not save your courses.'));
      }
    }
  }, [sections, user?.emailVerified, accountDataReady]);

  const cancelPendingScroll = useCallback(() => {
    const task = scrollTaskRef.current;
    task.generation += 1;
    if (task.raf !== undefined) window.cancelAnimationFrame(task.raf);
    task.timers.forEach((timer) => window.clearTimeout(timer));
    scrollTaskRef.current = { generation: task.generation, timers: [] };
  }, []);

  const scrollToAddCoursesArea = useCallback(() => {
    cancelPendingScroll();
    const generation = scrollTaskRef.current.generation;
    const doScroll = () => {
      if (scrollTaskRef.current.generation !== generation) return true;
      const dropzone =
        document.getElementById('responsive-choice-section') ||
        document.getElementById('responsive-section-intro') ||
        document.getElementById('responsive-add-title') ||
        document.getElementById('upload-dropzone') ||
        document.getElementById('step-add-courses-container');
      if (dropzone) {
        dropzone.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };
    if (!doScroll()) {
      scrollTaskRef.current.raf = window.requestAnimationFrame(doScroll);
      scrollTaskRef.current.timers.push(window.setTimeout(doScroll, 60), window.setTimeout(doScroll, 180));
    }
  }, [cancelPendingScroll]);

  const handleWorkflowPanelChange = (panel: WorkflowPanel) => {
    cancelPendingScroll();
    const previousPanel = workflowPanelRef.current;
    setWorkflowPanel(panel);
    if (panel === 'screenshots' || panel === 'manual' || panel === 'preferences') {
      if (currentStep !== 'setup') {
        navigateToStep('setup', true);
      }
    } else if (panel === 'start') {
      const wasInWorkflow = previousPanel === 'screenshots' || previousPanel === 'manual';
      if (sections.length === 0 && currentStep !== 'home') {
        navigateToStep('home', true, !wasInWorkflow);
      } else if (sections.length > 0 && currentStep !== 'setup') {
        navigateToStep('setup', true, !wasInWorkflow);
      }
      if (wasInWorkflow) {
        scrollToAddCoursesArea();
      }
    }
  };

  // Schedule Preferences State with schema validation
  const [preferences, setPreferences] = useState<SchedulePreferences>(() => initialPreferences);
  const preferencesRef = useRef<SchedulePreferences>(initialPreferences);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);

  // Hard storage boundary between anonymous browser state and authenticated accounts.
  // Account-owned data is fetched from the server before authenticated writes are enabled.
  useEffect(() => {
    let cancelled = false;

    const clearBrowserAccountState = () => {
      cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
      cancelQueuedStorageWrite(STORAGE_KEY_PREFS);
      clearAllPersistedAppData();
      setSections([]);
      setPreferences(DEFAULT_PREFERENCES);
      setOptimizerOutput(null);
      setAccessState(null);
      setIsOnboardingOpen(false);
      setAccountDataLoadError(null);
      sectionsRefStr.current = '';
      optimizerOutputRef.current = null;
      activeScheduleRunIdRef.current = null;
      workflowGenerationRef.current = createGenerationId('wf');
      optimizerTaskRef.current?.cancel();
      optimizerTaskRef.current = null;
      setIsCalculating(false);
      optimizerRequestIdRef.current++;
    };

    const hydrateAccount = async (userId: string) => {
      clearBrowserAccountState();
      let hydrated = false;
      try {
        const [coursesResult, schedulesResult] = await Promise.all([
          fetchJson('/api/courses', { credentials: 'same-origin', timeoutMs: 8_000 }),
          fetchJson('/api/schedules', { credentials: 'same-origin', timeoutMs: 8_000 }),
        ]);
        if (cancelled || authenticatedUserIdRef.current !== userId) return;

        const coursesOk = coursesResult.response.ok && coursesResult.data.ok && Array.isArray(coursesResult.data.courses);
        const schedulesOk = schedulesResult.response.ok && schedulesResult.data.ok && Array.isArray(schedulesResult.data.schedules);
        if (!coursesOk || !schedulesOk) {
          const message = !coursesOk
            ? ((coursesResult.data as any).error || 'Could not load saved courses.')
            : ((schedulesResult.data as any).error || 'Could not load saved schedules.');
          setAccountDataLoadError(message);
          setLastWorkflowAction(message);
          return;
        }

        setSections(coursesResult.data.courses);
        const latest = schedulesResult.data.schedules[0]?.scheduleData;
        setOptimizerOutput(latest || null);
        hydrated = true;
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not load your account data.';
          setAccountDataLoadError(message);
          setLastWorkflowAction(message);
        }
      } finally {
        if (!cancelled && authenticatedUserIdRef.current === userId && hydrated) {
          setAccountDataLoadError(null);
          setAccountDataReady(true);
        }
      }
    };

    if (authStatus === 'loading') {
      setAccountDataReady(false);
      return () => { cancelled = true; };
    }

    if (authStatus === 'authenticated' && user?.emailVerified && user.id) {
      authenticatedUserIdRef.current = user.id;
      setAccountDataReady(false);
      void hydrateAccount(user.id);
      return () => { cancelled = true; };
    }

    const wasAuthenticated = authenticatedUserIdRef.current !== null;
    authenticatedUserIdRef.current = null;
    if (wasAuthenticated) {
      clearBrowserAccountState();
      setAccountDataReady(false);
    }

    if (!wasAuthenticated && authStatus === 'unauthenticated') {
      setAccountDataLoadError(null);
      setAccountDataReady(true);
    } else if (wasAuthenticated) {
      // Logout starts from a clean anonymous browser state. Do not restore the
      // just-logged-out account's persisted records into anonymous mode.
      setAccountDataReady(true);
    } else {
      setAccountDataReady(true);
    }
    return () => { cancelled = true; };
  }, [authStatus, user?.id, user?.emailVerified, accountSyncAttempt]);

  const staleChangeSummary = useMemo(() => {
    return getInputsChangeSummary(optimizerOutput, sections, preferences);
  }, [optimizerOutput, sections, preferences]);

  const isResultsStale = staleChangeSummary.isStale;

  useEffect(() => {
    const generatedSig = optimizerOutput?.generatedInputsSignature;
    const currentSig = sections.length && optimizerOutput ? computeInputsSignature(sections, preferences) : null;
    const isStale = Boolean(optimizerOutput && (!generatedSig || !currentSig || generatedSig !== currentSig || isResultsStale));
    const reconciled = reconcileCourseBuilderWorkflow(workflow, { hasSections: sections.length > 0, hasResults: optimizerOutput !== null, isStale, isProcessing: isCalculating, hasRetryableError: Boolean(optimizerErrorMeta?.retryable) });
    if (reconciled.phase !== workflow.phase) {
      const actionByPhase: Record<string, CourseBuilderAction> = {
        idle: { type: 'RESET' }, results: { type: 'RESULTS_READY' }, stale: { type: 'STALE' }, ready: { type: 'READY' },
        cancelled: { type: 'CANCELLED' }, 'retryable-error': { type: 'RETRYABLE_ERROR' }, 'partial-success': { type: 'PARTIAL_SUCCESS' }, error: { type: 'ERROR' },
      };
      const action = actionByPhase[reconciled.phase];
      if (action) dispatchWorkflow(action);
    }
  }, [sections.length, optimizerOutput, preferences, workflow.phase, isCalculating, optimizerErrorMeta, isResultsStale]);

  const completedSteps = useMemo(() => ({ setup: sections.length > 0, results: Boolean(optimizerOutput && optimizerOutput.signatureStatus === 'verified') }), [sections.length, optimizerOutput]);
  const derivedWorkflowPhase = useMemo(() => { if (isCalculating) return 'processing'; if (optimizerErrorMeta?.retryable) return 'retryable-error'; if (sections.length === 0 && currentStep === 'home') return 'idle'; if (isResultsStale) return 'stale'; if (optimizerOutput?.signatureStatus === 'verified') return 'results'; return sections.length > 0 ? 'ready' : workflow.phase; }, [isCalculating, optimizerErrorMeta, sections.length, optimizerOutput, isResultsStale, workflow.phase]);

  // App-level navigation is centralized here so URL, visible step, persistence,
  // and scroll position cannot drift apart.
  function canNavigateTo(step: AppStep): boolean {
    if (step === 'home' || step === 'setup') return true;
    return optimizerOutputRef.current !== null && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true;
  }

  const syncNavigationFromLocation = useCallback((preferStoredBareRoot = false) => {
    setIsConfirmResetOpen(false);
    const hash = window.location.hash.toLowerCase();
    const pathname = normalizePathname(window.location.pathname).toLowerCase();

    const infoModal = getCanonicalInfoModalFromHash(hash);
    if (infoModal) {
      const storedStep = readSavedCurrentStep();
      const rawUnderlying = window.history.state?.gadwalUnderlyingStep;
      const currentSemanticSignature = optimizerOutputRef.current ? computeInputsSignature(sectionsRef.current, preferencesRef.current) : '';
      const historyStateMatches = !optimizerOutputRef.current?.generatedInputsSignature || !currentSemanticSignature || optimizerOutputRef.current.generatedInputsSignature === currentSemanticSignature;
      const canShowResults = Boolean(optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && historyStateMatches);
      const underlyingStep: AppStep = isAppStep(rawUnderlying) && (rawUnderlying !== 'results' || canShowResults) ? rawUnderlying : (storedStep === 'results' && canShowResults ? 'results' : storedStep === 'setup' && sectionsRef.current.length > 0 ? 'setup' : 'home');
      setCurrentStep(underlyingStep);
      if (underlyingStep === 'home') setWorkflowPanel('start');
      else if (underlyingStep === 'setup') setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
      else setWorkflowPanel('preferences');
      setIsDemoModalOpen(infoModal === 'demo');
      setIsHowItWorksModalOpen(infoModal === 'how-it-works' || infoModal === 'promise');
      setIsPrivacyModalOpen(infoModal === 'privacy');
      setIsPricingModalOpen(infoModal === 'pricing');
      setIsAccessBillingModalOpen(infoModal === 'access-billing');
      setIsAboutUsModalOpen(infoModal === 'about-us');
      setIsContactUsModalOpen(infoModal === 'contact-us');
      setIsDeliveryShippingModalOpen(infoModal === 'delivery-shipping');
      setIsRefundModalOpen(infoModal === 'refund');
      return;
    }

    setIsDemoModalOpen(false);
    setIsHowItWorksModalOpen(false);
    setIsPrivacyModalOpen(false);
    setIsPricingModalOpen(false);
    setIsAccessBillingModalOpen(false);
    setIsAboutUsModalOpen(false);
    setIsContactUsModalOpen(false);
    setIsDeliveryShippingModalOpen(false);
    setIsRefundModalOpen(false);

    let nextStep: AppStep = 'home';
    if (hash === '#results' || (!hash && pathname === '/results')) {
      const currentSemanticSignature = optimizerOutputRef.current ? computeInputsSignature(sectionsRef.current, preferencesRef.current) : '';
      const historyStateMatches = Boolean(optimizerOutputRef.current?.generatedInputsSignature && currentSemanticSignature && optimizerOutputRef.current.generatedInputsSignature === currentSemanticSignature);
      nextStep = optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && historyStateMatches ? 'results' : (sectionsRef.current.length > 0 ? 'setup' : 'home');
    } else if (hash === '#setup' || (!hash && pathname === '/setup')) {
      nextStep = 'setup';
    } else if (hash === '#home' || (!hash && pathname === '/home')) {
      nextStep = 'home';
    } else if (!hash && pathname === '/' && preferStoredBareRoot) {
      // On a fresh load at the bare root, preserve the saved workflow location.
      const savedStep = readSavedCurrentStep();
      if (savedStep === 'results' && optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && optimizerOutputRef.current.generatedInputsSignature === computeInputsSignature(sectionsRef.current, preferencesRef.current)) {
        nextStep = 'results';
      } else if (savedStep === 'setup' && sectionsRef.current.length > 0) {
        nextStep = 'setup';
      } else {
        nextStep = 'home';
      }
    }

    const targetHash = getStepHash(nextStep);
    if (window.location.hash !== targetHash || (pathname !== '/' && !['/home','/setup','/results'].includes(pathname))) {
      window.history.replaceState({ step: nextStep, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
    }

    setCurrentStep(nextStep);

    if (nextStep === 'home') {
      setWorkflowPanel('start');
    } else if (nextStep === 'setup') {
      setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
    }

    cancelPendingScroll();
    window.requestAnimationFrame(() => {
      const y = pageScrollPositionsRef.current[nextStep] || 0;
      window.scrollTo({ top: y, left: 0, behavior: 'auto' });
    });
  }, [cancelPendingScroll]);

  const navigateToStep = useCallback((step: AppStep, pushHistory = true, shouldScrollToTop = true): boolean => {
    if (!canNavigateTo(step)) return false;
    const previousStep = currentStep;
    pageScrollPositionsRef.current[previousStep] = window.scrollY || 0;
    setCurrentStep(step);
    if (pushHistory) saveCurrentStep(step);
    const targetHash = getStepHash(step);

    if (window.location.hash !== targetHash) {
      if (pushHistory) {
        window.history.pushState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
      } else {
        window.history.replaceState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
      }
    } else if (!pushHistory) {
      window.history.replaceState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
    }

    if (step === 'home') {
      setWorkflowPanel('start');
    } else if (step === 'setup') {
      setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
    }

    cancelPendingScroll();
    const scrollGeneration = scrollTaskRef.current.generation;
    const scheduleScroll = () => {
      if (scrollTaskRef.current.generation !== scrollGeneration) return;
      window.scrollTo({ top: shouldScrollToTop ? 0 : (pageScrollPositionsRef.current[step] || 0), left: 0, behavior: 'auto' });
    };
    scrollTaskRef.current.raf = window.requestAnimationFrame(scheduleScroll);
    return true;
  }, [currentStep, canNavigateTo, cancelPendingScroll]);

  // Keep direct hash edits and browser Back/Forward synchronized with React state.
  useEffect(() => {
    syncNavigationFromLocation(true);

    let lastLocationKey = `${window.location.pathname}${window.location.hash}`;
    const handleHistoryNavigation = () => { const key = `${window.location.pathname}${window.location.hash}`; if (key === lastLocationKey) return; lastLocationKey = key; syncNavigationFromLocation(false); };
    window.addEventListener('popstate', handleHistoryNavigation);
    window.addEventListener('hashchange', handleHistoryNavigation);
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation);
      window.removeEventListener('hashchange', handleHistoryNavigation);
    };
  }, [syncNavigationFromLocation]);

  // Global modals state
  const [isHowItWorksModalOpen, setIsHowItWorksModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isAboutUsModalOpen, setIsAboutUsModalOpen] = useState(false);
  const [isContactUsModalOpen, setIsContactUsModalOpen] = useState(false);
  const [isDeliveryShippingModalOpen, setIsDeliveryShippingModalOpen] = useState(false);
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<AuthModalView | null>(null);
  const [authResetToken, setAuthResetToken] = useState('');
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const modalRestoreFocusRef = useRef<HTMLElement | null>(null);

  const handleOpenAuth = useCallback((view: AuthModalView = 'login') => {
    setAuthResetToken('');
    setAuthModalView(view);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const hashPart = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
    const hashParams = new URLSearchParams(hashPart);
    const resetToken = params.get('token') || params.get('resetToken') || hashParams.get('token') || hashParams.get('resetToken') || '';
    const pathname = normalizePathname(window.location.pathname);

    if (resetToken || pathname === '/reset-password') {
      if (resetToken) {
        setAuthResetToken(resetToken.slice(0, 2048));
      }
      setAuthModalView('forgot');
      const cleanPath = pathname === '/reset-password' ? '/' : window.location.pathname;
      const cleanHash = window.location.hash.includes('?') ? window.location.hash.split('?')[0] : window.location.hash;
      const cleanUrl = `${cleanPath}${cleanHash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  const closeInfoModal = useCallback((kind: InfoModal) => {
    const current = getInfoModalFromHash(window.location.hash.toLowerCase());
    if (current === kind || (kind === 'promise' && current === 'how-it-works')) {
      const rawUnderlying = window.history.state?.gadwalUnderlyingStep;
      const underlyingStep = isAppStep(rawUnderlying) ? rawUnderlying : currentStep;
      if (window.history.state?.gadwalInfoModal === kind) {
        window.history.back();
      } else {
        window.history.replaceState({ step: underlyingStep }, '', getStepHash(underlyingStep));
      }
    }
    if (kind === 'demo') setIsDemoModalOpen(false);
    if (kind === 'how-it-works' || kind === 'promise') setIsHowItWorksModalOpen(false);
    if (kind === 'privacy') setIsPrivacyModalOpen(false);
    if (kind === 'pricing') setIsPricingModalOpen(false);
    if (kind === 'access-billing') setIsAccessBillingModalOpen(false);
    if (kind === 'about-us') setIsAboutUsModalOpen(false);
    if (kind === 'contact-us') setIsContactUsModalOpen(false);
    if (kind === 'delivery-shipping') setIsDeliveryShippingModalOpen(false);
    if (kind === 'refund') setIsRefundModalOpen(false);
  }, [currentStep]);

  const openInfoModal = useCallback((kind: InfoModal, trigger?: HTMLElement | null) => {
    if (trigger) modalRestoreFocusRef.current = trigger;
    setIsDemoModalOpen(false);
    setIsHowItWorksModalOpen(false);
    setIsPrivacyModalOpen(false);
    setIsPricingModalOpen(false);
    setIsAccessBillingModalOpen(false);
    setIsAboutUsModalOpen(false);
    setIsContactUsModalOpen(false);
    setIsDeliveryShippingModalOpen(false);
    setIsRefundModalOpen(false);
    const hash = INFO_MODAL_HASHES[kind] || '#how-it-works';
    const currentHash = window.location.hash.toLowerCase();
    if (currentHash !== hash) {
      window.history.pushState({ gadwalInfoModal: kind === 'promise' ? 'how-it-works' : kind, gadwalUnderlyingStep: currentStep, step: currentStep }, '', hash);
    }
    if (kind === 'demo') setIsDemoModalOpen(true);
    if (kind === 'how-it-works' || kind === 'promise') setIsHowItWorksModalOpen(true);
    if (kind === 'privacy') setIsPrivacyModalOpen(true);
    if (kind === 'pricing') setIsPricingModalOpen(true);
    if (kind === 'access-billing') setIsAccessBillingModalOpen(true);
    if (kind === 'about-us') setIsAboutUsModalOpen(true);
    if (kind === 'contact-us') setIsContactUsModalOpen(true);
    if (kind === 'delivery-shipping') setIsDeliveryShippingModalOpen(true);
    if (kind === 'refund') setIsRefundModalOpen(true);
  }, [currentStep]);

  const closeInfoAndNavigate = useCallback((kind: InfoModal, step: AppStep, workflowPanel?: WorkflowPanel) => {
    if (workflowPanel) setWorkflowPanel(workflowPanel);
    if (kind === 'demo') setIsDemoModalOpen(false);
    if (kind === 'how-it-works' || kind === 'promise') setIsHowItWorksModalOpen(false);
    if (kind === 'privacy') setIsPrivacyModalOpen(false);
    if (kind === 'pricing') setIsPricingModalOpen(false);
    if (kind === 'access-billing') setIsAccessBillingModalOpen(false);
    if (kind === 'about-us') setIsAboutUsModalOpen(false);
    if (kind === 'contact-us') setIsContactUsModalOpen(false);
    if (kind === 'delivery-shipping') setIsDeliveryShippingModalOpen(false);
    if (kind === 'refund') setIsRefundModalOpen(false);
    saveCurrentStep(step);
    window.history.replaceState({ step }, '', getStepHash(step));
    setCurrentStep(step);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, []);


  useEffect(() => {
    let cancelled = false;
    const syncAccountState = async () => {
      if (authStatus !== 'authenticated' || !user?.emailVerified) {
        if (!cancelled) { setAccessState(null); setIsAccountCenterOpen(false); }
        return;
      }
      try {
        const { response, data } = await fetchJson('/api/account/overview', { credentials: 'same-origin', timeoutMs: 10000 });
        if (!response.ok || cancelled) return;
        if (!cancelled) {
          setAccessState(data.access || null);
          if (!data.profile?.onboardingCompletedAt) setIsOnboardingOpen(true);
        }
      } catch (error) {
        if (!cancelled) devLogWarn('Could not sync account state.');
      }
    };
    void syncAccountState();
    return () => { cancelled = true; };
  }, [authStatus, user?.id, user?.emailVerified]);

  useEffect(() => {
    // Clean up any legacy test font style tag or storage
    const styleTag = document.getElementById('gadwal-test-font-style');
    if (styleTag) styleTag.remove();
    safeStorage.removeItem('gadwal_test_font');
  }, []);

  // Cancel any active in-flight calculation when inputs change
  const invalidateResults = () => {
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
  };

  // Sync state to durable versioned snapshots. A failed write leaves the prior
  // recoverable snapshot untouched rather than pretending the new state was saved.
  useEffect(() => {
    if (!accountDataReady || authStatus !== 'unauthenticated') return;
    const payload = JSON.stringify(createStorageEnvelope(sections, CURRENT_SCHEMA_VERSION));
    queueStorageWrite(STORAGE_KEY_SECTIONS, payload);
  }, [sections, accountDataReady, authStatus]);

  useEffect(() => {
    if (!accountDataReady || authStatus !== 'unauthenticated') return;
    const payload = JSON.stringify(createStorageEnvelope(preferences, CURRENT_SCHEMA_VERSION));
    queueStorageWrite(STORAGE_KEY_PREFS, payload);
  }, [preferences, accountDataReady, authStatus]);

  const sectionsRef = useRef<Section[]>(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // Section additions & merge handler. Course identity is code-first and visible
  // section codes are the only identifiers used for catalog deduplication. OCR
  // internal IDs are never compared with catalog section codes.
  const handleAddSections = (newSections: Section[]): AddSectionsResult => {
    const existing = sectionsRef.current;
    const courseIdentity = (section: Section) => getCourseIdentityKey(section.courseCode, section.name);
    // OCR facts are never silently synchronized to existing catalog values.
    // Conflicting credits are retained as an explicit review state by the
    // identity-safe deduplication layer instead of choosing the old value.
    const normalizedIncomingSections = newSections.map((section) => ({
      ...section,
      workflowGenerationId: section.workflowGenerationId || workflowGenerationRef.current,
      courseKey: courseIdentity(section),
      sectionCode: section.sectionCode?.trim() || null,
      sectionCodeMissing: Boolean(section.sectionCodeMissing || !section.sectionCode?.trim()),
    }));

    const { insertedSections, updatedSections, updatedAllSections, skippedCount, updatedCount } = deduplicateSections(
      existing,
      normalizedIncomingSections,
    );

    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = updatedAllSections;
    setSections(updatedAllSections);

    if (insertedSections.length > 0 || updatedCount > 0) {
      invalidateResults();
    }

    return { insertedSections, updatedSections, updatedAllSections, skippedCount, updatedCount, creditsAdjustedCount: 0 };
  };

  const handleDeleteCourse = (courseName: string, courseKey?: string) => {
    const targetNorm = normalizeCourseName(courseName);
    const nextSections = sectionsRef.current.filter((s) => {
      const identity = getCourseIdentityKey(s.courseCode, s.name);
      return courseKey ? identity !== courseKey : normalizeCourseName(s.name) !== targetNorm;
    });
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = nextSections;
    setSections(nextSections);
    invalidateResults();
  };

  const handleDeleteSection = (sectionId: string, courseName?: string, courseKey?: string): boolean => {
    if (!courseName || !courseName.trim()) {
      devLogWarn('Refusing ambiguous section deletion.');
      return false;
    }
    const targetId = sectionId.trim();
    const targetCourseNorm = normalizeCourseName(courseName);
    const exactMatches = sectionsRef.current.filter((s) => s.id.trim() === targetId && (!courseKey || (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey) && normalizeCourseName(s.name) === targetCourseNorm);
    let targetIndex = -1;
    if (exactMatches.length === 1) {
      targetIndex = sectionsRef.current.findIndex((s) => s.id.trim() === targetId && normalizeCourseName(s.name) === targetCourseNorm);
    } else if (exactMatches.length > 1) {
      devLogWarn('Refusing section deletion because the internal section ID is duplicated.');
      return false;
    } else {
      const canonicalTarget = canonicalizeSectionIdentity(targetId);
      const fallbackMatches = sectionsRef.current.filter((s) =>
        normalizeCourseName(s.name) === targetCourseNorm && canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalTarget
      );
      if (fallbackMatches.length !== 1) {
        devLogWarn('Refusing ambiguous section deletion.');
        return false;
      }
      targetIndex = sectionsRef.current.findIndex((s) =>
        normalizeCourseName(s.name) === targetCourseNorm && canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalTarget
      );
    }
    if (targetIndex < 0) return false;
    const remaining = sectionsRef.current.filter((_, index) => index !== targetIndex);
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = remaining;
    setSections(remaining);
    invalidateResults();
    return true;
  };

  const handleUpdateSection = (originalId: string, updatedSection: Section, originalCourseName?: string, originalCourseKey?: string, originalSectionKey?: string): boolean => {
    const result = updateSectionDomain(sectionsRef.current, originalId, updatedSection, { originalCourseName, originalCourseKey, originalSectionKey });
    if (!result.accepted) return false;
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = result.sections;
    setSections(result.sections);
    // A section edit can change the optimizer inputs even when course identity remains
    // stable, so all edits intentionally invalidate an existing result.
    invalidateResults();
    return true;
  };

  // Reconcile persisted preferences against the current catalog at the data boundary.
  // This prevents impossible/stale targets and malformed mandatory identities from reaching the optimizer.
  useEffect(() => {
    if (sections.length === 0) return;
    const creditValuesByCourse = new Map<string, Set<number>>();
    for (const section of sections) {
      if (section.credits == null || !Number.isFinite(Number(section.credits))) continue;
      const key = getCourseIdentityKey(section.courseCode, section.name);
      const set = creditValuesByCourse.get(key) || new Set<number>();
      set.add(Number(section.credits));
      creditValuesByCourse.set(key, set);
    }
    const totalCatalogCredits = Array.from(creditValuesByCourse.values())
      .filter((values) => values.size === 1)
      .reduce((sum, values) => sum + Array.from(values)[0], 0);
    const reconciled = reconcilePreferencesWithCatalog(preferences, sections, totalCatalogCredits);
    if (!areSchedulePreferencesEqual(reconciled, preferences)) {
      setPreferences(reconciled);
      optimizerRequestIdRef.current++;
      optimizerTaskRef.current?.cancel();
      optimizerTaskRef.current = null;
    }
  }, [sections]);

  // Synchronize mandatory course identities with the current catalog so deleted
  // courses never persist as stale optimizer constraints.
  useEffect(() => {
    const existingKeys = new Set(sections.map((s) => s.courseKey || getCourseIdentityKey(s.courseCode, s.name)));
    const byName = new Map<string, string[]>();
    for (const section of sections) {
      const key = section.courseKey || getCourseIdentityKey(section.courseCode, section.name);
      const name = normalizeCourseName(section.name);
      if (name) byName.set(name, [...(byName.get(name) || []), key]);
    }
    setPreferences((prev) => {
      const keys = normalizeMandatoryCourseKeys(prev.mandatoryCourseKeys).filter((key) => existingKeys.has(key));
      for (const legacyName of normalizeMandatoryCourses(prev.mandatoryCourses)) {
        const matches = Array.from(new Set(byName.get(normalizeCourseName(legacyName)) || []));
        if (matches.length === 1 && !keys.some((key) => key.toLowerCase() === matches[0].toLowerCase())) keys.push(matches[0]);
      }
      const labels = keys.map((key) => sections.find((s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === key)?.name?.trim() || '').filter(Boolean);
      const previousKeys = normalizeMandatoryCourseKeys(prev.mandatoryCourseKeys).slice().sort();
      const nextKeys = keys.slice().sort();
      if (previousKeys.join("|") !== nextKeys.join("|") || Array.from(new Set(labels)).sort().join("|") !== Array.from(new Set(prev.mandatoryCourses || [])).sort().join("|")) {
        return { ...prev, mandatoryCourseKeys: keys, mandatoryCourses: Array.from(new Set(labels)) };
      }
      return prev;
    });
  }, [sections]);

  const handleUpdatePreferences = (newPrefs: SchedulePreferences) => {
    const canonicalPrefs = { ...preferences, ...sanitizePreferenceValues(newPrefs) };
    setPreferences(canonicalPrefs);
    safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);
    invalidateResults();
  };

  const handleClearSections = () => {
    RESET_COORDINATOR.reset('user-reset');
    resetGenerationRef.current += 1;
    workflowGenerationRef.current = createGenerationId('wf');
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
    sectionsRef.current = [];
    setSections([]);
    setPreferences(DEFAULT_PREFERENCES);
    setOptimizerOutput(null);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    clearAllPersistedAppData();
    safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);

    setResetVersion((v) => v + 1);
    setWorkflowPanel('start');
    navigateToStep('home', false);
    setIsConfirmResetOpen(false);
    setResetAnnouncement('Everything was cleared. You can start a new schedule.');
    if (resetAnnouncementTimerRef.current !== null) window.clearTimeout(resetAnnouncementTimerRef.current);
    resetAnnouncementTimerRef.current = window.setTimeout(() => {
      resetAnnouncementTimerRef.current = null;
      setResetAnnouncement(null);
    }, 5000);
    setIsPrivacyModalOpen(false);
    setIsPricingModalOpen(false);
    setIsAccessBillingModalOpen(false);
    setIsAboutUsModalOpen(false);
    setIsContactUsModalOpen(false);
    setIsDeliveryShippingModalOpen(false);
    setIsRefundModalOpen(false);
    setIsDemoModalOpen(false);
    setIsHowItWorksModalOpen(false);
    resetBodyScrollLock();
  };

  // Run Optimization Algorithm with user preferences
  const executeOptimizer = async (prefsToUse: SchedulePreferences, navigateToResultsOnSuccess: boolean): Promise<boolean> => {
    const reqId = ++optimizerRequestIdRef.current;
    const generationAtStart = workflowGenerationRef.current;
    const sectionsSnapshotAtStart = cloneDomain(sections);
    const preferencesSnapshotAtStart = cloneDomain(prefsToUse);
    cancelOptimizerOwner('live-estimate');
    dispatchWorkflow({ type: 'GENERATION_STARTED' });
    setIsCalculating(true);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    setLastWorkflowAction(null);
    try {
      const { courseMap, fixedCourses } = buildOptimizerCourseMap(sectionsSnapshotAtStart);

      const task = runOptimizerAsyncCancellable({
        courses: courseMap,
        fixedCourses,
        preferences: prefsToUse,
        runId: activeScheduleRunIdRef.current || undefined,
      }, { owner: 'user-run', cancelPreviousOwner: true });
      optimizerTaskRef.current = task;
      const rawOutput = await task.promise;
      const generatedOutput = { ...rawOutput, resultContractVersion: CURRENT_RESULT_CONTRACT_VERSION as 'v2' | 'v3', workflowGenerationId: generationAtStart };

      if (reqId !== optimizerRequestIdRef.current || generationAtStart !== workflowGenerationRef.current) {
        // Stale in-flight calculation discarded because inputs or step changed
        return false;
      }

      const totalGeneratedSchedules = generatedOutput.byDayCount && typeof generatedOutput.byDayCount === 'object'
        ? Object.values(generatedOutput.byDayCount).reduce((sum, bucket) => sum + (Array.isArray(bucket) ? bucket.length : 0), 0)
        : 0;
      const hasValidResult =
        generatedOutput.signatureStatus === 'verified' &&
        generatedOutput.sectionsSnapshotComplete === true &&
        generatedOutput.preferencesSnapshotComplete === true &&
        generatedOutput.byDayCount && typeof generatedOutput.byDayCount === 'object' &&
        totalGeneratedSchedules > 0 &&
        generatedOutput.searchCompleteness !== 'cancelled' &&
        generatedOutput.searchCompleteness !== 'preflight_rejected';
      if (generatedOutput.byDayCount && typeof generatedOutput.byDayCount === 'object' && totalGeneratedSchedules === 0) {
        throw Object.assign(new Error('NO_RESULTS'), { code: 'NO_RESULTS' });
      }
      if (!hasValidResult) {
        throw Object.assign(new Error('NO_RESULTS'), { code: 'NO_RESULTS' });
      }

      const output: OptimizerOutput = {
        ...generatedOutput,
        generatedInputsSignature: computeInputsSignature(sectionsSnapshotAtStart, preferencesSnapshotAtStart),
        generatedAt: Date.now(),
        sectionsSnapshot: cloneDomain(sectionsSnapshotAtStart) as Section[],
        preferencesUsed: cloneDomain(preferencesSnapshotAtStart),
        sectionsSnapshotComplete: true,
        preferencesSnapshotComplete: true,
        signatureStatus: 'verified',
        buildVersion: APP_VERSION,
      };

      optimizerOutputRef.current = output;
      setOptimizerOutput(output);
      setLastWorkflowAction('Schedules generated successfully.');
      
      // Persist the verified result before allowing the run to be completed. The server
      // uses the saved result as the authoritative evidence that a successful search occurred.
      if (user?.emailVerified) {
        const saveResponse = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ scheduleData: output, title: 'My Schedule', runId: activeScheduleRunIdRef.current })
        });
        const saveBody = await saveResponse.json().catch(() => ({}));
        if (!saveResponse.ok) {
          throw Object.assign(new Error(saveBody.error || 'Could not save the generated schedule.'), { code: 'SAVE_RESULT_FAILED' });
        }
      }

      if (navigateToResultsOnSuccess) {
        navigateToStep('results', true);
      }
      return true;
    } catch (err: any) {
      devLogError('Failed to run optimizer.');
      if (reqId === optimizerRequestIdRef.current) {
        const raw = String(err?.message || '');
        const cancelled = /cancel/i.test(raw);
        const noResults = /no schedule|no valid|couldn.t find/i.test(raw) || err?.code === 'NO_RESULTS';
        if (cancelled) {
          setOptimizerErrorMessage(null);
          setOptimizerErrorMeta(null);
          setLastWorkflowAction('Search stopped by you.');
          dispatchWorkflow({ type: 'CANCELLED' });
        } else if (noResults) {
          setOptimizerErrorMessage('We couldn’t find a schedule that matches all of your choices. Try relaxing one constraint.');
          setOptimizerErrorMeta({ code: 'NO_RESULTS', retryable: false });
          dispatchWorkflow({ type: 'ERROR', reasonCode: 'NO_RESULTS' });
        } else {
          setOptimizerErrorMessage('The schedule search stopped unexpectedly. Your courses are still safe. Try the search again.');
          setOptimizerErrorMeta({ code: 'SEARCH_FAILED', retryable: true });
          setLastWorkflowAction('Schedule search needs another try.');
          dispatchWorkflow({ type: 'RETRYABLE_ERROR', reasonCode: 'SEARCH_FAILED' });
        }
            return false;
    }    } finally {
      if (reqId === optimizerRequestIdRef.current) setIsCalculating(false);
      if (reqId === optimizerRequestIdRef.current) optimizerTaskRef.current = null;
    }
  };

  const handleCancelOptimizer = () => {
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    setLastWorkflowAction('Search stopped by you.');
    dispatchWorkflow({ type: 'CANCELLED' });
  };

  const handleRunOptimizer = async () => {
    if (isCalculating) return;
    if (!user) { handleOpenAuth('login'); return; }
    if (!user.emailVerified) { handleOpenAuth('verify'); return; }

    let runData: any = null;
    try {
      const { response: runResponse, data: runDataResponse } = await fetchJson('/api/run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sections, preferences }),
      });
      runData = runDataResponse || {};
      activeScheduleRunIdRef.current = typeof runData.runId === 'string' ? runData.runId : null;
      if (!runResponse.ok) {
        if (runResponse.status === 403) setIsUpgradeModalOpen(true);
        else alert(runData.error || 'Failed to start run.');
        return;
      }

      const success = await executeOptimizer(preferences, true);
      if (runData.runId) {
        await fetchJson('/api/run/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ runId: runData.runId, success }),
          timeoutMs: 8_000
        });
      }
      activeScheduleRunIdRef.current = null;
    } catch (e) {
      activeScheduleRunIdRef.current = null;
      if (!runData?.runId) {
        alert('Could not start the schedule search. Please try again.');
      } else {
        // Do not mark the run as failed from the browser. A failed/cancelled search
        // remains the same active free-run so the student can retry without consuming it.
      }
    }
  };

  // Safe navigation home without clearing user data
  const handleGoHome = () => {
    setWorkflowPanel('start');
    navigateToStep('home', true, true);
  };


  // Distinct course count for clean header display
  const distinctCoursesCount = useMemo(() => {
    return new Set(sections.map((s) => s.courseKey || getCourseIdentityKey(s.courseCode, s.name))).size;
  }, [sections]);

  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    try {
      await refreshConnectivity();
    } finally {
      setIsCheckingConnection(false);
    }
  };

  if (!isOnline) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
        <header className="border-b border-line-strong bg-paper sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span className="flex items-center p-1 select-none">
                <img
                  src="/brand/gadwal-wordmark.png"
                  alt="Gadwal"
                  className="block w-auto h-8 sm:h-9.5 md:h-10 max-w-[10.5rem] sm:max-w-[12rem] object-contain object-left"
                />
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full text-center space-y-6 bg-paper p-6 sm:p-8 border border-line-strong rounded-sm shadow-xs animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-full bg-mist border border-line flex items-center justify-center mx-auto text-text-muted">
              <WifiOff className="w-7 h-7 text-text-secondary" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
                No internet connection
              </h1>
              <p className="text-sm text-text-secondary leading-relaxed">
                Gadwal requires an active internet connection to run. Please check your network connection and try again.
              </p>
            </div>

            <div>
              <button
                type="button"
                id="btn-retry-connection"
                onClick={handleCheckConnection}
                disabled={isCheckingConnection}
                className="inline-flex items-center justify-center gap-2 w-full px-5 py-2.5 bg-ink hover:bg-ink-soft disabled:opacity-60 text-white text-sm font-bold rounded-sm transition cursor-pointer active:scale-98 shadow-xs"
              >
                <RefreshCw className={`w-4 h-4 ${isCheckingConnection ? 'animate-spin' : ''}`} />
                <span>{isCheckingConnection ? 'Checking connection…' : 'Check connection'}</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (accountDataLoadError && authStatus === 'authenticated' && user?.emailVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-ink px-6" role="alert">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-bold">Couldn’t load your account data</h1>
          <p className="mt-2 text-sm text-text-secondary">Your saved courses and schedules were not loaded, so nothing from this browser will be synced into your account.</p>
          <button type="button" className="mt-4 px-4 py-2 bg-ink text-white rounded-sm" onClick={() => setAccountSyncAttempt((v) => v + 1)}>Try again</button>
        </div>
      </div>
    );
  }

  if (!accountDataReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-ink" role="status" aria-live="polite">
        <span className="text-sm text-text-secondary">Loading your account…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-ink antialiased selection:bg-ink selection:text-white" data-workflow-phase={derivedWorkflowPhase}>
      {/* Header */}
      <Header
        totalCoursesCount={distinctCoursesCount}
        currentStep={currentStep}
        onNavigateStep={(step) => navigateToStep(step, true)}
        onGoHome={handleGoHome}
        onReset={() => setIsConfirmResetOpen(true)}
        onOpenHowItWorks={(trigger) => openInfoModal('how-it-works', trigger)}
        onOpenDemo={(trigger) => openInfoModal('demo', trigger)}
        onOpenAuth={(view) => handleOpenAuth(view || 'login')}
        onOpenAccount={() => setIsAccountCenterOpen(true)}
      />

      <VerificationBanner onOpenVerify={() => handleOpenAuth('verify')} />
      {user?.emailVerified && accessState && (
        <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-3" aria-live="polite">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-text-secondary">
            <span className="font-semibold text-ink">Gadwal access:</span>
            {accessState.hasAcademicYear ? <span className="font-bold text-emerald-700">Academic Year active</span> :
             accessState.hasCurrentTerm ? <span className="font-bold text-emerald-700">Current Term active</span> :
             accessState.hasFreeRun ? <span className="font-bold text-accent-strong">Free run available</span> :
             <span className="font-bold text-text-secondary">Payment required</span>}
            <span>•</span>
            <span>{accessState.academicYear} · {accessState.term}</span>
          </div>
        </div>
      )}

      {persistenceWarning && (
        <div role="status" aria-live="polite" className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-3">
          <div className="p-3 bg-caution-soft border border-caution-line rounded-sm text-sm sm:text-sm text-caution-strong">
            <strong>We can’t save your changes right now.</strong> Your changes may be lost if you close this tab. Keep it open for now.
          </div>
        </div>
      )}

      {/* Unknown Path / 404 Notice Banner (Problem #4) */}
      {unknownRouteNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-4"
        >
          <div className="p-4 bg-paper border border-line-strong rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm sm:text-sm text-ink shadow-xs animate-in fade-in duration-200">
            <div className="flex items-start sm:items-center gap-2.5">
              <div>
                <span className="font-bold block">Page not found <span className="font-mono text-sm text-text-secondary">{unknownRouteNotice}</span></span>
                <span className="text-text-secondary text-sm">
                  That page doesn’t exist. You’re back at Gadwal.
                </span>
              </div>
            </div>
            <button
              type="button"
              id="btn-dismiss-unknown-route-notice"
              onClick={() => { setUnknownRouteNotice(null); navigateToStep('home', false, true); }}
              className="px-3 py-1.5 text-sm font-bold text-text-secondary hover:text-ink bg-mist hover:bg-line rounded-sm cursor-pointer transition shrink-0 self-end sm:self-auto"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main id="gadwal-main-content" aria-label="Gadwal schedule planner" aria-busy={isCalculating} className="flex-1 pb-4 sm:pb-6">
        {(currentStep === 'home' || currentStep === 'setup') && (
          <>
            {currentStep === 'home' && workflowPanel === 'start' && sections.length === 0 && (
              <HeroBanner
                onOpenHowItWorks={() => openInfoModal('how-it-works')}
                onGetStarted={() => {
                  const dropzone =
                    document.getElementById('responsive-choice-section') ||
                    document.getElementById('responsive-section-intro') ||
                    document.getElementById('responsive-add-title') ||
                    document.getElementById('upload-dropzone') ||
                    document.getElementById('step-add-courses-container');
                  dropzone?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  const choiceBtn = dropzone?.querySelector<HTMLButtonElement>('.responsive-big-choice');
                  if (choiceBtn) {
                    window.setTimeout(() => choiceBtn.focus({ preventScroll: true }), 350);
                  }
                }}
              />
            )}

            <StepAddCourses
              key={`step-add-${resetVersion}`}
              workflowPanel={workflowPanel}
              onWorkflowPanelChange={handleWorkflowPanelChange}
              workflow={workflow}
              resetVersion={resetVersion}
              workflowGenerationId={workflowGenerationRef.current}
              dispatchWorkflow={dispatchWorkflow}
              sections={sections}
              onAddSections={handleAddSections}
              onDeleteCourse={handleDeleteCourse}
              onDeleteSection={handleDeleteSection}
              onUpdateSection={handleUpdateSection}
              onClearSections={() => setIsConfirmResetOpen(true)}
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              onRunOptimizer={handleRunOptimizer}
              onCancelOptimizer={handleCancelOptimizer}
              onOpenHowItWorks={(trigger) => openInfoModal('how-it-works', trigger)}
              onOpenDemo={(trigger) => openInfoModal('demo', trigger)}
              onOpenAuth={(view) => handleOpenAuth(view || 'login')}
              onGoHome={handleGoHome}
              onProcessingStateChange={setIsProcessingActive}
              isCalculating={isCalculating}
              hasPreviousResults={Boolean(
                optimizerOutput &&
                  (Object.values(optimizerOutput.byDayCount || {}).some((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                    Boolean(optimizerOutput.impossibleDiagnostic))
              )}
              isResultsStale={isResultsStale}
              staleReasons={staleChangeSummary.reasons}
              onViewPreviousResults={() => navigateToStep('results', false)}
              isOnline={isOnline}
              ocrServiceAvailable={ocrServiceAvailable}
              refreshConnectivity={refreshConnectivity}
            />
          </>
        )}

        {currentStep === 'results' && optimizerOutput && (
          <Suspense fallback={<div className="max-w-md mx-auto py-16 px-4 text-center text-sm text-text-secondary">Loading your schedules…</div>}>
          <StepResults
            key={`step-results-${resetVersion}`}
            optimizerOutput={optimizerOutput}
            preferences={preferences}
            sections={sections}
            onBackToSetup={() => navigateToStep('setup', false)}
                isStale={isResultsStale}
            staleChangeSummary={staleChangeSummary}
            onRecomputeSchedules={handleRunOptimizer}
            onCancelOptimizer={handleCancelOptimizer}
            isCalculating={isCalculating}
          />
          </Suspense>
        )}

        {currentStep === 'results' && !optimizerOutput && (
          <div className="max-w-md mx-auto py-16 px-4 sm:px-6 text-center space-y-5 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-none bg-mist border border-line flex items-center justify-center mx-auto text-text-muted">
              <AlertCircle className="w-6 h-6 text-text-muted" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-ink tracking-tight">No schedules yet</h2>
              <p className="text-sm sm:text-sm text-text-secondary leading-relaxed">
                Add your courses, then tell us what matters to you.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => navigateToStep('setup', false)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-ink hover:bg-ink-soft text-white text-sm sm:text-sm font-bold rounded-sm transition cursor-pointer active:scale-98 shadow-xs"
              >
                <span>Back to courses</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Global Modals */}
      <ConfirmResetModal
        isOpen={isConfirmResetOpen}
        onClose={() => setIsConfirmResetOpen(false)}
        onConfirm={handleClearSections}
      />

      <Suspense fallback={null}>
      <HowItWorksModal
        isOpen={isHowItWorksModalOpen}
        onClose={() => closeInfoModal('how-it-works')}
        restoreFocusRef={modalRestoreFocusRef}
        onGetStarted={() => {
          closeInfoAndNavigate('how-it-works', 'home', 'start');
          window.setTimeout(() => {
            const target =
              document.getElementById('responsive-choice-section') ||
              document.getElementById('responsive-section-intro') ||
              document.getElementById('responsive-add-title') ||
              document.getElementById('step-add-courses-container') ||
              document.querySelector('.responsive-primary-choice');
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const choiceBtn = target?.querySelector<HTMLButtonElement>('.responsive-big-choice') || document.getElementById('start-screenshots-choice');
            if (choiceBtn) {
              window.setTimeout(() => choiceBtn.focus({ preventScroll: true }), 350);
            }
          }, 60);
        }}
      />

      <DemoModal
        isOpen={isDemoModalOpen}
        onClose={() => closeInfoModal('demo')}
        restoreFocusRef={modalRestoreFocusRef}
        onGetStarted={() => {
          closeInfoAndNavigate('demo', 'home', 'start');
          window.setTimeout(() => {
            const target =
              document.getElementById('responsive-choice-section') ||
              document.getElementById('responsive-section-intro') ||
              document.getElementById('responsive-add-title') ||
              document.getElementById('step-add-courses-container') ||
              document.querySelector('.responsive-primary-choice');
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const choiceBtn = target?.querySelector<HTMLButtonElement>('.responsive-big-choice') || document.getElementById('start-screenshots-choice');
            if (choiceBtn) {
              window.setTimeout(() => choiceBtn.focus({ preventScroll: true }), 350);
            }
          }, 60);
        }}
      />

      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => closeInfoModal('privacy')}
        restoreFocusRef={modalRestoreFocusRef}
      />

      

            <RefundPolicyModal
        isOpen={isRefundModalOpen}
        onClose={() => closeInfoModal('refund')}
        restoreFocusRef={modalRestoreFocusRef}
      />
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => closeInfoModal('pricing')}
        restoreFocusRef={modalRestoreFocusRef}
      />
      <AboutUsModal
        isOpen={isAboutUsModalOpen}
        onClose={() => closeInfoModal('about-us')}
        restoreFocusRef={modalRestoreFocusRef}
      />
      <ContactUsModal
        isOpen={isContactUsModalOpen}
        onClose={() => closeInfoModal('contact-us')}
        restoreFocusRef={modalRestoreFocusRef}
      />
      <DeliveryShippingModal
        isOpen={isDeliveryShippingModalOpen}
        onClose={() => closeInfoModal('delivery-shipping')}
        restoreFocusRef={modalRestoreFocusRef}
      />
      </Suspense>

      <AuthModal
        isOpen={authModalView !== null}
        initialView={authModalView || 'login'}
        initialResetToken={authResetToken}
        onClose={() => { setAuthModalView(null); setAuthResetToken(''); }}
      />

      <AccountCenter
        isOpen={isAccountCenterOpen}
        onClose={() => setIsAccountCenterOpen(false)}
        onOpenUpgrade={() => { setIsAccountCenterOpen(false); setIsUpgradeModalOpen(true); }}
        onStartNewTerm={() => { setIsAccountCenterOpen(false); setSections([]); setOptimizerOutput(null); setWorkflowPanel('start'); navigateToStep('home', true); }}
        onResume={async () => { setIsAccountCenterOpen(false); if (sections.length > 0) { setWorkflowPanel('preferences'); navigateToStep('setup', true); return; } try { const { response, data } = await fetchJson('/api/courses', { credentials: 'same-origin', timeoutMs: 10000 }); const saved = Array.isArray((data as any)?.courses) ? (data as any).courses : Array.isArray((data as any)?.courseData) ? (data as any).courseData : []; if (response.ok && saved.length) { sectionsRef.current = saved; setSections(saved); invalidateResults(); setWorkflowPanel('preferences'); navigateToStep('setup', true); return; } } catch {} navigateToStep('home', true); }}
        onOpenAuth={(view) => { setIsAccountCenterOpen(false); handleOpenAuth(view); }}
        onLogout={async () => { setIsAccountCenterOpen(false); await logout(); }}
      />

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onStart={() => navigateToStep('home', true)}
      />

      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
      />

      {optimizerErrorMessage && (
        <WorkflowStatus
          kind={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'empty' : optimizerErrorMeta?.retryable ? 'error' : 'warning'}
          title={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'No schedule matched those choices.' : 'Schedule search needs attention.'}
          description={optimizerErrorMessage}
          actionLabel={optimizerErrorMeta?.retryable ? 'Retry search' : undefined}
          onAction={optimizerErrorMeta?.retryable ? handleRunOptimizer : undefined}
          secondaryActionLabel={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'Change choices' : 'Dismiss'}
          onSecondaryAction={() => { setOptimizerErrorMessage(null); setOptimizerErrorMeta(null); if (optimizerErrorMeta?.code === 'NO_RESULTS') navigateToStep('setup', true); }}
          className="responsive-optimizer-toast fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-50"
          autoFocus
          containerRef={optimizerErrorRef}
        />
      )}

      {lastWorkflowAction && currentStep === 'results' && (
        <div className="sr-only" role="status" aria-live="polite">{lastWorkflowAction}</div>
      )}

      <footer className="site-footer border-t border-line bg-paper px-5 sm:px-6 py-8 sm:py-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-10">
            <div className="max-w-xs space-y-3">
              <p className="text-lg font-bold text-ink tracking-tight">Gadwal</p>
              <p className="text-sm text-text-secondary leading-relaxed">
                No More Gaps
              </p>
              {FEEDBACK_EMAIL && (
                <div className="pt-2">
                  <a
                    href={`mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=Gadwal%20feedback`}
                    className="inline-flex items-center text-sm font-semibold text-ink hover:underline underline-offset-4 transition-colors"
                  >
                    Send feedback
                  </a>
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap gap-x-12 gap-y-8">
              <div className="space-y-4">
                <p className="text-sm font-bold text-ink uppercase tracking-wider">Product</p>
                <div className="flex flex-col space-y-3 text-sm font-medium">
                  <button type="button" onClick={(e) => openInfoModal('pricing', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Pricing</button>
                  <button type="button" onClick={(e) => openInfoModal('access-billing', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Access & billing</button>
                  <button type="button" onClick={(e) => openInfoModal('about-us', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">About Us</button>
                  <button type="button" onClick={(e) => openInfoModal('demo', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Screenshot guide</button>
                  <button type="button" onClick={(e) => openInfoModal('how-it-works', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">How it works</button>
                  <button type="button" onClick={(e) => openInfoModal('contact-us', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Contact Us</button>
                </div>
              </div>
              
              <div className="space-y-4">
                <p className="text-sm font-bold text-ink uppercase tracking-wider">Legal</p>
                <div className="flex flex-col space-y-3 text-sm font-medium">
                  <button type="button" onClick={(e) => openInfoModal('privacy', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Privacy Policy</button>
                  <button type="button" onClick={(e) => openInfoModal('delivery-shipping', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Delivery & Shipping Policy</button>
                  <button type="button" onClick={(e) => openInfoModal('refund', e.currentTarget)} className="min-h-[44px] text-left text-text-secondary hover:text-ink transition-colors w-fit inline-flex items-center">Refund & Cancellation Policy</button>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t border-line text-sm text-text-muted flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <p>© {new Date().getFullYear()} Gadwal. All rights reserved.</p>
            <p className="text-xs max-w-xl sm:text-right">
              Gadwal provides digital access to scheduling tools. Applicable policies are linked above.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
