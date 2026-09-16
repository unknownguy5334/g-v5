import type { jsPDF } from 'jspdf';
import { devLogError, devLogWarn } from './clientLogger';
import { OptimizationResult, Section, Session, DayOfWeek } from '../types';
import { timeToMinutes, formatTime12 } from './optimizer';
import { getBrowserCapabilities } from './browserCapabilities';
import { DAY_ORDER, DAY_FULL_NAMES, assertExportableSchedule } from './exportCalendar';
import { formatCourseDisplay } from './courseUtils';
export { generateICS, downloadICS, downloadSingleScheduleIcs } from './exportCalendar';

// ----------------------------------------------------------------------
// 1. PLAIN-TEXT FORMATTERS
// ----------------------------------------------------------------------

interface DaySessionItem {
  day: DayOfWeek;
  dayName: string;
  start12: string;
  end12: string;
  startMin: number;
  endMin: number;
  courseName: string;
  rawCourseName: string;
  courseCode: string;
  courseId: string;
  credits: number | null;
  instructor?: string | null;
  type?: string;
}

export interface UniqueCourseItem {
  name: string;
  code: string;
  credits: number | null;
}

/**
 * Strips any course codes, department codes, section codes, and parenthetical codes from a course name,
 * ensuring ONLY the clean, pure course title (e.g. "Economics II") is returned.
 */
export function getPureCourseName(name?: string | null, code?: string | null): string {
  let clean = (name || '').trim();
  if (!clean && code) return code.trim();
  if (!clean) return 'Untitled Course';

  // 1. Remove parenthetical course codes at end: e.g. "Economics II (ECN20201)" -> "Economics II"
  clean = clean.replace(/\s*\([^)]*\)\s*$/, '').trim();

  // 2. Remove explicit code prefix if name starts with course code: e.g. "ECN20201 Economics II"
  if (code) {
    const cleanCode = code.trim();
    if (cleanCode && clean.toLowerCase().startsWith(cleanCode.toLowerCase())) {
      clean = clean.slice(cleanCode.length).replace(/^[\s\-–—:]+/, '').trim();
    }
  }

  // 3. Remove general alphanumeric course code prefixes: e.g. "BUS302 - Business Ethics" -> "Business Ethics"
  clean = clean.replace(/^[A-Za-z]{2,8}\s*[-_]?\s*\d{1,6}[A-Za-z0-9\-_]*\s*[-–—:]*\s*/i, (match) => {
    const remainder = clean.slice(match.length).trim();
    return remainder.length > 2 ? '' : match;
  }).trim();

  return clean || (name || code || 'Untitled Course').trim();
}

