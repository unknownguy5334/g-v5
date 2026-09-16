import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { safeStorage } from '../utils/safeStorage';
import { AuthUser, AuthStatus } from '../types/auth';
import {
  fetchCurrentSession,
  studentSignIn,
  studentSignUp,
  studentSignOut,
  resendVerificationEmail,
  verifyEmailToken,
  requestPasswordReset,
  submitPasswordReset,
  signInWithGoogle,
} from '../services/authClient';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  isLoading: boolean;
  refreshSession: () => Promise<AuthUser | null>;
  login: (credentials: { email: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  loginWithGoogle: (payload: { credential?: string; idToken?: string; code?: string; accessToken?: string }) => Promise<{ ok: boolean; error?: string; message?: string }>;
  signUp: (payload: { email: string; password: string; name?: string }) => Promise<{ ok: boolean; error?: string; message?: string }>;
  logout: () => Promise<void>;
  resendVerification: (emailOverride?: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  verifyEmail: (token: string, email?: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  forgotPassword: (email: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  resetPassword: (token: string, newPass: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_BOUNDARY_STORAGE_KEY = 'gadwal_auth_boundary_v1';

function signalAuthBoundary(): void {
  safeStorage.setItem(AUTH_BOUNDARY_STORAGE_KEY, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const data = await fetchCurrentSession();
      if (data.user && data.user.emailVerified) {
        setUser(data.user);
        setStatus('authenticated');
        return data.user;
      } else {
        setUser(null);
        setStatus('unauthenticated');
        return null;
      }
    } catch {
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== AUTH_BOUNDARY_STORAGE_KEY) return;
      void refreshSession();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshSession]);

  const login = async (credentials: { email: string; password: string }) => {
    const res = await studentSignIn(credentials);
    if (res.ok && res.user && res.user.emailVerified) {
      signalAuthBoundary();
      setUser(res.user);
      setStatus('authenticated');
      return { ok: true };
    }
    return { ok: false, error: res.error || 'Login failed' };
  };

  const loginWithGoogle = async (payload: { credential?: string; idToken?: string; code?: string; accessToken?: string }) => {
    const res = await signInWithGoogle(payload);
    if (res.ok && res.user && res.user.emailVerified) {
      signalAuthBoundary();
      setUser(res.user);
      setStatus('authenticated');
      return { ok: true, message: res.message };
    }
    return { ok: false, error: res.error || 'Google sign-in failed' };
  };

  const signUp = async (payload: { email: string; password: string; name?: string }) => {
    const res = await studentSignUp(payload);
    if (res.ok) {
      // An account only exists once verification is complete!
      // Do not store user or set unverified session on sign up.
      return { ok: true, message: res.message };
    }
    return { ok: false, error: res.error || 'Account creation failed' };
  };

  const logout = async () => {
    const result = await studentSignOut();
    if (result.ok) { signalAuthBoundary(); setUser(null); setStatus('unauthenticated'); }
    else throw new Error(result.error || 'Logout could not be completed.');
  };

  const resendVerification = async (emailOverride?: string) => {
    const targetEmail = emailOverride || user?.email;
    if (!targetEmail) return { ok: false, error: 'No email specified.' };
    return await resendVerificationEmail(targetEmail);
  };

  const verifyEmail = async (token: string, email?: string) => {
    const targetEmail = email || user?.email;
    const res = await verifyEmailToken(token, targetEmail);
    if (res.ok) {
      if (res.user) {
        setUser(res.user);
        setStatus('authenticated');
      }
      signalAuthBoundary();
      await refreshSession();
    }
    return res;
  };

  const forgotPassword = async (email: string) => {
    return await requestPasswordReset(email);
  };

  const resetPassword = async (token: string, newPass: string) => {
    return await submitPasswordReset(token, newPass);
  };

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        isLoading: status === 'loading',
        refreshSession,
        login,
        loginWithGoogle,
        signUp,
        logout,
        resendVerification,
        verifyEmail,
        forgotPassword,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
