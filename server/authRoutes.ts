import express, { Express, Request, Response, NextFunction } from 'express';
import { getDbPool } from './db';
import { deriveNeonAuthBaseUrl } from './neonAuthUrl';
import { getOrCreateStudentProfile } from './services/studentProfile';
import { allowPersistentRateLimit } from './persistentRateLimiter';
import { persistentRateLimitMiddleware } from './rateLimitMiddleware';

import { isMiuEmail } from './authPolicy';
import { fetchWithTimeout } from './upstream';
import { resolveAuthoritativeOrigin } from './requestSecurity';
import { requireAuth } from './authMiddleware';
import { getServerConfig } from './config';


function getIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function allowCriticalRateLimit(scope: string, key: string, limit: number, windowMs: number) {
  try {
    return await allowPersistentRateLimit(scope, key, limit, windowMs, { failClosed: true });
  } catch {
    // Critical controls must fail closed. A shared-store outage must not reopen
    // a multi-instance bypass through the per-process fallback limiter.
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
  }
}

async function allowSensitiveReauthentication(req: Request, userId: string) {
  const ip = getIp(req);
  const userLimit = await allowCriticalRateLimit('auth_reauth_user', userId, 5, 5 * 60_000);
  if (!userLimit.allowed) return userLimit;
  return allowCriticalRateLimit('auth_reauth_ip', `${userId}:${ip}`, 5, 5 * 60_000);
}

function normalizeAuthSetCookie(cookie: string): string | null {
  const parts = cookie.split(';').map((part) => part.trim()).filter(Boolean);
  const first = parts.shift();
  if (!first || !first.includes('=')) return null;
  const attrs: string[] = [];
  let hasPath = false;
  let hasSameSite = false;
  let hasSecure = false;
  let hasHttpOnly = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('domain=')) continue;
    if (lower.startsWith('path=')) { attrs.push('Path=/'); hasPath = true; continue; }
    if (lower.startsWith('samesite=')) { attrs.push('SameSite=Lax'); hasSameSite = true; continue; }
    if (lower === 'secure') { attrs.push('Secure'); hasSecure = true; continue; }
    if (lower === 'httponly') { attrs.push('HttpOnly'); hasHttpOnly = true; continue; }
    attrs.push(part);
  }
  if (!hasPath) attrs.push('Path=/');
  if (!hasSameSite) attrs.push('SameSite=Lax');
  if (!hasHttpOnly) attrs.push('HttpOnly');
  if (getServerConfig().deploymentEnv === 'production' && !hasSecure) attrs.push('Secure');
  return [first, ...attrs].join('; ');
}

function getUpstreamSetCookies(response: globalThis.Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = response.headers.get('set-cookie');
  return combined ? [combined] : [];
}

function forwardSetCookie(response: globalThis.Response, res: Response): void {
  const normalized = getUpstreamSetCookies(response)
    .map(normalizeAuthSetCookie)
    .filter((cookie): cookie is string => Boolean(cookie));
  if (normalized.length) res.setHeader('Set-Cookie', normalized);
}

function clearBetterAuthCookies(req: Request, res: Response): void {
  const raw = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  const names = raw.split(';')
    .map((part) => part.trim().split('=', 1)[0])
    .filter((name) => /^better-auth\./i.test(name));
  const unique = [...new Set(names)];
  if (!unique.length) return;
  const secure = getServerConfig().deploymentEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', unique.map((name) => `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`));
}

/**
 * Registers all Neon Auth endpoints for Gadwal student authentication.
 */
