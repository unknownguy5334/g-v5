/** Development-only client diagnostics. Never retain raw exception objects in production browser consoles. */
export function devLogError(label: string): void {
  if (import.meta.env.DEV && typeof console !== 'undefined') console.error(label);
}

export function devLogWarn(label: string): void {
  if (import.meta.env.DEV && typeof console !== 'undefined') console.warn(label);
}

export function devLogDebug(label: string, metadata?: unknown): void {
  if (import.meta.env.DEV && typeof console !== 'undefined') console.debug(label, metadata ?? '');
}
