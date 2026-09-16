import React, { useState, useRef } from 'react';
import { usePopupInteractions } from '../hooks/usePopupInteractions';
import { RotateCcw, Menu, X, User, LogOut, LogIn, CheckCircle2, AlertCircle, CreditCard, ShieldCheck } from 'lucide-react';
import { AppStep } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { isAdminUser } from '../types/auth';


interface HeaderProps {
  totalCoursesCount: number;
  currentStep?: AppStep;
  onNavigateStep?: (step: AppStep) => void;
  onGoHome: () => void;
  onReset: () => void;
  onOpenHowItWorks: (trigger?: HTMLElement | null) => void;
  onOpenDemo?: (trigger?: HTMLElement | null) => void;
  onOpenPromise?: (trigger?: HTMLElement | null) => void;
  onOpenAuth?: (view?: 'login' | 'signup' | 'verify') => void;
  onOpenAccount?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  totalCoursesCount,
  currentStep,
  onNavigateStep,
  onGoHome,
  onReset,
  onOpenHowItWorks,
  onOpenDemo,
  onOpenPromise,
  onOpenAuth,
  onOpenAccount,
}) => {
  const { user, status, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  const handleHowItWorks = (trigger?: HTMLElement | null) => {
    if (onOpenHowItWorks) onOpenHowItWorks(trigger);
    else if (onOpenPromise) onOpenPromise(trigger);
  };

  usePopupInteractions({
    isOpen: isMobileMenuOpen,
    onClose: () => setIsMobileMenuOpen(false),
    triggerRef: toggleButtonRef,
    popupRef: popoverRef,
    keyboardNavigation: 'none',
    focusSelector: 'a, button, [tabindex]:not([tabindex="-1"])',
  });

  return (
    <header className="border-b border-line-strong bg-paper sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Side: Brand Identity (Navigates Home/Setup safely without resetting) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a
            href="/#home"
            id="header-btn-logo"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex items-center p-1 rounded-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent select-none cursor-pointer shrink-0"
            title="Gadwal home"
            aria-label="Return to Gadwal home"
          >
            <img
              src="/brand/gadwal-wordmark.png"
              alt="Gadwal"
              className="block w-auto h-8 sm:h-9.5 md:h-10 max-w-[10.5rem] sm:max-w-[12rem] object-contain object-left"
            />
          </a>
        </div>

        {/* Desktop Navigation (sm: and up) text-led, underline on hover, no icon-per-item */}
        <div className="responsive-header-desktop items-center gap-6 shrink-0">
          <nav className="flex items-center gap-4 pr-1" aria-label="Main Navigation">
            <button
              type="button"
              id="header-btn-home"
              onClick={onGoHome}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="Return to home"
              aria-current={currentStep === 'home' ? 'page' : undefined}
            >
              Home
            </button>

            {currentStep === 'home' && totalCoursesCount > 0 && onNavigateStep && (
              <button
                type="button"
                id="header-btn-build"
                onClick={() => onNavigateStep('setup')}
                className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
                title="Go to course builder"
              >
                Build a week
              </button>
            )}

            <a
              href="#guide"
              id="header-btn-demo"
              onClick={(event) => { event.preventDefault(); onOpenDemo?.(event.currentTarget); }}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="Open screenshot guide"
            >
              Screenshot guide
            </a>

            <a
              href="#how-it-works"
              id="header-btn-how-it-works"
              onClick={(event) => { event.preventDefault(); handleHowItWorks(event.currentTarget); }}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="How it works"
            >
              How it works
            </a>
          </nav>

          {/* Auth State Button */}
          {user ? (
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-line cursor-default"
                title={`Signed in as ${user.email}`}
              >
                <User className="w-3.5 h-3.5 text-ink" />
                <span className="max-w-[120px] truncate text-ink font-medium">{user.name || user.email.split('@')[0]}</span>
                {user.emailVerified ? (
                  <span title="Verified MIU Student" className="inline-flex">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAuth?.('verify')}
                    className="flex items-center gap-0.5 text-[10px] text-caution font-bold hover:underline cursor-pointer"
                    title="Account unverified - click to verify"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-caution" />
                    <span>Verify</span>
                  </button>
                )}
              </div>
              {isAdminUser(user) && (
                <a
                  href="/admin"
                  id="header-btn-admin"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong transition-colors cursor-pointer px-2 py-1 rounded bg-accent/10 hover:bg-accent/20 border border-accent/20"
                  title="Gadwal Admin Dashboard"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                  <span>Admin</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => onOpenAccount?.()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer px-2 py-1 rounded hover:bg-mist"
                title="Gadwal account and access"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Account</span>
              </button>
              <button
                type="button"
                id="header-btn-logout"
                onClick={() => logout()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer px-2 py-1 rounded hover:bg-mist"
                title="Log out of Gadwal"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <button
                type="button"
                id="header-btn-login"
                onClick={() => onOpenAuth?.('login')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:text-ink-soft transition-colors cursor-pointer px-2.5 py-1 rounded border border-line hover:bg-mist bg-white"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Log in</span>
              </button>
              <button
                type="button"
                id="header-btn-signup"
                onClick={() => onOpenAuth?.('signup')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-accent hover:bg-accent-strong transition-colors cursor-pointer px-2.5 py-1 rounded shadow-xs"
              >
                <span>Sign up</span>
              </button>
            </div>
          )}

          {totalCoursesCount > 0 && (
            <button
              type="button"
              id="header-btn-reset"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 text-base font-semibold text-alert hover:text-alert-strong transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-alert"
              title="Clear courses and start over"
            >
              <RotateCcw className="w-3.5 h-3.5 text-alert" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Mobile navigation with the standard menu button */}
        <div className="responsive-header-mobile items-center gap-2 relative">
          <button
            ref={toggleButtonRef}
            type="button"
            id="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="responsive-header-menu-button inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-ink bg-white border border-line rounded-xl transition cursor-pointer active:scale-98"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-navigation-menu"
          >
            {isMobileMenuOpen ? (
              <>
                <X className="w-5 h-5 text-ink" />
              </>
            ) : (
              <>
                <Menu className="w-5 h-5 text-ink" />
              </>
            )}
          </button>

          {/* Mobile Popover Menu */}
          {isMobileMenuOpen && (
            <nav
              ref={popoverRef}
              id="mobile-navigation-menu"
              className="absolute right-0 top-full mt-2 w-60 bg-white border border-line rounded-sm shadow-md p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-0.5 focus:outline-none"
              aria-label="Mobile navigation"
            >
              <button
                type="button"
                id="mobile-menu-home"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onGoHome();
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                Home
              </button>

              {currentStep === 'home' && totalCoursesCount > 0 && onNavigateStep && (
                <button
                  type="button"
                  id="mobile-menu-build"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onNavigateStep('setup');
                  }}
                  className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
                >
                  Build a week
                </button>
              )}

              <button
                type="button"
                id="mobile-menu-demo"
                onClick={() => {
                  onOpenDemo?.(toggleButtonRef.current);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                Screenshot guide
              </button>

              <button
                type="button"
                id="mobile-menu-how-it-works"
                onClick={() => {
                  handleHowItWorks(toggleButtonRef.current);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                How it works
              </button>

              {/* Mobile Auth options */}
              <div className="pt-1.5 pb-1 border-t border-line mt-1">
                {user ? (
                  <>
                    <div className="px-3.5 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-ink" />
                        <div className="text-xs">
                          <p className="font-semibold text-ink">{user.name || 'MIU Student'}</p>
                          <p className="text-text-secondary truncate max-w-[170px]">{user.email}</p>
                        </div>
                      </div>
                      {user.emailVerified ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <span className="text-[10px] font-bold text-caution bg-caution-soft px-1.5 py-0.5 rounded border border-caution-line">Unverified</span>
                      )}
                    </div>
                    {!user.emailVerified && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          onOpenAuth?.('verify');
                        }}
                        className="w-full px-3.5 py-2 min-h-[40px] flex items-center gap-2 text-xs font-semibold text-caution hover:bg-caution-soft rounded-sm transition text-left cursor-pointer"
                      >
                        <AlertCircle className="w-4 h-4 text-caution" />
                        <span>Verify Student Email</span>
                      </button>
                    )}
                    {isAdminUser(user) && (
                      <a
                        href="/admin"
                        id="mobile-menu-admin"
                        className="w-full px-3.5 py-2 min-h-[40px] flex items-center gap-2 text-xs font-semibold text-accent hover:text-accent-strong hover:bg-mist rounded-sm transition text-left cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-accent" />
                        <span>Admin Dashboard</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenAccount?.();
                      }}
                      className="w-full px-3.5 py-2 min-h-[40px] flex items-center gap-2 text-xs font-semibold text-text-secondary hover:text-ink hover:bg-mist rounded-sm transition text-left cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Account</span>
                    </button>
                    <button
                      type="button"
                      id="mobile-menu-logout"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3.5 py-2 min-h-[40px] flex items-center gap-2 text-xs font-semibold text-text-secondary hover:text-ink hover:bg-mist rounded-sm transition text-left cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log out</span>
                    </button>
                  </>
                ) : (
                  <div className="p-2 space-y-1.5">
                    <button
                      type="button"
                      id="mobile-menu-login"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenAuth?.('login');
                      }}
                      className="w-full py-2 px-3 text-center text-xs font-semibold text-ink bg-white border border-line rounded-md hover:bg-mist transition cursor-pointer"
                    >
                      Log in
                    </button>
                    <button
                      type="button"
                      id="mobile-menu-signup"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        onOpenAuth?.('signup');
                      }}
                      className="w-full py-2 px-3 text-center text-xs font-semibold text-white bg-accent hover:bg-accent-strong rounded-md transition shadow-xs cursor-pointer"
                    >
                      Create Account
                    </button>
                  </div>
                )}
              </div>

              {totalCoursesCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onReset();
                  }}
                  className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center gap-2 text-base font-semibold text-alert hover:text-alert-strong hover:bg-alert-soft rounded-sm transition text-left cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-alert" />
                  <span>Reset</span>
                </button>
              )}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};
