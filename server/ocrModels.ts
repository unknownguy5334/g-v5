import { ThinkingLevel } from '@google/genai';

// Known-good v35 OCR model order. Keep this order and thinking level behavior stable.
export const MODEL_REGISTRY = [
  { id: 'gemini-flash-lite-latest', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.5-flash-lite', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.7-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3-flash-preview', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-flash-latest', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.5-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.1-flash-lite', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.6-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
  { id: 'gemini-3.8-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW },
] as const;

export const MODEL_REGISTRY_MAP = new Map<string, (typeof MODEL_REGISTRY)[number]>(MODEL_REGISTRY.map((model) => [model.id, model]));
export const modelAllowed = (id: string): boolean => MODEL_REGISTRY_MAP.has(id);
