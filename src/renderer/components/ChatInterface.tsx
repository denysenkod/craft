import React, { useState, useEffect, useRef } from 'react';
import MessageBubble from './chat/MessageBubble';

const TOOL_STATUS: Record<string, string> = {
  get_transcript: 'Reading transcript...',
  search_transcripts: 'Searching transcripts...',
  get_meeting: 'Looking up meeting...',
  list_meetings: 'Checking meetings...',
  get_task: 'Looking up task...',
  list_tasks: 'Searching tasks...',
  create_task: 'Drafting task...',
  update_task: 'Preparing update...',
};

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void;
      off: (channel: string, subscription: (...args: unknown[]) => void) => void;
    };
  }
}

interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
}

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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ParsedMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposals?: Proposal[];
}

type AgentStatus = 'idle' | 'thinking' | 'tool_call' | 'streaming';

function parseMessage(msg: ChatMessage): ParsedMessage {
  if (msg.role === 'assistant') {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed.text !== undefined && parsed.proposals) {
        return { id: msg.id, role: msg.role, text: parsed.text, proposals: parsed.proposals };
      }
    } catch {
      // Not JSON, treat as plain text
    }
  }
  return { id: msg.id, role: msg.role, text: msg.content };
}

interface Props {
  context: CurrentContext;
  onTaskChanged?: () => void;
}

