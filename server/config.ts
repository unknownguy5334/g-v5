export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  deploymentEnv: 'development' | 'staging' | 'production';
  port: number;
  trustedProxyCidrs: string[];
  directDeployment: boolean;
  requireTrustedProxy: boolean;
  diagnosticModelsEnabled: boolean;
  ocrRateLimitPerMinute: number;
  ocrRateLimitWindowMs: number;
  maxSingleImageBytes: number;
  maxTotalImagesBytes: number;
  maxRawPayloadBytes: number;
  maxImagesPerRequest: number;
  maxImageDimension: number;
  maxImagePixels: number;
  maxGlobalConcurrentWork: number;
  allowExternalViteHost: boolean;
  debugMetrics: boolean;
  productionSourcemaps: boolean;
  frameAncestors: string;
  allowedOrigins: string[];
  geminiApiKey: string;
  databaseUrl: string;
  neonAuthUrl: string;
  appOrigin: string;
  releaseVersion: string;
}

function parsePort(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${raw}. PORT must be an integer from 1 to 65535.`);
  }
  return port;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Expected a positive integer, received: ${raw}`);
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected a boolean value ('true' or 'false'), received: ${raw}`);
}

let activeConfig: ServerConfig | null = null;

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const deploymentEnvRaw = String(env.GADWAL_ENV || nodeEnv).trim().toLowerCase();
  const deploymentEnv = deploymentEnvRaw === 'staging' ? 'staging' : deploymentEnvRaw === 'production' ? 'production' : 'development';
  const trustedProxyCidrs = String(env.TRUSTED_PROXY_CIDRS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const directDeployment = parseBoolean(env.DIRECT_DEPLOYMENT, true);
  const requireTrustedProxy = parseBoolean(env.REQUIRE_TRUSTED_PROXY, false);
  const appOrigin = String(env.APP_ORIGIN || '').trim();
  const geminiApiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim();
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const neonAuthUrl = String(env.NEON_AUTH_URL || '').trim();
  if (nodeEnv === 'production' && deploymentEnv !== 'production') throw new Error('GADWAL_ENV must be production when NODE_ENV=production.');
  if (deploymentEnv === 'production' && nodeEnv !== 'production') throw new Error('NODE_ENV must be production when GADWAL_ENV is production.');
  if (deploymentEnv === 'production') {
    if (!databaseUrl) throw new Error('DATABASE_URL is required in production.');
    if (!neonAuthUrl) throw new Error('NEON_AUTH_URL is required in production. Copy the branch auth URL from Neon Auth settings.');
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required in production.');
    if (!appOrigin || !/^https:\/\//i.test(appOrigin)) throw new Error('APP_ORIGIN must be an HTTPS URL in production.');
    if (requireTrustedProxy && trustedProxyCidrs.length === 0) {
      throw new Error('TRUSTED_PROXY_CIDRS must be configured for production proxy deployments. Set DIRECT_DEPLOYMENT=true only when the server is directly exposed.');
    }
  }

  return {
    nodeEnv,
    deploymentEnv,
    port: parsePort(env.PORT),
    trustedProxyCidrs,
    directDeployment,
    requireTrustedProxy,
    diagnosticModelsEnabled: parseBoolean(env.ENABLE_DIAGNOSTIC_MODELS_ENDPOINT, nodeEnv !== 'production'),
    ocrRateLimitPerMinute: parsePositiveInt(env.OCR_RATE_LIMIT_PER_MINUTE, 5),
    ocrRateLimitWindowMs: 60_000,
    maxSingleImageBytes: 15 * 1024 * 1024,
    maxTotalImagesBytes: 80 * 1024 * 1024,
    maxRawPayloadBytes: 80 * 1024 * 1024,
    maxImagesPerRequest: 30,
    maxImageDimension: 8_000,
    maxImagePixels: 40_000_000,
    maxGlobalConcurrentWork: 8,
    allowExternalViteHost: parseBoolean(env.ALLOW_EXTERNAL_VITE_HOST, nodeEnv !== 'production'),
    debugMetrics: parseBoolean(env.DEBUG_METRICS, false),
    productionSourcemaps: parseBoolean(env.PRODUCTION_SOURCEMAPS, false),
    frameAncestors: String(env.FRAME_ANCESTORS || "'self'").trim(),
    allowedOrigins: String(env.ALLOWED_ORIGINS || env.APP_ORIGIN || '').split(',').map((v) => v.trim()).filter(Boolean),
    geminiApiKey,
    databaseUrl,
    neonAuthUrl,
    appOrigin,
    releaseVersion: String(env.GADWAL_RELEASE || env.K_REVISION || env.GAE_VERSION || 'local').trim() || 'local',
  };
}

export function setServerConfig(config: ServerConfig): void { activeConfig = config; }
export function getServerConfig(): ServerConfig { if (!activeConfig) throw new Error('Server configuration has not been initialized.'); return activeConfig; }
