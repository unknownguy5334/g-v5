import React from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, Phone, MapPin } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface ContactUsModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const ContactUsModal: React.FC<ContactUsModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
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
        aria-labelledby="contact-us-title"
        tabIndex={-1}
        className="gd-modal-shell w-full max-w-lg md:max-w-2xl flex flex-col text-ink relative h-[min(90dvh,640px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-3">
          <h2 id="contact-us-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
            Contact Us
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close contact information"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
          <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
            Need help with your account, have a question about Gadwal, or experiencing a technical issue? Our support team is ready to assist you.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 mt-4 sm:mt-6">
            <div className="border border-line rounded-xl p-4 sm:p-5 bg-surface">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-mist flex items-center justify-center mb-3">
                <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-ink" aria-hidden="true" />
              </div>
              <h3 className="font-bold text-ink text-sm sm:text-base mb-1">Email Support</h3>
              <p className="text-xs sm:text-sm text-text-secondary mb-2.5">For general inquiries and technical assistance.</p>
              {import.meta.env.VITE_SUPPORT_EMAIL ? (
                <a href={`mailto:${import.meta.env.VITE_SUPPORT_EMAIL}`} className="text-xs sm:text-sm font-semibold text-ink hover:underline">
                  {import.meta.env.VITE_SUPPORT_EMAIL}
                </a>
              ) : (
                <span className="text-xs sm:text-sm text-text-muted">Support email is not configured yet.</span>
              )}
            </div>

            <div className="border border-line rounded-xl p-4 sm:p-5 bg-surface">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-mist flex items-center justify-center mb-3">
                <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-ink" aria-hidden="true" />
              </div>
              <h3 className="font-bold text-ink text-sm sm:text-base mb-1">Phone Support</h3>
              <p className="text-xs sm:text-sm text-text-secondary mb-2.5">Available during regular business hours.</p>
              {import.meta.env.VITE_SUPPORT_PHONE ? (
                <a href={`tel:${import.meta.env.VITE_SUPPORT_PHONE}`} className="text-xs sm:text-sm font-semibold text-ink hover:underline">
                  {import.meta.env.VITE_SUPPORT_PHONE}
                </a>
              ) : (
                <span className="text-xs sm:text-sm text-text-muted">Support phone is not configured yet.</span>
              )}
            </div>
            
            <div className="border border-line rounded-xl p-4 sm:p-5 bg-surface sm:col-span-2">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-mist flex items-center justify-center mb-3">
                <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-ink" aria-hidden="true" />
              </div>
              <h3 className="font-bold text-ink text-sm sm:text-base mb-1">Location</h3>
              <p className="text-xs sm:text-sm text-text-secondary">
                {import.meta.env.VITE_BUSINESS_LOCATION || 'Cairo, Egypt'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