export default function ChatInterface({ context, onTaskChanged }: Props) {
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [activeTool, setActiveTool] = useState<{ name: string; args: Record<string, unknown> } | null>(null);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [pendingProposals, setPendingProposals] = useState<Proposal[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    (async () => {
      const history = await window.api.invoke('chat:get-history') as ChatMessage[];
      setMessages(history.map(parseMessage));
    })();
  }, []);

  // Subscribe to stream events
  useEffect(() => {
    // When tools are called, intermediate text is cleared.
    // Only text after the last tool call is shown as the final answer.

    const handler = (event: unknown) => {
      const e = event as Record<string, unknown>;
      switch (e.type) {
        case 'thinking':
          setAgentStatus('thinking');
          break;
        case 'tool_call':
          setAgentStatus('tool_call');
          setActiveTool({ name: e.tool as string, args: e.args as Record<string, unknown> });
          // Discard intermediate text streamed before/between tools ("Let me check...")
          setStreamBuffer('');
          break;
        case 'tool_result':
          setActiveTool(null);
          break;
        case 'message_delta':
          setAgentStatus('streaming');
          setStreamBuffer(prev => prev + (e.content as string));
          break;
        case 'proposal':
          setPendingProposals(prev => [...prev, ...(e.proposals as Proposal[])]);
          break;
        case 'done': {
          setAgentStatus('idle');
          setActiveTool(null);
          setStreamBuffer('');
          // Reload messages from DB — clear pendingProposals only after history loads
          (async () => {
            const history = await window.api.invoke('chat:get-history') as ChatMessage[];
            setMessages(history.map(parseMessage));
            setPendingProposals([]);
          })();
          break;
        }
        case 'error':
          setAgentStatus('idle');
          setActiveTool(null);
          setStreamBuffer('');
          break;
      }
    };

    const subscription = window.api.on('chat:stream-event', handler);
    return () => { window.api.off('chat:stream-event', subscription); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamBuffer, agentStatus, activeTool]);

  // Track which transcript context was last sent to avoid re-sending
  const lastSentContextRef = useRef<string | undefined>(undefined);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;

    setInput('');
    // Optimistic: add user message immediately
    const tempMsg: ParsedMessage = { id: 'temp-' + Date.now(), role: 'user', text };
    setMessages(prev => [...prev, tempMsg]);

    // Include transcript content on first message after context change
    let transcriptContent: string | undefined;
    let analysisJson: string | undefined;
    if (context.transcriptId && context.transcriptId !== lastSentContextRef.current) {
      try {
        const transcript = await window.api.invoke('transcript:get', context.transcriptId) as
          { raw_text?: string; analysis_json?: string } | undefined;
        if (transcript) {
          transcriptContent = transcript.raw_text;
          analysisJson = transcript.analysis_json;
        }
      } catch {
        // Transcript not available, continue without it
      }
      lastSentContextRef.current = context.transcriptId;
    }

    await window.api.invoke('chat:send-message', { message: text, context, transcriptContent, analysisJson });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    window.api.invoke('chat:cancel');
  };

  const handleApprove = async (proposal: Proposal) => {
    try {
      await window.api.invoke('chat:approve-proposal', { proposal_id: proposal.proposal_id, proposal });
      setMessages(prev => prev.map(msg => {
        if (!msg.proposals) return msg;
        return {
          ...msg,
          proposals: msg.proposals.map(p =>
            p.proposal_id === proposal.proposal_id ? { ...p, status: 'approved' as const } : p
          ),
        };
      }));
      onTaskChanged?.();
    } catch (err) {
      console.error('Approve failed:', err);
    }
  };

  const handleReject = async (proposalId: string) => {
    await window.api.invoke('chat:reject-proposal', { proposal_id: proposalId });
    setMessages(prev => prev.map(msg => {
      if (!msg.proposals) return msg;
      return {
        ...msg,
        proposals: msg.proposals.map(p =>
          p.proposal_id === proposalId ? { ...p, status: 'rejected' as const } : p
        ),
      };
    }));
  };

  const handleClearHistory = async () => {
    await window.api.invoke('chat:clear-history');
    setMessages([]);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden p-3">
      <div className="flex flex-col flex-1 overflow-hidden rounded-2xl border border-border-base bg-surface-1">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
          {messages.length === 0 && agentStatus === 'idle' && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-text-muted text-[13px]">Ask me anything about your meetings and tasks.</p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.text}
              proposals={msg.proposals}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}

          {/* Transient status indicator (thinking / tool calls) */}
          {agentStatus !== 'idle' && !streamBuffer && (
            <div className="self-start flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-surface-2 border border-border-base">
              <span
                className="w-1.5 h-1.5 rounded-full bg-honey shrink-0"
                style={{ animation: 'thinkBounce 1.4s ease-in-out infinite' }}
              />
              <span className="text-[12px] text-text-muted">
                {activeTool ? (TOOL_STATUS[activeTool.name] || `Running ${activeTool.name}`) : 'Thinking...'}
              </span>
            </div>
          )}

          {/* Final answer streaming in (with live proposals if any) */}
          {(streamBuffer || pendingProposals.length > 0) && (
            <MessageBubble
              role="assistant"
              content={streamBuffer || ''}
              proposals={pendingProposals.length > 0 ? pendingProposals : undefined}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}
        </div>

        {/* Input area */}
        <div className="px-3 pb-3">
          <div className="relative rounded-xl border border-border-base bg-surface-2 overflow-hidden">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={agentStatus !== 'idle'}
                  className="w-full text-[13px] px-4 pt-3 pb-10 bg-transparent text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                  placeholder="Ask about your meetings, transcripts, or tasks..."
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                  {/* Clear history */}
                  {messages.length > 0 && agentStatus === 'idle' && (
                    <button
                      onClick={handleClearHistory}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-red-400 transition-colors"
                      title="Clear chat history"
                    >
                      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                        <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  )}
                  {/* Cancel / Send */}
                  {agentStatus !== 'idle' ? (
                    <button
                      onClick={handleCancel}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      title="Cancel"
                    >
                      <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" className="w-4 h-4">
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                      style={{ background: input.trim() ? '#E8A838' : '#2A2A32' }}
                      disabled={!input.trim()}
                    >
                      <svg fill="none" stroke={input.trim() ? '#07070A' : '#5E5B54'} strokeWidth={2} viewBox="0 0 24 24" className="w-4 h-4">
                        <path d="M12 19V5m0 0l-5 5m5-5l5 5" />
                      </svg>
                    </button>
                  )}
                </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes thinkBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
