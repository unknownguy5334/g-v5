import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function read(rel:string){ return fs.readFileSync(path.join(root,rel),'utf8'); }
function assert(v:unknown,msg:string){ if(!v) throw new Error(msg); }

const auth = read('server/authMiddleware.ts');
const authRoutes = read('server/authRoutes.ts');
const server = read('server.ts');
const paymentRoutes = read('server/paymentRoutes.ts');
const paymentService = read('server/services/paymentService.ts');
const profileRoutes = read('server/profileRoutes.ts');
const studentProfile = read('server/services/studentProfile.ts');
const headers = read('server/securityHeaders.ts');
const config = read('server/config.ts');

assert(auth.includes('get-session'), 'Protected requests must verify Neon Auth sessions server-side.');
assert(!auth.includes(['x-gadwal','admin-token'].join('-')), 'Admin auth must not use the removed diagnostic token.');
assert(auth.includes("user.role !== 'ADMIN'"), 'Admin access must be role-based.');
assert(authRoutes.includes('/email-otp/verify-email'), 'Email verification must use Neon Auth OTP verification.');
assert(authRoutes.includes('emailVerified !== true'), 'Verification must be confirmed against the real Neon Auth user state.');
assert(!authRoutes.includes('token: parsed.token'), 'Sign-in should not expose provider auth tokens to the browser.');
assert(server.includes('requireAdmin, async (req, res)'), 'Diagnostic model discovery must require server-side admin auth.');
assert(server.includes('enforceSameOriginForStateChanges'), 'State-changing API requests must have same-origin protection.');
assert(headers.includes('X-Frame-Options'), 'Frame protection header is required.');
assert(headers.includes('Content-Security-Policy'), 'CSP is required.');
assert(headers.includes('isProduction ?'), 'Production CSP must differ from development CSP.');
assert(paymentRoutes.includes('isSupportedImageBuffer'), 'Payment proof must be validated by actual file signature.');
assert(paymentRoutes.includes('allowPersistentRateLimit') || paymentRoutes.includes('SlidingWindowRateLimiter'), 'Payment submission must be rate limited.');
assert(paymentService.includes('payment_submissions WHERE id=$1 FOR UPDATE'), 'Payment approval must use a transaction lock.');
assert(profileRoutes.includes('requireAuth'), 'Student profile/data routes must require authentication.');
assert(auth.includes("profile?.role === 'ADMIN' ? 'ADMIN' : 'STUDENT'"), 'Admin role must come from the stored student role, not hard-coded email.');
assert(!studentProfile.includes('youssef2409621@miuegypt.edu.eg'), 'Admin email must not be hard-coded in runtime authorization.');
assert(!config.includes('adminDiagnosticToken'), 'Diagnostic admin token configuration must be removed.');
console.log('PASS security hardening static checks');
