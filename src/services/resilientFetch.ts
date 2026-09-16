import { safeStorage } from '../utils/safeStorage';

export const GADWAL_AUTH_TOKEN_KEY = 'gadwal_auth_token_v1';

export function getStoredAuthToken(): string | null {
  return safeStorage.getItem(GADWAL_AUTH_TOKEN_KEY) || safeStorage.sessionGetItem(GADWAL_AUTH_TOKEN_KEY) || null;
}

export function setStoredAuthToken(token: string): void {
  if (!token) return;
  safeStorage.setItem(GADWAL_AUTH_TOKEN_KEY, token);
  safeStorage.sessionSetItem(GADWAL_AUTH_TOKEN_KEY, token);
}

export function clearStoredAuthToken(): void {
  safeStorage.removeItem(GADWAL_AUTH_TOKEN_KEY);
  safeStorage.sessionRemoveItem(GADWAL_AUTH_TOKEN_KEY);
}

export class NetworkTimeoutError extends Error {
  readonly code = 'NETWORK_TIMEOUT';
  readonly retryable = true;
  constructor(message = 'The request took too long. Please try again.') {
    super(message);
    this.name = 'NetworkTimeoutError';
  }
}

export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
}

export interface JsonResponse<T = any> {
  response: Response;
  data: T | Record<string, unknown>;
}

export async function fetchWithTimeout(input: RequestInfo | URL, options: FetchJsonOptions = {}): Promise<Response> {
  const { timeoutMs = 12_000, signal: parentSignal, ...init } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }

  const headers = new Headers(init.headers || {});
  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const credentials = init.credentials || 'include';

  try {
    const response = await fetch(input, { ...init, headers, credentials, signal: controller.signal });
    return response;
  } catch (error) {
    if (timedOut) throw new NetworkTimeoutError();
    if (parentSignal?.aborted) throw error;
    if (error instanceof TypeError) {
      throw new Error('Network connection failed. Please check your connection and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export async function readJson<T = any>(response: Response): Promise<T | Record<string, unknown>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {};
  }
  try {
    const data = await response.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function fetchJson<T = any>(input: RequestInfo | URL, options: FetchJsonOptions = {}): Promise<JsonResponse<T>> {
  const response = await fetchWithTimeout(input, options);
  const data = await readJson<T>(response);
  return { response, data };
}
