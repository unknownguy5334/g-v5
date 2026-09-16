import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  KeyRound,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isMiuStudentEmail, MIU_STUDENT_EMAIL_DOMAIN } from '../types/auth';
import { ModalShell } from './ModalShell';

export type AuthModalView = 'login' | 'signup' | 'verify' | 'forgot';

interface AuthModalProps {
  isOpen: boolean;
  initialView?: AuthModalView;
  initialResetToken?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialView = 'login',
  initialResetToken = '',
  onClose,
  onSuccess,
}) => {
  const {
    user,
    login,
    signUp,
    resendVerification,
    verifyEmail,
    forgotPassword,
    resetPassword,
    refreshSession,
  } = useAuth();

  const [view, setView] = useState<AuthModalView>(initialView);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  // UI status states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailWarning, setEmailWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setView(initialView);
      setError(null);
      setSuccessMessage(null);
      setEmailWarning(null);
      setPassword('');
      setConfirmPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetToken(initialResetToken);
      if (user?.email) {
        setEmail(user.email);
      }
    }
  }, [isOpen, initialView, initialResetToken, user]);

  if (!isOpen) return null;

  // Real-time email validation for sign up
  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (view === 'signup') {
      const trimmed = val.trim().toLowerCase();
      if (trimmed.length > 0 && trimmed.includes('@') && !trimmed.endsWith(MIU_STUDENT_EMAIL_DOMAIN)) {
        setEmailWarning(`Only official MIU student email addresses ending with ${MIU_STUDENT_EMAIL_DOMAIN} are accepted.`);
      } else {
        setEmailWarning(null);
      }
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Please enter your MIU student email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    const res = await login({ email: trimmedEmail, password });
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage('Welcome back! Successfully logged in.');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 500);
    } else {
      setError(res.error || 'Login failed. Please check your email and password.');
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your MIU student email address.');
      return;
    }

    if (!isMiuStudentEmail(trimmed)) {
      setError(`Account creation is restricted to MIU students. Email must end with ${MIU_STUDENT_EMAIL_DOMAIN}.`);
      return;
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both passwords match identically.');
      return;
    }

    setIsSubmitting(true);
    const res = await signUp({ email: trimmed, password, name: name.trim() });
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage(res.message || 'Account created successfully! A verification code has been sent to your MIU email.');
      setView('verify');
    } else {
      setError(res.error || 'Failed to create account. Please try again.');
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!verificationToken.trim()) {
      setError('Please enter your verification token or code.');
      return;
    }

    setIsSubmitting(true);
    const res = await verifyEmail(verificationToken.trim(), email.trim());
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage('Your MIU student email has been verified successfully!');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
    } else {
      setError(res.error || 'Invalid or expired verification token.');
    }
  };

  const handleCheckVerificationStatus = async () => {
    setError(null);
    setSuccessMessage(null);
    setIsCheckingStatus(true);
    try {
      await refreshSession();
      if (user?.emailVerified) {
        setSuccessMessage('Email verification confirmed!');
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 800);
      } else {
        setError('Email is not verified yet. Please click the link in your email or enter the verification code.');
      }
    } catch {
      setError('Could not verify status. Please try again.');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    const res = await resendVerification(email.trim());
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage('A fresh verification email has been sent to your MIU inbox.');
    } else {
      setError(res.error || 'Failed to resend verification email.');
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your MIU student email.');
      return;
    }

    setIsSubmitting(true);
    const res = await forgotPassword(trimmed);
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage(res.message || 'If an account exists, password recovery instructions have been sent to your email.');
    } else {
      setError(res.error || 'Failed to process password reset request.');
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!resetToken.trim()) {
      setError('Please enter the reset token from your email.');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match. Please verify.');
      return;
    }

    setIsSubmitting(true);
    const res = await resetPassword(resetToken.trim(), newPassword);
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessMessage('Password reset successfully! You can now sign in.');
      setPassword('');
      setTimeout(() => setView('login'), 1200);
    } else {
      setError(res.error || 'Failed to reset password. Please check your reset token.');
    }
  };

  let title = 'Student Login';
  let description = 'Sign in to save and generate your course schedules.';
  if (view === 'signup') {
    title = 'Create Student Account';
    description = 'Exclusively for Misr International University students.';
  } else if (view === 'verify') {
    title = 'Verify MIU Email';
    description = 'Verify your student account to activate schedule generation.';
  } else if (view === 'forgot') {
    title = 'Reset Password';
    description = 'Enter your student email to receive recovery instructions.';
  }

  const passwordsMatch = Boolean(password && confirmPassword && password === confirmPassword);
  const passwordsMismatch = Boolean(confirmPassword && password !== confirmPassword);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      maxWidthClass="max-w-md"
    >
      <div className="p-5 sm:p-6 space-y-4">
        {/* Feedback alerts */}
        {error && (
          <div
            id="auth-error-banner"
            role="alert"
            className="p-3 bg-alert-soft border border-alert-line rounded-lg flex items-start gap-2.5 text-xs text-alert-strong motion-safe:animate-in motion-safe:fade-in"
          >
            <AlertCircle className="w-4 h-4 text-alert shrink-0 mt-0.5" />
            <span className="font-medium leading-relaxed">{error}</span>
          </div>
        )}

        {successMessage && (
          <div
            id="auth-success-banner"
            role="status"
            className="p-3 bg-success-soft border border-success-line rounded-lg flex items-start gap-2.5 text-xs text-success-strong motion-safe:animate-in motion-safe:fade-in"
          >
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <span className="font-medium leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* View: LOGIN */}
        {view === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="login-input-email"
                className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
              >
                MIU Student Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  id="login-input-email"
                  name="email"
                  autoComplete="username"
                  required
                  placeholder="student.id@miuegypt.edu.eg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-white transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-input-password"
                  className="block text-xs font-semibold text-ink uppercase tracking-wider"
                >
                  Password
                </label>
                <button
                  type="button"
                  id="login-btn-forgot"
                  onClick={() => {
                    setError(null);
                    setSuccessMessage(null);
                    setView('forgot');
                  }}
                  className="text-xs font-medium text-ink hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login-input-password"
                  name="password"
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-white transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-ink cursor-pointer p-1 rounded"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="login-btn-submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 mt-2 bg-accent hover:bg-accent-strong text-white font-semibold text-sm rounded-lg transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-2 text-center text-xs text-text-secondary border-t border-line">
              Don't have a Gadwal account yet?{' '}
              <button
                type="button"
                id="login-btn-switch-signup"
                onClick={() => {
                  setError(null);
                  setSuccessMessage(null);
                  setView('signup');
                }}
                className="font-bold text-ink underline hover:text-ink-soft cursor-pointer min-h-[44px] inline-flex items-center justify-center"
              >
                Create student account
              </button>
            </div>
          </form>
        )}

        {/* View: SIGN UP */}
        {view === 'signup' && (
          <form onSubmit={handleSignUpSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="signup-input-name"
                className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
              >
                Full Name <span className="text-text-muted font-normal lowercase">(optional)</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  id="signup-input-name"
                  name="name"
                  autoComplete="name"
                  placeholder="e.g. Mostafa Ahmed"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-white transition"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-input-email"
                className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
              >
                MIU Student Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  id="signup-input-email"
                  name="email"
                  autoComplete="username"
                  required
                  placeholder="student.id@miuegypt.edu.eg"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  className={`w-full pl-10 pr-3.5 py-2.5 text-sm bg-paper border rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:bg-white transition ${
                    emailWarning ? 'border-caution' : 'border-line focus:border-accent'
                  }`}
                />
              </div>
              {emailWarning && (
                <p className="mt-1.5 text-xs text-caution font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {emailWarning}
                </p>
              )}
              <p className="mt-1 text-[11px] text-text-muted">
                Must end with{' '}
                <code className="bg-mist px-1 py-0.5 rounded text-ink font-mono font-medium">
                  {MIU_STUDENT_EMAIL_DOMAIN}
                </code>
              </p>
            </div>

            <div>
              <label
                htmlFor="signup-input-password"
                className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="signup-input-password"
                  name="new-password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-white transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-ink cursor-pointer p-1 rounded"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="signup-input-confirm-password"
                className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
              >
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="signup-input-confirm-password"
                  name="confirm-password"
                  autoComplete="new-password"
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full pl-10 pr-10 py-2.5 text-sm bg-paper border rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:bg-white transition ${
                    passwordsMismatch
                      ? 'border-alert focus:border-alert'
                      : passwordsMatch
                      ? 'border-success focus:border-success'
                      : 'border-line focus:border-accent'
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {passwordsMatch && (
                    <span title="Passwords match" className="inline-flex">
                      <Check className="w-4 h-4 text-success" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="text-text-secondary hover:text-ink cursor-pointer p-1 rounded"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {passwordsMismatch && (
                <p className="mt-1 text-xs text-alert font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Passwords do not match
                </p>
              )}
            </div>

            <button
              type="submit"
              id="signup-btn-submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 mt-2 bg-accent hover:bg-accent-strong text-white font-semibold text-sm rounded-lg transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-2 text-center text-xs text-text-secondary border-t border-line">
              Already have an account?{' '}
              <button
                type="button"
                id="signup-btn-switch-login"
                onClick={() => {
                  setError(null);
                  setSuccessMessage(null);
                  setView('login');
                }}
                className="font-bold text-ink underline hover:text-ink-soft cursor-pointer min-h-[44px] inline-flex items-center justify-center"
              >
                Sign In
              </button>
            </div>
          </form>
        )}

        {/* View: VERIFY EMAIL */}
        {view === 'verify' && (
          <div className="space-y-4">
            <div className="p-3.5 bg-mist/60 border border-line rounded-lg text-xs text-text-secondary leading-relaxed">
              We sent a verification link and code to{' '}
              <strong className="text-ink font-semibold">{email || user?.email || 'your MIU student email'}</strong>.
              <br />
              Click the link in your email, or paste the verification code below.
            </div>

            <div className="space-y-2">
              <button
                type="button"
                id="verify-btn-check-status"
                onClick={handleCheckVerificationStatus}
                disabled={isCheckingStatus}
                className="w-full py-2 px-3 bg-paper hover:bg-mist border border-line rounded-lg text-xs font-semibold text-ink transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {isCheckingStatus ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Checking email verification...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    <span>I clicked the link in my email (Refresh)</span>
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleVerifySubmit} className="space-y-3 pt-2 border-t border-line" noValidate>
              <div>
                <label
                  htmlFor="verify-input-token"
                  className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
                >
                  Verification Code or Token
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    id="verify-input-token"
                    name="token"
                    required
                    placeholder="Paste code or token from email"
                    value={verificationToken}
                    onChange={(e) => setVerificationToken(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted font-mono focus:outline-none focus:border-accent focus:bg-white transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                id="verify-btn-submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-accent hover:bg-accent-strong text-white font-semibold text-sm rounded-lg transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>Verify Code</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between pt-2 border-t border-line text-xs">
              <button
                type="button"
                id="verify-btn-resend"
                onClick={handleResend}
                disabled={isSubmitting}
                className="font-semibold text-ink underline hover:text-ink-soft cursor-pointer flex items-center gap-1.5"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Resend email</span>
              </button>

              <button
                type="button"
                onClick={() => setView('login')}
                className="text-text-secondary hover:text-ink cursor-pointer font-medium"
              >
                Back to Sign In
              </button>
            </div>
          </div>
        )}

        {/* View: FORGOT PASSWORD */}
        {view === 'forgot' && (
          <div className="space-y-4">
            <form onSubmit={handleForgotPasswordSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="forgot-input-email"
                  className="block text-xs font-semibold text-ink uppercase tracking-wider mb-1.5"
                >
                  MIU Student Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-text-secondary absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    id="forgot-input-email"
                    name="email"
                    required
                    placeholder="student.id@miuegypt.edu.eg"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-paper border border-line rounded-lg text-ink placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-white transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                id="forgot-btn-submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-accent hover:bg-accent-strong text-white font-semibold text-sm rounded-lg transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Sending Instructions...</span>
                  </>
                ) : (
                  <span>Send Recovery Instructions</span>
                )}
              </button>
            </form>

            <div className="p-3.5 bg-paper border border-line rounded-lg space-y-3 mt-2">
              <span className="block text-xs font-bold text-ink">Already received a reset token?</span>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Paste reset token here"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-line rounded-lg font-mono text-ink"
                />
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="New password (min 8 chars)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 pr-8 py-2 text-xs bg-white border border-line rounded-lg text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-ink cursor-pointer p-0.5"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showConfirmNewPassword ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3 pr-8 py-2 text-xs bg-white border border-line rounded-lg text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-ink cursor-pointer p-0.5"
                  >
                    {showConfirmNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <button
                type="button"
                id="forgot-btn-submit-new-pass"
                onClick={handleResetPasswordSubmit}
                disabled={isSubmitting || !resetToken.trim() || newPassword.length < 8}
                className="w-full min-h-[38px] py-1.5 px-3 text-xs font-semibold bg-ink text-white rounded-lg hover:bg-ink-soft cursor-pointer disabled:opacity-50 transition"
              >
                Set New Password
              </button>
            </div>

            <div className="pt-2 text-center text-xs text-text-secondary border-t border-line">
              <button
                type="button"
                onClick={() => setView('login')}
                className="font-bold text-ink underline hover:text-ink-soft cursor-pointer min-h-[44px] inline-flex items-center justify-center"
              >
                Back to Sign In
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};
