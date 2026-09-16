import React from 'react';
import { ModalShell } from './ModalShell';
import { GoogleSignInButton } from './GoogleSignInButton';

export type AuthModalView = 'login' | 'signup' | 'verify' | 'forgot';

interface AuthModalProps {
  isOpen: boolean;
  initialView?: AuthModalView;
  initialResetToken?: string;
  onClose: () => void;
  onSuccess?: () => void;
  onViewChange?: (view: AuthModalView) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  if (!isOpen) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Student Login"
    >
      <div className="p-6 sm:p-8 flex flex-col items-center text-center">
        <h3 className="text-xl font-black text-ink mb-2">Welcome to Gadwal</h3>
        <p className="text-sm text-text-secondary mb-8">
          Sign in securely using your MIU student Google account to save and generate your course schedules.
        </p>

        <div className="w-full max-w-sm">
          <GoogleSignInButton
            onSuccess={() => {
              onSuccess?.();
              onClose();
            }}
            text="Continue with MIU Google Account"
          />
        </div>

        <p className="text-xs text-text-muted mt-6 max-w-xs leading-relaxed">
          By signing in, you agree to our Terms of Service and Privacy Policy.
          You must use an official Misr International University email address.
        </p>
      </div>
    </ModalShell>
  );
};
