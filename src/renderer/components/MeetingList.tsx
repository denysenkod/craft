import React, { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void;
      off: (channel: string, subscription: (...args: unknown[]) => void) => void;
    };
  }
}

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: Array<{ email: string; responseStatus: string }>;
  meetingUrl: string | null;
  status: string;
  htmlLink: string;
  recallBotId: string | null;
  botStatus: string | null;
  botError: string | null;
}

interface MeetingListProps {
  onOpenTranscript: (meetingId: string, meetingTitle: string) => void;
  onOpenMomTest: () => void;
}

function getDisplayStatus(event: CalendarEvent): string {
  if (event.botStatus === 'recording') return 'recording';
  if (event.botStatus === 'done') return 'done';
  if (event.botStatus === 'failed') return 'failed';
  if (event.botStatus === 'scheduled') return 'bot_scheduled';

  const now = new Date();
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (now > end) return 'past';
  if (now >= start && now <= end) return 'live';
  return 'scheduled';
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { color: string; label: string; dot?: boolean; strike?: boolean }> = {
    recording: { color: '#E87B6B', label: 'Rec', dot: true },
    done: { color: '#5CC9A0', label: 'Done' },
    bot_scheduled: { color: '#E8A838', label: 'Bot Ready' },
    scheduled: { color: '#9C9890', label: 'Upcoming' },
    live: { color: '#E8A838', label: 'Live', dot: true },
    past: { color: '#5E5B54', label: 'Past' },
    failed: { color: '#5E5B54', label: 'Failed', strike: true },
  };
  const s = styles[status] || styles.past;
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-wider" style={{ color: s.color, textDecoration: s.strike ? 'line-through' : undefined }}>
      {s.dot && (
        <span className="inline-block w-[5px] h-[5px] rounded-full mr-1 animate-pulse" style={{ background: s.color }} />
      )}
      {!s.dot && status === 'done' && <span>&#10003; </span>}
      {s.label}
    </span>
  );
}

