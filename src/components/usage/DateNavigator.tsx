import { useState, useRef, useEffect, useCallback } from "react";
import { useT } from "../../i18n/useT";

// ── Date helpers ──────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayStr(): string {
  return toDateStr(new Date());
}

function addDays(dateStr: string, offset: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + offset);
  return toDateStr(d);
}

function isFutureDate(dateStr: string): boolean {
  return dateStr > todayStr();
}

// ── MiniCalendar ──────────────────────────────────────────────────────

interface MiniCalendarProps {
  selectedDate: string;
  cachedDates: Record<string, boolean>;
  onSelect: (dateStr: string) => void;
  onClose: () => void;
}

function MiniCalendar({ selectedDate, cachedDates, onSelect, onClose }: MiniCalendarProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const selected = parseDateStr(selectedDate);
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  const today = todayStr();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Fill remaining cells to complete the grid
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = `${t.usage_cal_months[viewMonth]} ${viewYear}`;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg usage-calendar-enter"
      style={{ fontFamily: '"Geist Sans", sans-serif' }}
    >
      {/* Month header */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3.5 5L6.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-[11px] font-medium text-[var(--text-primary)]">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 px-1.5">
        {t.usage_cal_weekdays.map((day) => (
          <div key={day} className="text-center text-[9px] text-[var(--text-faint)] py-0.5 font-medium">
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 px-1.5 pb-1.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;

          const dateStr = toDateStr(new Date(viewYear, viewMonth, day));
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const isFuture = isFutureDate(dateStr);
          const hasData = cachedDates[dateStr] === true;

          return (
            <button
              key={dateStr}
              disabled={isFuture}
              onClick={() => {
                onSelect(dateStr);
                onClose();
              }}
              className={`
                relative flex flex-col items-center justify-center h-6 rounded text-[10px] transition-all duration-100
                ${isFuture ? "text-[var(--text-faint)] cursor-default opacity-40" : "cursor-pointer hover:bg-[var(--surface-hover)]"}
                ${isSelected ? "bg-[var(--accent)] text-white hover:bg-[var(--accent)]" : ""}
                ${isToday && !isSelected ? "text-[var(--accent)] font-bold" : ""}
                ${!isSelected && !isToday && !isFuture ? "text-[var(--text-secondary)]" : ""}
              `}
            >
              <span>{day}</span>
              {hasData && !isSelected && (
                <span
                  className="absolute bottom-0 w-1 h-1 rounded-full bg-[var(--accent)]"
                  style={{ opacity: 0.7 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── DateNavigator ─────────────────────────────────────────────────────

interface DateNavigatorProps {
  date: string;
  cachedDates: Record<string, boolean>;
  onDateChange: (dateStr: string) => void;
  onCollapse?: () => void;
}

export function DateNavigator({ date, cachedDates, onDateChange, onCollapse }: DateNavigatorProps) {
  const t = useT();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const today = todayStr();
  const isToday = date === today;
  const parsed = parseDateStr(date);
  const isTomorrow = addDays(date, 1) > today;

  const displayDate = `${t.usage_cal_months_short[parsed.getMonth()]} ${parsed.getDate()}`;

  return (
    <div className="relative px-3 py-2 shrink-0 border-b border-[var(--border)]">
      <div className="flex items-center gap-1">
        {/* Panel title */}
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] shrink-0">
          <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span
          className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mr-auto"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.usage_title}
        </span>

        {/* Prev day */}
        <button
          onClick={() => onDateChange(addDays(date, -1))}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M5 1.5L2.5 4L5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Date label — click opens calendar */}
        <button
          onClick={() => setCalendarOpen(!calendarOpen)}
          className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-1 py-0.5 rounded hover:bg-[var(--surface-hover)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {displayDate}
        </button>

        {/* Next day */}
        <button
          onClick={() => !isTomorrow && onDateChange(addDays(date, 1))}
          disabled={isTomorrow}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
            isTomorrow
              ? "text-[var(--text-faint)] cursor-default"
              : "hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M3 1.5L5.5 4L3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Today button */}
        {!isToday && (
          <button
            onClick={() => onDateChange(today)}
            className="text-[10px] text-[var(--accent)] hover:text-[var(--text-primary)] transition-colors ml-0.5 px-1 py-0.5 rounded hover:bg-[var(--surface-hover)]"
          >
            {t.usage_today}
          </button>
        )}

        {/* Collapse button */}
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Mini calendar popup */}
      {calendarOpen && (
        <MiniCalendar
          selectedDate={date}
          cachedDates={cachedDates}
          onSelect={onDateChange}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}
