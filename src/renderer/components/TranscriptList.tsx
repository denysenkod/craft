import React, { useEffect, useState } from 'react';

interface TranscriptSummary {
  id: string;
  meetingId: string;
  title: string;
  speakers: string[];
  durationMin: number;
  createdAt: string;
}

interface TranscriptListProps {
  onSelect: (transcriptId: string, meetingId: string, title: string) => void;
}

const SPEAKER_COLORS = ['#E8A838', '#6BA8E8', '#5CC9A0', '#E87B6B', '#B88AE8', '#E8D06B'];

function groupByTime(items: TranscriptSummary[]): { label: string; items: TranscriptSummary[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const groups: { label: string; items: TranscriptSummary[] }[] = [];
  const today: TranscriptSummary[] = [];
  const thisWeek: TranscriptSummary[] = [];
  const earlier: TranscriptSummary[] = [];

  for (const item of items) {
    const d = new Date(item.createdAt);
    if (d >= todayStart) {
      today.push(item);
    } else if (d >= weekStart) {
      thisWeek.push(item);
    } else {
      earlier.push(item);
    }
  }

  if (today.length > 0) groups.push({ label: 'Today', items: today });
  if (thisWeek.length > 0) groups.push({ label: 'This Week', items: thisWeek });
  if (earlier.length > 0) groups.push({ label: 'Earlier', items: earlier });

  return groups;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  if (d >= todayStart) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } else if (d >= weekStart) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export default function TranscriptList({ onSelect }: TranscriptListProps) {
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.invoke('transcript:list') as TranscriptSummary[];
        setTranscripts(result);
      } catch (err) {
        console.error('Failed to load transcripts:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-10 pt-8 pb-6 shrink-0">
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Transcripts</h1>
        </div>
        <div className="px-7 py-12 text-center">
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (transcripts.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-10 pt-8 pb-6 shrink-0">
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Transcripts</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3a3a44" strokeWidth={1.5} className="mx-auto mb-3">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-text-muted">No transcripts yet</p>
            <p className="text-xs text-text-muted/50 mt-1.5">Record a meeting to see transcripts here</p>
          </div>
        </div>
      </div>
    );
  }

  const groups = groupByTime(transcripts);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-10 pt-8 pb-6 shrink-0">
        <h1 className="text-3xl font-semibold text-text-primary tracking-tight">Transcripts</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-10 pb-10">
        {groups.map((group) => (
          <div key={group.label} className="mb-6">
            <div className="text-xs font-medium text-text-muted mb-2">
              {group.label}
            </div>
            {group.items.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect(t.id, t.meetingId, t.title)}
                className="w-full text-left py-2.5 border-b border-border-base hover:bg-surface-2 transition-colors px-2 -mx-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{t.title}</span>
                  <span className="text-xs text-text-muted shrink-0 ml-4">
                    {formatTime(t.createdAt)}{t.durationMin > 0 ? ` · ${t.durationMin} min` : ''}
                  </span>
                </div>
                {t.speakers.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    {t.speakers.map((speaker, i) => (
                      <React.Fragment key={speaker}>
                        {i > 0 && <span className="text-xs text-text-muted/30">·</span>}
                        <span
                          className="text-xs"
                          style={{ color: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}
                        >
                          {speaker}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
