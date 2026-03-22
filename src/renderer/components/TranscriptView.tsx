import React, { useEffect, useState } from 'react';

interface TranscriptViewProps {
  meetingId: string | null;
  meetingTitle: string;
  initialTranscriptId?: string | null;
  onTranscriptLoaded?: (transcriptId: string, meetingId: string) => void;
  onBack?: () => void;
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

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEAKER_COLORS = ['#E8A838', '#6BA8E8', '#5CC9A0', '#E87B6B', '#B88AE8', '#E8D06B'];

export default function TranscriptView({ meetingId, meetingTitle, initialTranscriptId, onTranscriptLoaded, onBack }: TranscriptViewProps) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialTranscriptId) {
      loadByTranscriptId(initialTranscriptId);
    } else if (meetingId) {
      fetchTranscript(meetingId);
    }
  }, [meetingId, initialTranscriptId]);

  const loadByTranscriptId = async (tId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.invoke('transcript:get', tId) as {
        id: string;
        meeting_id: string;
        transcript_json: TranscriptEntry[] | null;
      } | null;
      if (!result || !result.transcript_json) {
        setError('Transcript not found');
        return;
      }
      setTranscript(result.transcript_json);
      if (onTranscriptLoaded) {
        onTranscriptLoaded(result.id, result.meeting_id);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load transcript');
    } finally {
      setLoading(false);
    }
  };

  const fetchTranscript = async (id: string) => {
    setLoading(true);
    setError(null);
    setStatusMsg(null);
    try {
      const result = await window.api.invoke('meeting:fetch-transcript', id, meetingTitle) as {
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

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="px-7 py-4 border-b border-border-base shrink-0 bg-surface-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            >
              <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <div className="text-xs font-medium text-text-muted">Transcript</div>
            <div className="text-base font-semibold text-text-primary mt-0.5">{meetingTitle}</div>
          </div>
        </div>
        {meetingDate && (
          <div className="text-xs text-text-muted shrink-0">{meetingDate}</div>
        )}
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
            <button onClick={() => meetingId && fetchTranscript(meetingId)} className="text-xs text-honey underline mt-2">Retry</button>
          </div>
        )}
        {statusMsg && (
          <div className="px-7 py-12 text-center">
            <p className="text-sm text-text-muted">{statusMsg}</p>
            <button onClick={() => meetingId && fetchTranscript(meetingId)} className="text-xs text-honey underline mt-2">Retry</button>
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
            <div key={i} className="flex px-7 py-3.5 border-b border-border-base hover:bg-surface-2 transition-colors">
              <span className="font-mono text-[10px] text-text-muted min-w-[44px] pt-0.5">{formatTimestamp(time)}</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider min-w-[100px] pt-0.5 truncate" style={{ color }}>{speaker}</span>
              <span className="text-sm leading-relaxed text-text-secondary flex-1">{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
