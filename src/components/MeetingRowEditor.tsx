import React from 'react';
import { DayOfWeek } from '../types';
import { ManualSessionRow } from '../features/courseBuilder/model';
import { NaturalTimeInput } from './NaturalTimeInput';
import { MANUAL_MEETING_TYPE_OPTIONS, ManualMeetingType } from '../utils/meetingTypes';
import { isManualMeetingType } from '../domain/meeting';
import { timeToMinutes } from '../utils/optimizer';
import { formatTo12Hour } from '../utils/parser';
import { Trash2 } from 'lucide-react';

export const ALL_DAYS: DayOfWeek[] = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  SAT: 'Saturday',
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
};

interface MeetingRowEditorProps {
  session: ManualSessionRow;
  index: number;
  totalMeetings: number;
  idPrefix?: string;
  courseTitle?: string;
  onChange: (patch: Partial<ManualSessionRow>) => void;
  onRemove: () => void;
}

export const MeetingRowEditor: React.FC<MeetingRowEditorProps> = ({
  session,
  index,
  totalMeetings,
  idPrefix = 'meeting',
  courseTitle = 'Course',
  onChange,
  onRemove,
}) => {
  const isTimeOrderInvalid = Boolean(
    session.start &&
    session.end &&
    timeToMinutes(session.start) >= timeToMinutes(session.end)
  );

  return (
    <div
      id={`${idPrefix}-${session.id}`}
      className={`p-3 rounded-lg border transition-colors ${
        isTimeOrderInvalid
          ? 'bg-alert/5 border-alert/60'
          : 'bg-white border-line hover:border-line-strong'
      }`}
    >
      {/* DESKTOP LAYOUT (sm: and up): Clean, aligned row */}
      <div className="hidden sm:block mb-2 text-xs font-extrabold text-text-secondary uppercase tracking-wider">
        Meeting {index + 1}
      </div>
      <div className="hidden sm:flex sm:items-start sm:gap-3 flex-wrap lg:flex-nowrap">
        {/* 1. Day Selector */}
        <div className="w-[140px] shrink-0">
          <label htmlFor={`${idPrefix}-${session.id}-day-desktop`} className="sr-only">
            Day
          </label>
          <select
            id={`${idPrefix}-${session.id}-day-desktop`}
            aria-label={`${courseTitle} meeting ${index + 1} day`}
            value={session.day}
            onChange={(e) => onChange({ day: e.target.value as DayOfWeek | '' })}
            className="w-full px-3 py-2 text-sm font-semibold text-ink bg-white border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink min-h-[42px] cursor-pointer transition shadow-2xs"
          >
            <option value="">Choose day</option>
            {ALL_DAYS.map((day) => (
              <option key={day} value={day}>
                {DAY_LABELS[day]}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Meeting Type */}
        <div className="w-[140px] shrink-0 space-y-1.5">
          <label htmlFor={`${idPrefix}-${session.id}-type-desktop`} className="sr-only">
            Meeting Type
          </label>
          <select
            id={`${idPrefix}-${session.id}-type-desktop`}
            aria-label={`${courseTitle} meeting ${index + 1} meeting type`}
            value={!session.type ? '' : (isManualMeetingType(session.type) ? session.type : 'Custom')}
            onChange={(e) => {
              const val = e.target.value as ManualMeetingType;
              onChange({
                type: val,
                customType: val === 'Custom' ? session.customType || '' : '',
              });
            }}
            className="w-full px-3 py-2 text-sm font-semibold text-ink bg-white border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink min-h-[42px] cursor-pointer transition shadow-2xs"
          >
            <option value="">Select type</option>
            {MANUAL_MEETING_TYPE_OPTIONS.filter((option) => option !== 'Custom').map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value="Custom">Custom</option>
          </select>

          {session.type === 'Custom' && (
            <input
              type="text"
              aria-label={`${courseTitle} meeting ${index + 1} custom meeting type`}
              value={session.customType || ''}
              onChange={(e) => onChange({ customType: e.target.value })}
              placeholder="e.g. Seminar"
              className="w-full px-2.5 py-1.5 text-xs font-semibold text-ink bg-white border border-line rounded-lg focus:outline-none focus:ring-1 focus:ring-ink"
            />
          )}
        </div>

        {/* 3. Start & End Time Range */}
        <div className="flex items-center gap-2 shrink-0">
          <div>
            <label htmlFor={`${idPrefix}-${session.id}-start-desktop`} className="sr-only">
              Start Time
            </label>
            <NaturalTimeInput
              id={`${idPrefix}-${session.id}-start-desktop`}
              value={session.start}
              onChange={(val24) => onChange({ start: val24, rawStart: val24 })}
              isEnd={false}
              placeholder="Start"
              ariaLabel={`${courseTitle} meeting ${index + 1} start time`}
              hasError={isTimeOrderInvalid}
            />
          </div>

          <span className="text-xs font-bold text-text-muted select-none px-0.5">to</span>

          <div>
            <label htmlFor={`${idPrefix}-${session.id}-end-desktop`} className="sr-only">
              End Time
            </label>
            <NaturalTimeInput
              id={`${idPrefix}-${session.id}-end-desktop`}
              value={session.end}
              onChange={(val24) => onChange({ end: val24, rawEnd: val24 })}
              isEnd={true}
              start24={session.start}
              placeholder="End"
              ariaLabel={`${courseTitle} meeting ${index + 1} end time`}
              hasError={isTimeOrderInvalid}
            />
          </div>
        </div>

        {/* 4. Remove Meeting Button (Desktop) */}
        <div className="ml-auto shrink-0 flex items-center">
          {totalMeetings > 1 ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove meeting ${index + 1}`}
              className="px-3 py-2 rounded-xl text-xs font-bold text-alert hover:bg-alert/10 border border-transparent hover:border-alert/20 transition flex items-center gap-1.5 cursor-pointer min-h-[42px]"
              title="Remove this meeting"
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Remove</span>
            </button>
          ) : (
            <div className="w-10" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* MOBILE LAYOUT (< sm): Compact and touch-friendly */}
      <div className="sm:hidden space-y-3.5">
        {/* Mobile Header: Meeting index & Remove button */}
        <div className="flex items-center justify-between pb-2 border-b border-line/60">
          <span className="text-xs font-extrabold text-ink uppercase tracking-wider">
            Meeting {index + 1}
          </span>
          {totalMeetings > 1 && (
            <button
              type="button"
              onClick={onRemove}
              className="text-xs font-bold text-alert hover:bg-alert/10 flex items-center gap-1.5 py-1 px-2.5 rounded-lg min-h-[44px] cursor-pointer transition"
              aria-label={`Remove meeting ${index + 1}`}
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Remove</span>
            </button>
          )}
        </div>

        {/* Mobile Day & Type side by side in a 2-column grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-${session.id}-day-mobile`} className="block text-xs font-bold text-text-secondary">
              Day
            </label>
            <select
              id={`${idPrefix}-${session.id}-day-mobile`}
              aria-label={`${courseTitle} meeting ${index + 1} day`}
              value={session.day}
              onChange={(e) => onChange({ day: e.target.value as DayOfWeek | '' })}
              className="w-full px-3 py-2 text-sm font-semibold text-ink bg-white border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink min-h-[44px] cursor-pointer shadow-2xs"
            >
              <option value="">Choose day</option>
              {ALL_DAYS.map((day) => (
                <option key={day} value={day}>
                  {DAY_LABELS[day]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-${session.id}-type-mobile`} className="block text-xs font-bold text-text-secondary">
              Meeting Type
            </label>
            <select
              id={`${idPrefix}-${session.id}-type-mobile`}
              aria-label={`${courseTitle} meeting ${index + 1} meeting type`}
              value={!session.type ? '' : (isManualMeetingType(session.type) ? session.type : 'Custom')}
              onChange={(e) => {
                const val = e.target.value as ManualMeetingType;
                onChange({
                  type: val,
                  customType: val === 'Custom' ? session.customType || '' : '',
                });
              }}
              className="w-full px-3 py-2 text-sm font-semibold text-ink bg-white border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink min-h-[44px] cursor-pointer shadow-2xs"
            >
              <option value="">Select type</option>
              {MANUAL_MEETING_TYPE_OPTIONS.filter((option) => option !== 'Custom').map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value="Custom">Custom</option>
            </select>
          </div>
        </div>

        {session.type === 'Custom' && (
          <input
            type="text"
            aria-label={`${courseTitle} meeting ${index + 1} custom meeting type`}
            value={session.customType || ''}
            onChange={(e) => onChange({ customType: e.target.value })}
            placeholder="Custom meeting type (e.g. Seminar)"
            className="w-full px-3.5 py-2 text-sm font-semibold text-ink bg-white border border-line rounded-xl min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink shadow-2xs"
          />
        )}

        {/* Mobile Start & End Time */}
        <div className="space-y-1.5">
          <span className="block text-xs font-bold text-text-secondary">
            Meeting Time
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <NaturalTimeInput
              id={`${idPrefix}-${session.id}-start-mobile`}
              value={session.start}
              onChange={(val24) => onChange({ start: val24, rawStart: val24 })}
              isEnd={false}
              placeholder="Start"
              ariaLabel={`${courseTitle} meeting ${index + 1} start time`}
              hasError={isTimeOrderInvalid}
            />
            <span className="text-text-muted text-xs font-bold px-1 select-none">to</span>
            <NaturalTimeInput
              id={`${idPrefix}-${session.id}-end-mobile`}
              value={session.end}
              onChange={(val24) => onChange({ end: val24, rawEnd: val24 })}
              isEnd={true}
              start24={session.start}
              placeholder="End"
              ariaLabel={`${courseTitle} meeting ${index + 1} end time`}
              hasError={isTimeOrderInvalid}
            />
          </div>
        </div>
      </div>

      {/* Real-time Time Order Validation Error Banner (Desktop & Mobile) */}
      {isTimeOrderInvalid && (
        <div className="mt-2.5 p-2 rounded-md bg-alert/10 border border-alert/30 text-xs font-bold text-alert flex items-center gap-1.5" role="alert">
          <span>⚠️ Start time must be earlier than end time ({formatTo12Hour(session.start)} → {formatTo12Hour(session.end)} is invalid)</span>
        </div>
      )}
    </div>
  );
};
