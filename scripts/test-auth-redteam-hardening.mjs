import fs from 'node:fs';
import path from 'node:path';

const source = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const checks = [];
function check(label, condition) {
  checks.push({ label, ok: Boolean(condition) });
  if (!condition) throw new Error(`FAIL: ${label}`);
}

const auth = source('server/authRoutes.ts');
const policy = source('server/authPolicy.ts');
const limiter = source('server/persistentRateLimiter.ts');
const account = source('server/accountRoutes.ts');
const clientAuth = source('src/types/auth.ts');
const accountUi = source('src/components/AccountCenter.tsx');
const env = source('.env.example');

check('backend email validation has a hard maximum length', policy.includes('MAX_AUTH_EMAIL_LENGTH = 160') && policy.includes('normalized.length > MAX_AUTH_EMAIL_LENGTH'));
check('client email validation mirrors the backend maximum', clientAuth.includes('MAX_AUTH_EMAIL_LENGTH = 160') && clientAuth.includes('normalized.length > MAX_AUTH_EMAIL_LENGTH'));
check('shared limiter supports explicit fail-closed mode', limiter.includes('failClosed?: boolean') && limiter.includes('if (options.failClosed)') && limiter.includes('return { allowed: false, retryAfterSeconds }'));
check('critical auth limiter always requests fail-closed mode', auth.includes("allowPersistentRateLimit(scope, key, limit, windowMs, { failClosed: true })"));
check('session endpoint rejects non-MIU authenticated identities', auth.includes('!sessionData.user || !isMiuEmail(sessionData.user.email)'));
check('verification has an account-wide email bucket', auth.includes("'auth_verify_email', trimmedEmail"));
check('resend verification has an account-wide email bucket', auth.includes("'auth_resend_email', trimmedEmail"));
check('forgot-password has an account-wide email bucket', auth.includes("'auth_reset_email', trimmedEmail"));
check('sensitive reauthentication is both account- and IP-scoped', auth.includes("'auth_reauth_user', userId") && auth.includes("'auth_reauth_ip', `${userId}:${ip}`"));
check('password inputs are capped at 128 characters', auth.includes('password.length > 128') && auth.includes('newPassword.length > 128'));
check('signup names are bounded and reject control characters', auth.includes('studentName.length > 120') && auth.includes('/[\\u0000-\\u001F\\u007F]/.test(studentName)'));
check('2xx upstream error envelopes cannot be treated as success for password/email changes', auth.includes('!response.ok || data?.error') && auth.includes('if (!response.ok)') && auth.includes("if (!response.ok || data?.error) return res.status"));
check('account deletion cancellation requires password reauthentication', account.includes("app.post('/api/account/delete-cancel', requireAuth, persistentRateLimitMiddleware('account_delete_cancel'") && account.includes('Your current password is required to cancel account deletion.'));
check('account deletion reauthentication is account- and IP-scoped and fail-closed', account.includes("'auth_reauth_user', user.id") && account.includes("'auth_reauth_ip', `${user.id}:${ip}`") && account.includes('{ failClosed: true }'));
check('example configuration uses the actual Neon Auth variable', env.includes('NEON_AUTH_URL=') && !env.includes('NEON_AUTH_BASE_URL='));
check('unused admin/crontab secret controls are not advertised by the example', !env.includes('ADMIN_EMAILS=') && !env.includes('CRON_SECRET='));
check('no temporary pre-audit backup artifacts remain', !fs.readdirSync('.', { withFileTypes: true }).some((e) => e.name.endsWith('.pre_audit')));

console.log(`AUTH RED-TEAM HARDENING: ${checks.length}/${checks.length} passed`);
