import React, { useState, useEffect } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

// ── Types ───────────────────────────────────────────────────────────

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  statusId: string;
  status: string;
  statusType: string;  // "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
  statusColor: string;
  priority: number;
  priorityLabel: string;
  assigneeName: string | null;
  assigneeInitials: string | null;
  blockedBy: { id: string; identifier: string; title: string }[];
  blocking: { id: string; identifier: string; title: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
}

// ── Priority icon ───────────────────────────────────────────────────

function PriorityIcon({ priority }: { priority: number }) {
  const bars = 4;
  const filled = priority === 0 ? 0 : 5 - priority;
  return (
    <div className="flex items-end gap-[2px] h-[12px]" title={`Priority ${priority}`}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-[2.5px] rounded-sm"
          style={{
            height: `${3 + i * 2.5}px`,
            background: i < filled ? (priority <= 1 ? '#E5484D' : priority === 2 ? '#E8A838' : '#5E5B54') : '#2A2A32',
          }}
        />
      ))}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export default function TaskReview() {
  const [linearIssues, setLinearIssues] = useState<LinearIssue[]>([]);
  const [workflowStates, setWorkflowStates] = useState<WorkflowState[]>([]);
  const [linearConnected, setLinearConnected] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<LinearIssue | null>(null);

  useEffect(() => {
    window.api.invoke('linear:status').then((status: any) => {
      setLinearConnected(status.connected);
      if (status.connected) {
        Promise.all([
          window.api.invoke('linear:get-states'),
          window.api.invoke('linear:get-issues'),
        ]).then(([states, issues]: any) => {
          setWorkflowStates(states);
          setLinearIssues(issues);
          setLoadingIssues(false);
        }).catch(() => setLoadingIssues(false));
      } else {
        setLoadingIssues(false);
      }
    });
  }, []);

  // Columns = workflow states from Linear, already sorted by type+position from the backend
  const columns = workflowStates.map((state) => ({
    ...state,
    issues: linearIssues.filter((issue) => issue.status === state.name),
    blockedCount: linearIssues.filter((issue) => issue.status === state.name && issue.blockedBy.length > 0).length,
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-5 flex items-end justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-light italic text-text-primary">Tasks</h1>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.12em] mt-1.5">Linear Issues</p>
        </div>
        {linearConnected && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="font-mono text-[10px] text-text-muted">Connected</span>
          </div>
        )}
      </div>

      {/* Kanban board */}
      {!linearConnected ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] text-text-muted mb-2">Connect to Linear to see your issues</p>
            <p className="font-mono text-[10px] text-text-muted">Settings &rarr; Linear &rarr; Connect</p>
          </div>
        </div>
      ) : loadingIssues ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="font-mono text-[11px] text-text-muted animate-pulse">Loading issues...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden px-6 pb-6">
          <div className="flex gap-3 h-full">
            {columns.map((col) => (
              <div key={col.id} className="flex flex-col flex-1 min-w-0">
                {/* Column header */}
                <div className="flex items-center gap-2 px-2 py-3 shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                    {col.name}
                  </span>
                  <span className="font-mono text-[11px] text-text-muted">{col.issues.length}</span>
                  {col.blockedCount > 0 && (
                    <span className="font-mono text-[10px] text-red-400 ml-auto">{col.blockedCount} blocked</span>
                  )}
                </div>
                {/* Column body */}
                <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
                  {col.issues.length === 0 ? (
                    <div className="py-8 text-center rounded-lg border border-dashed border-border-base">
                      <span className="font-mono text-[10px] text-text-muted">No issues</span>
                    </div>
                  ) : col.issues.map((issue) => (
                    <button
                      key={issue.id}
                      onClick={() => setSelectedIssue(issue)}
                      className="text-left w-full p-3 rounded-lg border border-border-base bg-surface-2 hover:border-border-strong transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <PriorityIcon priority={issue.priority} />
                        <span className="font-mono text-[10px] text-text-muted">{issue.identifier}</span>
                      </div>
                      <div className="text-[13px] font-medium text-text-primary leading-snug mb-1">{issue.title}</div>
                      {issue.description && (
                        <div className="text-[11px] text-text-muted leading-snug line-clamp-2 mb-2">{issue.description}</div>
                      )}
                      {issue.assigneeName && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-5 h-5 rounded-full bg-surface-3 border border-border-base flex items-center justify-center">
                            <span className="font-mono text-[8px] font-semibold text-text-muted">{issue.assigneeInitials}</span>
                          </div>
                          <span className="text-[11px] text-text-muted">{issue.assigneeName}</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issue detail modal */}
      {selectedIssue && (
        <IssueDetailModal issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      )}

      <style>{`
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

// ── Issue detail modal ──────────────────────────────────────────────

function IssueDetailModal({ issue, onClose }: { issue: LinearIssue; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.8)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] max-h-[80vh] overflow-y-auto bg-surface-2 border border-border-strong rounded-xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full" style={{ background: issue.statusColor }} />
            <span className="font-mono text-[11px] text-text-muted">{issue.identifier}</span>
            <span className="font-mono text-[10px] text-text-muted px-2 py-0.5 rounded-full border border-border-base">{issue.status}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-3"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <div className="px-6 pb-4">
          <h2 className="text-[20px] font-medium text-text-primary leading-snug">{issue.title}</h2>
        </div>

        {/* Meta */}
        <div className="flex gap-6 px-6 pb-5 border-b border-border-base">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-text-muted mb-1">Priority</div>
            <div className="flex items-center gap-2">
              <PriorityIcon priority={issue.priority} />
              <span className="text-[12px] text-text-secondary">{issue.priorityLabel || 'None'}</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-text-muted mb-1">Assignee</div>
            <span className="text-[12px] text-text-secondary">{issue.assigneeName || 'Unassigned'}</span>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-text-muted mb-1">Created</div>
            <span className="text-[12px] text-text-secondary">{new Date(issue.createdAt).toLocaleDateString()}</span>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-text-muted mb-1">Updated</div>
            <span className="text-[12px] text-text-secondary">{new Date(issue.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Description */}
        <div className="px-6 py-5">
          {issue.description ? (
            <div className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-line">{issue.description}</div>
          ) : (
            <div className="text-[13px] text-text-muted italic">No description</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-base flex justify-end">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] font-medium px-4 py-2 rounded-lg border border-[#5E6AD2] text-[#5E6AD2] uppercase tracking-wider hover:bg-[#5E6AD2] hover:text-white transition-all"
            onClick={(e) => {
              e.preventDefault();
              window.api.invoke('settings:get'); // just to trigger — we'd use shell.openExternal in main
            }}
          >
            Open in Linear &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}

function PriorityIconStandalone({ priority }: { priority: number }) {
  return <PriorityIcon priority={priority} />;
}
