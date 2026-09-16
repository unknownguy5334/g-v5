import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface DeliveryShippingModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const DeliveryShippingModal: React.FC<DeliveryShippingModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
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
        aria-labelledby="delivery-shipping-title"
        tabIndex={-1}
        className="gd-modal-shell w-full max-w-lg md:max-w-2xl flex flex-col text-ink relative h-[min(90dvh,640px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <h2 id="delivery-shipping-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
            Delivery & Shipping Policy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close delivery policy"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 text-sm sm:text-base text-text-secondary leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Digital Service Delivery</h3>
            <p>
              Gadwal is a purely digital scheduling platform and service. We do not sell physical goods. Therefore, there are <strong>no physical products, and no physical shipping or delivery</strong> is involved when you make a purchase on our platform. 
            </p>
            <p>
              There is no physical package, shipment, courier, or delivery address required to use Gadwal.
            </p>
          </section>
          
          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Electronic Access</h3>
            <p>
              After your payment is successful and your account is verified, access to the purchased Gadwal plan is delivered electronically directly to your Gadwal account. 
            </p>
            <p>
              Your access period is determined by the specific plan you purchased (Semester or Academic Year) and the active Gadwal academic-year or semester configuration on our servers. Access is applied immediately to your verified student account, allowing you to generate schedules without delay.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-ink text-base sm:text-lg">Technical Difficulties</h3>
            <p>
              If you have completed a payment but your account has not been updated with the appropriate access, please contact our support team immediately so we can verify the transaction and manually grant your electronic access.
            </p>
          </section>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