export function registerAuthRoutes(app: Express): void {
  app.use('/api/auth', (req, res, next) => {
    // Apply json parser to auth routes
    express.json({ limit: '512kb' })(req, res, next);
  });
  const getAuthBaseUrl = (): string => {
    const url = deriveNeonAuthBaseUrl();
    if (!url) {
      throw new Error('Neon Auth is not configured. DATABASE_URL is missing or invalid.');
    }
    return url;
  };

  // 1. GET current session and user verification state
  app.get('/api/auth/session', async (req: Request, res: Response) => {
    const sessionRl = await allowCriticalRateLimit('auth_session_ip', getIp(req), 120, 60_000);
    if (!sessionRl.allowed) { res.setHeader('Retry-After', String(sessionRl.retryAfterSeconds)); return res.status(429).json({ error: 'Too many session requests. Please wait before trying again.', code: 'RATE_LIMITED' }); }
    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    const headers: Record<string, string> = {};
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

    try {
      const response = await fetchWithTimeout(`${authBase}/get-session`, {
        method: 'GET',
        headers,
        timeoutMs: 8_000,
      });

      if (!response.ok) {
        if (response.status === 401) return res.status(200).json({ user: null, session: null });
        return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
      }

      const sessionData = await response.json();
      if (!sessionData || !sessionData.user || !isMiuEmail(sessionData.user.email)) {
        return res.status(200).json({ user: null, session: null });
      }

      const pool = getDbPool();
      if (!pool) return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
      const dbUser = await pool.query<{ emailVerified: boolean }>('SELECT "emailVerified" FROM neon_auth.user WHERE id = $1', [sessionData.user.id]);
      const emailVerified = dbUser.rows.length > 0 && Boolean(dbUser.rows[0].emailVerified);
      const profile = emailVerified ? await getOrCreateStudentProfile(sessionData.user.id, sessionData.user.email, sessionData.user.name) : null;
      const role = profile?.role === 'ADMIN' ? 'ADMIN' : 'STUDENT';

      // Do not expose the upstream session object to the browser. Depending on the
      // Neon Auth response shape, it may contain provider-managed credential metadata.
      return res.status(200).json({
        user: {
          id: sessionData.user.id,
          name: sessionData.user.name,
          email: sessionData.user.email,
          emailVerified,
          role,
          profile,
        },
        session: { authenticated: true },
      });
    } catch (err: unknown) {
      console.error('[Auth] Session load error:', err instanceof Error ? err.message : String(err));
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }
  });

  // 2. Student Sign Up - Enforces strict MIU student email requirement
  app.post('/api/auth/sign-up', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const { email, password, name } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: 'Email address is required.',
        code: 'EMAIL_REQUIRED',
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const ipLimit = await allowCriticalRateLimit('auth_signup_ip', ip, 30, 60_000);
    if (!ipLimit.allowed) {
      return res.status(429).json({ error: `Too many sign up attempts. Please wait ${ipLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }
    const accountLimit = await allowCriticalRateLimit('auth_signup_account', trimmedEmail, 5, 60_000);
    if (!accountLimit.allowed) {
      return res.status(429).json({ error: `Too many sign up attempts. Please wait ${accountLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    // STRICT MIU EMAIL DOMAIN RESTRICTION
    if (!isMiuEmail(trimmedEmail)) {
      return res.status(400).json({
        error: 'Only official MIU student emails ending with @miuegypt.edu.eg are permitted to create an account.',
        code: 'INVALID_EMAIL_DOMAIN',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters long.',
        code: 'PASSWORD_TOO_SHORT',
      });
    }

    const studentName = typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : trimmedEmail.split('@')[0].replace(/[._]/g, ' ');
    if (studentName.length > 120 || /[\u0000-\u001F\u007F]/.test(studentName)) {
      return res.status(400).json({ error: 'Name must be 120 characters or fewer and contain no control characters.', code: 'INVALID_NAME' });
    }

    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch (err: unknown) {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    try {
      const response = await fetchWithTimeout(`${authBase}/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': resolveAuthoritativeOrigin(req),
        },
        body: JSON.stringify({
          name: studentName,
          email: trimmedEmail,
          password,
        }),
        timeoutMs: 8_000,
      });

      const responseBody = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        parsed = { message: responseBody };
      }

      if (!response.ok) {
        const detail = JSON.stringify(parsed).toLowerCase();
        if (/already|exists|registered|unique|duplicate/.test(detail)) {
          return res.status(400).json({ error: 'This account could not be created. Check the email and try again.', code: 'SIGNUP_FAILED' });
        }
        const status = response.status >= 500 ? 502 : 400;
        return res.status(status).json({
          error: 'Account creation failed. Please check the details and try again.',
          code: 'SIGNUP_FAILED',
        });
      }

      // Forward Set-Cookie header so the user receives their session token
      forwardSetCookie(response, res);

      // Trigger verification email via Neon Auth
      try {
        await fetchWithTimeout(`${authBase}/email-otp/send-verification-otp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': resolveAuthoritativeOrigin(req),
          },
          body: JSON.stringify({ email: trimmedEmail, type: 'email-verification' }),
          timeoutMs: 8_000,
        });
      } catch (err) {
        console.warn('[Neon Auth] Verification email trigger warning:', err);
      }

      return res.status(200).json({
        ok: true,
        user: {
          id: parsed.user?.id,
          name: parsed.user?.name || studentName,
          email: trimmedEmail,
          emailVerified: false,
        },
        message: 'Account created successfully. Please verify your student email.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Auth] Sign-up upstream error:', msg);
      return res.status(502).json({ error: 'Account creation failed. Please try again later.', code: 'UPSTREAM_ERROR' });
    }
  });

  // 3. Student Sign In
  app.post('/api/auth/sign-in', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const { email, password } = req.body || {};
    const normalizedLoginEmail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 160) : 'unknown';
    const ipLimit = await allowCriticalRateLimit('auth_login_ip', ip, 30, 60_000);
    const accountLimit = await allowCriticalRateLimit('auth_login_account', normalizedLoginEmail, 10, 60_000);
    const rl = !ipLimit.allowed ? ipLimit : accountLimit;
    if (!rl.allowed) {
      return res.status(429).json({ error: `Too many login attempts. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.', code: 'EMAIL_REQUIRED' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.', code: 'PASSWORD_REQUIRED' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Password is too long.', code: 'PASSWORD_TOO_LONG' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!isMiuEmail(trimmedEmail)) {
      return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    }

    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch (err: unknown) {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    try {
      const response = await fetchWithTimeout(`${authBase}/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': resolveAuthoritativeOrigin(req),
        },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
        }),
        timeoutMs: 8_000,
      });

      const responseBody = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        parsed = { message: responseBody };
      }

      if (!response.ok) {
        return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
      }

      forwardSetCookie(response, res);

      const pool = getDbPool();
      if (!pool || !parsed.user?.id) return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
      const dbUser = await pool.query<{ emailVerified: boolean }>('SELECT "emailVerified" FROM neon_auth.user WHERE id = $1', [parsed.user.id]);
      const emailVerified = dbUser.rows.length > 0 && Boolean(dbUser.rows[0].emailVerified);
      const profile = await getOrCreateStudentProfile(parsed.user.id, parsed.user.email, parsed.user.name);
      const role = profile?.role === 'ADMIN' ? 'ADMIN' : 'STUDENT';

      return res.status(200).json({
        ok: true,
        user: {
          id: parsed.user?.id,
          name: parsed.user?.name,
          email: parsed.user?.email,
          emailVerified,
          role,
          profile,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Auth] Sign-in upstream error:', msg);
      return res.status(502).json({ error: 'Login failed. Please try again later.', code: 'UPSTREAM_ERROR' });
    }
  });

  // 4. Sign Out
  app.post('/api/auth/sign-out', async (req: Request, res: Response) => {
    const signOutRl = await allowCriticalRateLimit('auth_signout_ip', getIp(req), 30, 60_000);
    if (!signOutRl.allowed) { res.setHeader('Retry-After', String(signOutRl.retryAfterSeconds)); return res.status(429).json({ error: 'Too many sign-out requests. Please wait before trying again.', code: 'RATE_LIMITED' }); }
    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': resolveAuthoritativeOrigin(req),
    };
    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

    try {
      const response = await fetchWithTimeout(`${authBase}/sign-out`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
        timeoutMs: 8_000,
      });

      if (!response.ok && response.status !== 401) {
        return res.status(response.status >= 500 ? 502 : 400).json({ error: 'Could not complete logout. Please try again.', code: 'SIGNOUT_FAILED' });
      }
      forwardSetCookie(response, res);
      if (response.status === 401) clearBetterAuthCookies(req, res);
      return res.status(200).json({ ok: true, message: 'Logged out successfully.' });
    } catch {
      return res.status(502).json({ error: 'Could not complete logout. Please try again.', code: 'SIGNOUT_FAILED' });
    }
  });

  // 5. Resend Verification Email
  app.post('/api/auth/resend-verification', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const { email } = req.body || {};
    const resendKey = `${ip}:${typeof email === 'string' ? email.trim().toLowerCase().slice(0,160) : 'unknown'}`;
    const rl = await allowCriticalRateLimit('auth_resend', resendKey, 3, 60_000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Too many requests. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.', code: 'EMAIL_REQUIRED' });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!isMiuEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Only official MIU student emails are supported.', code: 'INVALID_EMAIL_DOMAIN' });
    }
    const emailLimit = await allowCriticalRateLimit('auth_resend_email', trimmedEmail, 3, 60_000);
    if (!emailLimit.allowed) {
      return res.status(429).json({ error: `Too many requests. Please wait ${emailLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch (err: unknown) {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    try {
      const response = await fetchWithTimeout(`${authBase}/email-otp/send-verification-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': resolveAuthoritativeOrigin(req),
        },
        body: JSON.stringify({ email: trimmedEmail, type: 'email-verification' }),
        timeoutMs: 8_000,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status >= 500) {
        return res.status(502).json({ error: 'Could not resend the verification email right now. Please try again later.', code: 'UPSTREAM_ERROR' });
      }
      // Do not reveal whether the account exists. 4xx provider responses are normalized.
      return res.status(200).json({ ok: true, message: 'If the MIU account can receive verification mail, a new verification code has been sent.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Auth] Resend verification upstream error:', msg);
      return res.status(502).json({ error: 'Could not resend the verification email. Please try again later.' });
    }
  });

  // 6. Verify Email via Neon Auth OTP/token and confirm the resulting session/user state.
  app.post('/api/auth/verify-email', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const { token, code, email } = req.body || {};
    const verifyKey = `${ip}:${typeof email === 'string' ? email.trim().toLowerCase().slice(0,160) : 'unknown'}`;
    const rl = await allowCriticalRateLimit('auth_verify', verifyKey, 10, 60_000);
    if (!rl.allowed) return res.status(429).json({ error: `Too many verification attempts. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });

    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const verificationToken = typeof (token || code) === 'string' ? String(token || code).trim() : '';

    if (!trimmedEmail || !isMiuEmail(trimmedEmail)) return res.status(400).json({ error: 'A valid MIU email is required.', code: 'INVALID_EMAIL' });
    const emailLimit = await allowCriticalRateLimit('auth_verify_email', trimmedEmail, 10, 60_000);
    if (!emailLimit.allowed) return res.status(429).json({ error: `Too many verification attempts. Please wait ${emailLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    if (!verificationToken) return res.status(400).json({ error: 'Verification code is required.', code: 'TOKEN_REQUIRED' });

    let authBase: string;
    try { authBase = getAuthBaseUrl(); } catch { return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' }); }

    try {
      const otpResponse = await fetchWithTimeout(`${authBase}/email-otp/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req) },
        body: JSON.stringify({ email: trimmedEmail, otp: verificationToken }),
        timeoutMs: 8_000,
      });
      const otpData = await otpResponse.json().catch(() => ({}));

      // Some Better Auth endpoints can return a JSON error envelope with an HTTP 2xx.
      // Never treat status alone as proof of verification.
      if (!otpResponse.ok || otpData?.error) {
        return res.status(otpResponse.status === 429 ? 429 : 400).json({ error: otpResponse.status === 429 ? 'Too many verification attempts. Please try later.' : 'Invalid or expired verification code.', code: otpResponse.status === 429 ? 'RATE_LIMITED' : 'INVALID_TOKEN' });
      }

      // Confirm the real user record is now verified. This is the final source of truth.
      const pool = getDbPool();
      if (!pool) return res.status(503).json({ error: 'Database unavailable.', code: 'DB_UNAVAILABLE' });
      const dbUser = await pool.query<{ id: string; "emailVerified": boolean }>('SELECT id, "emailVerified" FROM neon_auth.user WHERE lower(email)=lower($1) LIMIT 1', [trimmedEmail]);
      if (!dbUser.rows.length || dbUser.rows[0].emailVerified !== true) {
        return res.status(400).json({ error: 'Verification did not complete. Please request a new code and try again.', code: 'VERIFICATION_NOT_CONFIRMED' });
      }

      return res.status(200).json({ ok: true, verified: true, message: 'Email verified successfully.' });
    } catch (err: unknown) {
      console.error('[Auth] Verification upstream error:', err instanceof Error ? err.message : String(err));
      return res.status(502).json({ error: 'Verification service unavailable. Please try again later.', code: 'UPSTREAM_ERROR' });
    }
  });

  // 7. Request Password Reset (Forgot Password)
  app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const rl = await allowCriticalRateLimit('auth_reset', ip, 3, 60_000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Too many requests. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.', code: 'EMAIL_REQUIRED' });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!isMiuEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Only official MIU student emails are supported.', code: 'INVALID_EMAIL_DOMAIN' });
    }
    const emailLimit = await allowCriticalRateLimit('auth_reset_email', trimmedEmail, 3, 60_000);
    if (!emailLimit.allowed) {
      return res.status(429).json({ error: `Too many requests. Please wait ${emailLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch (err: unknown) {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    try {
      const response = await fetchWithTimeout(`${authBase}/request-password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': resolveAuthoritativeOrigin(req),
        },
        body: JSON.stringify({
          email: trimmedEmail,
          redirectTo: resolveAuthoritativeOrigin(req),
        }),
        timeoutMs: 8_000,
      });

      await response.text().catch(() => '');
      if (!response.ok && response.status >= 500) {
        return res.status(502).json({ error: 'Could not start password reset. Please try again later.', code: 'UPSTREAM_ERROR' });
      }
      return res.status(200).json({
        ok: true,
        message: 'If an account exists with this email, a password reset link or code has been sent.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Auth] Password reset request upstream error:', msg);
      return res.status(502).json({ error: 'Could not start password reset. Please try again later.' });
    }
  });

  const reauthenticateWithPassword = async (req: Request, email: string, password: string): Promise<boolean> => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!password || !isMiuEmail(normalizedEmail)) return false;
    try {
      const response = await fetchWithTimeout(`${getAuthBaseUrl()}/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req) },
        body: JSON.stringify({ email: normalizedEmail, password, rememberMe: false }),
        timeoutMs: 8_000,
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  // 8. Change password / email / session controls. These remain authoritative Neon Auth operations.
  app.post('/api/auth/change-password', requireAuth, async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || currentPassword.length < 8 || currentPassword.length > 128 || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Please provide valid current and new passwords.', code: 'INVALID_PASSWORD_INPUT' });
    }
    const reauthLimit = await allowSensitiveReauthentication(req, (req as any).user.id);
    if (!reauthLimit.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${reauthLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    const userResponse = await fetchWithTimeout(`${getAuthBaseUrl()}/get-session`, { headers: { ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, timeoutMs: 8_000 }).catch(() => null);
    if (!userResponse?.ok) return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.', code: 'UNAUTHORIZED' });
    const sessionData = await userResponse.json().catch(() => null);
    const email = sessionData?.user?.email;
    if (!email || !isMiuEmail(email)) return res.status(403).json({ error: 'Only verified MIU accounts can change their password.', code: 'FORBIDDEN' });
    try {
      const response = await fetchWithTimeout(`${getAuthBaseUrl()}/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req), ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
        timeoutMs: 8_000,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) return res.status(response.status >= 500 ? 502 : 400).json({ error: response.status >= 500 ? 'Password service is temporarily unavailable.' : 'Current password is incorrect or the new password is invalid.', code: response.status >= 500 ? 'UPSTREAM_ERROR' : 'PASSWORD_CHANGE_FAILED' });
      forwardSetCookie(response, res);
      return res.json({ ok: true, message: 'Password changed successfully. Other sessions were signed out.' });
    } catch { return res.status(502).json({ error: 'Password service is temporarily unavailable.', code: 'UPSTREAM_ERROR' }); }
  });

  app.post('/api/auth/change-email', requireAuth, persistentRateLimitMiddleware('auth_change_email', 5, 15 * 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    const { newEmail, currentPassword } = req.body || {};
    const normalized = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';
    if (!isMiuEmail(normalized)) return res.status(400).json({ error: 'The new email must be an official MIU email address.', code: 'INVALID_EMAIL_DOMAIN' });
    if (typeof currentPassword !== 'string' || currentPassword.length < 8 || currentPassword.length > 128) return res.status(400).json({ error: 'Current password is required for this sensitive change.', code: 'PASSWORD_REQUIRED' });
    const reauthLimit = await allowSensitiveReauthentication(req, (req as any).user.id);
    if (!reauthLimit.allowed) return res.status(429).json({ error: `Too many sensitive-account attempts. Please wait ${reauthLimit.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    try {
      const currentSession = await fetchWithTimeout(`${getAuthBaseUrl()}/get-session`, { headers: { ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, timeoutMs: 8_000 });
      const sessionData = await currentSession.json().catch(() => null);
      const currentEmail = String(sessionData?.user?.email || '').trim().toLowerCase();
      if (!currentSession.ok || !isMiuEmail(currentEmail)) return res.status(401).json({ error: 'Your session is no longer valid.', code: 'UNAUTHORIZED' });
      if (normalized === currentEmail) return res.status(400).json({ error: 'The new email is the same as your current email.', code: 'EMAIL_UNCHANGED' });
      const verifiedPassword = await reauthenticateWithPassword(req, currentEmail, currentPassword);
      if (!verifiedPassword) return res.status(403).json({ error: 'Current password is incorrect.', code: 'REAUTH_FAILED' });
      const response = await fetchWithTimeout(`${getAuthBaseUrl()}/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req), ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
        body: JSON.stringify({ newEmail: normalized, callbackURL: resolveAuthoritativeOrigin(req) }),
        timeoutMs: 8_000,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status >= 500 ? 502 : 400).json({ error: response.status >= 500 ? 'Email change service is temporarily unavailable.' : 'The email change could not be started. Make sure the new MIU email is available.', code: response.status >= 500 ? 'UPSTREAM_ERROR' : 'EMAIL_CHANGE_FAILED' });
      forwardSetCookie(response, res);
      return res.json({ ok: true, message: 'A confirmation link has been sent to the new MIU email address. Your current email remains active until verification completes.' });
    } catch { return res.status(502).json({ error: 'Email change service is temporarily unavailable.', code: 'UPSTREAM_ERROR' }); }
  });

  app.post('/api/auth/revoke-other-sessions', requireAuth, persistentRateLimitMiddleware('auth_revoke_other_sessions', 10, 15 * 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const response = await fetchWithTimeout(`${getAuthBaseUrl()}/revoke-other-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req), ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: JSON.stringify({}), timeoutMs: 8_000 });
      if (!response.ok) return res.status(response.status >= 500 ? 502 : 400).json({ error: 'Could not sign out other sessions.', code: 'SESSION_REVOKE_FAILED' });
      forwardSetCookie(response, res);
      return res.json({ ok: true, message: 'Other sessions were signed out.' });
    } catch { return res.status(502).json({ error: 'Could not sign out other sessions right now.', code: 'UPSTREAM_ERROR' }); }
  });

  app.post('/api/auth/revoke-all-sessions', requireAuth, persistentRateLimitMiddleware('auth_revoke_all_sessions', 10, 15 * 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const response = await fetchWithTimeout(`${getAuthBaseUrl()}/revoke-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': resolveAuthoritativeOrigin(req), ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: JSON.stringify({}), timeoutMs: 8_000 });
      if (!response.ok) return res.status(response.status >= 500 ? 502 : 400).json({ error: 'Could not sign out all sessions.', code: 'SESSION_REVOKE_FAILED' });
      forwardSetCookie(response, res);
      return res.json({ ok: true, message: 'All sessions were signed out. Please sign in again.' });
    } catch { return res.status(502).json({ error: 'Could not sign out all sessions right now.', code: 'UPSTREAM_ERROR' }); }
  });

  // 8. Reset Password with token
  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    const ip = getIp(req);
    const rl = await allowCriticalRateLimit('auth_reset', ip, 3, 60_000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Too many requests. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
    }

    const { token, newPassword } = req.body || {};

    if (!token || typeof token !== 'string' || token.length > 2048) {
      return res.status(400).json({ error: 'Reset token is required.', code: 'TOKEN_REQUIRED' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.', code: 'PASSWORD_TOO_SHORT' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'New password is too long.', code: 'PASSWORD_TOO_LONG' });
    }

    let authBase: string;
    try {
      authBase = getAuthBaseUrl();
    } catch (err: unknown) {
      return res.status(503).json({ error: 'Authentication service unavailable.', code: 'AUTH_UNAVAILABLE' });
    }

    try {
      const response = await fetchWithTimeout(`${authBase}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': resolveAuthoritativeOrigin(req),
        },
        body: JSON.stringify({
          token: token.trim(),
          newPassword,
        }),
        timeoutMs: 8_000,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
        return res.status(status).json({ error: status === 429 ? 'Too many reset attempts. Please try again later.' : 'The reset link or code is invalid or expired.', code: status === 429 ? 'RATE_LIMITED' : 'RESET_INVALID' });
      }

      return res.status(200).json({
        ok: true,
        message: 'Password reset successfully. You can now log in with your new password.',
      });
    } catch {
      return res.status(502).json({ error: 'Password reset failed. Please try again later.', code: 'UPSTREAM_ERROR' });
    }
  });
}
