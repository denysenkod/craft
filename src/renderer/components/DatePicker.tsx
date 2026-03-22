import React, { useState, useRef, useEffect } from 'react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function DatePicker({ value, onChange, className = '' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(0);
  const [viewMonth, setViewMonth] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? new Date(value + 'T12:00:00') : null;
  const today = new Date();

  useEffect(() => {
    if (open) {
      const d = selected || today;
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    onChange(`${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`);
    setOpen(false);
  };

  const isSelected = (day: number) => {
    if (!selected) return false;
    return selected.getFullYear() === viewYear && selected.getMonth() === viewMonth && selected.getDate() === day;
  };

  const isToday = (day: number) => {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  };

  const displayValue = selected
    ? `${MONTHS[selected.getMonth()].slice(0, 3)} ${selected.getDate()}, ${selected.getFullYear()}`
    : 'Select date';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 text-sm px-3.5 py-2.5 bg-surface-2 border border-border-base text-text-primary rounded-lg hover:border-honey/30 transition-colors w-full text-left"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F0EDE8" strokeWidth={1.5}>
          <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className={selected ? 'text-text-primary' : 'text-text-muted'}>{displayValue}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 w-[280px] bg-surface-3 border border-border-strong rounded-xl shadow-xl p-3">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2 px-1">
            <button type="button" onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-4 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-semibold text-text-primary">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-4 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-text-muted py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {/* Previous month trailing days */}
            {Array.from({ length: firstDayOfMonth }, (_, i) => (
              <div key={`p-${i}`} className="text-center text-xs text-text-muted/30 py-1.5">{prevMonthDays - firstDayOfMonth + 1 + i}</div>
            ))}
            {/* Current month days */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const sel = isSelected(day);
              const tod = isToday(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`text-center text-xs py-1.5 rounded-lg transition-colors ${
                    sel
                      ? 'bg-honey text-surface-0 font-semibold'
                      : tod
                        ? 'text-honey font-semibold hover:bg-surface-4'
                        : 'text-text-primary hover:bg-surface-4'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 pt-2 border-t border-border-base flex justify-center">
            <button
              type="button"
              onClick={() => {
                onChange(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`);
                setOpen(false);
              }}
              className="text-xs font-medium text-honey hover:underline"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
