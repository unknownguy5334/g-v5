export interface SafeServerError {
  name: string;
  message: string;
  code?: string;
  status?: number;
  retryAfter?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}


function redactSensitiveText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export function serializeServerError(error: unknown): SafeServerError {
  if (error instanceof Error) {
    const record = error as Error & Record<string, unknown>;
    const status = typeof record.status === 'number' && Number.isFinite(record.status) ? record.status : undefined;
    const retryAfter = typeof record.retryAfter === 'number' && Number.isFinite(record.retryAfter) ? record.retryAfter : undefined;
    const code = typeof record.code === 'string' ? record.code.slice(0, 80) : typeof record.reasonCode === 'string' ? record.reasonCode.slice(0, 80) : undefined;
    return { name: error.name || 'Error', message: redactSensitiveText(error.message), code, status, retryAfter };
  }
  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? redactSensitiveText(error.message) : 'Unknown server error';
    const code = typeof error.code === 'string' ? error.code.slice(0, 80) : typeof error.reasonCode === 'string' ? error.reasonCode.slice(0, 80) : undefined;
    const status = typeof error.status === 'number' && Number.isFinite(error.status) ? error.status : undefined;
    const retryAfter = typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter) ? error.retryAfter : undefined;
    return { name: typeof error.name === 'string' ? error.name.slice(0, 80) : 'Error', message, code, status, retryAfter };
  }
  return { name: 'Error', message: typeof error === 'string' ? redactSensitiveText(error) : 'Unknown server error' };
}

export function knownPublicErrorMessage(error: unknown, fallback: string, allowedMessages: readonly string[]): string {
  const message = error instanceof Error ? error.message : isRecord(error) && typeof error.message === 'string' ? error.message : '';
  return allowedMessages.includes(message) ? message : fallback;
}
