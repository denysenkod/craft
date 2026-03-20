import React, { useState } from 'react';

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'approved' | 'pushed';
  source: 'auto' | 'chat';
  linearId?: string;
}

const MOCK_TASKS: Task[] = [
  { id: '1', title: 'Add real-time migration progress bar', description: 'Replace static page with real-time progress: records processed, ETA, per-field status.', status: 'draft', source: 'auto' },
  { id: '2', title: 'Implement migration rollback system', description: 'Transactional migration with clean revert capability. Store pre-migration snapshots.', status: 'draft', source: 'auto' },
  { id: '3', title: 'Add error messages for Salesforce custom field failures', description: 'Detailed error reporting: which fields failed, why, and suggested fixes.', status: 'draft', source: 'auto' },
  { id: '4', title: 'Build dry-run migration validation', description: 'Pre-migration validation with field mapping preview. Stripe dry-run model.', status: 'approved', source: 'chat' },
  { id: '5', title: 'Inline validation errors for data import', description: 'Intercom-style inline validation during import.', status: 'approved', source: 'chat' },
  { id: '6', title: 'Salesforce custom field auto-detection', description: 'Auto-detect field types and suggest mappings.', status: 'approved', source: 'auto' },
  { id: '7', title: 'Audit silent failure modes in import pipeline', description: '', status: 'pushed', source: 'auto', linearId: 'ENG-342' },
  { id: '8', title: 'Customer escalation playbook for onboarding delays', description: '', status: 'pushed', source: 'auto', linearId: 'ENG-343' },
];

export default function TaskReview() {
  const [tasks, setTasks] = useState(MOCK_TASKS);
  const draft = tasks.filter((t) => t.status === 'draft');
  const approved = tasks.filter((t) => t.status === 'approved');
  const pushed = tasks.filter((t) => t.status === 'pushed');

  const toggleApprove = (id: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: t.status === 'draft' ? 'approved' as const : 'draft' as const } : t));
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-12 pt-10 pb-8 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-light italic text-text-primary">Tasks</h1>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-[0.12em] mt-2">Review, approve & push to Linear</p>
        </div>
        <button className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">
          Push {approved.length} to Linear &rarr;
        </button>
      </div>

      {/* Stats */}
      <div className="flex mx-12 border-b border-border-strong">
        {[
          { value: draft.length, label: 'Draft' },
          { value: approved.length, label: 'Approved' },
          { value: pushed.length, label: 'Pushed' },
        ].map((stat) => (
          <div key={stat.label} className="flex-1 py-6 text-center border-r border-border-base last:border-r-0">
            <div className="text-[42px] font-light italic text-honey">{stat.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-[0.1em] mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-12 pb-12">
        {draft.length > 0 && (
          <>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted pt-6 pb-3 border-b border-border-strong">Draft</div>
            {draft.map((t) => (
              <TaskItem key={t.id} task={t} onApprove={() => toggleApprove(t.id)} />
            ))}
          </>
        )}
        {approved.length > 0 && (
          <>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted pt-6 pb-3 border-b border-border-strong">Approved</div>
            {approved.map((t) => (
              <TaskItem key={t.id} task={t} approved />
            ))}
          </>
        )}
        {pushed.length > 0 && (
          <>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted pt-6 pb-3 border-b border-border-strong">Pushed to Linear</div>
            {pushed.map((t) => (
              <TaskItem key={t.id} task={t} pushed />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function TaskItem({ task, approved, pushed, onApprove }: { task: Task; approved?: boolean; pushed?: boolean; onApprove?: () => void }) {
  return (
    <div className="flex items-start gap-4 py-4.5 border-b border-border-base" style={{ opacity: pushed ? 0.5 : 1 }}>
      <button
        className="w-[18px] h-[18px] border shrink-0 mt-0.5 flex items-center justify-center"
        style={{
          borderColor: approved || pushed ? '#E8A838' : '#3A3A44',
          background: approved || pushed ? '#E8A838' : 'transparent',
        }}
        onClick={onApprove}
      >
        {(approved || pushed) && (
          <svg fill="none" stroke="#07070A" strokeWidth={3} viewBox="0 0 24 24" className="w-[11px] h-[11px]">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[15px] font-medium text-text-primary" style={{ textDecoration: pushed ? 'line-through' : undefined }}>{task.title}</span>
          <div className="flex gap-2 items-center">
            {pushed && task.linearId && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-green-400">{task.linearId}</span>
            )}
            {!pushed && (
              <span
                className="font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px border"
                style={{
                  borderColor: task.source === 'chat' ? 'rgba(232,168,56,0.3)' : '#3A3A44',
                  color: task.source === 'chat' ? '#E8A838' : '#5E5B54',
                }}
              >
                {task.source}
              </span>
            )}
          </div>
        </div>
        {task.description && !pushed && (
          <div className="text-[13px] text-text-secondary leading-snug mb-3">{task.description}</div>
        )}
        {!approved && !pushed && onApprove && (
          <div className="flex gap-1.5">
            <button onClick={onApprove} className="font-mono text-[10px] font-semibold px-2.5 py-1.5 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Approve</button>
            <button className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Edit</button>
            <button className="font-mono text-[10px] text-text-muted underline underline-offset-2 px-2.5 py-1.5 hover:text-red-400 transition-colors">Reject</button>
          </div>
        )}
      </div>
    </div>
  );
}
