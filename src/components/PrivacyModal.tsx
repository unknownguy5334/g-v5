import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
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
        aria-labelledby="privacy-modal-title"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-sheet w-full max-w-lg md:max-w-2xl flex flex-col text-ink relative h-[min(90dvh,640px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <h2 id="privacy-modal-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
            Privacy Policy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close privacy information"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 text-sm sm:text-base text-text-secondary leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Information We Process</h3>
            <p>To provide our scheduling service, Gadwal may process the following information:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account Information:</strong> Including your verified university email address and verification status.</li>
              <li><strong>Course Data:</strong> Course information you manually enter or that is extracted from your uploads.</li>
              <li><strong>Uploaded Screenshots:</strong> Images of your schedule that you upload for our OCR processing.</li>
              <li><strong>Saved Data:</strong> Saved course sets and schedules where our platform stores them.</li>
              <li><strong>Device & Session Info:</strong> Technical information used for account security, enforcing access, and preventing account sharing or abuse.</li>
              <li><strong>Payment References:</strong> Transaction identifiers and payment status to activate your account access.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">How We Use Your Information</h3>
            <p>
              The information we process is used exclusively to operate Gadwal. This includes providing the core scheduling and OCR functionality, verifying student accounts, processing payments, maintaining your access across sessions, providing technical support, and protecting the platform against abuse.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Screenshot Uploads & Course Data</h3>
            <p>
              When you upload screenshots, they are processed to extract course scheduling details. Uploaded screenshots are used solely to provide this OCR and scheduling functionality. They are not permanently retained unless we introduce a specific feature that requires retaining them to improve your experience.
            </p>
            <div className="bg-mist border border-line p-3.5 sm:p-4 rounded-xl text-ink font-medium text-xs sm:text-sm">
              Important: Please ensure you do not upload unnecessary sensitive personal information into course screenshots. Crop your images to only show the relevant schedule details when possible.
            </div>
          </section>
          
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Account & Security</h3>
            <p>
              Gadwal access is tied to your student account. Where our verification system is enabled, a verified <strong>university email</strong> should be used. Every student receives only one free full run. Our backend systems record when an account has consumed its free run, meaning that logging out, clearing your browser storage, changing browsers, or switching devices will not reset or grant another free run.
            </p>
            <p>
              We employ reasonable session and device monitoring to enforce access limits, verify payment status server-side, and implement anti-abuse measures, though no system can completely prevent all forms of account sharing.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Payments</h3>
            <p>
              When you purchase a Gadwal plan, payments are processed securely by our third-party payment provider. Gadwal does not directly collect, process, or store your full payment-card details.
            </p>
          </section>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
