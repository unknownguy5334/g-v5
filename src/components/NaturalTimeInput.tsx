import React, { useState, useEffect, useRef } from 'react';
import {
  parseBareTime,
  buildTime24,
  parseTime24,
  getLiveFormattedDisplay,
} from '../utils/naturalTime';

interface NaturalTimeInputProps {
  id?: string;
  value: string; // 24-hour time "HH:MM" or empty
  onChange: (time24: string) => void;
  isEnd?: boolean;
  start24?: string | null;
  placeholder?: string;
  ariaLabel?: string;
  hasError?: boolean;
  className?: string;
  disabled?: boolean;
}

export const NaturalTimeInput: React.FC<NaturalTimeInputProps> = ({
  id,
  value,
  onChange,
  isEnd = false,
  start24 = null,
  placeholder = 'e.g. 8:30',
  ariaLabel = 'Time',
  hasError = false,
  className = '',
  disabled = false,
}) => {
  // Extract initial display time and AM/PM from 24h value
  const initialParsed = value && value.includes(':') ? parseTime24(value) : null;
  const [displayText, setDisplayText] = useState<string>(initialParsed ? initialParsed.timeOnly : '');
  const [isFocused, setIsFocused] = useState(false);
  const [userSelectedAmPm, setUserSelectedAmPm] = useState<'AM' | 'PM' | null>(
    initialParsed ? initialParsed.ampm : null
  );

  // Track previous prop value to only sync on genuine external changes
  const prevValuePropRef = useRef(value);
  // Track latest text typed by the user to avoid stale closures
  const lastTypedTextRef = useRef(displayText);

  // Keep lastTypedTextRef in sync with displayText
  useEffect(() => {
    lastTypedTextRef.current = displayText;
  }, [displayText]);

  // Sync internal state when external `value` prop changes
  useEffect(() => {
    if (value !== prevValuePropRef.current) {
      const hadValue = Boolean(prevValuePropRef.current);
      prevValuePropRef.current = value;
      if (value && value.includes(':')) {
        const parsed = parseTime24(value);
        if (parsed) {
          setDisplayText(parsed.timeOnly);
          lastTypedTextRef.current = parsed.timeOnly;
          setUserSelectedAmPm(parsed.ampm);
          return;
        }
      } else if (!value && hadValue) {
        // Only clear if an existing saved value was explicitly cleared externally
        // and user is not currently in the middle of typing
        if (!lastTypedTextRef.current.trim()) {
          setDisplayText('');
          lastTypedTextRef.current = '';
          setUserSelectedAmPm(null);
        }
      }
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    lastTypedTextRef.current = raw;

    if (!raw.trim()) {
      setDisplayText('');
      lastTypedTextRef.current = '';
      setUserSelectedAmPm(null);
      prevValuePropRef.current = '';
      onChange('');
      return;
    }

    // Real-time live formatting (e.g. "130" -> "1:30", "830" -> "8:30", "1130" -> "11:30", "1000" -> "10:00")
    const live = getLiveFormattedDisplay(raw);
    const textToSet = live.shouldFormat ? live.display : raw;
    setDisplayText(textToSet);
    lastTypedTextRef.current = textToSet;

    // AM/PM is ONLY set if:
    // 1) The user previously selected AM or PM
    // 2) Or the user explicitly typed "am" or "pm" in the text (e.g. "830am", "130pm")
    // NO AUTO-GUESSING based on what the algorithm thinks is probably AM or PM!
    let effectiveAmPm = userSelectedAmPm;

    if (live.ampm) {
      effectiveAmPm = live.ampm;
      setUserSelectedAmPm(live.ampm);
    }

    const parsed = parseBareTime(textToSet);
    if (parsed) {
      if (effectiveAmPm) {
        const time24 = buildTime24(parsed.hours12, parsed.minutes, effectiveAmPm);
        prevValuePropRef.current = time24;
        onChange(time24);
      } else {
        // Waiting for the user to explicitly click AM or PM
        prevValuePropRef.current = '';
        onChange('');
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const currentText = (lastTypedTextRef.current || displayText).trim();

    if (!currentText) {
      setDisplayText('');
      lastTypedTextRef.current = '';
      setUserSelectedAmPm(null);
      prevValuePropRef.current = '';
      onChange('');
      return;
    }

    // On blur, normalize standard notation (e.g. "8:30" stays "8:30", bare "8" -> "8:00")
    // Do NOT erase or clear the typed text!
    const parsed = parseBareTime(currentText);
    if (parsed) {
      setDisplayText(parsed.formattedTimeOnly);
      lastTypedTextRef.current = parsed.formattedTimeOnly;

      const effectiveAmPm = userSelectedAmPm || parsed.ampm;
      if (effectiveAmPm) {
        setUserSelectedAmPm(effectiveAmPm);
        const time24 = buildTime24(parsed.hours12, parsed.minutes, effectiveAmPm);
        prevValuePropRef.current = time24;
        onChange(time24);
      }
      // If no effectiveAmPm, do NOT auto-guess and do NOT delete!
      // The typed digits remain in the field waiting for AM or PM selection.
    } else if (value && value.includes(':')) {
      // Restore previously saved valid time only if user entered an unparseable invalid string
      const prev = parseTime24(value);
      if (prev) {
        setDisplayText(prev.timeOnly);
        lastTypedTextRef.current = prev.timeOnly;
        setUserSelectedAmPm(prev.ampm);
      }
    }
  };

  const handleSelectAmPm = (target: 'AM' | 'PM') => {
    if (disabled) return;
    setUserSelectedAmPm(target);

    // Get current text from latest ref, displayText, or current value
    const textToParse =
      lastTypedTextRef.current.trim() ||
      displayText.trim() ||
      (value ? parseTime24(value)?.timeOnly : '') ||
      '';

    if (!textToParse) return;

    const parsed = parseBareTime(textToParse);
    if (parsed) {
      setDisplayText(parsed.formattedTimeOnly);
      lastTypedTextRef.current = parsed.formattedTimeOnly;
      const time24 = buildTime24(parsed.hours12, parsed.minutes, target);
      prevValuePropRef.current = time24;
      onChange(time24);
    }
  };

  const hasTimeWithoutAmPm = Boolean(displayText.trim() && !value && !userSelectedAmPm);

  return (
    <div className={`natural-time-container inline-flex flex-col gap-1 w-fit ${className}`}>
      <div
        className={`natural-time-pill inline-flex items-center min-h-[42px] rounded-xl border bg-white transition-all shadow-2xs ${
          hasError
            ? 'border-alert/80 ring-2 ring-alert/20'
            : isFocused
            ? 'border-ink ring-2 ring-ink/20'
            : hasTimeWithoutAmPm
            ? 'border-amber-400 ring-2 ring-amber-300/40'
            : 'border-line hover:border-line-strong'
        } ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
      >
        {/* Compact time digits input - completely borderless inside the pill */}
        <input
          type="text"
          id={id}
          value={displayText}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder || '8:30'}
          aria-label={ariaLabel}
          disabled={disabled}
          className="natural-time-input-field w-[76px] sm:w-[82px] px-2.5 py-1.5 text-center text-xs sm:text-sm font-mono font-bold text-ink placeholder:text-text-muted/40 bg-transparent !border-none !outline-none !shadow-none !ring-0 !m-0 min-h-[44px] select-all tracking-tight"
          style={{ border: 'none', outline: 'none', boxShadow: 'none', margin: 0 }}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Subtle vertical divider line */}
        <div className="h-5 w-[1px] bg-line/80 shrink-0" aria-hidden="true" />

        {/* AM / PM Toggle Pill right next to the time digits */}
        <div
          className={`flex items-center p-0.5 mx-1 rounded-lg shrink-0 text-xs font-bold transition-all ${
            hasTimeWithoutAmPm
              ? 'bg-amber-100/80 border border-amber-300'
              : 'bg-mist/70 border border-line/60'
          }`}
          role="group"
          aria-label={`${ariaLabel} AM/PM selector`}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSelectAmPm('AM')}
            disabled={disabled}
            className={`px-2 py-1 rounded-md transition-colors select-none cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center text-xs font-extrabold ${
              userSelectedAmPm === 'AM'
                ? 'bg-ink text-white shadow-2xs'
                : 'text-text-secondary hover:text-ink hover:bg-white/80'
            }`}
            aria-pressed={userSelectedAmPm === 'AM'}
            title="Set to AM"
          >
            AM
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSelectAmPm('PM')}
            disabled={disabled}
            className={`px-2 py-1 rounded-md transition-colors select-none cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center text-xs font-extrabold ${
              userSelectedAmPm === 'PM'
                ? 'bg-ink text-white shadow-2xs'
                : 'text-text-secondary hover:text-ink hover:bg-white/80'
            }`}
            aria-pressed={userSelectedAmPm === 'PM'}
            title="Set to PM"
          >
            PM
          </button>
        </div>
      </div>

      {/* Prompt only when time digits are typed but AM/PM is not chosen yet */}
      {hasTimeWithoutAmPm && (
        <span
          className="text-xs font-semibold text-amber-800 leading-tight px-1 flex items-center gap-1 mt-0.5"
          role="status"
        >
          <span className="font-bold font-mono text-ink">{displayText}</span>
          <span className="text-amber-700 font-medium">← Choose AM or PM</span>
        </span>
      )}
    </div>
  );
};

