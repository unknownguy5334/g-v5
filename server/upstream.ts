/**
 * Resilient wrapper for outbound HTTP calls to third-party services.
 * Always bounds the wait so a stalled provider cannot hold a request forever.
 */
export class UpstreamTimeoutError extends Error {
  readonly code = 'UPSTREAM_TIMEOUT';
  readonly retryable = true;
  constructor(message = 'Upstream service timed out.') {
    super(message);
    this.name = 'UpstreamTimeoutError';
  }
}

export interface UpstreamFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: UpstreamFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 8_000, signal: parentSignal, redirect: _redirect, ...init } = options;
  // Server-side outbound requests must never follow an unvalidated redirect to an
  // internal or otherwise unintended destination. Callers use fixed allowlisted hosts.
  const outboundInit: RequestInit = { ...init, redirect: 'error' };
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    return await fetch(input, { ...outboundInit, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new UpstreamTimeoutError();
    if (parentSignal?.aborted) throw error;
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

