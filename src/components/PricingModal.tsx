import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
  const [pricing, setPricing] = useState<{ CURRENT_TERM: number | null; ACADEMIC_YEAR: number | null } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/payment/pricing').then(async r => ({ ok:r.ok, data:await r.json() })).then(({ok,data}) => {
      if (!ok || cancelled) return;
      const rows = Array.isArray(data.products) ? data.products : [];
      const byId = Object.fromEntries(rows.map((x:any) => [x.id, Number(x.amount)]));
      setPricing({ CURRENT_TERM: Number.isFinite(byId.CURRENT_TERM) ? byId.CURRENT_TERM : null, ACADEMIC_YEAR: Number.isFinite(byId.ACADEMIC_YEAR) ? byId.ACADEMIC_YEAR : null });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isOpen]);
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
        aria-labelledby="pricing-modal-title"
        tabIndex={-1}
        className="gd-modal-shell w-full max-w-lg md:max-w-3xl lg:max-w-4xl flex flex-col text-ink relative h-[min(92dvh,760px)] max-h-[92dvh] overflow-hidden rounded-2xl shadow-xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Pinned Header */}
        <div className="z-20 shrink-0 border-b border-line bg-white px-4 sm:px-6 py-3.5 sm:py-4 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <h2 id="pricing-modal-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
              Simple, transparent pricing
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="gd-modal-close"
              aria-label="Close pricing information"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <p className="text-text-secondary text-xs sm:text-sm">
            No recurring billing. Pay once for digital access to unlimited schedule generations for your selected period.
          </p>
        </div>

        {/* Scrollable Body */}
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5 sm:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            {/* Free Tier */}
            <div className="border border-line rounded-xl p-4 sm:p-5 flex flex-col bg-surface">
              <h3 className="text-base sm:text-lg font-bold text-ink mb-1">Free First Run</h3>
              <p className="text-text-secondary text-xs sm:text-sm mb-3 sm:mb-4">Try Gadwal before you pay</p>
              <div className="text-xl sm:text-2xl font-bold text-ink mb-4">1 complete run</div>
              <ul className="space-y-2 mb-2 flex-1 text-xs sm:text-sm text-text-secondary">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Upload screenshots or enter courses</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Review and correct courses</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Run the optimizer</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> See top-ranked schedules</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Export your selected schedule</li>
              </ul>
            </div>

            {/* Semester Tier */}
            <div className="border border-line rounded-xl p-4 sm:p-5 flex flex-col bg-surface">
              <h3 className="text-base sm:text-lg font-bold text-ink mb-1">Current Term</h3>
              <p className="text-text-secondary text-xs sm:text-sm mb-3 sm:mb-4">Access for the currently active Fall, Spring, or Summer term</p>
              <div className="text-xl sm:text-2xl font-bold text-ink mb-4">{pricing?.CURRENT_TERM != null && Number.isFinite(pricing.CURRENT_TERM) ? `${pricing.CURRENT_TERM} EGP` : 'Unavailable'}</div>
              <ul className="space-y-2 mb-2 flex-1 text-xs sm:text-sm text-text-secondary">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Unlimited schedule generations</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Valid for your current term</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Access to all premium features</li>
              </ul>
            </div>

            {/* Academic Year Tier */}
            <div className="border-2 border-ink rounded-xl p-4 sm:p-5 flex flex-col bg-surface relative shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base sm:text-lg font-bold text-ink">Academic Year</h3>
                <span className="inline-flex items-center gap-1 bg-ink text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                  ⭐ Best Value
                </span>
              </div>
              <p className="text-text-secondary text-xs sm:text-sm mb-3 sm:mb-4">Complete coverage for the year</p>
              <div className="text-xl sm:text-2xl font-bold text-ink mb-4">{pricing?.ACADEMIC_YEAR != null && Number.isFinite(pricing.ACADEMIC_YEAR) ? `${pricing.ACADEMIC_YEAR} EGP` : 'Unavailable'}</div>
              <ul className="space-y-2 mb-2 flex-1 text-xs sm:text-sm text-text-secondary">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Unlimited schedule generations</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Covers Fall</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Covers Spring</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" /> Covers Summer Registration</li>
              </ul>
            </div>
          </div>
          
          <div className="bg-mist p-4 rounded-xl text-xs sm:text-sm text-text-secondary leading-relaxed">
            <h4 className="font-bold text-ink mb-1.5">How it works</h4>
            <p className="mb-2">Every new verified university student receives exactly one complete free Gadwal run. This allows you to experience the full product before payment is required.</p>
            <p className="mb-2">After your free run is consumed, you can purchase the Current Term plan or the Academic Year plan to continue generating schedules. The Academic Year plan is the best value when you expect to use Gadwal across more than one term.</p>
            <p>During your active access period, you can generate as many schedules as you need. There is no pay-per-schedule fee.</p>
          </div>
          
          <div className="text-xs text-text-muted pt-3 border-t border-line">
            <p>Purchasing Gadwal provides digital access to the selected plan. For further information on digital delivery, please see our Delivery & Shipping Policy. Gadwal access is tied to your verified university email account. Logging out, changing browsers, or clearing data does not grant additional free runs.</p>
          </div>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
