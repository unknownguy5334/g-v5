import { OptimizerOutput, SchedulePreferences, Section } from '../types';

export interface OptimizerParams {
  courses: Record<string, Section[]>;
  fixedCourses: Section[];
  targetCredits?: number;
  preferences: SchedulePreferences;
  mode?: 'full' | 'estimate' | 'diagnostic';
  runId?: string;
}

const activeRequests = new Map<string, PendingRequest>();
const ownerRequests = new Map<PendingRequest['owner'], Set<string>>();
let requestSeq = 0;

interface PendingRequest {
  params: OptimizerParams;
  resolve: (value: OptimizerOutput) => void;
  reject: (reason: any) => void;
  cancelled: boolean;
  abortController: AbortController;
  owner: 'live-estimate' | 'user-run' | 'other';
}

export interface OptimizerTask {
  id: string;
  promise: Promise<OptimizerOutput>;
  cancel: () => void;
}

function removeOwnerRequest(id: string, request: PendingRequest) {
  activeRequests.delete(id);
  const ids = ownerRequests.get(request.owner);
  ids?.delete(id);
  if (ids && ids.size === 0) ownerRequests.delete(request.owner);
}

function cancelRequest(id: string) {
  const request = activeRequests.get(id);
  if (!request || request.cancelled) return;
  request.cancelled = true;
  request.abortController.abort();
  removeOwnerRequest(id, request);
  request.reject(new Error('Optimizer request cancelled.'));
}

function cancelOwner(owner: PendingRequest['owner']) {
  const ids = Array.from(ownerRequests.get(owner) || []);
  for (const id of ids) cancelRequest(id);
}

export function disposeOptimizerWorker(): void {
  for (const [id, request] of Array.from(activeRequests.entries())) {
    removeOwnerRequest(id, request);
    request.cancelled = true;
    request.abortController.abort();
    request.reject(new Error('Optimizer client disposed.'));
  }
}

export function cancelOptimizerOwner(owner: PendingRequest['owner']): void {
  cancelOwner(owner);
}

export function runOptimizerAsyncCancellable(
  params: OptimizerParams,
  options: { owner?: PendingRequest['owner']; cancelPreviousOwner?: boolean } = {}
): OptimizerTask {
  const owner = options.owner || 'other';
  if (options.cancelPreviousOwner) cancelOwner(owner);

  requestSeq++;
  const id = `req_${Date.now()}_${requestSeq}`;
  const abortController = new AbortController();

  const promise = new Promise<OptimizerOutput>((resolve, reject) => {
    const request: PendingRequest = { params, resolve, reject, cancelled: false, abortController, owner };
    activeRequests.set(id, request);
    if (!ownerRequests.has(owner)) ownerRequests.set(owner, new Set());
    ownerRequests.get(owner)!.add(id);

    fetch('/api/generate-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(params),
      signal: abortController.signal
    })
    .then(async (res) => {
      if (request.cancelled) return;
      if (!res.ok) {
        let errorMessage = 'Failed to generate schedules.';
        try {
          const errData = await res.json();
          if (errData.error) errorMessage = errData.error;
        } catch {
          // fallback to standard message
        }
        throw new Error(errorMessage);
      }
      return res.json();
    })
    .then((result) => {
      if (request.cancelled) return;
      removeOwnerRequest(id, request);
      resolve(result);
    })
    .catch((err) => {
      if (request.cancelled) return;
      removeOwnerRequest(id, request);
      reject(err);
    });
  });

  return { id, promise, cancel: () => cancelRequest(id) };}

export function runOptimizerAsync(params: OptimizerParams): Promise<OptimizerOutput> {
  return runOptimizerAsyncCancellable(params).promise;}
