import React, { useState, useRef, useEffect } from 'react';

interface TimePickerProps {
  value: string; // HH:MM
  onChange: (value: string) => void;
  className?: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDisplay(time: string): string {
  if (!time) return 'Select time';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad2(m)} ${ampm}`;
}

export default function TimePicker({ value, onChange, className = '' }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll to selected time when opening
  useEffect(() => {
    if (open && scrollRef.current && value) {
      const [h, m] = value.split(':').map(Number);
      const index = h * 4 + Math.floor(m / 15);
      const el = scrollRef.current.children[index] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'center' });
    }
  }, [open]);

  // Generate time slots in 15-minute intervals
  const timeSlots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeSlots.push(`${pad2(h)}:${pad2(m)}`);
    }
  }

  const selectTime = (time: string) => {
    onChange(time);
    setOpen(false);
  };

  // Set to current time (rounded to nearest 15 min)
  const setNow = () => {
    const now = new Date();
    const m = Math.round(now.getMinutes() / 15) * 15;
    const h = m === 60 ? now.getHours() + 1 : now.getHours();
    onChange(`${pad2(h % 24)}:${pad2(m % 60)}`);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 text-sm px-3.5 py-2.5 bg-surface-2 border border-border-base text-text-primary rounded-lg hover:border-honey/30 transition-colors w-full text-left"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F0EDE8" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className={value ? 'text-text-primary' : 'text-text-muted'}>{formatDisplay(value)}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-20 w-[160px] bg-surface-3 border border-border-strong rounded-xl shadow-xl overflow-hidden">
          <div ref={scrollRef} className="max-h-[240px] overflow-y-auto py-1">
            {timeSlots.map((time) => {
              const isSelected = time === value;
              return (
                <button
                  key={time}
                  type="button"
                  onClick={() => selectTime(time)}
                  className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'bg-honey text-surface-0 font-semibold'
                      : 'text-text-primary hover:bg-surface-4'
                  }`}
                >
                  {formatDisplay(time)}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border-base px-3 py-2 flex justify-center">
            <button
              type="button"
              onClick={setNow}
              className="text-xs font-medium text-honey hover:underline"
            >
              Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
