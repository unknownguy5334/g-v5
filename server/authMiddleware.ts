import { Request, Response, NextFunction } from 'express';
import { deriveNeonAuthBaseUrl } from './neonAuthUrl';
import { getDbPool } from './db';
import { getOrCreateStudentProfile } from './services/studentProfile';
import { isMiuEmail } from './authPolicy';
import { fetchWithTimeout } from './upstream';

export interface AuthenticatedUser { id: string; name?: string; email: string; emailVerified: boolean; role: string; profile?: any; }

export async function authenticateRequest(req: Request): Promise<AuthenticatedUser | null> {
  const authBase = deriveNeonAuthBaseUrl();
  if (!authBase) return null;
  const headers: Record<string,string> = {};
  const origin = process.env.APP_ORIGIN?.trim();
  if (origin) headers['Origin'] = origin;
  if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
  try {
    const response = await fetchWithTimeout(`${authBase}/get-session`, { headers, timeoutMs: 6_000 });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.user?.id || !isMiuEmail(data.user.email)) return null;
    const pool = getDbPool();
    if (!pool) return null;
    const dbUser = await pool.query<{ emailVerified:boolean }>('SELECT "emailVerified" FROM neon_auth.user WHERE id=$1', [data.user.id]);
    const emailVerified = dbUser.rows.length > 0 && Boolean(dbUser.rows[0].emailVerified);
    if (!emailVerified) {
      return { id:data.user.id, name:data.user.name, email:String(data.user.email).trim().toLowerCase(), emailVerified:false, role:'STUDENT' };
    }
    const profile = await getOrCreateStudentProfile(data.user.id, data.user.email, data.user.name);
    return { id:data.user.id, name:data.user.name, email:String(data.user.email).trim().toLowerCase(), emailVerified:true, role:profile?.role === 'ADMIN' ? 'ADMIN' : 'STUDENT', profile };
  } catch { return null; }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req);
  if (!user) return res.status(401).json({ error:'Unauthorized', code:'UNAUTHORIZED' });
  if (!user.emailVerified) return res.status(403).json({ error:'Email verification is required to access this feature.', code:'UNVERIFIED' });
  (req as any).user = user; next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req);
  if (!user) return res.status(401).json({ error:'Authentication required for admin access', code:'UNAUTHORIZED' });
  if (!user.emailVerified) return res.status(403).json({ error:'Email verification is required for admin access.', code:'UNVERIFIED' });
  if (user.role !== 'ADMIN') return res.status(403).json({ error:'Forbidden: Admin access required', code:'FORBIDDEN' });
  (req as any).user = user; next();
}
