import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface AboutUsModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const AboutUsModal: React.FC<AboutUsModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef, manageHistory: false });
  if (!isOpen) return null;

  const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;

  const content = (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-us-title"
        tabIndex={-1}
        className="gd-modal-shell w-full max-w-lg md:max-w-2xl flex flex-col text-ink relative h-[min(90dvh,640px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <h2 id="about-us-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
            About Gadwal
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close about us"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 text-sm sm:text-base text-text-secondary leading-relaxed">
          <p>
            Gadwal was created with a simple mission: to make university course registration easier and less stressful for university students.
          </p>
          <p>
            Every semester, students face the frustrating process of manually testing endless combinations of courses, sections, and timeslots just to find a schedule that works. We built Gadwal to remove that frustration.
          </p>
          <p>
            Our platform allows you to quickly turn your course information either by uploading screenshots or manually entering them into a complete set of ranked schedule options. By checking the course and section options you provide, Gadwal finds valid schedule combinations in seconds. 
          </p>
          <p>
            With Gadwal, you can make your registration decisions faster, focus on what matters, and approach the registration period with confidence.
          </p>
          
          <div className="mt-6 pt-4 border-t border-line text-xs sm:text-sm text-text-muted">
            <p>Gadwal is an independent scheduling platform and is not officially affiliated with university.</p>
          </div>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
