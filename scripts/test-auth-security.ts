import fs from 'node:fs';
import path from 'node:path';
import { isMiuEmail } from '../server/authPolicy.js';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function source(file: string) {
  return fs.readFileSync(path.resolve(file), 'utf8');
}

console.log('--- AUTH SECURITY STATIC TESTS ---');
assert(isMiuEmail('student@miuegypt.edu.eg'), 'Valid MIU email should pass');
assert(!isMiuEmail('student@gmail.com'), 'Non-MIU email should fail');
assert(!isMiuEmail('@miuegypt.edu.eg'), 'Empty local part should fail');
assert(isMiuEmail('a.b+test@miuegypt.edu.eg'), 'Valid MIU local part should pass');

const middleware = source('server/authMiddleware.ts');
const studentProfile = source('server/services/studentProfile.ts');
const clientAuth = source('src/types/auth.ts');
assert(!middleware.includes('youssef2409621@miuegypt.edu.eg'), 'Admin email must not be hard-coded in auth middleware');
assert(!studentProfile.includes('youssef2409621@miuegypt.edu.eg'), 'Admin email must not be hard-coded in student profile service');
assert(clientAuth.includes("return user.role === 'ADMIN';"), 'Client admin check must rely on role only');

const authRoutes = source('server/authRoutes.ts');
assert(authRoutes.includes('/email-otp/verify-email'), 'Verification must use the real Neon/Better Auth OTP endpoint');
assert(authRoutes.includes('emailVerified !== true'), 'Verification must confirm the real database verification state');
console.log('PASS auth security static checks');
