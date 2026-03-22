import React, { useState, useEffect, useRef } from 'react';
import AttendeeInput from './AttendeeInput';
import CalendarDayView from './CalendarDayView';
import MeetingPrepOverlay from './MeetingPrepOverlay';
import DatePicker from './DatePicker';
import TimePicker from './TimePicker';

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
    <span className="text-xs font-medium" style={{ color: s.color, textDecoration: s.strike ? 'line-through' : undefined }}>
      {s.dot && (
        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse" style={{ background: s.color }} />
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
  return {
    title: 'Test Meeting',
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    startTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    duration: '30',
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
  const [attendees, setAttendees] = useState<Array<{ email: string; name?: string; contactId?: string }>>([]);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [scheduling, setScheduling] = useState(false);
  const [showDayView, setShowDayView] = useState(false);
  const [showPrepOverlay, setShowPrepOverlay] = useState(false);
  const [selectedPrepEvent, setSelectedPrepEvent] = useState<CalendarEvent | null>(null);

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
    setAttendees([]);
    setDate(defaults.date);
    setStartTime(defaults.startTime);
    setDuration(defaults.duration);
    setDescription('');
    setShowScheduleForm(true);
    setShowPasteForm(false);
  };

  const handleSchedule = async () => {
    if (!title || !date || !startTime) return;
    setScheduling(true);
    try {
      const startDate = new Date(`${date}T${startTime}`);
      const endDate = new Date(startDate.getTime() + parseInt(duration) * 60 * 1000);
      const startDateTime = startDate.toISOString();
      const endDateTime = endDate.toISOString();
      const attendeeList = attendees.map((a) => a.email).filter(Boolean);

      const result = await window.api.invoke('calendar:create-event', {
        title,
        description,
        attendees: attendeeList,
        startDateTime,
        endDateTime,
      }) as CalendarEvent;

      // Link attendees with contact IDs to the event
      const contactIds = attendees.filter((a) => a.contactId).map((a) => a.contactId!);
      if (contactIds.length > 0 && result?.id) {
        await window.api.invoke('prep:set-attendees', { googleEventId: result.id, contactIds });
      }

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
      window.api.invoke('shell:open-external', event.meetingUrl);
      window.api.invoke('meeting-chat:open', { eventId: event.id, title: event.summary, meetingUrl: event.meetingUrl });
    } else if (displayStatus === 'done') {
      onOpenTranscript(event.id, event.summary);
    } else if (displayStatus === 'scheduled') {
      // Future event without bot — open prep overlay
      setSelectedPrepEvent(event);
      setShowPrepOverlay(true);
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

  const inputClass = 'text-sm px-3.5 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30 rounded-lg';

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-10 pt-8 pb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Meetings</h1>
          <p className="text-sm text-text-muted mt-1">Google Calendar events & bot scheduling</p>
        </div>
        <div className="flex gap-2.5">
          <button onClick={showScheduleForm ? () => setShowScheduleForm(false) : openScheduleForm} className="text-sm font-semibold px-5 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all">
            + Schedule Meeting
          </button>
        </div>
      </div>

      {/* Schedule Form */}
      {showScheduleForm && (
        <div className="mx-10 pb-6 mb-2 border-b border-border-base">
          <div className="flex gap-2.5 mb-2.5">
            <input className={`flex-1 ${inputClass}`} placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="mb-2.5">
            <textarea className={`w-full ${inputClass} resize-none h-16`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="mb-2.5">
            <label className="block text-xs font-medium text-text-muted mb-1.5">Attendees</label>
            <AttendeeInput attendees={attendees} onChange={setAttendees} />
          </div>
          <div className="flex gap-2.5 mb-4 items-start">
            <DatePicker value={date} onChange={setDate} />
            <TimePicker value={startTime} onChange={setStartTime} />
            <select className={`${inputClass} cursor-pointer`} value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
              <option value="120">2 hours</option>
            </select>
            <button
              onClick={() => setShowDayView(true)}
              className="text-xs font-medium px-3.5 py-2.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all whitespace-nowrap"
            >
              View Day
            </button>
          </div>
          <div className="flex gap-2.5">
            <button onClick={handleSchedule} disabled={scheduling || !title || !date || !startTime} className="text-sm font-semibold px-5 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {scheduling ? 'Scheduling...' : 'Schedule'}
            </button>
            <button onClick={() => setShowScheduleForm(false)} className="text-sm font-medium px-4 py-2.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all">
              Cancel
            </button>
            <div className="flex-1" />
            <button onClick={() => { setShowPasteForm(!showPasteForm); setShowScheduleForm(false); }} className="text-xs text-text-muted underline underline-offset-2 hover:text-honey transition-colors">
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
      <div className="px-10 pb-10 overflow-y-auto flex-1">
        {loading && (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted">Loading calendar events...</p>
          </div>
        )}
        {error && (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted">{error}</p>
            <button onClick={() => loadEvents()} className="font-mono text-[11px] text-honey underline mt-2">Retry</button>
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted">No calendar events found.</p>
          </div>
        )}
        {!loading && !error && events.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-xs font-medium text-text-muted text-left py-3 border-b border-border-base" style={{ width: '36%' }}>Meeting</th>
                <th className="text-xs font-medium text-text-muted text-left py-3.5 border-b border-border-base">Attendees</th>
                <th className="text-xs font-medium text-text-muted text-left py-3.5 border-b border-border-base">Date / Time</th>
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
                      <td className="py-4 border-b border-border-base">
                        <div className="text-sm font-medium text-text-primary">{event.summary}</div>
                        {event.meetingUrl && (
                          <div className="text-xs text-text-muted mt-0.5 truncate max-w-[300px]">{event.meetingUrl}</div>
                        )}
                      </td>
                      <td className="py-4 border-b border-border-base text-sm text-text-secondary">
                        {formatAttendees(event.attendees)}
                      </td>
                      <td className="py-4 border-b border-border-base text-sm text-text-secondary">
                        <div>{formatDateTime(event.start)}</div>
                        <div className="text-text-muted">{formatTime(event.start)} — {formatTime(event.end)}</div>
                      </td>
                      <td className="py-4 border-b border-border-base text-right">
                        <StatusBadge status={displayStatus} />
                      </td>
                      <td className="py-4 border-b border-border-base text-right">
                        {displayStatus === 'failed' && !isPast && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRetry(event.id); }}
                            disabled={isRetrying}
                            className="text-xs font-medium px-3 py-1.5 border border-honey/30 bg-surface-3 text-honey rounded-md hover:bg-honey/10 transition-all disabled:opacity-40"
                          >
                            {isRetrying ? 'Retrying...' : 'Retry Bot'}
                          </button>
                        )}
                        {!event.botStatus && event.meetingUrl && (displayStatus === 'scheduled' || displayStatus === 'live') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSendBot(event.id); }}
                            disabled={isRetrying}
                            className="text-xs font-medium px-3 py-1.5 border border-honey/30 bg-surface-3 text-honey rounded-md hover:bg-honey/10 transition-all disabled:opacity-40"
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

      {/* Meeting Prep Overlay */}
      {selectedPrepEvent && (
        <MeetingPrepOverlay
          open={showPrepOverlay}
          onClose={() => { setShowPrepOverlay(false); setSelectedPrepEvent(null); }}
          event={selectedPrepEvent}
        />
      )}

      {/* Calendar Day View Overlay */}
      <CalendarDayView
        open={showDayView}
        onClose={() => setShowDayView(false)}
        date={date}
        events={events}
        duration={parseInt(duration)}
        onSelectTime={(time) => { setStartTime(time); setShowDayView(false); }}
      />
    </div>
  );
}
