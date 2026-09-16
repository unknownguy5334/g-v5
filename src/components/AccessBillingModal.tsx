import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clock3, CreditCard, ShieldCheck } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { formatDate } from '../utils/dateFormatting';

interface AccessBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const AccessBillingModal: React.FC<AccessBillingModalProps> = ({ isOpen, onClose, restoreFocusRef }) => {
  const [pricing, setPricing] = useState<{ CURRENT_TERM: number; ACADEMIC_YEAR: number } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/payment/pricing').then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (cancelled || !ok) return;
        const rows = Array.isArray(data.products) ? data.products : [];
        const byId = Object.fromEntries(rows.map((row: any) => [row.id, Number(row.amount)]));
        setPricing({
          CURRENT_TERM: Number.isFinite(byId.CURRENT_TERM) ? byId.CURRENT_TERM : NaN,
          ACADEMIC_YEAR: Number.isFinite(byId.ACADEMIC_YEAR) ? byId.ACADEMIC_YEAR : NaN,
        });
      }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isOpen]);

  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef, manageHistory: false });
  if (!isOpen) return null;
  const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;
  const content = (
    <div className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150 bg-ink/50" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="access-billing-title" tabIndex={-1} className="gd-modal-shell w-full max-w-3xl flex flex-col text-ink relative h-[min(90dvh,700px)] max-h-[90dvh] overflow-hidden rounded-2xl shadow-xl bg-white" onClick={(event) => event.stopPropagation()}>
        <div className="z-20 shrink-0 border-b border-line bg-paper px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div>
            <h2 id="access-billing-title" className="text-lg font-bold tracking-tight">Access & billing</h2>
            <p className="text-xs sm:text-sm text-text-secondary mt-0.5">Exactly what you get, what you pay, and when access ends.</p>
          </div>
          <button type="button" onClick={onClose} className="gd-modal-close" aria-label="Close Access & billing">×</button>
        </div>
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5 text-sm leading-relaxed">
          <section className="grid sm:grid-cols-2 gap-4">
            <div className="border border-line rounded-2xl p-5">
              <div className="flex items-center gap-2"><CreditCard className="w-4 h-4" /><h3 className="font-bold">Current Term</h3></div>
              <p className="mt-2 text-2xl font-black">{Number.isFinite(pricing?.CURRENT_TERM) ? `${pricing.CURRENT_TERM} EGP` : 'Unavailable'}</p>
              <p className="mt-1 text-text-secondary">One-time access for the currently active Fall, Spring, or Summer term.</p>
            </div>
            <div className="border-2 border-ink rounded-2xl p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /><h3 className="font-bold">Academic Year</h3></div>
              <p className="mt-2 text-2xl font-black">{Number.isFinite(pricing?.ACADEMIC_YEAR) ? `${pricing.ACADEMIC_YEAR} EGP` : 'Unavailable'}</p>
              <p className="mt-1 text-text-secondary">One-time access for the current academic year: Fall, Spring, and Summer.</p>
            </div>
          </section>

          <section className="border border-line rounded-2xl p-5 space-y-3">
            <h3 className="font-bold">How access works</h3>
            {[
              'Every new verified MIU student gets exactly one complete free schedule-generation run.',
              'A run is consumed only after a successful schedule result is saved. Errors, failed OCR, refreshes, and failed generation do not consume it.',
              'After the free run, paid access is determined by active server-side entitlements, not browser state.',
              'Academic Year access takes priority over a Current Term entitlement when both apply to the current period.',
              'When access expires, your saved Gadwal data remains available according to the account retention policy; access itself does not silently renew.',
            ].map((item) => <p key={item} className="flex gap-2 text-text-secondary"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-success" />{item}</p>)}
          </section>

          <section className="border border-line rounded-2xl p-5 space-y-3">
            <h3 className="font-bold flex items-center gap-2"><Clock3 className="w-4 h-4" /> Payments and verification</h3>
            <p className="text-text-secondary">Manual payments are reviewed before access is activated. Your payment record keeps the purchased product, price, and version that applied when you submitted it.</p>
            <p className="text-text-secondary">Submitting the same payment twice does not create duplicate active access. Pending and rejected submissions remain visible in your account history.</p>
            <p className="text-text-secondary">When a payment is rejected, Gadwal shows the review reason so you know what needs to be corrected.</p>
          </section>

          <section className="border border-line rounded-2xl p-5 space-y-3">
            <h3 className="font-bold">Upgrading</h3>
            <p className="text-text-secondary">If you already have an active Current Term entitlement for the current period and the Academic Year plan is available, Gadwal calculates the upgrade amount from the historical amount you actually paid for that entitlement.</p>
            <p className="text-text-secondary">You cannot buy duplicate active access for the same scope.</p>
          </section>

          <section className="border border-line rounded-2xl p-5 space-y-2 text-text-secondary">
            <p><strong className="text-ink">Access expiry:</strong> <span>Gadwal uses the current academic context and displays your remaining access time in your account.</span></p>
            <p><strong className="text-ink">No recurring billing:</strong> plans are one-time access purchases.</p>
            <p><strong className="text-ink">No pay-per-schedule charge:</strong> active paid access allows repeated schedule generation during the covered period.</p>
            <p><strong className="text-ink">Final university authority:</strong> Gadwal only uses the course/section information available to it; your university portal remains the final source of truth.</p>
          </section>
        </div>
      </div>
    </div>
  );
  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
