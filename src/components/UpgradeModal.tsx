import React, { useState, useEffect } from 'react';
import { ModalShell } from './ModalShell';
import { fetchJson } from '../services/resilientFetch';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UpgradeModal({ isOpen, onClose }: UpgradeModalProps) {
  const [step, setStep] = useState<'plan' | 'method' | 'instructions' | 'form' | 'success'>('plan');
  const [selectedPlan, setSelectedPlan] = useState<'CURRENT_TERM' | 'ACADEMIC_YEAR' | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [methods, setMethods] = useState<any[]>([]);
  const [pricing, setPricing] = useState<{ CURRENT_TERM: number; ACADEMIC_YEAR: number } | null>(null);
  const [academicYearPayableAmount, setAcademicYearPayableAmount] = useState<number | null>(null);
  const [upgradeAvailable, setUpgradeAvailable] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<Record<string, boolean>>({ CURRENT_TERM: false, ACADEMIC_YEAR: false });

  // Form state
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [teldaUsername, setTeldaUsername] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionRequestId, setSubmissionRequestId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setStep('plan');
      setSelectedPlan(null);
      setSelectedMethod(null);
      setFullName('');
      setPhoneNumber('');
      setTeldaUsername('');
      setProofFile(null);
      setError(null);
      setSubmissionRequestId(crypto.randomUUID());
      fetchMethods();
    }
  }, [isOpen]);

  const fetchMethods = async () => {
    try {
      setError(null);
      const [methodsResult, pricingResult] = await Promise.all([
        fetchJson('/api/payment/methods'),
        fetchJson('/api/payment/pricing-for-user')
      ]);
      const methodsRes = methodsResult.response;
      const pricingRes = pricingResult.response;
      const methodsData = methodsResult.data as any;
      const pricingData = pricingResult.data as any;
      setAcademicYearPayableAmount(Number.isFinite(Number(pricingData.academicYearPayableAmount)) ? Number(pricingData.academicYearPayableAmount) : null);
      setUpgradeAvailable(Boolean(pricingData.access?.upgradeAvailable));
      if (!methodsRes.ok || !pricingRes.ok) throw new Error('Payment options could not be loaded. Please try again.');
      if (methodsData.ok) setMethods(methodsData.methods.filter((m: any) => m.enabled === 1 && typeof m.destination === 'string' && m.destination.trim()));
      if (pricingData.ok) {
        const productRows = Array.isArray(pricingData.products) ? pricingData.products : [];
        const byId = Object.fromEntries(productRows.map((p: any) => [p.id, Number(p.amount)]));
        setPricing({
          CURRENT_TERM: Number.isFinite(byId.CURRENT_TERM) ? byId.CURRENT_TERM : 89,
          ACADEMIC_YEAR: Number.isFinite(byId.ACADEMIC_YEAR) ? byId.ACADEMIC_YEAR : 199,
        });
        setAvailablePlans({
          CURRENT_TERM: productRows.some((p: any) => p.id === 'CURRENT_TERM' && Number(p.enabled) === 1),
          ACADEMIC_YEAR: productRows.some((p: any) => p.id === 'ACADEMIC_YEAR' && Number(p.enabled) === 1),
        });
      }
    } catch (e) {
      setMethods([]);
      setAvailablePlans({ CURRENT_TERM: false, ACADEMIC_YEAR: false });
      setError(e instanceof Error ? e.message : 'Payment options could not be loaded. Please try again.');
    }
  };

  const handlePlanSelect = (plan: 'CURRENT_TERM' | 'ACADEMIC_YEAR') => {
    setSelectedPlan(plan);
    setStep('method');
  };

  const handleMethodSelect = (methodId: string) => {
    setSelectedMethod(methodId);
    setStep('instructions');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setProofFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proofFile) {
      setError('Payment screenshot is required.');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append('plan', selectedPlan!);
    formData.append('paymentMethod', selectedMethod!);
    formData.append('fullName', fullName);
    formData.append('phoneNumber', phoneNumber);
    if (selectedMethod === 'MANUAL_TELDA') {
      formData.append('teldaUsername', teldaUsername);
    }
    formData.append('proof', proofFile);

    try {
      const { response: res, data } = await fetchJson('/api/payment/submit', {
        method: 'POST',
        headers: submissionRequestId ? { 'X-Idempotency-Key': submissionRequestId } : undefined,
        body: formData,
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit payment.');
      }
      setStep('success');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getMethodName = (id: string) => {
    if (id === 'MANUAL_INSTAPAY') return 'InstaPay';
    if (id === 'MANUAL_TELDA') return 'Telda';
    if (id === 'MANUAL_VODAFONE_CASH') return 'Vodafone Cash';
    return id;
  };

  const selectedMethodConfig = methods.find(m => m.id === selectedMethod);

  if (!isOpen) return null;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Unlock Gadwal Access">
      {step === 'plan' && (
        <div className="space-y-6">
          <p className="text-gray-600 mb-6">{upgradeAvailable ? 'You already have Current Term access. Upgrade once to cover the rest of the academic year.' : 'Choose the access period you want to unlock.'}</p>
          {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm" role="alert">{error}</div>}
          <div className="grid gap-4">
            {availablePlans.CURRENT_TERM && !upgradeAvailable && (<button 
              onClick={() => handlePlanSelect('CURRENT_TERM')}
              className="min-h-[44px] p-6 border-2 border-gray-200 rounded-xl hover:border-[#F26522] hover:bg-[#F26522]/5 transition-colors text-left flex justify-between items-center"
            >
              <div>
                <h3 className="font-bold text-lg text-gray-900">Current Term</h3>
                <p className="text-gray-500 text-sm mt-1">Access for the currently active academic term (Fall, Spring, or Summer).</p>
              </div>
              <div className="text-2xl font-black text-[#F26522]" aria-label={`${pricing?.CURRENT_TERM ?? '-'} Egyptian pounds`}>{pricing?.CURRENT_TERM ?? '-'} EGP</div>
            </button>)}
            {availablePlans.ACADEMIC_YEAR && (<button 
              onClick={() => handlePlanSelect('ACADEMIC_YEAR')}
              className="min-h-[44px] p-6 border-2 border-[#F26522] rounded-xl bg-[#F26522]/5 hover:bg-[#F26522]/10 transition-colors text-left flex justify-between items-center relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 bg-[#F26522] text-white text-xs font-bold px-3 py-1 rounded-bl-lg">BEST VALUE</div>
              <div>
                <h3 className="font-bold text-lg text-gray-900">Academic Year</h3>
                <p className="text-gray-500 text-sm mt-1">Use Gadwal throughout the current academic year, including its remaining terms and Summer.</p>
              </div>
              <div className="text-2xl font-black text-[#F26522]" aria-label={`${upgradeAvailable ? (academicYearPayableAmount ?? pricing?.ACADEMIC_YEAR ?? '-') : (pricing?.ACADEMIC_YEAR ?? '-')} Egyptian pounds`}>{upgradeAvailable ? `${academicYearPayableAmount ?? pricing?.ACADEMIC_YEAR ?? '-'} EGP` : `${pricing?.ACADEMIC_YEAR ?? '-'} EGP`}</div>
            </button>)}
            {!availablePlans.CURRENT_TERM && !availablePlans.ACADEMIC_YEAR && (
              <p className="text-gray-500 italic p-4 border border-gray-200 rounded-xl">Paid plans are temporarily unavailable. Please try again later.</p>
            )}
          </div>
        </div>
      )}

      {step === 'method' && (
        <div className="space-y-6">
          <button onClick={() => setStep('plan')} className="min-h-[44px] inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">&larr; Back to plans</button>
          <h3 className="text-lg font-bold text-gray-900">Choose how you'd like to pay</h3>
          <div className="grid gap-4">
            {methods.length === 0 ? (
              <p className="text-gray-500 italic">No payment methods are currently available. Please contact support.</p>
            ) : (
              methods.map(method => (
                <button
                  key={method.id}
                  onClick={() => handleMethodSelect(method.id)}
                  className="min-h-[44px] p-4 border border-gray-200 rounded-xl hover:border-[#F26522] hover:bg-gray-50 transition-colors font-medium text-gray-900 flex items-center gap-3"
                >
                  {getMethodName(method.id)}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {step === 'instructions' && (
        <div className="space-y-6">
          <button onClick={() => setStep('method')} className="min-h-[44px] inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">&larr; Back to methods</button>
          <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Payment Instructions: {getMethodName(selectedMethod!)}</h3>
            <p className="text-gray-600 mb-4">
              Please transfer exactly <strong>{selectedPlan === 'CURRENT_TERM' ? (pricing?.CURRENT_TERM ?? '-') : (upgradeAvailable ? (academicYearPayableAmount ?? pricing?.ACADEMIC_YEAR ?? '-') : (pricing?.ACADEMIC_YEAR ?? '-'))} EGP</strong> to the following destination:
            </p>
            <div className="text-xl font-mono bg-white p-4 rounded border border-gray-200 text-center select-all mb-4">
              {selectedMethodConfig?.destination || 'N/A'}
            </div>
            {selectedMethodConfig?.instructions && (
              <p className="text-gray-600 text-sm bg-blue-50 text-blue-800 p-4 rounded-lg">{selectedMethodConfig.instructions}</p>
            )}
          </div>
          <button
            onClick={() => setStep('form')}
            className="w-full min-h-[44px] h-12 bg-gray-900 hover:bg-black text-white font-medium rounded-xl transition-colors"
          >
            I have paid
          </button>
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <button type="button" onClick={() => setStep('instructions')} className="min-h-[44px] inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">&larr; Back to instructions</button>
          <h3 className="text-lg font-bold text-gray-900">Confirm Payment</h3>
          {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm">{error}</div>}
          
          <div className="space-y-4">
            <div>
              <label htmlFor="payment-full-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input id="payment-full-name" type="text" required value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#F26522] focus:border-transparent outline-none" />
            </div>
            <div>
              <label htmlFor="payment-phone-number" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input id="payment-phone-number" type="tel" required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#F26522] focus:border-transparent outline-none" />
            </div>
            {selectedMethod === 'MANUAL_TELDA' && (
              <div>
                <label htmlFor="payment-telda-username" className="block text-sm font-medium text-gray-700 mb-1">Telda Username</label>
                <input id="payment-telda-username" type="text" required value={teldaUsername} onChange={e => setTeldaUsername(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#F26522] focus:border-transparent outline-none" />
              </div>
            )}
            <div>
              <label htmlFor="payment-proof" className="block text-sm font-medium text-gray-700 mb-1">Payment Screenshot (Proof)</label>
              <input id="payment-proof" type="file" accept="image/*" required onChange={handleFileChange} className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[44px] h-12 bg-[#F26522] hover:bg-[#E05A1C] text-white font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Payment'}
          </button>
        </form>
      )}

      {step === 'success' && (
        <div className="text-center space-y-6 py-8">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Payment Submitted</h3>
            <p className="text-gray-600">Your payment is being reviewed. Status: <strong>Pending Verification</strong></p>
          </div>
          <button
            onClick={onClose}
            className="w-full min-h-[44px] h-12 bg-gray-900 hover:bg-black text-white font-medium rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
}
