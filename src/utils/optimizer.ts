export const DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
export const ALL_DAYS: Array<typeof DAYS[number]> = [...DAYS];

export function timeToMinutes(timeStr: string | null | undefined): number {
  if (!timeStr) return NaN;
  const t = timeStr.trim().toLowerCase();
  const isPM = t.includes('pm') || t.includes('p.m.');
  const isAM = t.includes('am') || t.includes('a.m.');
  const cleanStr = t.replace(/[a-z.]/g, '').trim();
  const parts = cleanStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (isNaN(hours) || isNaN(minutes)) return NaN;
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function formatTime12(timeStr: string): string {
  const mins = timeToMinutes(timeStr);
  if (isNaN(mins)) return timeStr;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
