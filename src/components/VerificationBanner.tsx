import React, { useState } from 'react';
import { Mail, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface VerificationBannerProps {
  onOpenAuthModal?: (view?: 'login' | 'signup' | 'verify') => void;
  onOpenVerify?: () => void;
}

export const VerificationBanner: React.FC<VerificationBannerProps> = ({ onOpenAuthModal, onOpenVerify }) => {
  const { user, status, resendVerification } = useAuth();
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'unverified' || !user) {
    return null;
  }

  const handleResend = async () => {
    setResending(true);
    setMessage(null);
    setError(null);
    const res = await resendVerification();
    setResending(false);
    if (res.ok) {
      setMessage('Verification link sent! Please check your MIU inbox.');
    } else {
      setError(res.error || 'Failed to resend verification link.');
    }
  };

  return (
    <div
      id="verification-required-banner"
      className="bg-caution-soft border-b border-caution-line text-ink py-2.5 px-4 sm:px-6"
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
        <div className="flex items-start sm:items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-caution shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-ink">Student Email Verification Required: </span>
            <span className="text-text-secondary">
              A verification email was sent to <strong className="font-medium text-ink">{user.email}</strong>. Please verify your account to unlock schedule generation.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          {message ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success min-h-[44px]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {message}
            </span>
          ) : (
            <button
              type="button"
              id="banner-btn-resend"
              onClick={handleResend}
              disabled={resending}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink bg-white border border-line rounded hover:bg-mist transition disabled:opacity-50 cursor-pointer min-h-[44px]"
            >
              {resending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
              <span>{resending ? 'Sending...' : 'Resend Email'}</span>
            </button>
          )}

          {(onOpenVerify || onOpenAuthModal) && (
            <button
              type="button"
              id="banner-btn-enter-code"
              onClick={() => {
                if (onOpenVerify) onOpenVerify();
                else if (onOpenAuthModal) onOpenAuthModal('verify');
              }}
              className="px-2 py-2 text-xs font-semibold text-ink underline hover:text-ink-soft cursor-pointer ml-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              Enter Token
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="max-w-5xl mx-auto mt-1.5 text-xs text-alert font-medium pl-7">
          {error}
        </div>
      )}
    </div>
  );
};
