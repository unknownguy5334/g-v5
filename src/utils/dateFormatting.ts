/**
 * Cross-browser, locale-aware formatting for timestamps persisted by Gadwal.
 * Values must be absolute timestamps (ISO strings or epoch milliseconds), not
 * browser-local date strings, so Safari/Firefox/Chromium interpret them the same way.
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Date unavailable';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    try {
      return date.toLocaleString();
    } catch {
      return date.toISOString();
    }
  }
}


export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Date unavailable';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  } catch {
    try { return date.toLocaleDateString(); } catch { return date.toISOString().slice(0, 10); }
  }
}