export function getUniqueScheduleCourses(schedule: OptimizationResult): UniqueCourseItem[] {
  const seen = new Set<string>();
  const list: UniqueCourseItem[] = [];

  for (const sec of schedule.sections) {
    const cleanName = getPureCourseName(sec.name, sec.courseCode);
    const cleanCode = (sec.courseCode || '').trim();
    const sectionCode = (sec.sectionCode || '').trim();
    const key = `${(sec.courseKey || cleanCode || cleanName).toLowerCase()}___${sectionCode.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push({
        name: cleanName,
        code: cleanCode || sectionCode,
        credits: sec.credits ?? null,
      });
    }
  }

  return list;
}

function formatWaitingTime(totalGapMinutes: number): string {
  if (!Number.isFinite(totalGapMinutes) || totalGapMinutes <= 0) return '0m';
  const hours = Math.floor(totalGapMinutes / 60);
  const mins = totalGapMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function getScheduleDaySessions(schedule: OptimizationResult): Record<DayOfWeek, DaySessionItem[]> {
  const grouped: Record<DayOfWeek, DaySessionItem[]> = {
    SUN: [],
    MON: [],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
  };

  for (const section of schedule.sections) {
    const credits = section.credits ?? null;
    const pureName = getPureCourseName(section.name, section.courseCode);
    for (const session of section.sessions) {
      if (grouped[session.day]) {
        grouped[session.day].push({
          day: session.day,
          dayName: DAY_FULL_NAMES[session.day] || session.day,
          start12: formatTime12(session.start),
          end12: formatTime12(session.end),
          startMin: timeToMinutes(session.start),
          endMin: timeToMinutes(session.end),
          courseName: pureName,
          rawCourseName: section.name || '',
          courseCode: section.courseCode || '',
          courseId: (section.sectionCode || '').trim(),
          credits,
          instructor: section.instructor || null,
          type: session.type,
        });
      }
    }
  }

  for (const day of DAY_ORDER) {
    grouped[day].sort((a, b) => a.startMin - b.startMin);
  }

  return grouped;
}

/**
 * Format a single schedule in clean plain text with zero markdown asterisks and no option strings.
 */
export function formatScheduleAsText(schedule: OptimizationResult, rank: number = 1): string {
  const total = Math.max(0, Math.round(schedule.totalGap));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const gapStr = total === 0 ? '0m total gap' : (hours > 0 ? `${hours}h${minutes ? ` ${minutes}m` : ''} total gap` : `${minutes}m total gap`);

  const lines: string[] = [];
  lines.push(`Schedule #${rank}`);
  lines.push(`Total Gap: ${gapStr}`);
  lines.push(`Days: ${schedule.numDays} ${schedule.numDays === 1 ? 'day' : 'days'}`);
  const cleanCourses = getCleanScheduleCourses(schedule);
  lines.push(`Courses: ${cleanCourses.length} ${cleanCourses.length === 1 ? 'course' : 'courses'}`);
  lines.push(`Total Credits: ${schedule.totalCredits} credits`);
  lines.push('');

  lines.push('Courses:');
  for (const c of cleanCourses) {
    const codeStr = c.code ? ` (${c.code})` : '';
    const creditStr = c.credits != null ? ` - ${c.credits} credits` : '';
    lines.push(`- ${c.name}${codeStr}${creditStr}`);
  }
  lines.push('');

  lines.push('Weekly Schedule:');
  const daySessions = getScheduleDaySessions(schedule);
  let hasAnySession = false;
  for (const day of DAY_ORDER) {
    const sessions = daySessions[day];
    if (sessions && sessions.length > 0) {
      hasAnySession = true;
      lines.push(`${DAY_FULL_NAMES[day]}:`);
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (i > 0) {
          const prev = sessions[i - 1];
          const gapMinutes = s.startMin - prev.endMin;
          if (gapMinutes > 0) {
            lines.push(`  [${gapMinutes} min gap between courses]`);
          }
        }
        const mType = s.type === 'Custom' ? (s.type || 'Custom') : (s.type || 'Lecture');
        lines.push(`  ${s.start12} to ${s.end12} - ${s.courseName} (${mType})`);
      }
      lines.push('');
    }
  }

  if (!hasAnySession) {
    lines.push('No scheduled course meetings.');
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Extract unique course registration codes / CRNs from a schedule.
 */
export function getScheduleRegistrationCodes(schedule: OptimizationResult): { code: string; courseName: string; credits: number | null }[] {
  const list: { code: string; courseName: string; credits: number | null }[] = [];
  const seen = new Set<string>();
  for (const sec of schedule.sections) {
    const rawCode = String(sec.sectionCode || '').trim();
    const dedupeKey = `${(sec.courseKey || sec.courseCode || sec.name || '').toLocaleLowerCase()}::${rawCode.toLocaleLowerCase()}`;
    if (rawCode && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      list.push({ code: rawCode, courseName: formatCourseDisplay(sec.courseCode, sec.name), credits: sec.credits ?? null });
    }
  }
  return list;
}

/**
 * Format registration codes (CRNs) in a clean comma-separated list ready for registrar quick-add.
 */
export function formatScheduleCodesForRegistration(schedule: OptimizationResult): string {
  const codes = getScheduleRegistrationCodes(schedule);
  return codes.map((c) => c.code).join(', ');
}

/**
 * Format registration codes with full course names and credits.
 */
export function formatScheduleCodesWithDetails(schedule: OptimizationResult, rank: number = 1): string {
  const codes = getScheduleRegistrationCodes(schedule);
  const lines: string[] = [
    `SCHEDULE #${rank} REGISTRATION CODES (CRNs):`,
    `Quick Paste: ${codes.map((c) => c.code).join(', ')}`,
    '',
    'COURSES BREAKDOWN:',
  ];
  for (const c of codes) {
    lines.push(`• ${c.courseName}: ${c.code} (${c.credits} credits)`);
  }
  return lines.join('\n');
}

/**
 * Copies text safely to clipboard with fallback.
 */
export interface ClipboardCopyResult {
  success: boolean;
  method: 'clipboard-api' | 'execCommand' | 'manual' | 'none';
  reason?: 'insecure-context' | 'permission-denied' | 'api-unavailable' | 'fallback-failed' | 'manual-required' | 'unknown';
}

export async function copyToClipboardDetailed(text: string): Promise<ClipboardCopyResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { success: false, method: 'none', reason: 'api-unavailable' };
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    if (window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return { success: true, method: 'clipboard-api' };
      } catch (err) {
        devLogWarn('Navigator clipboard fallback engaged.');
        // Continue to the legacy fallback; browsers can deny clipboard permission
        // even in a secure context.
      }
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = typeof document.execCommand === 'function' && document.execCommand('copy');
    textArea.remove();
    return successful
      ? { success: true, method: 'execCommand' }
      : { success: false, method: 'manual', reason: 'manual-required' };
  } catch (err) {
    devLogError('Clipboard fallback failed.');
    return {
      success: false,
      method: 'none',
      reason: typeof navigator !== 'undefined' && navigator.clipboard && !window.isSecureContext ? 'insecure-context' : 'fallback-failed',
    };
  }
}

