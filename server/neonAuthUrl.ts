/**
 * Neon Auth Base URL and helper utility.
 * Derives the Managed Better Auth URL from DATABASE_URL.
 */

function isAllowedNeonAuthUrl(value: string, allowLocalhost: boolean): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.port) return false;
    if (parsed.protocol === 'http:' && allowLocalhost && parsed.hostname === 'localhost') {
      return /^\/[^?#]*\/auth$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
    }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'localhost') return false;
    const hostAllowed = /^(ep-[a-z0-9-]+)\.neonauth\.(?:(c-[a-z0-9-]+)\.)?([a-z0-9-]+\.aws\.neon\.tech)$/.test(parsed.hostname.toLowerCase());
    if (!hostAllowed) return false;
    return /^\/[^?#]*\/auth$/.test(parsed.pathname) && !parsed.search && !parsed.hash;
  } catch { return false; }
}

export function deriveNeonAuthBaseUrl(dbUrl?: string): string | null {
  const explicit = String(process.env.NEON_AUTH_URL || '').trim();
  if (explicit) {
    try {
      const allowLocalhost = process.env.NODE_ENV !== 'production' && String(process.env.GADWAL_ENV || '').trim().toLowerCase() !== 'production';
      if (!isAllowedNeonAuthUrl(explicit, allowLocalhost)) return null;
      return explicit.replace(/\/$/, '');
    } catch { return null; }
  }
  const urlStr = dbUrl || process.env.DATABASE_URL;
  if (!urlStr || typeof urlStr !== 'string') return null;

  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname;
    // Format: ep-[endpoint-id](-pooler).[optional cell.][region].aws.neon.tech
    const match = host.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\.(?:(c-[a-z0-9-]+)\.)?([a-z0-9-]+\.aws\.neon\.tech)$/);
    if (!match) return null;

    const [, endpointId, cell, regionDomain] = match;
    const dbName = parsed.pathname.replace(/^\//, '').split('?')[0] || 'neondb';
    const middle = cell ? `neonauth.${cell}.${regionDomain}` : `neonauth.${regionDomain}`;
    return `https://${endpointId}.${middle}/${dbName}/auth`;
  } catch {
    return null;
  }
}
