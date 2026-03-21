import React from 'react';

interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  transcript_id?: string;
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

interface Props {
  proposal: Proposal;
  onApprove: (proposal: Proposal) => void;
  onReject: (proposalId: string) => void;
}

export default function ProposalCard({ proposal, onApprove, onReject }: Props) {
  const isResolved = proposal.status !== 'pending';
  const isCreate = proposal.proposal_type === 'create';

  if (isResolved) {
    return (
      <div className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border-base">
        <span className={`w-1.5 h-1.5 rounded-full ${proposal.status === 'approved' ? 'bg-green-400' : 'bg-text-muted'}`} />
        <span className="text-[11px] text-text-muted">
          {proposal.status === 'approved'
            ? (isCreate ? 'Task created' : 'Task updated')
            : (isCreate ? 'Task dismissed' : 'Update dismissed')}
        </span>
      </div>
    );
  }

  return (
    <div className="self-start max-w-[85%] rounded-xl overflow-hidden border border-border-strong bg-surface-2">
      {/* Content preview */}
      <div className="px-3.5 py-2.5">
        {isCreate ? (
          <>
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
              New task
            </div>
            <div className="text-[13px] font-medium text-text-primary">{proposal.title}</div>
            {proposal.description && (
              <div className="text-[11px] text-text-secondary mt-1 line-clamp-2">{proposal.description}</div>
            )}
          </>
        ) : (
          <>
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
              Update task
            </div>
            {proposal.changes?.title && (
              <div className="text-[12px] mb-1">
                <span className="text-red-400/70 line-through mr-2">{proposal.changes.title.old}</span>
                <span className="text-green-400">{proposal.changes.title.new}</span>
              </div>
            )}
            {proposal.changes?.description && (
              <div className="text-[11px] text-text-secondary line-clamp-2">{proposal.changes.description.new}</div>
            )}
            {proposal.reason && !proposal.changes?.title && !proposal.changes?.description && (
              <div className="text-[12px] text-text-secondary">{proposal.reason}</div>
            )}
          </>
        )}
      </div>

      {/* Compact action buttons */}
      <div className="flex border-t border-border-base">
        <button
          onClick={() => onApprove(proposal)}
          className="flex-1 py-2 text-[12px] font-semibold text-surface-0 bg-honey hover:bg-honey-dim transition-colors flex items-center justify-center gap-1.5"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" className="w-3 h-3">
            <path d="M5 13l4 4L19 7" />
          </svg>
          Approve
        </button>
        <button
          onClick={() => onReject(proposal.proposal_id)}
          className="flex-1 py-2 text-[12px] font-medium text-text-muted hover:text-red-400 transition-colors flex items-center justify-center gap-1.5 border-l border-border-base"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" className="w-3 h-3">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
          Reject
        </button>
      </div>
    </div>
  );
}
