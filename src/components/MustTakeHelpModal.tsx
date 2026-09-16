import React, { useEffect, useRef } from 'react';
import { GadwalModal } from './GadwalModal';

interface MustTakeHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MustTakeHelpModal: React.FC<MustTakeHelpModalProps> = ({
  isOpen,
  onClose,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && contentRef.current) {
      const parent = contentRef.current.closest('.gd-modal-body');
      if (parent) parent.scrollTop = 0;
    }
  }, [isOpen]);

  return (
    <GadwalModal
      isOpen={isOpen}
      onClose={onClose}
      title="How 'Required' and 'Optional' work"
      description="Choose which courses are required vs. optional."
      className="gd-must-take-modal"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] bg-ink text-white font-bold text-sm rounded-xl hover:bg-ink-soft transition cursor-pointer shadow-xs"
        >
          Got it
        </button>
      }
    >
      <div ref={contentRef} className="space-y-3 text-ink">
        {/* Side-by-side comparison on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* REQUIRED CARD */}
          <div className="rounded-xl border border-line bg-paper p-3.5 flex flex-col justify-between space-y-2.5 shadow-2xs">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2.5 py-0.5 rounded-full bg-ink text-white font-bold text-xs">
                  Required
                </span>
                <span className="font-bold text-ink text-sm">Must Take</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                You <strong>definitely need</strong> this course. Gadwal locks it into <strong>every single schedule</strong> it generates.
              </p>
            </div>
            <div className="pt-2 border-t border-line/60 flex items-center gap-1.5 text-[11px] font-semibold text-ink">
              <span className="w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>
              <span>Always in your schedule</span>
            </div>
          </div>

          {/* OPTIONAL CARD */}
          <div className="rounded-xl border border-line bg-paper p-3.5 flex flex-col justify-between space-y-2.5 shadow-2xs">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2.5 py-0.5 rounded-full bg-mist text-text-secondary border border-line font-bold text-xs">
                  Optional
                </span>
                <span className="font-bold text-ink text-sm">Flexible</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                You are <strong>open to taking</strong> it. Gadwal tests combinations of these to reach your target credits or courses.
              </p>
            </div>
            <div className="pt-2 border-t border-line/60 flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0"></span>
              <span>Not removed, used if it fits</span>
            </div>
          </div>
        </div>

        {/* Quick Example Card */}
        <div className="rounded-xl bg-mist/50 border border-line p-3 text-xs space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink text-xs">Quick Example</span>
          </div>
          <p className="text-xs text-ink">
            Target: <strong className="font-bold">5 courses total</strong>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-secondary leading-normal">
            <div className="bg-white border border-line/70 rounded-lg p-2.5">
              <span className="text-ink font-bold block mb-0.5 text-[11px]">1. Your choice:</span>
              <span>2 courses marked <strong>Required</strong>, 4 courses left as <strong>Optional</strong>.</span>
            </div>
            <div className="bg-white border border-line/70 rounded-lg p-2.5">
              <span className="text-ink font-bold block mb-0.5 text-[11px]">2. Gadwal's result:</span>
              <span>Keeps the 2 required courses, then picks the 3 best optional courses to reach 5 courses with zero conflicts.</span>
            </div>
          </div>
        </div>
      </div>
    </GadwalModal>
  );
};
