import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, ArrowLeft, CheckCircle2, Layers, Maximize2 } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { COPY } from '../content/copy';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

interface StepItem {
  id: number;
  title: string;
  shortTitle: string;
}

const STEPS: StepItem[] = [
  {
    id: 1,
    title: COPY.demo.step1Title,
    shortTitle: 'Advising',
  },
  {
    id: 2,
    title: COPY.demo.step2Title,
    shortTitle: 'Clear schedule',
  },
  {
    id: 3,
    title: COPY.demo.step3Title,
    shortTitle: 'Open course',
  },
  {
    id: 4,
    title: COPY.demo.step4Title,
    shortTitle: 'Take screenshot',
  },
  {
    id: 5,
    title: COPY.demo.step5Title,
    shortTitle: 'Repeat options',
  },
];

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, onClose, onGetStarted, restoreFocusRef }) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
  const [isExamplesOpen, setIsExamplesOpen] = useState(false);
  const guideBodyRef = useRef<HTMLDivElement | null>(null);
  const guideFooterRef = useRef<HTMLDivElement | null>(null);
  const [guideFooterHeight, setGuideFooterHeight] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const handleTimelineKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isExamplesOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsExamplesOpen(false);
          return;
        }
        if (zoomedImage) {
          event.preventDefault();
          setZoomedImage(null);
          return;
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      const activeDialog = target?.closest('[role=\"dialog\"]');
      if (!activeDialog || activeDialog.getAttribute('aria-labelledby') !== 'demo-modal-title') return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); goToPrev(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); goToNext(); }
    };
    window.addEventListener('keydown', handleTimelineKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleTimelineKeyDown, { capture: true });
  }, [isOpen, isExamplesOpen, zoomedImage]);

  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef , manageHistory: false });

  // Reset step and popup on reopen
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setZoomedImage(null);
      setIsExamplesOpen(false);
    }
  }, [isOpen]);

  // Keep the scrollable guide content clear of the fixed/persistent action bar and
  // track its real height so short and tall viewports both have a safe scroll end.
  useEffect(() => {
    if (!isOpen || !guideFooterRef.current) return;
    const footer = guideFooterRef.current;
    const updateFooterHeight = () => {
      // In flex layout, the footer is a sibling in normal flow, so body does not need
      // duplicate footer-height clearance which causes artificial scrollbars.
      setGuideFooterHeight(0);
    };
    updateFooterHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFooterHeight);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [isOpen]);

  // Every explicit step change starts at the beginning of the destination step.
  useEffect(() => {
    if (!isOpen) return;
    guideBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentStep, isOpen]);

  const handleAction = useCallback(() => {
    if (onGetStarted) { onGetStarted(); return; }
    onClose();
    const target =
      document.getElementById('responsive-choice-section') ||
      document.getElementById('responsive-section-intro') ||
      document.getElementById('responsive-add-title') ||
      document.getElementById('step-add-courses-container') ||
      document.querySelector('.responsive-primary-choice');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [onClose, onGetStarted]);

  const goToPrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    if (currentStep < 5) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleAction();
    }
  }, [currentStep, handleAction]);

  const openImage = useCallback((src: string, alt: string) => setZoomedImage({ src, alt }), []);
  const closeImage = useCallback(() => setZoomedImage(null), []);

  const renderGuideImage = useCallback((src: string, alt: string, className: string, enableZoom = true) => {
    if (!enableZoom) {
      return (
        <div className="flex flex-col items-center justify-center w-full">
          <img src={src} alt={alt} className={className} loading="lazy" />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center w-full">
        <button
          type="button"
          className="gd-guide-image-button group relative w-full min-h-[44px] flex flex-col items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-zoom-in"
          onClick={() => openImage(src, alt)}
          aria-label={`${alt}. Open larger preview`}
        >
          <img src={src} alt={alt} className={className} loading="lazy" />
          <span className="gd-guide-image-hint group-hover:text-ink transition-colors">
            <Maximize2 className="w-3.5 h-3.5 text-ink shrink-0" />
            <span>Tap to enlarge</span>
          </span>
        </button>
      </div>
    );
  }, [openImage]);

  if (!isOpen) return null;

  const currentStepData = STEPS[currentStep - 1] || STEPS[0];

  const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;

  const content = (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        aria-describedby="demo-modal-subtitle demo-steps-keyboard-help"
        tabIndex={-1}
        className="demo-guide-modal gd-modal-shell gd-modal-sheet sm:rounded-2xl w-full max-w-[96vw] sm:max-w-5xl md:max-w-6xl flex flex-col text-ink relative h-[min(92dvh,660px)] max-h-[92dvh] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border border-line bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER - PINNED POSITION */}
        <div className="gd-modal-header z-20 shrink-0 border-b border-line px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="min-w-0">
              <h2 id="demo-modal-title" className="text-base sm:text-lg font-black tracking-tight text-ink font-sans truncate">
                {COPY.demo.title}
              </h2>
              <span id="demo-modal-subtitle" className="sr-only">{COPY.demo.howTitle}</span>
              <span id="demo-steps-keyboard-help" className="sr-only">Use Left and Right Arrow keys to move between steps. Step 1 is the first step and Step 5 is the last step.</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Close button */}
            <button
              type="button"
              id="demo-modal-close"
              onClick={onClose}
              aria-label="Close screenshot guide"
              className="gd-modal-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MAIN BODY AREA: ONLY ONE STEP DISPLAYED AT A TIME */}
        <div id={`demo-step-panel-${currentStep}`} role="region" aria-label={`Step ${currentStep} of 5`} tabIndex={-1} ref={guideBodyRef} className="gd-modal-body gd-modal-guide-timeline flex-1 min-h-0 overflow-y-auto px-3.5 py-4 sm:px-6 sm:py-5 relative text-ink focus:outline-none">
          {/* STEP CONTENT CONTAINER - min-h-full flex-col for smooth vertical centering when fitting and natural scrolling without clipping */}
          <div className="gd-demo-step-content max-w-5xl mx-auto w-full min-h-full flex flex-col justify-center py-2">
            <div className="sr-only" aria-live="polite">Step {currentStep} of 5: {currentStepData.shortTitle}. {currentStep === 1 ? 'This is the first step.' : currentStep === 5 ? 'This is the last step.' : ''}</div>
            {/* STEP 1: OPEN ADVISING */}
            {currentStep === 1 && (
              <div id="demo-step-1" className="flex flex-col md:grid md:grid-cols-12 md:gap-6 md:items-center space-y-3.5 md:space-y-0 my-auto">
                <div className="md:col-span-5 space-y-2 flex flex-col justify-center my-auto">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed pt-0.5">
                    Open your <strong className="font-bold text-ink">student portal</strong>, then select <strong className="font-bold text-ink">Advising</strong>.
                  </p>
                </div>

                <div className="md:col-span-7 flex justify-center items-center w-full my-auto">
                  <div className="gd-guide-image-card w-full max-w-full sm:max-w-[420px] p-4 sm:p-6 bg-paper rounded-xl sm:rounded-2xl border border-line flex flex-col items-center justify-center">
                    {renderGuideImage(
                      '/demo/step1-advising-icon.svg',
                      'Illustration of the student portal Advising entry point',
                      'gd-guide-image gd-guide-image-step1 w-full max-w-[260px] sm:max-w-[340px] max-h-[190px] sm:max-h-[250px]',
                      false
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: CLEAR YOUR SCHEDULE */}
            {currentStep === 2 && (
              <div id="demo-step-2" className="flex flex-col md:grid md:grid-cols-12 md:gap-6 md:items-center space-y-3.5 md:space-y-0 my-auto">
                <div className="md:col-span-5 space-y-2 flex flex-col justify-center my-auto">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed pt-0.5">
                    <strong className="font-bold text-ink">Remove all courses</strong> from your schedule so your portal shows all available times.
                  </p>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                    {COPY.demo.step2Note}
                  </p>
                </div>

                <div className="md:col-span-7 w-full my-auto">
                  <div className="gd-guide-image-card w-full rounded-xl sm:rounded-2xl overflow-hidden border border-line bg-paper p-2.5 sm:p-3">
                    {renderGuideImage(
                      '/demo/step2-registered-courses.svg',
                      'Schedule screenshot showing courses to drop',
                      'gd-guide-image w-full h-auto max-h-[200px] sm:max-h-[270px] md:max-h-[320px]'
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: OPEN EACH COURSE */}
            {currentStep === 3 && (
              <div id="demo-step-3" className="flex flex-col md:grid md:grid-cols-12 md:gap-6 md:items-center space-y-3.5 md:space-y-0 my-auto">
                <div className="md:col-span-5 space-y-2.5">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {COPY.demo.step3Body1}
                  </p>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {COPY.demo.step3Body2}
                  </p>

                  <div className="p-2.5 sm:p-3 rounded-lg bg-mist/70 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-text-secondary">
                    <p className="text-xs sm:text-sm text-text-secondary font-medium leading-snug">
                      <span className="font-bold text-ink">Tip: </span>{COPY.demo.step3Rule}
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsExamplesOpen(true)}
                      className="inline-flex items-center justify-center px-2.5 py-1 rounded-md bg-white border border-line hover:border-line-strong text-ink font-semibold text-xs shrink-0 transition cursor-pointer shadow-2xs hover:bg-mist"
                    >
                      See examples
                    </button>
                  </div>
                </div>

                <div className="md:col-span-7 w-full">
                  <div className="gd-guide-image-card w-full rounded-xl sm:rounded-2xl overflow-hidden border border-line bg-paper p-2.5 sm:p-3">
                    {renderGuideImage(
                      '/demo/step4-course-options.svg',
                      'Course categories showing available options FIN201',
                      'gd-guide-image w-full h-auto max-h-[200px] sm:max-h-[270px] md:max-h-[320px]'
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: TAKE A SCREENSHOT */}
            {currentStep === 4 && (
              <div id="demo-step-4" className="flex flex-col md:grid md:grid-cols-12 md:gap-6 md:items-center space-y-3.5 md:space-y-0 my-auto">
                <div className="md:col-span-5 space-y-2">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {COPY.demo.step4Body}
                  </p>
                </div>

                <div className="md:col-span-7 w-full space-y-2.5 pt-1">
                  {/* Positioned cleanly above the picture with clear top margin and full visibility */}
                  <div className="p-2.5 sm:p-3 rounded-lg sm:rounded-xl bg-paper border border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 shadow-2xs">
                    <p className="text-xs font-extrabold text-ink uppercase tracking-wide shrink-0">
                      {COPY.demo.step4ChecklistTitle || 'Make sure it shows:'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span>Course name</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span>Course code</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span>Days</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span>Times</span>
                      </div>
                    </div>
                  </div>

                  <div className="gd-guide-image-card w-full rounded-xl sm:rounded-2xl overflow-hidden border border-line bg-paper p-2.5 sm:p-3">
                    {renderGuideImage(
                      '/demo/step5-single-option-nutrition.svg',
                      'Single course option showing course name, code, days, and times',
                      'gd-guide-image w-full h-auto max-h-[190px] sm:max-h-[250px] md:max-h-[300px]'
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: REPEAT FOR EVERY COURSE */}
            {currentStep === 5 && (
              <div id="demo-step-5" className="flex flex-col md:grid md:grid-cols-12 md:gap-6 md:items-center space-y-3.5 md:space-y-0 my-auto">
                <div className="md:col-span-5 space-y-2">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {COPY.demo.step5Body1}
                  </p>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {COPY.demo.step5Body2}
                  </p>
                </div>

                <div className="gd-demo-auto-grid md:col-span-7 w-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                  <div className="gd-guide-image-card rounded-xl overflow-hidden border border-line bg-paper p-2 sm:p-2.5 space-y-1">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-text-secondary">FIN201 - New07</span>
                      <span className="text-xs font-mono font-bold text-ink">Screenshot 1</span>
                    </div>
                    {renderGuideImage(
                      '/demo/step6-fin-new07.svg',
                      'Financial Management FIN201 - New07 option screenshot',
                      'gd-guide-image w-full h-auto max-h-[160px] sm:max-h-[210px] md:max-h-[250px]'
                    )}
                  </div>

                  <div className="gd-guide-image-card rounded-xl overflow-hidden border border-line bg-paper p-2 sm:p-2.5 space-y-1">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-text-secondary">FIN201 - New09</span>
                      <span className="text-xs font-mono font-bold text-ink">Screenshot 2</span>
                    </div>
                    {renderGuideImage(
                      '/demo/step6-fin-new09.svg',
                      'Financial Management FIN201 - New09 option screenshot',
                      'gd-guide-image w-full h-auto max-h-[160px] sm:max-h-[210px] md:max-h-[250px]'
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM NAVIGATION BAR - PINNED POSITION */}
        <div ref={guideFooterRef} className="gd-modal-footer gd-modal-guide-footer flex items-center justify-between gap-3 sm:gap-4 z-20 px-4 sm:px-6 py-3">
          {/* Previous Button */}
          <button
            type="button"
            id="demo-modal-prev"
            onClick={goToPrev}
            disabled={currentStep === 1}
            className={`min-h-[44px] px-4 sm:px-5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 transition cursor-pointer ${
              currentStep === 1
                ? 'opacity-40 text-text-muted cursor-not-allowed border border-transparent'
                : 'text-ink hover:bg-mist border border-line active:scale-98'
            }`}
            aria-label="Previous step"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          {/* Center Progress Indicator */}
          <div className="gd-demo-step-progress text-center">
            <span className="text-xs font-mono font-bold text-text-secondary tracking-wide whitespace-nowrap" aria-label={`Step ${currentStep} of 5`}>
              {currentStep} / 5
            </span>
          </div>

          {/* Next or Done Button */}
          {currentStep < 5 ? (
            <button
              type="button"
              id="demo-modal-next"
              onClick={goToNext}
              className="min-h-[44px] px-5 sm:px-6 rounded-xl bg-ink hover:bg-ink-soft text-white font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
              aria-label="Next step"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              id="demo-modal-btn-action"
              onClick={handleAction}
              className="min-h-[44px] px-5 sm:px-7 rounded-xl bg-ink hover:bg-ink-soft text-white font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
              aria-label="Start adding courses"
            >
              <span>Start adding courses</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {zoomedImage && (
          <div className="gd-guide-lightbox" role="dialog" aria-modal="true" aria-label="Expanded guide screenshot" onClick={closeImage}>
            <div className="gd-guide-lightbox-panel" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="gd-guide-lightbox-close gd-modal-close" onClick={closeImage} aria-label="Close enlarged screenshot preview">
                <X className="w-5 h-5" />
              </button>
              <img src={zoomedImage.src} alt={zoomedImage.alt} className="gd-guide-lightbox-image" />
            </div>
          </div>
        )}

        {/* SEE EXAMPLES POPUP MODAL */}
        {isExamplesOpen && (
          <div
            className="gd-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150 bg-black/60 "
            onClick={() => setIsExamplesOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="examples-modal-title"
              className="gd-modal-shell max-w-lg w-full bg-white rounded-2xl border border-line shadow-2xl overflow-hidden flex flex-col text-ink max-h-[90vh] sm:max-h-[85vh] motion-safe:animate-in motion-safe:zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-white border-b border-line p-4 sm:p-5 flex items-center justify-between shrink-0">
                <h3 id="examples-modal-title" className="text-base sm:text-lg font-black text-ink tracking-tight">
                  Only choose courses you’re willing to take
                </h3>
                <button
                  type="button"
                  onClick={() => setIsExamplesOpen(false)}
                  aria-label="Close examples"
                  className="min-h-[44px] min-w-[44px] rounded-lg hover:bg-mist text-text-secondary hover:text-ink flex items-center justify-center transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs sm:text-sm leading-relaxed text-ink">
                {/* Intro paragraph */}
                <div className="space-y-2">
                  <p className="font-bold text-ink">
                    Select <strong>only the courses you are willing to take this semester</strong>.
                  </p>
                  <p className="text-text-secondary">
                    When choosing what to screenshot, <strong>only include courses you are willing to take</strong>. Do not screenshot courses you already know you do not want or need.
                  </p>
                  <p className="text-text-secondary">
                    Gadwal will <strong>only consider the courses you select</strong> when building your possible schedules. If you don't select a course, <strong>Gadwal will not include it in your possible schedules</strong>.
                  </p>
                </div>

                {/* Examples list */}
                <div className="pt-4 border-t border-line space-y-2">
                  <h4 className="font-extrabold text-xs uppercase tracking-wider text-ink">
                    For example:
                  </h4>
                  <ul className="list-disc pl-5 space-y-2 text-ink text-xs sm:text-sm">
                    <li>
                      If you need or plan to take <strong>Math 201</strong>, include it in your screenshots and select it.
                    </li>
                    <li>
                      If <strong>Math 201</strong> is available but you do not want to take it this semester, <strong>do not include it in your screenshots and do not select it</strong>.
                    </li>
                    <li>
                      If you have 3 elective options but only want to take 1, <strong>only include and select the elective you want</strong>.
                    </li>
                  </ul>
                </div>

                {/* One important thing to remember */}
                <div className="pt-4 border-t border-line space-y-1.5">
                  <h4 className="font-extrabold text-xs uppercase tracking-wider text-ink">
                    One important thing to remember
                  </h4>
                  <p className="text-xs sm:text-sm text-text-secondary">
                    <strong>Selecting a course does not guarantee that it will appear in your final schedule.</strong> It only tells Gadwal that <strong>you are willing to take it</strong>.
                  </p>
                </div>

                {/* Simple rule */}
                <div className="pt-4 border-t border-line space-y-2">
                  <h4 className="font-extrabold text-xs uppercase tracking-wider text-ink">
                    Simple rule
                  </h4>
                  <p className="text-xs sm:text-sm font-semibold text-ink">
                    If you would not be happy seeing a course in your final schedule, don't include it in your screenshots and don't select it.
                  </p>
                  <div className="space-y-1 pt-1 text-xs font-bold text-ink">
                    <div><strong>Selected</strong> = Gadwal may include it.</div>
                    <div><strong>Not selected</strong> = Gadwal will not include it.</div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-3.5 sm:p-4 bg-paper border-t border-line flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setIsExamplesOpen(false)}
                  className="w-full sm:w-auto min-h-[40px] px-6 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft transition cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Got it, close examples
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