/** Boolean compatibility wrapper for existing integrations. */
export async function copyToClipboard(text: string): Promise<boolean> {
  return (await copyToClipboardDetailed(text)).success;
}


function getPdfSessionRowHeight(doc: jsPDF, fullCourseLabel: string, middleWidth: number): number {
  const wrappedLines = doc.splitTextToSize(fullCourseLabel, middleWidth);
  return Math.max(7.5, wrappedLines.length * 3.8 + 3.8);
}

// ----------------------------------------------------------------------
// 2. SINGLE SOURCE OF TRUTH: SCHEDULE EXPORT TEMPLATE & RENDERER
// ----------------------------------------------------------------------

export interface ExportTaskOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'AbortError';
  }
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportCancelledError();
}

async function deliverBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
    }, 500);
  } catch (err) {
    devLogWarn('Direct download fallback engaged.');
    window.open(url, '_blank', 'noopener,noreferrer');
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

const EXPORT_FONT_STACK = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function wrapTextIntoLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let currentLine = '';

  const pushBrokenWord = (word: string) => {
    let remaining = word;
    while (remaining) {
      let fit = remaining.length;
      while (fit > 1 && ctx.measureText(remaining.slice(0, fit)).width > maxWidth) fit -= 1;
      const piece = remaining.slice(0, fit);
      lines.push(piece);
      remaining = remaining.slice(fit);
    }
  };

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      continue;
    }
    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }
    if (ctx.measureText(word).width <= maxWidth) currentLine = word;
    else pushBrokenWord(word);
  }
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

let cachedLogoImage: HTMLImageElement | null = null;
let logoLoadPromise: Promise<HTMLImageElement | null> | null = null;

