import crypto from 'node:crypto';
import { getServerConfig } from './config';

export interface ServerMetric {
  name: string;
  value: number;
  path?: string;
  timestamp?: string;
}

export function recordServerMetric(metric: ServerMetric): void {
  // In development or production, metrics can be collected or logged
  const config = getServerConfig();
  if (config.nodeEnv !== 'production' && config.debugMetrics) {
    console.debug(`[Telemetry] ${metric.name}: ${metric.value} (path: ${metric.path || '/'})`);
  }
}

export function hashIp(ip: string): string {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export function structuredServerLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  meta?: Record<string, unknown>
): void {
  let releaseVersion = process.env.GADWAL_RELEASE || process.env.K_REVISION || process.env.GAE_VERSION || 'local';
  try { releaseVersion = getServerConfig().releaseVersion; } catch { /* startup failure before config initialization */ }
  const logEntry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    severity: level === 'debug' ? 'DEBUG' : level.toUpperCase(),
    level,
    message,
    serviceContext: { service: 'gadwal', version: releaseVersion },
    ...meta,
  };
  if (level === 'error' && typeof meta?.stack === 'string') {
    logEntry['@type'] = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';
  }
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}
