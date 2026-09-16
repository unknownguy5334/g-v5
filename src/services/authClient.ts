import { AuthUser } from '../types/auth';
import { fetchJson, setStoredAuthToken, clearStoredAuthToken } from './resilientFetch';

export interface SessionResponse {
  user: AuthUser | null;
  session: Record<string, unknown> | null;
}

export async function fetchCurrentSession(): Promise<SessionResponse> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/session', { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) return { user: null, session: null };
    
    // Also fetch profile if user exists and is verified
    if (data.user && data.user.emailVerified) {
      try {
        const { response: pRes, data: pData } = await fetchJson('/api/profile', { method: 'GET', credentials: 'same-origin' });
        if (pRes.ok) {
          data.user.profile = pData.profile;
        }
      } catch {}
    }
    
    return data;
  } catch {
    return { user: null, session: null };
  }
}

export async function studentSignUp(payload: { email: string; password: string; name?: string }): Promise<{ ok: boolean; user?: AuthUser; error?: string; message?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Account creation failed.' };
    }
    return { ok: true, user: data.user, message: data.message };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function studentSignIn(payload: { email: string; password: string }): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Invalid email or password.' };
    }
    
    if (data.token) {
      setStoredAuthToken(data.token);
    }

    if (data.user && data.user.emailVerified) {
      try {
        const { response: pRes, data: pData } = await fetchJson('/api/profile', { method: 'GET', credentials: 'same-origin' });
        if (pRes.ok) {
          data.user.profile = pData.profile;
        }
      } catch {}
    }

    return { ok: true, user: data.user };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function studentSignOut(): Promise<{ ok: boolean; error?: string }> {
  try {
    clearStoredAuthToken();
    const { response: res, data } = await fetchJson('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', timeoutMs: 8000 });
    if (!res.ok) return { ok: false, error: data.error || 'Logout could not be completed.' };
    return { ok: true };
  } catch (err: unknown) {
    clearStoredAuthToken();
    return { ok: false, error: err instanceof Error ? err.message : 'Logout could not be completed.' };
  }
}

export async function resendVerificationEmail(email: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Failed to resend verification.' };
    }
    return { ok: true, message: data.message || 'Verification email resent.' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function verifyEmailToken(tokenOrCode: string, email?: string): Promise<{ ok: boolean; user?: AuthUser; error?: string; message?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: tokenOrCode, email }),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Verification failed.' };
    }
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    return { ok: true, user: data.user, message: data.message || 'Email verified successfully!' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Password reset request failed.' };
    }
    return { ok: true, message: data.message || 'Check your student email for the reset instructions.' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function submitPasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, newPassword }),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Password reset failed.' };
    }
    return { ok: true, message: data.message || 'Password updated successfully. You may now log in.' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function fetchGoogleAuthConfig(): Promise<{ clientId: string; configured: boolean; hostedDomain: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/google/config', { method: 'GET' });
    if (!res.ok) return { clientId: '', configured: false, hostedDomain: 'miuegypt.edu.eg' };
    return {
      clientId: data.clientId || '',
      configured: Boolean(data.configured),
      hostedDomain: data.hostedDomain || 'miuegypt.edu.eg',
    };
  } catch {
    return { clientId: '', configured: false, hostedDomain: 'miuegypt.edu.eg' };
  }
}

export async function signInWithGoogle(payload: { credential?: string; idToken?: string; code?: string; accessToken?: string; redirectUri?: string }): Promise<{ ok: boolean; user?: AuthUser; error?: string; message?: string }> {
  try {
    const { response: res, data } = await fetchJson('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: data.error || data.message || 'Google sign-in failed.' };
    }
    if (data.token) {
      setStoredAuthToken(data.token);
    }
    if (data.user && data.user.emailVerified) {
      try {
        const { response: pRes, data: pData } = await fetchJson('/api/profile', { method: 'GET', credentials: 'same-origin' });
        if (pRes.ok && pData.profile) {
          data.user.profile = pData.profile;
        }
      } catch {}
    }
    return { ok: true, user: data.user, message: data.message || 'Signed in successfully!' };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Google sign-in error' };
  }
}
