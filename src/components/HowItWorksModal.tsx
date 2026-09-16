import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { COPY } from '../content/copy';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({
  isOpen,
  onClose,
  onGetStarted,
  restoreFocusRef,
}) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef, manageHistory: false });
  const [currentStep, setCurrentStep] = useState(0);
  const cardContainerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Touch swipe coordinates for mobile
  const touchStartCoords = useRef<{ x: number; y: number } | null>(null);

  const totalSteps = 9;

  // Check scroll position to display "more below" affordance
  const checkScroll = () => {
    if (!cardContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = cardContainerRef.current;
    const hasMore = scrollHeight - (scrollTop + clientHeight) > 12;
    setCanScrollDown(hasMore);
  };

  // Reset to first card whenever opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  // Scroll to top of card body whenever step changes and update scroll affordance
  useEffect(() => {
    if (cardContainerRef.current) {
      cardContainerRef.current.scrollTop = 0;
      // Recheck scroll after render
      const timer = setTimeout(checkScroll, 50);
      return () => clearTimeout(timer);
    }
  }, [currentStep, isOpen]);

  if (!isOpen) return null;

  const handleAction = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    onClose();
    const target =
      document.getElementById('responsive-choice-section') ||
      document.getElementById('responsive-section-intro') ||
      document.getElementById('responsive-add-title') ||
      document.getElementById('step-add-courses-container') ||
      document.querySelector('.responsive-primary-choice');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartCoords.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartCoords.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStartCoords.current.x;
    const deltaY = touch.clientY - touchStartCoords.current.y;
    touchStartCoords.current = null;

    // Must be predominantly horizontal and at least 45px distance
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < 0) {
        // Swiped Left -> Next
        setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1));
      } else {
        // Swiped Right -> Previous
        setCurrentStep((prev) => Math.max(0, prev - 1));
      }
    }
  };

  const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;

  const renderCardContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                You choose the courses
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Each course can have one or more <strong className="text-ink font-bold">course options</strong> with different days and times.
            </p>

            <div className="rounded-xl border border-line bg-paper p-3.5 space-y-3 font-sans text-xs sm:text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2.5 border-b border-line/60">
                <div>
                  <span className="font-bold text-ink">Financial Accounting</span>
                  <span className="text-text-secondary text-xs ml-2">1 option</span>
                </div>
                <span className="self-start sm:self-auto px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">
                  ACT20101
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2.5 border-b border-line/60">
                <div>
                  <span className="font-bold text-ink">Macroeconomics</span>
                  <span className="text-text-secondary text-xs ml-2">2 options</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">ECN33104</span>
                  <span className="px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">ECN33106</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <div>
                  <span className="font-bold text-ink">Corporate Finance</span>
                  <span className="text-text-secondary text-xs ml-2">3 options</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">FIN32101</span>
                  <span className="px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">FIN32102</span>
                  <span className="px-2 py-0.5 rounded bg-mist font-mono font-bold text-ink text-xs">FIN32103</span>
                </div>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                That creates a lot of combinations
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              When courses have multiple options, there can be <strong className="text-ink font-bold">hundreds or even thousands of possible combinations</strong>.
            </p>

            <div className="rounded-xl border border-line bg-paper p-3.5 space-y-2 text-xs sm:text-sm">
              <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">For example:</p>
              <div className="font-mono text-xs font-semibold text-text-secondary space-y-1.5">
                <p>ACT20101 + ECN33104 + FIN32101</p>
                <p>ACT20101 + ECN33104 + FIN32102</p>
                <p>ACT20101 + ECN33106 + FIN32101</p>
                <p>ACT20101 + ECN33106 + FIN32102</p>
              </div>
              <div className="pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-text-secondary text-xs sm:text-sm">...and many more.</span>
                <span className="px-2 py-0.5 rounded bg-mist border border-line text-ink font-bold text-[11px]">
                  Hundreds of possibilities
                </span>
              </div>
            </div>

            <div className="pt-1 text-xs sm:text-sm">
              <p className="text-text-secondary leading-relaxed">
                You could try to compare them yourself... <strong className="text-ink font-bold">Or let Gadwal do it for you.</strong>
              </p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                Gadwal searches the combinations
              </h3>
            </div>

            <div className="space-y-1 text-xs sm:text-sm">
              <p className="font-bold text-ink">You choose:</p>
              <ul className="space-y-1 list-disc pl-4 text-text-secondary font-medium">
                <li><strong className="text-ink font-bold">The number of courses you need</strong></li>
                <li><strong className="text-ink font-bold">The credits you need</strong></li>
                <li><strong className="text-ink font-bold">Any courses you must take</strong></li>
              </ul>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Gadwal compares the available course options and finds <strong className="text-ink font-bold">valid schedules with no conflicts</strong>.
            </p>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Gadwal groups valid schedules by the number of class days and shows up to three options in each group.
            </p>

            <div className="rounded-xl border border-line bg-paper p-3 space-y-2 text-xs sm:text-sm">
              <div className="flex items-center gap-2 text-ink font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-ink shrink-0" />
                <span>No conflicts</span>
              </div>
              <div className="flex items-center gap-2 text-ink font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-ink shrink-0" />
                <span>Multiple valid schedules to compare</span>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                You choose the schedule you like best
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              For example, Gadwal might show you:
            </p>

            <div className="space-y-2 text-xs sm:text-sm">
              <div className="rounded-xl border border-line bg-paper p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <strong className="text-ink font-bold">Schedule 1</strong>
                <span className="text-text-secondary whitespace-normal break-words">4 days · 3 courses · No conflicts</span>
              </div>
              <div className="rounded-xl border border-line bg-paper p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <strong className="text-ink font-bold">Schedule 2</strong>
                <span className="text-text-secondary whitespace-normal break-words">5 days · 3 courses · No conflicts</span>
              </div>
              <div className="rounded-xl border border-line bg-paper p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <strong className="text-ink font-bold">Schedule 3</strong>
                <span className="text-text-secondary">6 days · 3 courses · No conflicts</span>
              </div>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line text-center">
              <span className="text-text-secondary text-xs sm:text-sm font-semibold">
                Grouped by number of class days
              </span>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                What the options allow
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Gadwal only works with the course options your university provides.
            </p>

            <div className="p-3.5 rounded-xl border border-line bg-paper space-y-2 text-xs sm:text-sm">
              <p className="text-ink font-bold text-xs sm:text-sm">
                Gadwal cannot:
              </p>
              <ul className="space-y-1.5 list-disc pl-4 text-text-secondary font-medium">
                <li>Create new class times</li>
                <li>Move classes to different days or times</li>
                <li>Add courses your university doesn't offer</li>
              </ul>
            </div>

            <p className="text-ink font-bold text-xs sm:text-sm leading-relaxed pt-1">
              Gadwal uses the options that already exist to find the best valid schedules.
            </p>
          </div>
        );

      case 5:
        return (
          <div className="space-y-3.5">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                Here's what Gadwal can do
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Choosing options manually can leave you with long gaps between courses.
            </p>

            <div className="space-y-2.5">
              {/* Schedule 1 */}
              <div className="rounded-xl border border-line bg-paper p-3 space-y-2 text-xs sm:text-sm">
                <div className="flex items-center justify-between">
                  <strong className="text-ink font-bold">A schedule chosen manually</strong>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs text-text-secondary font-medium">
                  <div><strong>Monday:</strong> 2h 00m gap</div>
                  <div><strong>Tuesday:</strong> 3h 00m gap</div>
                  <div><strong>Wednesday:</strong> 1h 00m gap</div>
                  <div><strong>Thursday:</strong> 5h 00m gap</div>
                </div>
                <div className="pt-2 border-t border-line/60 font-bold text-ink text-xs">
                  Total: 11h 00m of gaps
                </div>
              </div>

              <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
                Gadwal compares all valid combinations and ranks them so you can see schedules with less waiting first.
              </p>

              {/* Schedule 2 */}
              <div className="rounded-xl border border-line bg-paper p-3 space-y-2 text-xs sm:text-sm">
                <div className="flex items-center justify-between">
                  <strong className="font-bold text-ink">Another valid combination found by Gadwal</strong>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs text-text-secondary font-medium">
                  <div><strong>Monday:</strong> 1h 00m gap</div>
                  <div><strong>Tuesday:</strong> 1h 00m gap</div>
                  <div><strong>Wednesday:</strong> 1h 00m gap</div>
                  <div><strong>Thursday:</strong> 2h 00m gap</div>
                </div>
                <div className="pt-2 border-t border-line/60 font-bold text-ink text-xs">
                  Total: 5h 00m of gaps
                </div>
              </div>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              In this example, comparing valid combinations helped go from <strong className="text-ink font-bold">11h 00m of gaps to 5h 00m of gaps</strong>.
            </p>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              <strong className="text-ink font-bold">That improvement only happens when a better valid combination actually exists in the course options your university provides.</strong>
            </p>
          </div>
        );

      case 6:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                Your screenshots matter
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              Gadwal can only use the information you provide.
            </p>

            <div className="p-3 rounded-xl bg-paper border border-line font-bold text-ink text-xs sm:text-sm">
              If a course option isn't in your screenshots, Gadwal can't consider it.
            </div>

            <div className="space-y-1.5">
              <p className="font-bold text-ink text-xs sm:text-sm">Make sure your screenshots are:</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-xl bg-paper border border-line font-bold text-xs text-ink uppercase">Clear</div>
                <div className="p-2 rounded-xl bg-paper border border-line font-bold text-xs text-ink uppercase">Complete</div>
                <div className="p-2 rounded-xl bg-paper border border-line font-bold text-xs text-ink uppercase">Up to date</div>
              </div>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm leading-relaxed">
              If your university changes a course option, day, or time, <strong className="text-ink font-bold">update your screenshots</strong>.
            </p>
          </div>
        );

      case 7:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                One last thing
              </h3>
            </div>

            <p className="text-text-secondary text-xs sm:text-sm font-medium leading-relaxed">
              <strong className="text-ink font-bold">Gadwal doesn’t register you or make changes in your university portal.</strong>
            </p>

            <div className="p-3 rounded-xl bg-paper border border-line text-xs sm:text-sm font-bold text-ink text-center">
              Uses your course options → Finds valid schedules → Compares them for you.
            </div>

            <div className="space-y-1 text-xs sm:text-sm">
              <p className="font-bold text-ink">
                Your university portal is the final source of truth.
              </p>
              <p className="font-black text-ink text-sm sm:text-base pt-1">
                You make the final decision.
              </p>
            </div>
          </div>
        );

      case 8:
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-black text-ink">
                The bottom line
              </h3>
            </div>

            <div className="p-4 rounded-xl border border-line bg-paper space-y-2">
              <p className="font-bold text-ink text-sm sm:text-base leading-relaxed">
                We'll show you what's actually possible from the course options you provide.
              </p>
              <p className="font-bold text-text-secondary text-sm sm:text-base leading-relaxed">
                We won't invent a better schedule just to make the result look better.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

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
        aria-labelledby="how-it-works-title"
        tabIndex={-1}
        className="how-it-works-modal gd-modal-shell gd-modal-sheet sm:rounded-2xl w-full max-w-lg md:max-w-xl flex flex-col text-ink relative h-[min(92dvh,620px)] max-h-[92dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER - PINNED POSITION */}
        <div className="gd-modal-header z-20 shrink-0 border-b border-line bg-paper/95  px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="how-it-works-title" className="text-base sm:text-lg font-black tracking-tight text-ink font-sans truncate">
              {COPY.how.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close how Gadwal works information"
            className="gd-modal-close shrink-0 p-1.5 rounded-lg hover:bg-mist text-text-secondary hover:text-ink transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* ACTIVE FLASHCARD AREA WITH TOUCH SWIPE AND SCROLL INDICATOR */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={cardContainerRef}
            onScroll={checkScroll}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 text-ink leading-relaxed select-text"
            data-modal-scroll
          >
            {renderCardContent()}
          </div>

          {/* VISIBLE SCROLL CUE / GRADIENT FADE AFFORDANCE AT BOTTOM EDGE */}
          <div
            className={`pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white via-white/80 to-transparent transition-opacity duration-200 z-10 flex items-end justify-center pb-1 ${
              canScrollDown ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          >
            <span className="text-[11px] font-bold text-text-secondary bg-white/95 px-2.5 py-0.5 rounded-full border border-line shadow-2xs">
              Scroll for more ↓
            </span>
          </div>
        </div>

        {/* STEPPER PAGINATION FOOTER - PINNED POSITION */}
        <div className="gd-modal-footer z-20 shrink-0 border-t border-line bg-paper/95  px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
            disabled={currentStep === 0}
            className={`min-h-[44px] px-4 sm:px-5 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 transition cursor-pointer ${
              currentStep === 0
                ? 'opacity-40 text-text-muted cursor-not-allowed border border-transparent'
                : 'text-ink hover:bg-mist border border-line active:scale-98'
            }`}
            aria-label="Previous step"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          {/* Center Progress Indicator */}
          <div className="text-center">
            <span className="text-xs font-mono font-bold text-text-secondary tracking-wide whitespace-nowrap" aria-label={`Slide ${currentStep + 1} of ${totalSteps}`}>
              {currentStep + 1} / {totalSteps}
            </span>
          </div>

          {currentStep < totalSteps - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1))}
              className="min-h-[44px] px-5 sm:px-6 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft active:scale-98 transition cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
              aria-label="Next step"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAction}
              className="min-h-[44px] px-5 sm:px-7 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft active:scale-98 transition cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
              aria-label="Start adding courses"
            >
              <span>Start adding courses</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
