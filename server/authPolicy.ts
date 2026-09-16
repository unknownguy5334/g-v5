export const MIU_DOMAIN_SUFFIX = '@miuegypt.edu.eg';
export const MAX_AUTH_EMAIL_LENGTH = 160;

export function isMiuEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.length > MAX_AUTH_EMAIL_LENGTH) return false;
  if (!normalized.endsWith(MIU_DOMAIN_SUFFIX)) return false;
  const localPart = normalized.slice(0, -MIU_DOMAIN_SUFFIX.length);
  return localPart.length > 0 && /^[a-z0-9._%+-]+$/.test(localPart);
}
