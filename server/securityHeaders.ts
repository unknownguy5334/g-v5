import type { Request, Response, NextFunction } from 'express';
import { getServerConfig } from './config';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const config = getServerConfig();
  const isProduction = config.nodeEnv === 'production';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  const connectSources = "'self' ws: wss: http: https: https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com";
  const frameAncestors = "'self' https://*.google.com https://*.google.corp https://*.aistudio.google.com https://aistudio.google.com https://*.run.app *";
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://accounts.google.com https://accounts.google.com/gsi/client https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "img-src 'self' data: blob: https: https://*.googleusercontent.com",
    "font-src 'self' data: https:",
    `connect-src ${connectSources}`,
    "frame-src 'self' https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "worker-src 'self' blob:",
  ].join('; '));
  if (req.path.startsWith('/api/')) {
    res.removeHeader('ETag');
  }
  if (req.path === '/health' || req.path === '/healthz' || req.path === '/health/ready' || req.path === '/health/neon-auth' || req.path === '/health/db' || req.path === '/api/health' || req.path === '/api/health/live' || req.path === '/api/health/ready' || req.path === '/api/health/neon-auth' || req.path === '/api/health/db') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
