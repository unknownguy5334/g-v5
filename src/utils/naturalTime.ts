import { timeToMinutes } from './optimizer';
import { formatTo12Hour } from './parser';

/**
 * Normalizes Eastern Arabic (0660-0669) and Persian (06F0-06F9) numerals to ASCII digits.
 */
export function normalizeDigits(raw: string): string {
  return String(raw || '')
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}

export interface NaturalTimeResult {
  time24: string; // "HH:MM" 24-hour format (e.g. "13:00", "09:30")
  ampm: 'AM' | 'PM';
  formatted12: string; // "1:00 PM", "9:30 AM"
  rawText: string;
}

export interface BareTimeResult {
  hours12: number; // 1 to 12
  minutes: number; // 0 to 59
  ampm: 'AM' | 'PM' | null; // null if bare/not specified by user
  formattedTimeOnly: string; // "8:30", "1:00", "11:30"
}

/**
 * Parses user typed input into time parts without forcing a default AM or PM.
 * Supports:
 * - "830" -> 8:30
 * - "1130" -> 11:30
 * - "100" -> 1:00
 * - "130" -> 1:30
 * - "8" -> 8:00
 * - "10" -> 10:00
 * - "8:30" -> 8:30
 * - "8.30" -> 8:30
 * - "830am" -> 8:30 with ampm: 'AM'
 * - "1pm" -> 1:00 with ampm: 'PM'
 * - "1430" / "14:30" -> 2:30 with ampm: 'PM' (24-hour time >= 13)
 */
export function parseBareTime(raw: string): BareTimeResult | null {
  if (!raw || !raw.trim()) return null;

  const clean = normalizeDigits(raw.trim()).toLowerCase();

  // Detect explicit AM / PM or Arabic equivalents
  let explicitAmPm: 'AM' | 'PM' | null = null;
  if (/(?:\b|[\d\s])(am|a\.m\.|a|ص)(?:\b|[\d\s]|$)/i.test(clean)) {
    explicitAmPm = 'AM';
  } else if (/(?:\b|[\d\s])(pm|p\.m\.|p|م)(?:\b|[\d\s]|$)/i.test(clean)) {
    explicitAmPm = 'PM';
  }

  // Strip letters and keep digits, colons, dots
  const digitStr = clean
    .replace(/(?:am|pm|a\.m\.|p\.m\.|[apصم])/gi, '')
    .replace(/[^\d:.]/g, '')
    .trim();

  if (!digitStr) return null;

  let h: number | null = null;
  let m = 0;

  if (digitStr.includes(':') || digitStr.includes('.')) {
    const sep = digitStr.includes(':') ? ':' : '.';
    const parts = digitStr.split(sep);
    if (parts.length >= 2) {
      const parsedH = Number(parts[0]);
      let parsedMStr = parts[1];
      if (parsedMStr.length === 1) {
        // e.g. "8:3" -> 30 minutes in informal typing
        parsedMStr = `${parsedMStr}0`;
      } else if (parsedMStr.length > 2) {
        parsedMStr = parsedMStr.slice(0, 2);
      }
      const parsedM = Number(parsedMStr);
      if (Number.isFinite(parsedH) && Number.isFinite(parsedM) && parsedH >= 0 && parsedH <= 24 && parsedM >= 0 && parsedM <= 59) {
        h = parsedH === 24 ? 0 : parsedH;
        m = parsedM;
      }
    }
  } else {
    // Pure numeric string
    const len = digitStr.length;
    if (len === 1 || len === 2) {
      // "8" -> 8:00, "10" -> 10:00, "12" -> 12:00
      const val = Number(digitStr);
      if (Number.isFinite(val) && val >= 0 && val <= 24) {
        h = val === 24 ? 0 : val;
        m = 0;
      }
    } else if (len === 3) {
      // "830" -> 8:30, "130" -> 1:30, "100" -> 1:00, "945" -> 9:45
      const parsedH = Number(digitStr.slice(0, 1));
      const parsedM = Number(digitStr.slice(1));
      if (Number.isFinite(parsedH) && Number.isFinite(parsedM) && parsedM >= 0 && parsedM <= 59) {
        h = parsedH;
        m = parsedM;
      }
    } else if (len === 4) {
      // "1130" -> 11:30, "1430" -> 14:30, "0830" -> 8:30
      const parsedH = Number(digitStr.slice(0, 2));
      const parsedM = Number(digitStr.slice(2));
      if (Number.isFinite(parsedH) && Number.isFinite(parsedM) && parsedH >= 0 && parsedH <= 24 && parsedM >= 0 && parsedM <= 59) {
        h = parsedH === 24 ? 0 : parsedH;
        m = parsedM;
      }
    }
  }

  if (h === null || !Number.isFinite(h) || !Number.isFinite(m)) {
    return null;
  }

  // Handle 24-hour time detection
  let finalAmPm = explicitAmPm;
  let hours12 = h;

  if (h >= 13 && h <= 23) {
    // 24-hour afternoon time (e.g. 13:00 -> 1:00 PM)
    finalAmPm = 'PM';
    hours12 = h - 12;
  } else if (h === 0) {
    finalAmPm = 'AM';
    hours12 = 12;
  } else if (h === 12) {
    hours12 = 12;
    // Keep explicitAmPm if user specified, otherwise null so user can choose
  } else {
    // 1 <= h <= 11: DO NOT default to AM or PM! Keep explicitAmPm (null if bare)
    hours12 = h;
  }

  const formattedTimeOnly = `${hours12}:${String(m).padStart(2, '0')}`;

  return {
    hours12,
    minutes: m,
    ampm: finalAmPm,
    formattedTimeOnly,
  };
}

