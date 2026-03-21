import React from 'react';

const TOOL_LABELS: Record<string, string> = {
  get_transcript: 'Reading transcript',
  search_transcripts: 'Searching transcripts',
  get_meeting: 'Looking up meeting',
  list_meetings: 'Listing meetings',
  get_task: 'Looking up task',
  list_tasks: 'Listing tasks',
  create_task: 'Drafting task',
  update_task: 'Preparing task update',
};

interface Props {
  tool: string;
  args: Record<string, unknown>;
}

export default function ToolCallIndicator({ tool, args }: Props) {
  const label = TOOL_LABELS[tool] || `Running ${tool}`;
  const detail = args.query ? `"${args.query}"` : args.task_id || args.transcript_id || '';

  return (
    <div className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-2 border border-border-base text-[12px] text-text-muted">
      <span
        className="w-1.5 h-1.5 rounded-full bg-honey"
        style={{ animation: 'thinkBounce 1.4s ease-in-out infinite' }}
      />
      <span>{label}</span>
      {detail && <span className="text-text-muted/60 truncate max-w-[200px]">{String(detail)}</span>}
    </div>
  );
}
