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

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Assign consistent colors to speakers
const SPEAKER_COLORS = ['#E8A838', '#6BA8E8', '#5CC9A0', '#E87B6B', '#B88AE8', '#E8D06B'];

export default function TranscriptView({ meetingId, meetingTitle, onTranscriptLoaded }: TranscriptViewProps) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    fetchTranscript();
  }, [meetingId]);

  const fetchTranscript = async () => {
    if (!meetingId) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);
    try {
      const result = await window.api.invoke('meeting:fetch-transcript', meetingId, meetingTitle) as {
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

  // Build speaker color map and extract unique attendees
  const speakerColorMap = new Map<string, string>();
  for (const entry of transcript) {
    const name = entry.participant?.name || 'Unknown';
    if (!speakerColorMap.has(name)) {
      speakerColorMap.set(name, SPEAKER_COLORS[speakerColorMap.size % SPEAKER_COLORS.length]);
    }
  }
  const attendees = Array.from(speakerColorMap.keys());

  // Extract meeting date from first word's absolute timestamp
  const meetingDate = transcript[0]?.words?.[0]?.start_timestamp?.absolute
    ? new Date(transcript[0].words[0].start_timestamp.absolute).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-7 py-4 border-b border-border-base shrink-0 bg-surface-0 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Transcript</div>
          <div className="text-[15px] font-medium text-text-primary mt-0.5">{meetingTitle}</div>
        </div>
        {(meetingDate || attendees.length > 0) && (
          <div className="flex items-center gap-3 text-[12px] text-text-muted shrink-0">
            {meetingDate && <span>{meetingDate}</span>}
            {meetingDate && attendees.length > 0 && <span className="text-border-base">|</span>}
            {attendees.length > 0 && <span>{attendees.join(', ')}</span>}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-7 py-12 text-center">
            <p className="font-mono text-xs text-text-muted">Loading transcript...</p>
          </div>
        )}
        {error && (
          <div className="px-7 py-12 text-center">
            <p className="font-mono text-xs text-text-muted">{error}</p>
            <button onClick={fetchTranscript} className="font-mono text-[11px] text-honey underline mt-2">Retry</button>
          </div>
        )}
        {statusMsg && (
          <div className="px-7 py-12 text-center">
            <p className="font-mono text-xs text-text-muted">{statusMsg}</p>
            <button onClick={fetchTranscript} className="font-mono text-[11px] text-honey underline mt-2">Retry</button>
          </div>
        )}
        {!loading && !error && !statusMsg && transcript.length === 0 && (
          <div className="px-7 py-12 text-center">
            <p className="font-mono text-xs text-text-muted">No transcript available.</p>
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
