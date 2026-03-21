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

  if (proposal.proposal_type === 'create') {
    return (
      <div className="max-w-[85%] rounded-2xl overflow-hidden border border-honey/20 bg-surface-2">
        <div className="px-4 py-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-honey mb-1.5">
            {isResolved
              ? proposal.status === 'approved' ? 'Task Created' : 'Task Dismissed'
              : 'Create Task?'}
          </div>
          <div className="text-[14px] font-medium text-text-primary mb-1">{proposal.title}</div>
          <div className="text-[12px] text-text-secondary leading-snug">{proposal.description}</div>
        </div>
        {!isResolved && (
          <div className="flex gap-1.5 px-4 py-2.5 border-t border-honey/10">
            <button
              onClick={() => onApprove(proposal)}
              className="font-mono text-[10px] font-semibold px-3 py-1.5 bg-honey text-surface-0 rounded-full uppercase tracking-wider hover:bg-honey-dim transition-all"
            >
              Approve
            </button>
            <button
              onClick={() => onReject(proposal.proposal_id)}
              className="font-mono text-[10px] font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-full uppercase tracking-wider hover:border-red-400 hover:text-red-400 transition-all"
            >
              Reject
            </button>
          </div>
        )}
        {isResolved && (
          <div className="px-4 py-2 border-t border-honey/10">
            <span className={`font-mono text-[10px] uppercase tracking-wider ${proposal.status === 'approved' ? 'text-green-400' : 'text-text-muted'}`}>
              {proposal.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Update proposal
  return (
    <div className="max-w-[85%] rounded-2xl overflow-hidden border border-blue-400/20 bg-surface-2">
      <div className="px-4 py-3">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-400 mb-1.5">
          {isResolved
            ? proposal.status === 'approved' ? 'Task Updated' : 'Update Dismissed'
            : 'Update Task?'}
        </div>
        {proposal.reason && (
          <div className="text-[12px] text-text-secondary mb-2 italic">{proposal.reason}</div>
        )}
        {proposal.changes?.title && (
          <div className="mb-1.5">
            <div className="font-mono text-[10px] text-text-muted mb-0.5">Title</div>
            <div className="text-[12px] text-red-400/70 line-through">{proposal.changes.title.old}</div>
            <div className="text-[12px] text-green-400">{proposal.changes.title.new}</div>
          </div>
        )}
        {proposal.changes?.description && (
          <div>
            <div className="font-mono text-[10px] text-text-muted mb-0.5">Description</div>
            <div className="text-[11px] text-red-400/70 line-through leading-snug">{proposal.changes.description.old}</div>
            <div className="text-[11px] text-green-400 leading-snug mt-0.5">{proposal.changes.description.new}</div>
          </div>
        )}
      </div>
      {!isResolved && (
        <div className="flex gap-1.5 px-4 py-2.5 border-t border-blue-400/10">
          <button
            onClick={() => onApprove(proposal)}
            className="font-mono text-[10px] font-semibold px-3 py-1.5 bg-blue-500 text-white rounded-full uppercase tracking-wider hover:bg-blue-400 transition-all"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(proposal.proposal_id)}
            className="font-mono text-[10px] font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-full uppercase tracking-wider hover:border-red-400 hover:text-red-400 transition-all"
          >
            Reject
          </button>
        </div>
      )}
      {isResolved && (
        <div className="px-4 py-2 border-t border-blue-400/10">
          <span className={`font-mono text-[10px] uppercase tracking-wider ${proposal.status === 'approved' ? 'text-green-400' : 'text-text-muted'}`}>
            {proposal.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        </div>
      )}
    </div>
  );
}
