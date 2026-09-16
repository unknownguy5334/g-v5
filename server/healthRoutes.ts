import type { Express, Request, Response } from 'express';
import { testDbConnection } from './db';
import { getServerConfig } from './config';
import { fetchWithTimeout } from './upstream';
import { requireAdmin } from './authMiddleware';

let readinessCache: { expiresAt: number; payload: any; statusCode: number } | null = null;
let readinessInFlight: Promise<{ payload: any; statusCode: number }> | null = null;

async function testGeminiReachability(): Promise<{ status: 'ok' | 'unavailable' | 'unconfigured'; latencyMs?: number }> {
  const config = getServerConfig();
  if (!config.geminiApiKey) return { status: 'unconfigured' };
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      {
        timeoutMs: 3000,
        headers: { 'Accept': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      },
    );
    return { status: response.ok ? 'ok' : 'unavailable', latencyMs: Date.now() - started };
  } catch {
    return { status: 'unavailable', latencyMs: Date.now() - started };
  }
}


async function testNeonAuthReachability(): Promise<{ status: 'ok' | 'unavailable' | 'unconfigured'; latencyMs?: number }> {
  const config = getServerConfig();
  const authBase = config.neonAuthUrl?.trim();
  if (!authBase) return { status: 'unconfigured' };
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(`${authBase.replace(/\/$/, '')}/get-session`, {
      timeoutMs: 3000,
      headers: { 'Accept': 'application/json', ...(config.appOrigin ? { Origin: config.appOrigin } : {}) },
    });
    // A reachable Neon Auth endpoint may return an unauthenticated 200/401/403;
    // transport/server failures are the actual dependency outage.
    const reachable = response.status >= 200 && response.status < 500;
    return { status: reachable ? 'ok' : 'unavailable', latencyMs: Date.now() - started };
  } catch {
    return { status: 'unavailable', latencyMs: Date.now() - started };
  }
}

async function getReadiness(): Promise<{ payload: any; statusCode: number }> {
  if (readinessCache && readinessCache.expiresAt > Date.now()) return readinessCache;
  if (readinessInFlight) return readinessInFlight;
  readinessInFlight = (async () => {
  const config = getServerConfig();
  const db = await testDbConnection();
  const gemini = await testGeminiReachability();
  const neonAuth = await testNeonAuthReachability();
  const proxyOk = config.nodeEnv !== 'production' || config.directDeployment || config.trustedProxyCidrs.length > 0;
  const neonAuthOk = config.deploymentEnv === 'production' ? neonAuth.status === 'ok' : neonAuth.status !== 'unavailable';
  const ready = db.ok && gemini.status === 'ok' && neonAuthOk && proxyOk;
  const result = {
    payload: {
      status: ready ? 'ok' : 'degraded',
      ready,
      // Internal dependencies obscured for security
    },
    statusCode: ready ? 200 : 503,
  };
  readinessCache = { ...result, expiresAt: Date.now() + 10_000 };
  return result;
  })();
  try { return await readinessInFlight; } finally { readinessInFlight = null; }
}

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    const result = await getReadiness();
    res.status(result.statusCode).json(result.payload);
  });

  app.get(['/health/ready', '/api/health/ready'], async (_req: Request, res: Response) => {
    const result = await getReadiness();
    res.status(result.statusCode).json(result.payload);
  });

  app.get(['/health/neon-auth', '/api/health/neon-auth'], requireAdmin, async (_req: Request, res: Response) => {
    const result = await testNeonAuthReachability();
    const status = result.status === 'ok' ? 200 : result.status === 'unconfigured' ? 503 : 502;
    res.status(status).json({ status: result.status });
  });

  app.get(['/health/db', '/api/health/db'], requireAdmin, async (_req: Request, res: Response) => {
    const testResult = await testDbConnection();
    if (testResult.ok) {
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(testResult.message.includes('not configured') ? 503 : 500).json({ status: 'error' });
    }
  });
}
