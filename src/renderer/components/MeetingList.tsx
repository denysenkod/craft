import React, { useState } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void;
      off: (channel: string, subscription: (...args: unknown[]) => void) => void;
    };
  }
}

interface MeetingListProps {
  onOpenTranscript: (transcriptId: string, meetingId: string) => void;
  onOpenMomTest: () => void;
}

const MOCK_MEETINGS = [
  { id: '1', title: 'Enterprise Onboarding — Sarah Chen', url: 'meet.google.com/abc-defg-hij', date: 'Mar 20, 2026', duration: '42 min', status: 'done' as const },
  { id: '2', title: 'Billing Pain Points — Marcus Rivera', url: 'zoom.us/j/123456789', date: 'Mar 20, 2026', duration: '18 min', status: 'recording' as const },
  { id: '3', title: 'API Integration Feedback — Lena Kowalski', url: 'meet.google.com/xyz-uvwx-yza', date: 'Mar 19, 2026', duration: '55 min', status: 'done' as const },
  { id: '4', title: 'Dashboard Redesign — Tom Nguyen', url: 'meet.google.com/pending', date: 'Mar 21, 2026', duration: '—', status: 'pending' as const },
  { id: '5', title: 'Competitor Analysis — Internal', url: 'zoom.us/j/987654321', date: 'Mar 18, 2026', duration: '—', status: 'failed' as const },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { color: string; label: string; dot?: boolean; strike?: boolean }> = {
    recording: { color: '#E87B6B', label: 'Rec', dot: true },
    done: { color: '#5CC9A0', label: 'Done' },
    pending: { color: '#5E5B54', label: 'Pending' },
    failed: { color: '#5E5B54', label: 'Failed', strike: true },
  };
  const s = styles[status] || styles.pending;
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

export default function MeetingList({ onOpenTranscript, onOpenMomTest }: MeetingListProps) {
  const [showJoinForm, setShowJoinForm] = useState(false);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-12 pt-10 pb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-light italic text-text-primary" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>Meetings</h1>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.12em] mt-2">Record & analyze customer interviews</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenMomTest} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">
            Prepare Questions
          </button>
          <button onClick={() => setShowJoinForm(!showJoinForm)} className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">
            + Join Meeting
          </button>
        </div>
      </div>

      {/* Join Form */}
      {showJoinForm && (
        <div className="mx-12 pb-6 border-b border-border-strong">
          <div className="flex gap-2 mb-2">
            <input className="flex-1 font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30" placeholder="Meeting title" />
            <input className="flex-1 font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30" placeholder="Google Meet / Zoom URL" />
          </div>
          <div className="flex gap-2">
            <button className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Send Bot</button>
            <button onClick={() => setShowJoinForm(false)} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Cancel</button>
            <div className="flex-1" />
            <button className="font-mono text-[11px] text-text-muted underline underline-offset-2 hover:text-honey transition-colors">paste transcript</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="px-12 pb-12 overflow-y-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong" style={{ width: '44%' }}>Meeting</th>
              <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong">Date</th>
              <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-left py-3.5 border-b border-border-strong">Duration</th>
              <th className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted text-right py-3.5 border-b border-border-strong">Status</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_MEETINGS.map((m) => (
              <tr
                key={m.id}
                className="cursor-pointer transition-colors hover:bg-surface-2"
                onClick={() => m.status === 'done' && onOpenTranscript(m.id, m.id)}
              >
                <td className="py-4.5 border-b border-border-base">
                  <div className="text-[15px] font-medium text-text-primary">{m.title}</div>
                  <div className="font-mono text-[11px] text-text-muted mt-0.5">{m.url}</div>
                </td>
                <td className="py-4.5 border-b border-border-base font-mono text-[11px] text-text-secondary">{m.date}</td>
                <td className="py-4.5 border-b border-border-base font-mono text-[11px] text-text-secondary">{m.duration}</td>
                <td className="py-4.5 border-b border-border-base text-right"><StatusBadge status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
