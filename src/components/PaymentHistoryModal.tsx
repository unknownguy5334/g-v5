import React, { useEffect, useState } from 'react';
import { ModalShell } from './ModalShell';
import { fetchJson } from '../services/resilientFetch';
import { formatDateTime } from '../utils/dateFormatting';

interface PaymentHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentHistoryModal({ isOpen, onClose }: PaymentHistoryModalProps) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchJson('/api/payment/submissions', { credentials: 'same-origin' })
        .then(({ response: res, data }) => {
          if (data.ok) {
            setSubmissions(data.submissions || []);
            setEntitlements(data.entitlements || []);
          } else {
            setError(data.error || 'Failed to load history');
          }
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);


  const cancelSubmission = async (id: string) => {
    if (!window.confirm('Cancel this pending payment submission? No access will be granted from it.')) return;
    setCancelling(id);
    try {
      const { response: res, data } = await fetchJson(`/api/payment/submissions/${id}/cancel`, { method: 'POST', credentials: 'same-origin', timeoutMs: 8_000 });
      if (!res.ok) throw new Error(data.error || 'Failed to cancel payment.');
      setSubmissions(prev => prev.map(s => s.id === id ? data.submission : s));
    } catch (e: any) {
      setError(e.message || 'Failed to cancel payment.');
    } finally {
      setCancelling(null);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Payment & Access History">
      <div className="space-y-6">
        {loading ? (
          <div className="py-8 text-center text-gray-500 flex items-center justify-center gap-2" role="status" aria-live="polite"><span className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" aria-hidden="true" /><span>Loading your payment history…</span></div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl" role="alert">{error}</div>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Active Access</h3>
              {entitlements.length === 0 ? (
                <div className="p-4 bg-gray-50 text-gray-500 rounded-xl border border-gray-100 italic">
                  No active entitlements found.
                </div>
              ) : (
                <div className="space-y-3">
                  {entitlements.map(ent => (
                    <div key={ent.id} className="p-4 bg-green-50 border border-green-200 rounded-xl">
                      <div className="font-bold text-green-900">{ent.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'}</div>
                      <div className="text-sm text-green-800 mt-1">
                        Academic Year: {ent.academicYear} {ent.plan === 'CURRENT_TERM' ? `| Term: ${ent.term}` : ''}
                      </div>
                      <div className="text-xs text-green-700 mt-2 font-medium">Status: {ent.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Payment Submissions</h3>
              {submissions.length === 0 ? (
                <div className="p-4 bg-gray-50 text-gray-500 rounded-xl border border-gray-100 italic">
                  No payment submissions found.
                </div>
              ) : (
                <div className="space-y-3">
                  {submissions.map(sub => (
                    <div key={sub.id} className="p-4 border border-gray-200 rounded-xl">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-gray-900">{sub.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'}</div>
                        <div className={`text-xs font-bold px-2 py-1 rounded-full ${
                          sub.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                          sub.status === 'REJECTED' || sub.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {sub.status === 'PENDING' ? 'PENDING VERIFICATION' : sub.status}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        {sub.amount} EGP via {
                          sub.paymentMethod === 'MANUAL_INSTAPAY' ? 'InstaPay' :
                          sub.paymentMethod === 'MANUAL_TELDA' ? 'Telda' :
                          sub.paymentMethod === 'MANUAL_VODAFONE_CASH' ? 'Vodafone Cash' : sub.paymentMethod
                        }
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{formatDateTime(sub.createdAt)}</div>
                      
                      {sub.status === 'APPROVED' && (
                        <div className="mt-3 text-sm text-green-600 bg-green-50 p-2 rounded">
                          Payment approved: your Gadwal access is active.
                        </div>
                      )}
                      {sub.status === 'PENDING' && (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm text-yellow-700 bg-yellow-50 p-2 rounded">
                            Payment submitted: we're reviewing your payment.
                          </div>
                          <button type="button" onClick={() => cancelSubmission(sub.id)} disabled={cancelling === sub.id} className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline disabled:opacity-50 min-h-[44px] inline-flex items-center">
                            {cancelling === sub.id ? 'Cancelling…' : 'Cancel pending submission'}
                          </button>
                        </div>
                      )}
                      {sub.status === 'REJECTED' && (
                        <div className="mt-3 text-sm text-red-600 bg-red-50 p-2 rounded">
                          Payment could not be verified. {sub.rejectionReason && `Reason: ${sub.rejectionReason}`}
                        </div>
                      )}
                      {sub.status === 'CANCELLED' && (
                        <div className="mt-3 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                          This payment submission was cancelled. No access was granted from it.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
