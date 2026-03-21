import React, { useEffect, useState } from 'react';

interface TranscriptViewProps {
  meetingId: string | null;
  meetingTitle: string;
  onOpenChat: () => void;
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

export default function TranscriptView({ meetingId, meetingTitle, onOpenChat }: TranscriptViewProps) {
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
      const result = await window.api.invoke('meeting:fetch-transcript', meetingId) as {
        status: string;
        transcript: TranscriptEntry[];
        message?: string;
      };
      if (result.status !== 'done') {
        setStatusMsg(result.message || 'Transcript not ready yet');
        setTranscript([]);
      } else {
        setTranscript(result.transcript || []);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fetch transcript');
    } finally {
      setLoading(false);
    }
  };

  // Build speaker color map
  const speakerColorMap = new Map<string, string>();
  for (const entry of transcript) {
    const name = entry.participant?.name || 'Unknown';
    if (!speakerColorMap.has(name)) {
      speakerColorMap.set(name, SPEAKER_COLORS[speakerColorMap.size % SPEAKER_COLORS.length]);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Transcript Pane */}
      <div className="flex-1 flex flex-col border-r border-border-base min-w-0">
        <div className="px-7 py-4 border-b border-border-base flex items-center justify-between shrink-0 bg-surface-0">
          <div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Transcript</div>
            <div className="text-[15px] font-medium text-text-primary mt-0.5">{meetingTitle}</div>
          </div>
          <button onClick={onOpenChat} className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">
            Chat &rarr;
          </button>
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

      {/* Analysis Pane */}
      <div className="w-[400px] flex flex-col overflow-hidden bg-surface-2 shrink-0">
        <div className="px-6 py-4 border-b border-border-base flex items-center justify-between bg-surface-0">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Analysis</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8">
            <p className="font-mono text-xs text-text-muted mb-4">Generate an AI-powered analysis of this transcript including summary, pain points, key quotes, and sentiment.</p>
            <button
              disabled={transcript.length === 0}
              className="font-mono text-[11px] font-semibold px-5 py-2.5 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generate Analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
