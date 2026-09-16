import React, { useState } from 'react';
import { ModalShell } from './ModalShell';
import { fetchJson } from '../services/resilientFetch';
import { Upload, Sparkles, CalendarDays, ArrowRight, ArrowLeft } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose, onStart }) => {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    try {
      setBusy(true);
      const r = await fetchJson('/api/account/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!r.response.ok) throw new Error(r.data?.error || 'Could not save your onboarding state.');
      onClose();
      onStart();
    } catch (e) {
      console.error('Onboarding complete error', e);
      // Even if it fails, close and start
      onClose();
      onStart();
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const steps = [
    {
      title: 'Welcome to Gadwal',
      subtitle: 'The smartest way to build your schedule',
      body: 'Say goodbye to hours of trial and error. Gadwal instantly turns your available courses into beautiful, conflict-free schedules.',
      icon: <Sparkles className="w-10 h-10 text-accent" />
    },
    {
      title: 'Upload or Add Courses',
      subtitle: 'Fast & accurate extraction',
      body: 'Upload screenshots of your timetable or enter courses manually. Gadwal extracts the details automatically so you can review them before proceeding.',
      icon: <Upload className="w-10 h-10 text-accent" />
    },
    {
      title: 'Find Your Perfect Schedule',
      subtitle: 'Compare & choose with ease',
      body: 'Once your courses are ready, Gadwal checks every available combination and ranks the resulting schedules. Find your perfect week in seconds.',
      icon: <CalendarDays className="w-10 h-10 text-accent" />
    }
  ];

  const currentStep = steps[step];

  return (
    <ModalShell isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} title="Get Started" autoHeight maxWidthClass="max-w-md">
      <div className="p-6 sm:p-8 flex flex-col items-center text-center">
        
        <div className="w-20 h-20 rounded-3xl bg-accent/10 flex items-center justify-center mb-6 ring-4 ring-accent/5">
          {currentStep.icon}
        </div>
        
        <h3 className="text-2xl font-black text-ink mb-2">{currentStep.title}</h3>
        <p className="font-semibold text-accent mb-4">{currentStep.subtitle}</p>
        <p className="text-text-secondary leading-relaxed mb-8">
          {currentStep.body}
        </p>

        <div className="flex gap-2 mb-8 w-full justify-center" aria-label={`Step ${step + 1} of 3`}>
          {steps.map((_, i) => (
            <div 
              key={i} 
              className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'bg-ink w-8' : i < step ? 'bg-ink/60 w-4' : 'bg-line w-4'}`}
            />
          ))}
        </div>

        <div className="flex w-full gap-3">
          {step > 0 && (
            <button 
              disabled={busy} 
              onClick={() => setStep(s => s - 1)} 
              className="flex-shrink-0 min-h-[52px] min-w-[52px] flex items-center justify-center border-2 border-line hover:border-ink rounded-xl text-ink transition-colors disabled:opacity-50"
              aria-label="Previous step"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          
          <button 
            disabled={busy} 
            onClick={step < 2 ? () => setStep(s => s + 1) : finish} 
            className="flex-1 min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-ink hover:bg-black text-white font-bold text-lg transition-colors disabled:opacity-70"
          >
            {busy ? 'Saving...' : step < 2 ? 'Continue' : 'Get Started'}
            {!busy && step < 2 && <ArrowRight className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

