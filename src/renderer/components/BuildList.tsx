import React from 'react';

interface Build {
  id: string;
  task_title: string;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  created_at: string;
}

interface BuildListProps {
  builds: Build[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewBuild: () => void;
}

const STATUS_DOT: Record<string, { color: string; pulse?: boolean }> = {
  queued: { color: '#E8A838' },
  running: { color: '#4ade80', pulse: true },
  awaiting_input: { color: '#E8A838', pulse: true },
  done: { color: '#60a5fa' },
  failed: { color: '#f87171' },
  cancelled: { color: '#9ca3af' },
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_input: 'Needs Input',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function BuildList({ builds, selectedId, onSelect, onNewBuild }: BuildListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={onNewBuild}
          className="w-full text-sm font-medium px-4 py-2.5 bg-honey/10 text-honey rounded-lg hover:bg-honey/20 transition-all"
        >
          + New Build
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {builds.length === 0 && (
          <div className="text-sm text-text-muted text-center mt-8 px-4">
            No builds yet. Create one to get started.
          </div>
        )}
        {builds.map((build) => {
          const dot = STATUS_DOT[build.status] || STATUS_DOT.queued;
          const isSelected = build.id === selectedId;
          return (
            <button
              key={build.id}
              onClick={() => onSelect(build.id)}
              className={`w-full text-left p-3 rounded-lg mb-1 transition-all ${
                isSelected
                  ? 'bg-honey/10 border border-honey/20'
                  : 'hover:bg-surface-3 border border-transparent'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{
                    background: dot.color,
                    animation: dot.pulse ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">{build.task_title}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {build.repo_name} · {STATUS_LABEL[build.status] || build.status}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">{timeAgo(build.created_at)}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
