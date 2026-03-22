import React, { useEffect, useRef, useState } from 'react';
import BuildChat from './BuildChat';

interface BuildEvent {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

interface BuildData {
  id: string;
  task_title: string;
  task_description: string | null;
  pm_notes: string | null;
  transcript_context: string | null;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  summary: string | null;
  files_changed: number;
  error_message: string | null;
  created_at: string;
  events: BuildEvent[];
}

interface BuildDetailProps {
  build: BuildData;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  queued: { label: 'Queued', bg: 'rgba(232,168,56,0.15)', text: '#E8A838' },
  running: { label: 'Running', bg: 'rgba(74,222,128,0.15)', text: '#4ade80' },
  awaiting_input: { label: 'Needs Input', bg: 'rgba(232,168,56,0.15)', text: '#E8A838' },
  done: { label: 'Done', bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  failed: { label: 'Failed', bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
};

function formatTime(dateStr: string, baseDateStr: string): string {
  const diff = new Date(dateStr).getTime() - new Date(baseDateStr).getTime();
  const totalSecs = Math.max(0, Math.floor(diff / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function BuildDetail({ build, onCancel, onRetry }: BuildDetailProps) {
  const [briefOpen, setBriefOpen] = useState(false);
  const statusCfg = STATUS_CONFIG[build.status] || STATUS_CONFIG.queued;
  const isActive = build.status === 'running' || build.status === 'awaiting_input';
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current && isActive) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [build.events.length, isActive]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border-base shrink-0">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-primary truncate">{build.task_title}</h3>
            <div className="text-xs text-text-muted mt-1">
              {build.repo_name}
              {build.branch_name && (
                <span className="text-blue-400 ml-1.5">{build.branch_name}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: statusCfg.bg, color: statusCfg.text }}
            >
              {statusCfg.label}
            </span>
            {isActive && (
              <button
                onClick={() => onCancel(build.id)}
                className="text-xs px-2.5 py-1 rounded-full border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-all"
              >
                Cancel
              </button>
            )}
            {build.status === 'failed' && (
              <button
                onClick={() => onRetry(build.id)}
                className="text-xs px-2.5 py-1 rounded-full border border-honey/30 text-honey hover:bg-honey/10 transition-all"
              >
                Retry
              </button>
            )}
          </div>
        </div>

        {/* Collapsible build brief */}
        <button
          onClick={() => setBriefOpen(!briefOpen)}
          className="mt-2 w-full text-left px-3 py-2 rounded-lg transition-all"
          style={{ background: 'rgba(232,168,56,0.06)', border: '1px solid rgba(232,168,56,0.12)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-honey font-medium">Build Brief</span>
            <span className="text-xs text-text-muted">{briefOpen ? 'Collapse' : 'Expand'}</span>
          </div>
        </button>
        {briefOpen && (
          <div className="mt-2 px-3 py-2 text-xs text-text-secondary space-y-2">
            {build.task_description && <div><span className="text-text-muted">Description:</span> {build.task_description}</div>}
            {build.pm_notes && <div><span className="text-text-muted">PM Notes:</span> {build.pm_notes}</div>}
            {build.transcript_context && <div><span className="text-text-muted">Transcript:</span> {build.transcript_context.slice(0, 300)}...</div>}
          </div>
        )}
      </div>

      {/* Completion card */}
      {build.status === 'done' && (
        <div className="p-4 border-b border-border-base shrink-0">
          <div className="rounded-lg p-4" style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">Build Complete</span>
              <span className="text-xs text-text-muted">{build.files_changed} files changed</span>
            </div>
            {build.summary && (
              <p className="text-xs text-text-secondary mb-3">{build.summary.slice(0, 300)}</p>
            )}
            {build.pr_url && (
              <button
                onClick={() => window.api.invoke('shell:open-external', build.pr_url)}
                className="text-sm font-medium px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all"
              >
                View Draft PR on GitHub
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      {build.status === 'failed' && build.error_message && (
        <div className="p-4 border-b border-border-base shrink-0">
          <div className="rounded-lg p-3" style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)' }}>
            <span className="text-xs text-red-400">{build.error_message}</span>
          </div>
        </div>
      )}

      {/* Progress stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-3">Progress</div>
        {build.events.length === 0 && (
          <div className="text-sm text-text-muted">Waiting to start...</div>
        )}
        <div className="space-y-1">
          {build.events.map((event, i) => {
            const isLast = i === build.events.length - 1;
            const isError = event.type === 'error';
            const isQuestion = event.type === 'question';
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 px-2.5 py-2 rounded-lg"
                style={{
                  background: isQuestion ? 'rgba(232,168,56,0.08)' : isLast && isActive ? 'rgba(232,168,56,0.06)' : isError ? 'rgba(248,113,113,0.06)' : 'transparent',
                  border: isQuestion ? '1px solid rgba(232,168,56,0.2)' : isLast && isActive ? '1px solid rgba(232,168,56,0.12)' : '1px solid transparent',
                }}
              >
                <span className="text-xs text-text-muted whitespace-nowrap min-w-[36px] mt-0.5">
                  {formatTime(event.created_at, build.created_at)}
                </span>
                <div
                  className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                  style={{
                    background: isQuestion ? '#E8A838' : isError ? '#f87171' : isLast && isActive ? '#E8A838' : '#4ade80',
                    animation: isLast && isActive ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <span className={`text-xs ${isError ? 'text-red-400' : isQuestion ? 'text-honey' : 'text-text-primary'}`}>
                  {event.content}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat panel for Q&A */}
      {build.status === 'awaiting_input' && (
        <BuildChat buildId={build.id} />
      )}
    </div>
  );
}
