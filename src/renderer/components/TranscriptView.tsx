import React, { useEffect, useState } from 'react';

interface TranscriptViewProps {
  meetingId: string | null;
  meetingTitle: string;
  onTranscriptLoaded?: (transcriptId: string, meetingId: string) => void;
}

interface TranscriptEntry {
  participant: {
    id: number;
    name: string;
  };
  words: Array<{
    text: string;
    start_timestamp: { relative: number; absolute: string };
    end_timestamp: { relative: number; absolute: string };
  }>;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: Array<{ email: string }>;
  botStatus: string | null;
  recallBotId: string | null;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SPEAKER_COLORS = ['#E8A838', '#6BA8E8', '#5CC9A0', '#E87B6B', '#B88AE8', '#E8D06B'];

export default function TranscriptView({ meetingId, meetingTitle, onTranscriptLoaded }: TranscriptViewProps) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [availableEvents, setAvailableEvents] = useState<CalendarEvent[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');

  const activeMeetingId = meetingId || selectedId;
  const activeTitle = meetingId ? meetingTitle : selectedTitle;

  useEffect(() => {
    if (meetingId) {
      setSelectedId(null);
      fetchTranscript(meetingId);
    } else {
      loadAvailableTranscripts();
    }
  }, [meetingId]);

  const loadAvailableTranscripts = async () => {
    setLoadingList(true);
    try {
      const events = await window.api.invoke('calendar:list-events') as CalendarEvent[];
      setAvailableEvents(events.filter((e) => e.botStatus === 'done' && e.recallBotId));
    } catch {
      setAvailableEvents([]);
    } finally {
      setLoadingList(false);
    }
  };

  const selectTranscript = (event: CalendarEvent) => {
    setSelectedId(event.id);
    setSelectedTitle(event.summary);
    fetchTranscript(event.id);
  };

  const fetchTranscript = async (id: string) => {
    setLoading(true);
    setError(null);
    setStatusMsg(null);
    try {
      const result = await window.api.invoke('meeting:fetch-transcript', id) as {
        status: string;
        transcript: TranscriptEntry[];
        transcriptId?: string;
        meetingId?: string;
        message?: string;
      };
      if (result.status !== 'done') {
        setStatusMsg(result.message || 'Transcript not ready yet');
        setTranscript([]);
      } else {
        const entries = result.transcript || [];
        setTranscript(entries);
        if (entries.length > 0 && onTranscriptLoaded && result.transcriptId && result.meetingId) {
          onTranscriptLoaded(result.transcriptId, result.meetingId);
        }
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fetch transcript');
    } finally {
      setLoading(false);
    }
  };

  const speakerColorMap = new Map<string, string>();
  for (const entry of transcript) {
    const name = entry.participant?.name || 'Unknown';
    if (!speakerColorMap.has(name)) {
      speakerColorMap.set(name, SPEAKER_COLORS[speakerColorMap.size % SPEAKER_COLORS.length]);
    }
  }

  const meetingDate = transcript[0]?.words?.[0]?.start_timestamp?.absolute
    ? new Date(transcript[0].words[0].start_timestamp.absolute).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  // Transcript list when no meeting selected
  if (!activeMeetingId) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-10 pt-8 pb-6">
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Transcripts</h1>
          <p className="text-sm text-text-muted mt-1">Select a meeting to view its transcript</p>
        </div>
        <div className="px-10 pb-10 overflow-y-auto flex-1">
          {loadingList && (
            <p className="text-sm text-text-muted py-8 text-center">Loading...</p>
          )}
          {!loadingList && availableEvents.length === 0 && (
            <p className="text-sm text-text-muted py-8 text-center">No transcripts available yet. Completed meetings with a bot will appear here.</p>
          )}
          {availableEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => selectTranscript(event)}
              className="w-full text-left flex items-center gap-4 px-5 py-4 border border-border-base rounded-xl mb-2 bg-surface-2 hover:bg-surface-3 hover:border-honey/20 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-surface-4 flex items-center justify-center shrink-0">
                <svg fill="none" stroke="#5CC9A0" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary group-hover:text-honey transition-colors truncate">{event.summary}</div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-text-muted">{formatDate(event.start)}</span>
                  <span className="text-xs text-text-muted">{formatTime(event.start)}</span>
                  <span className="text-xs text-text-muted">{formatDuration(event.start, event.end)}</span>
                  {event.attendees.length > 0 && (
                    <span className="text-xs text-text-muted">
                      {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4 text-text-muted group-hover:text-honey transition-colors shrink-0">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Transcript Pane */}
      <div className="flex-1 flex flex-col border-r border-border-base min-w-0">
        <div className="px-7 py-4 border-b border-border-base flex items-center justify-between shrink-0 bg-surface-0">
          <div className="flex items-center gap-3">
            {!meetingId && (
              <button
                onClick={() => { setSelectedId(null); setTranscript([]); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 transition-all"
              >
                <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div>
              <div className="text-xs font-medium text-text-muted">Transcript</div>
              <div className="text-base font-semibold text-text-primary mt-0.5">{activeTitle}</div>
              {meetingDate && (
                <div className="text-xs text-text-muted">{meetingDate}</div>
              )}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-7 py-12 text-center">
              <p className="text-sm text-text-muted">Loading transcript...</p>
            </div>
          )}
          {error && (
            <div className="px-7 py-12 text-center">
              <p className="text-sm text-text-muted">{error}</p>
              <button onClick={() => activeMeetingId && fetchTranscript(activeMeetingId)} className="text-xs text-honey underline mt-2">Retry</button>
            </div>
          )}
          {statusMsg && (
            <div className="px-7 py-12 text-center">
              <p className="text-sm text-text-muted">{statusMsg}</p>
              <button onClick={() => activeMeetingId && fetchTranscript(activeMeetingId)} className="text-xs text-honey underline mt-2">Retry</button>
            </div>
          )}
          {!loading && !error && !statusMsg && transcript.length === 0 && (
            <div className="px-7 py-12 text-center">
              <p className="text-sm text-text-muted">No transcript available.</p>
            </div>
          )}
          {transcript.map((entry, i) => {
            const speaker = entry.participant?.name || 'Unknown';
            const color = speakerColorMap.get(speaker) || '#E8A838';
            const text = entry.words.map((w) => w.text).join(' ');
            const time = entry.words[0]?.start_timestamp?.relative ?? 0;
            return (
              <div key={i} className="flex px-7 py-3 border-b border-border-base hover:bg-surface-2 transition-colors">
                <span className="text-xs text-text-muted min-w-[48px] pt-0.5">{formatTimestamp(time)}</span>
                <span className="text-xs font-semibold min-w-[110px] pt-0.5 truncate" style={{ color }}>{speaker}</span>
                <span className="text-sm leading-relaxed text-text-secondary flex-1">{text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Analysis Pane */}
      <div className="w-[400px] flex flex-col overflow-hidden bg-surface-2 shrink-0">
        <div className="px-6 py-4 border-b border-border-base flex items-center justify-between bg-surface-0">
          <span className="text-xs font-medium text-text-muted">Analysis</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8">
            <p className="text-sm text-text-muted mb-4">Generate an AI-powered analysis of this transcript including summary, pain points, key quotes, and sentiment.</p>
            <button
              disabled={transcript.length === 0}
              className="text-sm font-semibold px-5 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generate Analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
