import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface RefundPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const RefundPolicyModal: React.FC<RefundPolicyModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
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
        aria-labelledby="refund-modal-title"
        tabIndex={-1}
        className="gd-modal-shell w-full max-w-lg md:max-w-2xl flex flex-col text-ink relative h-[min(90dvh,640px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <h2 id="refund-modal-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
            Refund & Cancellation Policy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close refund policy"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 text-sm sm:text-base text-text-secondary leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Digital Access</h3>
            <p>
              Gadwal provides digital access to scheduling tools. Because our service is purely digital and access is granted immediately upon payment verification, <strong>refunds are generally not available after access has been granted or the service has been used</strong>.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Payment vs. Access Activation</h3>
            <p>
              When you purchase a Gadwal plan (Semester or Academic Year), a payment is processed. Following a successful payment, your account is verified, and digital access is activated for your verified university email address. 
            </p>
            <p>
              Once this access is activated on your account, the transaction is considered complete, and the service is deemed delivered. We do not offer automatic refunds for unused access periods or simply changing your mind.
            </p>
          </section>
          
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Technical Access Issues</h3>
            <p>
              While standard refunds are not available, we understand that technical issues can occasionally arise. If a severe technical-access problem occurs where Gadwal cannot reasonably provide the purchased service to your account, we may review these situations on a case-by-case basis.
            </p>
            <p>
              If you believe you have experienced a technical failure that prevented you from receiving the digital access you paid for, please contact our support team. We will investigate the issue and attempt to resolve it. Gadwal makes no promise or guarantee of an automatic refund.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Cancellations</h3>
            <p>
              Gadwal operates on a one-time payment model for a specific access period (Semester or Academic Year). We do not use recurring subscriptions. Therefore, there is no subscription to cancel, and you will not be automatically billed again when your current plan expires.
            </p>
          </section>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
