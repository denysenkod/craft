import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  meetingTitle?: string;
}

interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update' | 'delete';
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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo`;
  return date.toLocaleDateString();
}

interface Props {
  context: CurrentContext;
  activeSessionId: string | null;
  onSessionChange: (sessionId: string | null) => void;
  onTaskChanged?: () => void;
  onNavigateToTasks?: () => void;
}

export default function ChatInterface({ context, activeSessionId, onSessionChange, onTaskChanged, onNavigateToTasks }: Props) {
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [activeTool, setActiveTool] = useState<{ name: string; args: Record<string, unknown> } | null>(null);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [pendingProposals, setPendingProposals] = useState<Proposal[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Track which proposals are currently being processed (approve/reject in flight)
  const [processingProposals, setProcessingProposals] = useState<Set<string>>(new Set());

  // Debounced task refresh — waits 1.5s after last call so batch operations settle
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTaskRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      onTaskChanged?.();
      refreshTimerRef.current = null;
    }, 1500);
  }, [onTaskChanged]);

  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
  const [sessionTitle, setSessionTitle] = useState('New chat');
  const [searchQuery, setSearchQuery] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const historyToggleRef = useRef<HTMLButtonElement>(null);

  // Load history when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setSessionTitle('New chat');
      return;
    }
    (async () => {
      const history = await window.api.invoke('chat:get-history', activeSessionId) as ChatMessage[];
      setMessages(history.map(parseMessage));
      const firstUser = history.find(m => m.role === 'user');
      if (firstUser) {
        setSessionTitle(firstUser.content.substring(0, 60));
      }
    })();
  }, [activeSessionId]);

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
        case 'task_changed':
          debouncedTaskRefresh();
          break;
        case 'task_created':
          onNavigateToTasks?.();
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
          if (activeSessionIdRef.current) {
            (async () => {
              const history = await window.api.invoke('chat:get-history', activeSessionIdRef.current) as ChatMessage[];
              setMessages(history.map(parseMessage));
              setPendingProposals([]);
            })();
          }
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
  }, [debouncedTaskRefresh, activeSessionId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamBuffer, agentStatus, activeTool]);

  // Track which transcript context was last sent to avoid re-sending
  const lastSentContextRef = useRef<string | undefined>(undefined);

  const filteredSessions = sessions.filter(s =>
    !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Click-outside/Escape handler for history dropdown
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        historyRef.current && !historyRef.current.contains(e.target as Node) &&
        historyToggleRef.current && !historyToggleRef.current.contains(e.target as Node)
      ) {
        setShowHistory(false);
        setSearchQuery('');
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowHistory(false); setSearchQuery(''); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showHistory]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;

    setInput('');
    setAgentStatus('thinking');
    const tempMsg: ParsedMessage = { id: 'temp-' + Date.now(), role: 'user', text };
    setMessages(prev => [...prev, tempMsg]);

    // Lazy session creation — create on first message
    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await window.api.invoke('chat:create-session') as { id: string };
      sessionId = session.id;
      activeSessionIdRef.current = sessionId;
      onSessionChange(sessionId);
    }

    // Update session title on first user message
    if (messages.length === 0) {
      const title = text.substring(0, 60);
      window.api.invoke('chat:update-session-title', sessionId, title).catch(err => console.error('Failed to update session title:', err));
      setSessionTitle(title);
    }

    // Include transcript content on first message after context change
    let transcriptContent: string | undefined;
    const contextKey = context.transcriptId || '';
    if (contextKey && contextKey !== lastSentContextRef.current) {
      try {
        const transcript = await window.api.invoke('transcript:get', contextKey) as { raw_text: string } | null;
        if (transcript) {
          transcriptContent = transcript.raw_text;
          lastSentContextRef.current = contextKey;
        }
      } catch (err) {
        console.error('Failed to fetch transcript for context:', err);
      }
    }

    try {
      await window.api.invoke('chat:send-message', {
        message: text,
        context,
        sessionId,
        transcriptContent,
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      setAgentStatus('idle');
    }
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
    setProcessingProposals(prev => new Set(prev).add(proposal.proposal_id));
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
      debouncedTaskRefresh();
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setProcessingProposals(prev => { const next = new Set(prev); next.delete(proposal.proposal_id); return next; });
    }
  };

  const handleReject = async (proposalId: string) => {
    setProcessingProposals(prev => new Set(prev).add(proposalId));
    try {
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
    } finally {
      setProcessingProposals(prev => { const next = new Set(prev); next.delete(proposalId); return next; });
    }
  };

  const resetChatState = () => {
    setMessages([]);
    setSessionTitle('New chat');
    setShowHistory(false);
    setSearchQuery('');
    lastSentContextRef.current = undefined;
    onSessionChange(null);
  };

  const handleClearHistory = async () => {
    if (activeSessionId) {
      await window.api.invoke('chat:clear-history', activeSessionId);
    }
    resetChatState();
  };

  const handleNewChat = () => {
    resetChatState();
  };

  const handleLoadSession = (sessionId: string) => {
    onSessionChange(sessionId);
    setShowHistory(false);
    setSearchQuery('');
    const session = sessions.find(s => s.id === sessionId);
    if (session) setSessionTitle(session.title);
  };

  const toggleHistory = async () => {
    if (!showHistory) {
      const list = await window.api.invoke('chat:list-sessions') as Array<{ id: string; title: string; updated_at: string }>;
      setSessions(list);
    }
    setShowHistory(prev => !prev);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Chat header with session controls */}
      <div className="px-5 py-3 border-b border-border-base shrink-0 relative">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium text-text-primary truncate max-w-[260px]">{sessionTitle}</div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              title="New chat"
            >
              <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            <button
              ref={historyToggleRef}
              onClick={toggleHistory}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                showHistory ? 'text-text-primary bg-surface-2' : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
              }`}
              title="Chat history"
            >
              <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            {showHistory && (
              <button
                onClick={() => { setShowHistory(false); setSearchQuery(''); }}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
                title="Close"
              >
                <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* History dropdown */}
        {showHistory && (
          <div
            ref={historyRef}
            className="absolute left-0 right-0 top-full z-50 border-b border-border-base bg-surface-0 shadow-lg flex flex-col"
            style={{ maxHeight: 'calc(3 * 58px + 42px)' }}
          >
            {/* Search bar */}
            <div className="px-4 py-2.5 border-b border-border-base flex items-center gap-2.5 shrink-0">
              <svg fill="none" stroke="#5E5B54" strokeWidth={1.5} viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0">
                <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
                placeholder="Search"
                autoFocus
              />
              <span className="text-[11px] text-text-muted whitespace-nowrap">All Conversations</span>
            </div>

            {/* Session list */}
            <div className="overflow-y-auto chat-scroll">
              {filteredSessions.length === 0 && (
                <div className="px-4 py-5 text-center text-[12px] text-text-muted">
                  {searchQuery ? 'No matching conversations' : 'No conversations yet'}
                </div>
              )}
              {filteredSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleLoadSession(s.id)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                    s.id === activeSessionId
                      ? 'bg-surface-2'
                      : 'hover:bg-surface-2/50'
                  }`}
                >
                  <svg fill="none" stroke={s.id === activeSessionId ? '#E8A838' : '#5E5B54'} strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4 mt-0.5 shrink-0">
                    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] truncate ${s.id === activeSessionId ? 'text-text-primary' : 'text-text-secondary'}`}>{s.title}</div>
                  </div>
                  <span className="text-[11px] text-text-muted shrink-0 mt-0.5">{formatRelativeTime(s.updated_at)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Chat messages and input ── */}
      <div className="flex flex-col flex-1 overflow-hidden p-3">
          <div className="flex flex-col flex-1 overflow-hidden rounded-2xl border border-border-base bg-surface-1">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4 chat-scroll">
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
                  processingProposals={processingProposals}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              ))}

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

              {(streamBuffer || pendingProposals.length > 0) && (
                <MessageBubble
                  role="assistant"
                  content={streamBuffer || ''}
                  proposals={pendingProposals.length > 0 ? pendingProposals : undefined}
                  processingProposals={processingProposals}
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
                  disabled={agentStatus !== 'idle' || processingProposals.size > 0}
                  className="w-full text-[13px] px-4 pt-3 pb-10 bg-transparent text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                  placeholder="Ask about your meetings, transcripts, or tasks..."
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                  {messages.length > 0 && agentStatus === 'idle' && processingProposals.size === 0 && (
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
                  {agentStatus !== 'idle' || processingProposals.size > 0 ? (
                    <button
                      onClick={handleCancel}
                      className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                      style={{ background: '#E8A838' }}
                      title="Stop"
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: '#07070A' }} />
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
            .chat-scroll::-webkit-scrollbar { width: 5px; }
            .chat-scroll::-webkit-scrollbar-track { background: transparent; }
            .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
            .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
            @keyframes thinkBounce {
              0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
              30% { transform: translateY(-4px); opacity: 1; }
            }
          `}</style>
        </div>
    </div>
  );
}
