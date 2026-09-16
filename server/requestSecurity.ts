import type { NextFunction, Request, Response } from 'express';
import { getServerConfig } from './config';

function isOriginAllowed(origin: string, req: Request): boolean {
  const config = getServerConfig();
  const configured = config.allowedOrigins.map((value) => value.replace(/\/$/, ''));
  const normalizedOrigin = origin.replace(/\/$/, '');
  if (configured.includes(normalizedOrigin)) return true;

  // In production, APP_ORIGIN / ALLOWED_ORIGINS are the only trusted browser origins.
  // Never reflect Host or X-Forwarded-Host into the CSRF trust decision: forwarded-host
  // headers are attacker-controlled unless a trusted proxy has already normalized them.
  if (config.nodeEnv === 'production') return false;

  let originHostname = '';
  try {
    originHostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Non-production deployments still need an explicit browser trust boundary.
  // Local development may use only the exact Vite/backend loopback origins below;
  // staging/custom deployments must declare ALLOWED_ORIGINS/APP_ORIGIN rather than
  // accepting arbitrary attacker-controlled Origin headers.
  if (config.nodeEnv !== 'production') {
    if (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') return true;
    return false;
  }
  return false;
}

export function resolveAuthoritativeOrigin(req: Request): string {
  const config = getServerConfig();
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (configuredOrigin && /^https?:\/\//i.test(configuredOrigin)) {
    return configuredOrigin.replace(/\/$/, '');
  }

  const originHeader = req.get('origin')?.trim();
  if (originHeader && isOriginAllowed(originHeader, req)) {
    return originHeader.replace(/\/$/, '');
  }

  const referer = req.get('referer')?.trim();
  if (referer) {
    try {
      const parsedOrigin = new URL(referer).origin;
      if (isOriginAllowed(parsedOrigin, req)) {
        return parsedOrigin.replace(/\/$/, '');
      }
    } catch {
      // Ignore URL parse error
    }
  }

  // Outside production we may derive a development origin from the request host.
  // Production always has APP_ORIGIN validated by loadServerConfig, so reaching this
  // fallback there would indicate invalid initialization rather than a trusted origin.
  if (config.nodeEnv !== 'production') {
    const hostHeader = req.get('host')?.split(',')[0].trim();
    if (hostHeader) {
      const rawProto = (req.protocol || 'https').split(',')[0].trim();
      const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : 'https';
      const candidate = `${proto}://${hostHeader}`;
      if (isOriginAllowed(candidate, req)) {
        return candidate.replace(/\/$/, '');
      }
    }
    return 'http://localhost:3000';
  }

  return config.appOrigin.replace(/\/$/, '');
}

export function enforceSameOriginForStateChanges(req: Request, res: Response, next: NextFunction) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();

  const config = getServerConfig();
  const origin = req.get('origin');
  const referer = req.get('referer');

  // Browser requests should carry Origin. Reject explicit cross-origin requests.
  if (origin) {
    if (!isOriginAllowed(origin, req)) {
      return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'ORIGIN_REJECTED' });
    }
    return next();
  }

  // For browser-like requests without Origin, validate Referer when present.
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (!isOriginAllowed(refererOrigin, req)) {
        return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'ORIGIN_REJECTED' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.', code: 'ORIGIN_REJECTED' });
    }
  }

  // A state-changing request carrying a session cookie but no Origin/Referer is not a
  // normal browser submission. In production, reject it rather than creating a CSRF
  // ambiguity. Non-browser API clients can use Authorization headers instead.
  if (config.nodeEnv === 'production' && req.headers.cookie && !req.headers.authorization) {
    return res.status(403).json({ error: 'Request origin could not be verified.', code: 'ORIGIN_REQUIRED' });
  }

  next();
}

export function publicServerError(status = 500) {
  return { status, error: 'Something went wrong. Please try again later.', code: 'INTERNAL_ERROR' };
}