function formatDateTime(isoString: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(isoString: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatAttendees(attendees: Array<{ email: string }>): string {
  if (attendees.length === 0) return '—';
  if (attendees.length <= 2) return attendees.map((a) => a.email).join(', ');
  return `${attendees[0].email} +${attendees.length - 1}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function getDefaultFormValues() {
  const now = new Date();
  const end = new Date(now.getTime() + 2 * 60 * 1000);
  return {
    title: 'Test Meeting',
    attendees: '',
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    startTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    endTime: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
  };
}

export default function MeetingList({ onOpenTranscript, onOpenMomTest }: MeetingListProps) {
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [scheduling, setScheduling] = useState(false);

  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadEvents = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const result = await window.api.invoke('calendar:list-events') as CalendarEvent[];
      setEvents(result);
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Failed to load events';
      setError(msg);
      setEvents([]);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    refreshIntervalRef.current = setInterval(() => {
      loadEvents(false);
    }, 10000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  const openScheduleForm = () => {
    const defaults = getDefaultFormValues();
    setTitle(defaults.title);
    setAttendees(defaults.attendees);
    setDate(defaults.date);
    setStartTime(defaults.startTime);
    setEndTime(defaults.endTime);
    setDescription('');
    setShowScheduleForm(true);
    setShowPasteForm(false);
  };

  const handleSchedule = async () => {
    if (!title || !date || !startTime || !endTime) return;
    setScheduling(true);
    try {
      const startDateTime = new Date(`${date}T${startTime}`).toISOString();
      const endDateTime = new Date(`${date}T${endTime}`).toISOString();
      const attendeeList = attendees
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      await window.api.invoke('calendar:create-event', {
        title,
        description,
        attendees: attendeeList,
        startDateTime,
        endDateTime,
      });

      setShowScheduleForm(false);
      await loadEvents();
    } catch (err: unknown) {
      console.error('Failed to schedule:', err);
    } finally {
      setScheduling(false);
    }
  };

  const handleSendBot = async (eventId: string) => {
    setRetryingIds((prev) => new Set(prev).add(eventId));
    try {
      await window.api.invoke('calendar:send-bot', eventId);
      await loadEvents();
    } catch (err: unknown) {
      await loadEvents();
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  };

  const handleRetry = async (eventId: string) => {
    setRetryingIds((prev) => new Set(prev).add(eventId));
    try {
      await window.api.invoke('calendar:retry-bot', eventId);
      setExpandedErrorId(null);
      await loadEvents();
    } catch (err: unknown) {
      await loadEvents();
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  };

  const handleRowClick = (event: CalendarEvent, displayStatus: string) => {
    if (displayStatus === 'failed') {
      setExpandedErrorId(expandedErrorId === event.id ? null : event.id);
    } else if ((displayStatus === 'live' || displayStatus === 'recording' || displayStatus === 'bot_scheduled') && event.meetingUrl) {
      // Open meeting in browser AND open floating chat window
      window.api.invoke('shell:open-external', event.meetingUrl);
      window.api.invoke('meeting-chat:open', { eventId: event.id, title: event.summary, meetingUrl: event.meetingUrl });
    } else if (displayStatus === 'done') {
      onOpenTranscript(event.id, event.summary);
    }
  };

  const handleRemove = async (event: CalendarEvent, displayStatus: string) => {
    const isPast = new Date(event.end) < new Date();
    // Future meetings with a bot need confirmation
    if (!isPast && event.botStatus) {
      if (!confirm(`Remove "${event.summary}" and cancel the scheduled bot?`)) return;
    }
    try {
      // Remove from UI immediately for smooth experience
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      setExpandedErrorId(null);
      await window.api.invoke('calendar:remove-meeting', event.id);
    } catch (err: unknown) {
      console.error('Failed to remove meeting:', err);
      // Reload on failure to restore state
      loadEvents(false);
    }
  };

  const inputClass = 'font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30';

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-12 pt-10 pb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-light italic text-text-primary" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>Meetings</h1>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.12em] mt-2">Google Calendar events & bot scheduling</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenMomTest} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">
            Prepare Questions
          </button>
          <button onClick={showScheduleForm ? () => setShowScheduleForm(false) : openScheduleForm} className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">
            + Schedule Meeting
          </button>
        </div>
      </div>

      {/* Schedule Form */}
      {showScheduleForm && (
        <div className="mx-12 pb-6 border-b border-border-strong">
          <div className="flex gap-2 mb-2">
            <input className={`flex-1 ${inputClass}`} placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="mb-2">
            <textarea className={`w-full ${inputClass} resize-none h-16`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex gap-2 mb-2">
            <input className={`flex-1 ${inputClass}`} placeholder="Attendee emails (comma-separated)" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </div>
          <div className="flex gap-2 mb-3">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            <input type="time" className={inputClass} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <input type="time" className={inputClass} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSchedule} disabled={scheduling || !title || !date || !startTime || !endTime} className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {scheduling ? 'Scheduling...' : 'Schedule'}
            </button>
            <button onClick={() => setShowScheduleForm(false)} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">
              Cancel
            </button>
            <div className="flex-1" />
            <button onClick={() => { setShowPasteForm(!showPasteForm); setShowScheduleForm(false); }} className="font-mono text-[11px] text-text-muted underline underline-offset-2 hover:text-honey transition-colors">
              paste transcript
            </button>
          </div>
        </div>
      )}

      {/* Paste transcript fallback */}
      {showPasteForm && (
        <div className="mx-12 pb-6 border-b border-border-strong">
          <div className="flex gap-2 mb-2">
            <input className={`flex-1 ${inputClass}`} placeholder="Meeting title" />
            <input className={`flex-1 ${inputClass}`} placeholder="Google Meet / Zoom URL" />
          </div>
          <div className="flex gap-2">
            <button className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Send Bot</button>
            <button onClick={() => setShowPasteForm(false)} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="px-12 pb-12 overflow-y-auto flex-1">
        {loading && (
          <div className="py-12 text-center">
            <p className="font-mono text-xs text-text-muted">Loading calendar events...</p>
          </div>
        )}
        {error && (
          <div className="py-12 text-center">
            <p className="font-mono text-xs text-text-muted">{error}</p>
            <button onClick={() => loadEvents()} className="font-mono text-[11px] text-honey underline mt-2">Retry</button>
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div className="py-12 text-center">
            <p className="font-mono text-xs text-text-muted">No calendar events found.</p>
          </div>
        )}
        {!loading && !error && events.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong" style={{ width: '36%' }}>Meeting</th>
                <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong">Attendees</th>
                <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong">Date / Time</th>
                <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-right py-3.5 border-b border-border-strong">Status</th>
                <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-right py-3.5 border-b border-border-strong" style={{ width: '140px' }}></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const displayStatus = getDisplayStatus(event);
                const isExpanded = expandedErrorId === event.id;
                const isRetrying = retryingIds.has(event.id);
                const isPast = new Date(event.end) < new Date();
                return (
                  <React.Fragment key={event.id}>
                    <tr
                      className="cursor-pointer transition-colors hover:bg-surface-2"
                      onClick={() => handleRowClick(event, displayStatus)}
                    >
                      <td className="py-4.5 border-b border-border-base">
                        <div className="text-[15px] font-medium text-text-primary">{event.summary}</div>
                        {event.meetingUrl && (
                          <div className="font-mono text-[11px] text-text-muted mt-0.5 truncate max-w-[300px]">{event.meetingUrl}</div>
                        )}
                      </td>
                      <td className="py-4.5 border-b border-border-base font-mono text-[11px] text-text-secondary">
                        {formatAttendees(event.attendees)}
                      </td>
                      <td className="py-4.5 border-b border-border-base font-mono text-[11px] text-text-secondary">
                        <div>{formatDateTime(event.start)}</div>
                        <div className="text-text-muted">{formatTime(event.start)} — {formatTime(event.end)}</div>
                      </td>
                      <td className="py-4.5 border-b border-border-base text-right">
                        <StatusBadge status={displayStatus} />
                      </td>
                      <td className="py-4.5 border-b border-border-base text-right">
                        {displayStatus === 'failed' && !isPast && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRetry(event.id); }}
                            disabled={isRetrying}
                            className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-honey/40 bg-surface-3 text-honey uppercase tracking-wider hover:bg-honey/10 transition-all disabled:opacity-40"
                          >
                            {isRetrying ? 'Retrying...' : 'Retry Bot'}
                          </button>
                        )}
                        {!event.botStatus && event.meetingUrl && (displayStatus === 'scheduled' || displayStatus === 'live') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSendBot(event.id); }}
                            disabled={isRetrying}
                            className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-honey/40 bg-surface-3 text-honey uppercase tracking-wider hover:bg-honey/10 transition-all disabled:opacity-40"
                          >
                            {isRetrying ? 'Sending...' : 'Send Bot'}
                          </button>
                        )}
                        {displayStatus === 'done' && event.recallBotId && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenTranscript(event.id, event.summary); }}
                            className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-honey/40 bg-surface-3 text-honey uppercase tracking-wider hover:bg-honey/10 transition-all"
                          >
                            View Transcript
                          </button>
                        )}
                        {(displayStatus === 'past' || displayStatus === 'done' || displayStatus === 'failed' || (isPast && event.botStatus)) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemove(event, displayStatus); }}
                            className="font-mono text-[10px] font-medium px-2 py-1.5 text-text-muted hover:text-red-400 transition-colors ml-1"
                            title="Remove"
                          >
                            &#x2715;
                          </button>
                        )}
                        {!isPast && (displayStatus === 'scheduled' || displayStatus === 'bot_scheduled') && event.botStatus && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemove(event, displayStatus); }}
                            className="font-mono text-[10px] font-medium px-2 py-1.5 text-text-muted hover:text-red-400 transition-colors ml-1"
                            title="Cancel & Remove"
                          >
                            &#x2715;
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && event.botError && (
                      <tr>
                        <td colSpan={5} className="border-b border-border-base bg-surface-1 px-6 py-3">
                          <div className="font-mono text-[11px] text-text-muted">
                            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#E87B6B' }}>Error: </span>
                            {event.botError}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