/**
 * Builds a 24-hour "HH:MM" string from hours (1-12), minutes, and chosen AM/PM.
 */
export function buildTime24(hours12: number, minutes: number, ampm: 'AM' | 'PM'): string {
  let h = hours12;
  if (ampm === 'AM') {
    if (h === 12) h = 0;
  } else {
    if (h < 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Parses an existing 24-hour "HH:MM" string into display timeOnly ("8:30", "1:00") and ampm ("AM"|"PM").
 */
export function parseTime24(time24: string): { timeOnly: string; ampm: 'AM' | 'PM' } | null {
  if (!time24 || !time24.includes(':')) return null;
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;

  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;

  return {
    timeOnly: `${h12}:${String(m).padStart(2, '0')}`,
    ampm,
  };
}

export interface LiveFormattedResult {
  display: string;
  shouldFormat: boolean;
  ampm: 'AM' | 'PM' | null;
  hours12: number | null;
  minutes: number | null;
}

/**
 * Formats user input in real-time as they type.
 * Examples:
 * - "130" -> formats live to "1:30"
 * - "830" -> formats live to "8:30"
 * - "1130" -> formats live to "11:30"
 * - "1000" -> formats live to "10:00"
 * - "1430" -> formats live to "2:30" (PM)
 * - "1:30" -> formats live to "1:30"
 */
export function getLiveFormattedDisplay(raw: string): LiveFormattedResult {
  if (!raw || !raw.trim()) {
    return { display: '', shouldFormat: false, ampm: null, hours12: null, minutes: null };
  }

  const clean = normalizeDigits(raw.trim()).toLowerCase();

  // Detect explicit AM/PM
  let explicitAmPm: 'AM' | 'PM' | null = null;
  if (/(?:\b|[\d\s])(am|a\.m\.|a|ص)(?:\b|[\d\s]|$)/i.test(clean)) {
    explicitAmPm = 'AM';
  } else if (/(?:\b|[\d\s])(pm|p\.m\.|p|م)(?:\b|[\d\s]|$)/i.test(clean)) {
    explicitAmPm = 'PM';
  }

  const digits = clean.replace(/[^\d]/g, '');

  // 1. User typed colon or dot separator
  if (clean.includes(':') || clean.includes('.')) {
    const sep = clean.includes(':') ? ':' : '.';
    const parts = clean.replace(/[^\d:.]/g, '').split(sep);
    if (parts.length >= 2 && parts[1].length >= 2) {
      const parsed = parseBareTime(clean);
      if (parsed) {
        return {
          display: parsed.formattedTimeOnly,
          shouldFormat: true,
          ampm: parsed.ampm || explicitAmPm,
          hours12: parsed.hours12,
          minutes: parsed.minutes,
        };
      }
    }
    return { display: raw, shouldFormat: false, ampm: explicitAmPm, hours12: null, minutes: null };
  }

  // 2. Pure digits without separator:
  // 3-digit times:
  // First digit 2-9 (e.g. "830" -> 8:30, "230" -> 2:30, "945" -> 9:45)
  // First digit 1 and second digit >= 3 (e.g. "130" -> 1:30, "145" -> 1:45, "150" -> 1:50)
  if (digits.length === 3) {
    const first = Number(digits[0]);
    const second = Number(digits[1]);
    const minutes = Number(digits.slice(1));

    if ((first >= 2 && first <= 9) || (first === 1 && second >= 3)) {
      if (minutes >= 0 && minutes <= 59) {
        return {
          display: `${first}:${String(minutes).padStart(2, '0')}`,
          shouldFormat: true,
          ampm: explicitAmPm,
          hours12: first,
          minutes,
        };
      }
    }
  }

  // 4-digit times:
  // (e.g. "1130" -> 11:30, "1000" -> 10:00, "1230" -> 12:30, "1430" -> 2:30 PM, "0830" -> 8:30)
  if (digits.length === 4) {
    const h = Number(digits.slice(0, 2));
    const m = Number(digits.slice(2));
    if (h >= 0 && h <= 24 && m >= 0 && m <= 59) {
      let h12 = h;
      let ampm = explicitAmPm;
      if (h >= 13 && h <= 23) {
        ampm = 'PM';
        h12 = h - 12;
      } else if (h === 0) {
        ampm = 'AM';
        h12 = 12;
      } else if (h > 12) {
        h12 = h - 12;
      }
      if (h12 === 0) h12 = 12;

      return {
        display: `${h12}:${String(m).padStart(2, '0')}`,
        shouldFormat: true,
        ampm,
        hours12: h12,
        minutes: m,
      };
    }
  }

  // If explicit AM/PM was typed even on shorter inputs (e.g. "1pm", "8am")
  if (explicitAmPm && digits.length >= 1 && digits.length <= 2) {
    const parsed = parseBareTime(clean);
    if (parsed) {
      return {
        display: parsed.formattedTimeOnly,
        shouldFormat: true,
        ampm: explicitAmPm,
        hours12: parsed.hours12,
        minutes: parsed.minutes,
      };
    }
  }

  return { display: raw, shouldFormat: false, ampm: explicitAmPm, hours12: null, minutes: null };
}

/**
 * Parses user-typed natural time with university schedule context and smart AM/PM inference.
 *
 * Rules:
 * - "1:00" -> 1:00 PM (13:00) when schedule/university context indicates afternoon.
 * - "10:00" -> 10:00 AM (10:00) when schedule/university context indicates morning.
 * - If this is an End Time and Start Time is e.g. 11:30 AM, "1:00" is automatically inferred as 1:00 PM (13:00).
 * - Explicit AM/PM (e.g. "1:00 PM", "10am", "2:30pm") is always respected.
 * - 24-hour time (e.g. "13:00", "14:30") is preserved as PM.
 */
export function parseNaturalTime(
  raw: string,
  context?: { isEnd?: boolean; start24?: string | null; forcedAmPm?: 'AM' | 'PM' | null }
): NaturalTimeResult | null {
  if (!raw || !raw.trim()) return null;

  let clean = normalizeDigits(raw.trim()).replace(/\s+/g, ' ');

  // Look for explicit AM / PM or Arabic equivalent
  const explicitAmMatch = /(?:\b|[\d\s])(am|a\.m\.|a|ص)(?:\b|[\d\s]|$)/i.exec(clean);
  const explicitPmMatch = /(?:\b|[\d\s])(pm|p\.m\.|p|م)(?:\b|[\d\s]|$)/i.exec(clean);
  const hasExplicitAm = Boolean(explicitAmMatch);
  const hasExplicitPm = Boolean(explicitPmMatch);

  // Remove explicit markers to parse digits cleanly
  const digitStr = clean
    .replace(/(?:am|pm|a\.m\.|p\.m\.|[apصم])/gi, '')
    .replace(/[^\d:.]/g, '')
    .trim();

  if (!digitStr) return null;

  let hours: number | null = null;
  let minutes = 0;

  // Pattern: "H:MM" or "HH:MM" or "H.MM"
  if (digitStr.includes(':') || digitStr.includes('.')) {
    const sep = digitStr.includes(':') ? ':' : '.';
    const parts = digitStr.split(sep);
    if (parts.length >= 2) {
      const h = Number(parts[0]);
      const m = Number(parts[1].slice(0, 2));
      if (Number.isFinite(h) && Number.isFinite(m) && m >= 0 && m <= 59) {
        hours = h;
        minutes = m;
      }
    }
  } else {
    // Pure digits: "1", "10", "130", "1130", "1400", "230"
    const num = Number(digitStr);
    if (Number.isFinite(num)) {
      if (digitStr.length === 1 || digitStr.length === 2) {
        // "1" -> 1:00, "10" -> 10:00, "14" -> 14:00
        if (num >= 0 && num <= 24) {
          hours = num === 24 ? 0 : num;
          minutes = 0;
        }
      } else if (digitStr.length === 3) {
        // "130" -> 1:30, "230" -> 2:30, "930" -> 9:30
        const h = Number(digitStr.slice(0, 1));
        const m = Number(digitStr.slice(1));
        if (m >= 0 && m <= 59) {
          hours = h;
          minutes = m;
        }
      } else if (digitStr.length === 4) {
        // "1130" -> 11:30, "1430" -> 14:30, "1000" -> 10:00
        const h = Number(digitStr.slice(0, 2));
        const m = Number(digitStr.slice(2));
        if (h >= 0 && h <= 24 && m >= 0 && m <= 59) {
          hours = h === 24 ? 0 : h;
          minutes = m;
        }
      }
    }
  }

  if (hours === null || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  // Determine AM/PM
  let ampm: 'AM' | 'PM' = 'AM';

  if (context?.forcedAmPm) {
    ampm = context.forcedAmPm;
    if (ampm === 'PM') {
      if (hours < 12) hours += 12;
    } else {
      if (hours === 12) hours = 0;
      else if (hours > 12) hours -= 12;
    }
  } else if (hasExplicitAm) {
    ampm = 'AM';
    if (hours === 12) hours = 0;
    else if (hours > 12) return null;
  } else if (hasExplicitPm) {
    ampm = 'PM';
    if (hours < 12) hours += 12;
    else if (hours > 23) return null;
  } else if (hours >= 13 && hours <= 23) {
    // 24-hour time naturally in PM
    ampm = 'PM';
  } else if (hours === 0) {
    ampm = 'AM';
  } else if (hours === 12) {
    // 12 without explicit AM/PM is noon (PM)
    ampm = 'PM';
  } else if (hours >= 1 && hours <= 11) {
    // Surrounding context inference:
    // 1. Is this an End Time paired with a Start Time?
    if (context?.isEnd && context.start24) {
      const startMinutes = timeToMinutes(context.start24);
      if (Number.isFinite(startMinutes)) {
        const optionAmMinutes = (hours === 12 ? 0 : hours) * 60 + minutes;
        const optionPmMinutes = (hours === 12 ? 12 : hours + 12) * 60 + minutes;

        // If start is in PM (>= 12:00 = 720 mins), end must be PM
        if (startMinutes >= 12 * 60) {
          ampm = 'PM';
          hours = hours < 12 ? hours + 12 : hours;
        }
        // If start is in AM (< 720 mins):
        // If option AM is <= start (e.g. start is 11:30 AM, end typed as 1:00 -> 1:00 AM < 11:30 AM),
        // then end MUST be PM!
        else if (optionAmMinutes <= startMinutes) {
          ampm = 'PM';
          hours = hours < 12 ? hours + 12 : hours;
        } else {
          // Both option AM and PM are after start (e.g. start is 9:00 AM, end typed as 10:30).
          // Class duration in AM = 10:30 - 9:00 = 90 mins (realistic class).
          // Class duration in PM = 22:30 - 9:00 = 13.5 hours (unrealistic).
          // If option AM yields duration <= 4 hours (240 mins), choose AM!
          const durationAm = optionAmMinutes - startMinutes;
          if (durationAm > 0 && durationAm <= 240) {
            ampm = 'AM';
          } else {
            ampm = 'PM';
            hours = hours < 12 ? hours + 12 : hours;
          }
        }
      } else {
        // Fall back to university hours heuristic
        ampm = inferUniversityAmPm(hours);
        if (ampm === 'PM' && hours < 12) hours += 12;
      }
    } else {
      // Start time or standalone: University hours heuristic
      ampm = inferUniversityAmPm(hours);
      if (ampm === 'PM' && hours < 12) hours += 12;
    }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  const time24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const formatted12 = formatTo12Hour(time24);

  return {
    time24,
    ampm,
    formatted12,
    rawText: raw,
  };
}

/**
 * Standard university schedule AM/PM heuristic:
 * - Hours 8, 9, 10, 11 default to AM (e.g. 10:00 -> 10:00 AM)
 * - Hours 12, 1, 2, 3, 4, 5, 6, 7 default to PM (e.g. 1:00 -> 1:00 PM, 2:30 -> 2:30 PM)
 */
function inferUniversityAmPm(hour: number): 'AM' | 'PM' {
  if (hour >= 8 && hour <= 11) return 'AM';
  return 'PM';
}

/**
 * Toggles the AM/PM of a 24-hour time string ("HH:MM").
 */
export function toggleTimeAmPm(time24: string, target?: 'AM' | 'PM'): string {
  if (!time24 || !time24.includes(':')) return time24;
  const [hStr, mStr] = time24.split(':');
  let h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time24;

  const currentAmPm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  const newAmPm = target || (currentAmPm === 'AM' ? 'PM' : 'AM');

  if (newAmPm === currentAmPm) return time24;

  if (newAmPm === 'PM') {
    if (h < 12) h += 12;
  } else {
    if (h >= 12) h -= 12;
  }

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Formats a 24-hour "HH:MM" string for display, e.g. "1:00 PM"
 */
export function formatDisplayTime(time24: string): string {
  if (!time24) return '';
  return formatTo12Hour(time24);
}
