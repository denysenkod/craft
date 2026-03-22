import React, { useState, useMemo } from 'react';

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

interface CalendarDayViewProps {
  open: boolean;
  onClose: () => void;
  date: string; // YYYY-MM-DD
  events: CalendarEvent[];
  duration: number; // minutes
  onSelectTime: (startTime: string) => void;
}

const HOUR_HEIGHT = 60;
const START_HOUR = 7;
const END_HOUR = 22;
const SNAP_MINUTES = 15;

function timeToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

export default function CalendarDayView({ open, onClose, date, events, duration, onSelectTime }: CalendarDayViewProps) {
  const [hoverMinutes, setHoverMinutes] = useState<number | null>(null);

  // Filter events to the selected date
  const dayEvents = useMemo(() => {
    return events.filter((e) => {
      const eventDate = new Date(e.start).toISOString().split('T')[0];
      return eventDate === date;
    }).map((e) => ({
      ...e,
      startMin: timeToMinutes(e.start),
      endMin: timeToMinutes(e.end),
    }));
  }, [events, date]);

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  // Check if a slot collides with any event
  const hasCollision = (startMin: number, endMin: number): boolean => {
    return dayEvents.some((e) => startMin < e.endMin && endMin > e.startMin);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMinutes = START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
    const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    setHoverMinutes(Math.max(START_HOUR * 60, Math.min(snapped, END_HOUR * 60 - duration)));
  };

  const handleClick = () => {
    if (hoverMinutes === null) return;
    if (hasCollision(hoverMinutes, hoverMinutes + duration)) return;
    onSelectTime(minutesToTime(hoverMinutes));
    onClose();
  };

  if (!open) return null;

  const dateObj = new Date(date + 'T12:00:00');
  const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[480px] max-h-[85vh] flex flex-col bg-surface-2 border border-border-strong overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border-base">
          <h2 className="text-xl font-light italic text-text-primary" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>{dateLabel}</h2>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest mt-1">Click to select a {duration}-minute slot</p>
        </div>

        {/* Time grid */}
        <div className="flex-1 overflow-y-auto">
          <div
            className="relative cursor-crosshair"
            style={{ height: totalHeight }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverMinutes(null)}
            onClick={handleClick}
          >
            {/* Hour lines */}
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
              const hour = START_HOUR + i;
              return (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-t border-border-base flex"
                  style={{ top: i * HOUR_HEIGHT }}
                >
                  <span className="font-mono text-[10px] text-text-muted w-[52px] shrink-0 px-2 -mt-[7px]">
                    {formatHour(hour)}
                  </span>
                </div>
              );
            })}

            {/* Existing events */}
            {dayEvents.map((event) => {
              const top = ((event.startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
              const height = ((event.endMin - event.startMin) / 60) * HOUR_HEIGHT;
              return (
                <div
                  key={event.id}
                  className="absolute left-[56px] right-3 bg-surface-4 border border-border-strong px-2.5 py-1.5 overflow-hidden"
                  style={{ top, height: Math.max(height, 20), borderRadius: 3 }}
                >
                  <div className="text-[11px] text-text-secondary font-medium truncate">{event.summary}</div>
                  <div className="font-mono text-[10px] text-text-muted">
                    {minutesToTime(event.startMin)} — {minutesToTime(event.endMin)}
                  </div>
                </div>
              );
            })}

            {/* Hover slot */}
            {hoverMinutes !== null && (() => {
              const top = ((hoverMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
              const height = (duration / 60) * HOUR_HEIGHT;
              const collision = hasCollision(hoverMinutes, hoverMinutes + duration);
              return (
                <div
                  className={`absolute left-[56px] right-3 border px-2.5 py-1.5 pointer-events-none transition-colors ${
                    collision
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-honey/10 border-honey/30'
                  }`}
                  style={{ top, height, borderRadius: 3 }}
                >
                  <div className={`font-mono text-[10px] ${collision ? 'text-red-400' : 'text-honey'}`}>
                    {minutesToTime(hoverMinutes)} — {minutesToTime(hoverMinutes + duration)}
                    {collision && ' (conflicts)'}
                  </div>
                </div>
              );
            })()}

            {/* Current time indicator */}
            {(() => {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
              if (todayStr !== date) return null;
              const nowMin = now.getHours() * 60 + now.getMinutes();
              if (nowMin < START_HOUR * 60 || nowMin > END_HOUR * 60) return null;
              const top = ((nowMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
              return (
                <div className="absolute left-[52px] right-0 border-t-2 border-red-500 pointer-events-none" style={{ top }}>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 -mt-[6px] -ml-[5px]" />
                </div>
              );
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border-base">
          <button
            onClick={onClose}
            className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
