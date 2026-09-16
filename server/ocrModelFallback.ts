import { MODEL_REGISTRY } from './ocrModels';
import type { ThinkingLevel } from '@google/genai';
import { callOcrModelWithRetry } from '../src/utils/ocrApiContract';

export interface OcrModelAttemptContext {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface OcrFallbackResult<T> {
  value: T;
  modelId: string;
}

/**
 * Known-good v35 OCR fallback behavior.
 * Each model receives the same bounded 35s request timeout and the retry helper
 * only retries transient rate-limit failures, then falls through the ordered registry.
 */
export async function runOcrWithModelFallback<T>(options: {
  parentSignal?: AbortSignal;
  multi: boolean;
  execute: (ctx: OcrModelAttemptContext, signal: AbortSignal) => Promise<unknown>;
  parse: (raw: unknown, modelId: string) => T | null;
  onModelFailure?: (modelId: string, error: unknown) => void;
}): Promise<OcrFallbackResult<T> | null> {
  let lastError: unknown = null;
  for (const model of MODEL_REGISTRY) {
    if (options.parentSignal?.aborted) throw new Error('CLIENT_ABORTED');
    try {
      const response = await callOcrModelWithRetry(
        (signal) => options.execute({ modelId: model.id, thinkingLevel: options.multi ? model.multi : model.single }, signal),
        { timeoutMs: 35_000, parentSignal: options.parentSignal },
      );
      const parsed = options.parse(response, model.id);
      if (parsed !== null) return { value: parsed, modelId: model.id };
    } catch (error) {
      if (options.parentSignal?.aborted || (error instanceof Error && error.message === 'CLIENT_ABORTED')) {
        throw new Error('CLIENT_ABORTED');
      }
      lastError = error;
      options.onModelFailure?.(model.id, error);
    }
  }
  if (lastError) throw lastError;
  return null;
}
