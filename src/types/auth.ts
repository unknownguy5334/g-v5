export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role?: string;
  profile?: {
    freeRunStatus?: 'available' | 'in-progress' | 'used';
    freeRunStartedAt?: string;
    freeRunCompletedAt?: string;
    [key: string]: any;
  };
}

export type AuthStatus = 'loading' | 'unauthenticated' | 'unverified' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
}

export const MIU_STUDENT_EMAIL_DOMAIN = '@miuegypt.edu.eg';
export const MAX_AUTH_EMAIL_LENGTH = 160;

/**
 * Client-side validator matching backend rule.
 */
export function isMiuStudentEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.length > MAX_AUTH_EMAIL_LENGTH || !normalized.endsWith(MIU_STUDENT_EMAIL_DOMAIN)) return false;
  const local = normalized.slice(0, -MIU_STUDENT_EMAIL_DOMAIN.length);
  return local.length > 0 && /^[a-z0-9._%+-]+$/.test(local);
}

export function isAdminUser(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role === 'ADMIN';
}