async function getOrLoadLogo(): Promise<HTMLImageElement | null> {
  if (cachedLogoImage && cachedLogoImage.complete && cachedLogoImage.naturalWidth > 0) {
    return cachedLogoImage;
  }
  if (!logoLoadPromise) {
    logoLoadPromise = new Promise((resolve) => {
      if (typeof window === 'undefined' || typeof Image === 'undefined') return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        cachedLogoImage = img;
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = '/brand/gadwal-wordmark.png';
      setTimeout(() => resolve(img.complete && img.naturalWidth > 0 ? img : null), 1200);
    });
  }
  return logoLoadPromise;
}

/**
 * Clean course item for the top COURSES section.
 */
interface CleanCourseSummaryItem {
  name: string;
  code: string;
  credits: number | null;
}

function getCleanScheduleCourses(schedule: OptimizationResult): CleanCourseSummaryItem[] {
  const seen = new Set<string>();
  const list: CleanCourseSummaryItem[] = [];

  for (const sec of schedule.sections) {
    const name = getPureCourseName(sec.name, sec.courseCode);
    const courseCode = (sec.courseCode || '').trim();
    const sectionCode = (sec.sectionCode || '').trim();

    let fullCode = sectionCode || courseCode;
    if (courseCode && sectionCode && !sectionCode.includes(courseCode) && !courseCode.includes(sectionCode)) {
      fullCode = `${courseCode}${sectionCode}`;
    }

    const dedupeKey = `${(name || courseCode).toLowerCase()}___${fullCode.toLowerCase()}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      list.push({
        name: name || courseCode || 'Untitled Course',
        code: fullCode,
        credits: sec.credits ?? null,
      });
    }
  }

  return list;
}

/**
 * ONE AND ONLY ONE VISUAL SCHEDULE-EXPORT TEMPLATE (3:4 Ratio).
 * Renders the exact minimalist information-sheet template shown in the reference image.
 */
export async function renderScheduleToCanvas(
  schedule: OptimizationResult,
  rank: number = 1,
  options?: ExportTaskOptions
): Promise<HTMLCanvasElement> {
  assertExportableSchedule(schedule);
  throwIfExportAborted(options?.signal);

  // Pre-load bundled Inter font stack
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await Promise.all([
        (document as any).fonts.load(`400 16px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`500 19px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`600 24px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`700 23px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`700 24px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`800 26px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`800 28px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.load(`900 64px ${EXPORT_FONT_STACK}`),
        (document as any).fonts.ready,
      ]);
    } catch {
      // Graceful fallback
    }
  }
  throwIfExportAborted(options?.signal);

  const logoImg = await getOrLoadLogo();
  throwIfExportAborted(options?.signal);

  // 3:4 Aspect Ratio Canvas (1200 x 1600 logical, scale 2 = 2400 x 3200 for Retina clarity)
  const canvas = document.createElement('canvas');
  const scale = 2;
  const width = 1200;
  const height = 1600;
  const marginX = 56;
  const contentWidth = width - marginX * 2; // 1088px

  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize export canvas context');

  ctx.scale(scale, scale);

  // 1. Pure White Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 2. Data Preparation
  const courses = getCleanScheduleCourses(schedule);
  const daySessions = getScheduleDaySessions(schedule);
  const activeDays = DAY_ORDER.filter((d) => daySessions[d] && daySessions[d].length > 0);

  // ----------------------------------------------------
  // 3. HEADER: Title on left, Gadwal logo on right
  // ----------------------------------------------------
  const headerTopY = 56;

  // Title: "Schedule #1"
  ctx.fillStyle = '#000000';
  ctx.font = `900 64px ${EXPORT_FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Schedule #${rank}`, marginX, headerTopY + 56);

  // Gadwal Logo on Right
  if (logoImg && logoImg.naturalWidth > 0) {
    const logoW = 220;
    const logoH = (logoImg.naturalHeight / logoImg.naturalWidth) * logoW;
    ctx.drawImage(logoImg, width - marginX - logoW, headerTopY + (56 - logoH) / 2 + 2, logoW, logoH);
  } else {
    // Fallback: Typography logo
    ctx.fillStyle = '#000000';
    ctx.font = `800 44px ${EXPORT_FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText('Gadwal', width - marginX, headerTopY + 52);
    ctx.textAlign = 'left';
  }

  // ----------------------------------------------------
  // 4. COURSES SECTION: Centered "COURSES" + Moderately Scaled Horizontal Columns
  // ----------------------------------------------------
  let currentY = headerTopY + 112;

  // Centered Heading: "COURSES"
  ctx.fillStyle = '#000000';
  ctx.font = `800 26px ${EXPORT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText('COURSES', width / 2, currentY);
  ctx.textAlign = 'left';

  currentY += 30;

  const numCourses = courses.length;

  // Layout Courses in a bounded grid. The previous single-row implementation placed
  // course #7+ outside the canvas; rows keep all realistic course counts inside the export.
  const numCols = Math.max(1, Math.min(numCourses, 6));
  const courseNameFontSize = numCols <= 4 ? 24 : numCols === 5 ? 22 : 20;
  const courseCodeFontSize = numCols <= 4 ? 20 : numCols === 5 ? 18 : 16;
  const courseNameFont = `700 ${courseNameFontSize}px ${EXPORT_FONT_STACK}`;
  const courseCodeFont = `500 ${courseCodeFontSize}px ${EXPORT_FONT_STACK}`;
  const courseNameLineH = courseNameFontSize + 7;
  const courseCodeSpacing = courseCodeFontSize + 7;
  const colWidth = contentWidth / numCols;
  const rowGap = 18;
  const courseRows: CleanCourseSummaryItem[][] = [];
  for (let i = 0; i < courses.length; i += numCols) courseRows.push(courses.slice(i, i + numCols));

  let courseCursorY = currentY + 16;
  ctx.font = courseNameFont;
  for (let rowIndex = 0; rowIndex < courseRows.length; rowIndex += 1) {
    const row = courseRows[rowIndex];
    const rowData = row.map((c) => {
      const maxTextW = colWidth - 16;
      const nameLines = wrapTextIntoLines(ctx, c.name, maxTextW);
      return { nameLines, code: c.code ? `(${c.code})` : '' };
    });
    const rowHeight = Math.max(1, ...rowData.map((c) => c.nameLines.length * courseNameLineH + (c.code ? courseCodeSpacing : 0)));
    const dividerTop = courseCursorY - 8;
    const dividerBottom = courseCursorY + rowHeight + 4;

    rowData.forEach((col, idx) => {
      const colCenterX = marginX + idx * colWidth + colWidth / 2;
      ctx.fillStyle = '#000000';
      ctx.font = courseNameFont;
      ctx.textAlign = 'center';
      let lineY = courseCursorY;
      col.nameLines.forEach((line) => {
        ctx.fillText(line, colCenterX, lineY);
        lineY += courseNameLineH;
      });
      if (col.code) {
        ctx.fillStyle = '#111111';
        ctx.font = courseCodeFont;
        ctx.fillText(col.code, colCenterX, lineY + 2);
      }
      if (idx < rowData.length - 1) {
        const dividerX = marginX + (idx + 1) * colWidth;
        ctx.strokeStyle = '#D1D5DB';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dividerX, dividerTop);
        ctx.lineTo(dividerX, dividerBottom);
        ctx.stroke();
      }
    });
    courseCursorY += rowHeight + rowGap;
  }

  currentY = Math.max(courseCursorY - rowGap, currentY + 36) + 28;

  // ----------------------------------------------------
  // 5. SUMMARY LINE: Centered with bullets
  // ----------------------------------------------------
  const totalGapStr = formatWaitingTime(schedule.totalGap);
  const summaryText = `${totalGapStr} total gap  •  ${schedule.numDays} days  •  ${courses.length} courses  •  ${schedule.totalCredits} credits`;

  ctx.fillStyle = '#000000';
  ctx.font = `700 24px ${EXPORT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(summaryText, width / 2, currentY);

  currentY += 28;

  // Subtle horizontal rule below summary
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, currentY);
  ctx.lineTo(width - marginX, currentY);
  ctx.stroke();

  currentY += 24;

  // ----------------------------------------------------
  // 6. WEEKLY SCHEDULE DATA (Normal Size, Global Consistent Alignment, NO Day Separator Lines)
  // ----------------------------------------------------
  const numDays = Math.max(1, activeDays.length);

  // Normal, balanced typography for weekly rows
  const weeklyFontSize = 24;
  const dayHeaderFontSize = 28;
  const dashStr = '  —  ';

  const timeFont = `600 ${weeklyFontSize}px ${EXPORT_FONT_STACK}`;
  const dashFont = `600 ${weeklyFontSize}px ${EXPORT_FONT_STACK}`;
  const courseFont = `800 ${weeklyFontSize}px ${EXPORT_FONT_STACK}`;
  const dayHeaderFont = `800 ${dayHeaderFontSize}px ${EXPORT_FONT_STACK}`;

  // Measure em-dash width
  ctx.font = dashFont;
  const dashWidth = ctx.measureText(dashStr).width;

  // 1. GLOBAL MEASUREMENT: Pre-measure ALL sessions across ALL days
  // so the em-dash "—" is at the exact same horizontal coordinate for every single day!
  let globalMaxTimeW = 0;
  let globalMaxCourseW = 0;

  const allDayPrepared = activeDays.map((day) => {
    const sessions = daySessions[day] || [];
    const measuredSessions = sessions.map((s) => {
      const cleanCourseName = getPureCourseName(s.courseName || s.rawCourseName, s.courseCode);
      const timeStr = `${s.start12} – ${s.end12}`;

      ctx.font = timeFont;
      const timeW = ctx.measureText(timeStr).width;
      if (timeW > globalMaxTimeW) globalMaxTimeW = timeW;

      ctx.font = courseFont;
      const courseW = ctx.measureText(cleanCourseName).width;
      if (courseW > globalMaxCourseW) globalMaxCourseW = courseW;

      return {
        session: s,
        timeStr,
        courseName: cleanCourseName,
      };
    });

    return {
      day,
      sessions: measuredSessions,
    };
  });

  // Calculate the single GLOBAL horizontal alignment anchor points for all rows
  const globalScheduleBlockWidth = globalMaxTimeW + dashWidth + globalMaxCourseW;
  const globalBlockStartX = Math.max(marginX, (width - globalScheduleBlockWidth) / 2);
  const globalTimeEndX = globalBlockStartX + globalMaxTimeW;
  const globalDashStartX = globalTimeEndX;
  const globalCourseStartX = globalDashStartX + dashWidth;

  // 2. VERTICAL SPACE ALLOCATION: Normal, comfortable pacing
  const bottomTargetY = 1530;
  const availableWeeklyHeight = bottomTargetY - currentY;

  // Standard comfortable spacing
  let sessionLineHeight = 44;
  let dayHeaderSpacing = 34;
  let dayPaddingTop = 18;
  let dayPaddingBottom = 22;

  const totalDaySpans = allDayPrepared.reduce((acc, d) => acc + d.sessions.length, 0);
  const baseTotalNeeded =
    numDays * (dayPaddingTop + dayHeaderSpacing + dayPaddingBottom) +
    totalDaySpans * sessionLineHeight;

  if (baseTotalNeeded < availableWeeklyHeight) {
    const surplus = availableWeeklyHeight - baseTotalNeeded;
    const surplusPerDay = surplus / (numDays + 1);
    dayPaddingTop += surplusPerDay * 0.25;
    dayPaddingBottom += surplusPerDay * 0.35;
    sessionLineHeight = Math.min(
      52,
      sessionLineHeight + (surplusPerDay * 0.25) / Math.max(1, totalDaySpans / numDays)
    );
    dayHeaderSpacing = Math.min(40, dayHeaderSpacing + surplusPerDay * 0.15);
  } else if (baseTotalNeeded > availableWeeklyHeight) {
    const scaleFactor = availableWeeklyHeight / baseTotalNeeded;
    sessionLineHeight = Math.max(36, sessionLineHeight * scaleFactor);
    dayHeaderSpacing = Math.max(26, dayHeaderSpacing * scaleFactor);
    dayPaddingTop = Math.max(12, dayPaddingTop * scaleFactor);
    dayPaddingBottom = Math.max(14, dayPaddingBottom * scaleFactor);
  }

  // 3. DRAW ALL DAYS with global consistent alignment & NO line separator between days
  for (let dayIndex = 0; dayIndex < allDayPrepared.length; dayIndex++) {
    const { day, sessions } = allDayPrepared[dayIndex];
    if (sessions.length === 0) continue;

    currentY += dayPaddingTop;

    // Day Heading: Centered on the page (SUN, MON, TUE, WED, THU, FRI, SAT)
    ctx.fillStyle = '#000000';
    ctx.font = dayHeaderFont;
    ctx.textAlign = 'center';
    ctx.fillText(day, width / 2, currentY);

    currentY += dayHeaderSpacing;

    // Draw each session row with global horizontal alignment
    for (const item of sessions) {
      // Time: Right-aligned against globalTimeEndX (so times end exactly at the dash)
      ctx.fillStyle = '#000000';
      ctx.font = timeFont;
      ctx.textAlign = 'right';
      ctx.fillText(item.timeStr, globalTimeEndX, currentY);

      // Dash: Left-aligned at globalDashStartX (exact same X across ALL days)
      ctx.font = dashFont;
      ctx.textAlign = 'left';
      ctx.fillText(dashStr, globalDashStartX, currentY);

      // Course Name: Bold, Left-aligned at globalCourseStartX (exact same X across ALL days)
      ctx.font = courseFont;
      ctx.fillText(item.courseName, globalCourseStartX, currentY);

      currentY += sessionLineHeight;
    }

    currentY += dayPaddingBottom;
    // No separator line between days - pure clean whitespace
  }

  return canvas;
}

/**
 * Downloads a single schedule as a high-resolution 3:4 PNG image.
 */
export async function downloadScheduleImage(
  schedule: OptimizationResult,
  rank: number = 1,
  options?: ExportTaskOptions
): Promise<void> {
  const canvas = await renderScheduleToCanvas(schedule, rank, options);
  throwIfExportAborted(options?.signal);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas image conversion failed'));
        return;
      }
      deliverBlob(blob, `Gadwal-Schedule-${rank}.png`).then(resolve).catch(reject);
    }, 'image/png');
  });
}

/**
 * Downloads a single schedule as a 3:4 PDF containing the EXACT SAME rendered visual schedule.
 * Single source of truth: 100% visual parity with the exported image.
 */
export async function downloadSchedulePDF(
  schedule: OptimizationResult,
  rank: number = 1,
  options?: ExportTaskOptions
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  assertExportableSchedule(schedule);
  throwIfExportAborted(options?.signal);

  // Render the ONE visual export canvas
  const canvas = await renderScheduleToCanvas(schedule, rank, options);
  throwIfExportAborted(options?.signal);

  // Create a 3:4 portrait PDF (210mm x 280mm = exact 3:4 ratio)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [210, 280],
    compress: true,
  });

  const imgData = canvas.toDataURL('image/png', 1.0);
  doc.addImage(imgData, 'PNG', 0, 0, 210, 280, undefined, 'FAST');

  throwIfExportAborted(options?.signal);
  const blob = doc.output('blob');
  await deliverBlob(blob, `Gadwal-Schedule-${rank}.pdf`);
}


