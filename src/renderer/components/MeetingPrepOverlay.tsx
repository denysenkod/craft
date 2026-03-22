import React, { useState, useEffect, useRef } from 'react';
import MessageBubble from './chat/MessageBubble';

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: Array<{ email: string; responseStatus: string }>;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  profile_summary: string | null;
}

interface NoteItem {
  id: string;
  text: string;
  type: 'question' | 'note';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface MeetingPrepOverlayProps {
  open: boolean;
  onClose: () => void;
  event: CalendarEvent;
}

const TOOL_STATUS: Record<string, string> = {
  get_transcript: 'Reading transcript...',
  search_transcripts: 'Searching transcripts...',
  get_meeting: 'Looking up meeting...',
  list_meetings: 'Checking meetings...',
  get_task: 'Looking up task...',
  list_tasks: 'Searching tasks...',
  create_task: 'Drafting task...',
  update_task: 'Preparing update...',
  get_contact: 'Looking up contact...',
  list_contacts: 'Listing contacts...',
  get_mom_test_framework: 'Loading Mom Test...',
  add_prep_note: 'Adding note...',
  add_prep_question: 'Adding question...',
};

export default function MeetingPrepOverlay({ open, onClose, event }: MeetingPrepOverlayProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'tool_call'>('idle');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<string[]>([]);
  const [streamBuffer, setStreamBuffer] = useState('');
  const streamBufferRef = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [attendees, setAttendees] = useState<Contact[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;

    window.api.invoke('prep-chat:get-history', event.id).then((history) => {
      const msgs = (history as Array<{ id: string; role: string; content: string }>).map((m) => {
        let text = m.content;
        try { const p = JSON.parse(m.content); if (p.text !== undefined) text = p.text; } catch { /* not JSON */ }
        return { id: m.id, role: m.role as 'user' | 'assistant', content: text };
      });
      setMessages(msgs);
    });

    window.api.invoke('prep:get-notes', event.id).then((result) => {
      const { notes_json } = result as { notes_json: string };
      try { setNotes(JSON.parse(notes_json)); } catch { setNotes([]); }
    });

    window.api.invoke('prep:get-attendees', event.id).then((result) => {
      setAttendees(result as Contact[]);
    });

    const handler = window.api.on('prep-chat:stream-event', (evt: unknown) => {
      const e = evt as { type: string; content?: string; message?: string; message_id?: string; tool?: string; result?: unknown };
      if (e.type === 'thinking') {
        setAgentStatus('thinking');
        setStreamBuffer('');
        streamBufferRef.current = '';
        setActiveTool(null);
        setToolResults([]);
      } else if (e.type === 'tool_call') {
        setAgentStatus('tool_call');
        setActiveTool(e.tool || null);
      } else if (e.type === 'tool_result') {
        setActiveTool(null);
        setAgentStatus('thinking');
        // Collect a short summary of the tool result
        if (e.tool) {
          const label = TOOL_STATUS[e.tool]?.replace('...', '') || e.tool;
          setToolResults((prev) => [...prev, label.trim()]);
        }
      } else if (e.type === 'message_delta') {
        setAgentStatus('idle');
        streamBufferRef.current += (e.content || '');
        setStreamBuffer(streamBufferRef.current);
      } else if (e.type === 'done') {
        const finalContent = streamBufferRef.current;
        if (finalContent) {
          setMessages((prev) => [...prev, { id: e.message_id || `msg-${Date.now()}`, role: 'assistant', content: finalContent }]);
        }
        setStreamBuffer('');
        streamBufferRef.current = '';
        setAgentStatus('idle');
        setActiveTool(null);
        setToolResults([]);
      } else if (e.type === 'error') {
        setAgentStatus('idle');
        setStreamBuffer('');
        streamBufferRef.current = '';
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${e.message}` }]);
      } else if (e.type === 'notes_updated') {
        window.api.invoke('prep:get-notes', event.id).then((result) => {
          const { notes_json } = result as { notes_json: string };
          try { setNotes(JSON.parse(notes_json)); } catch { /* ignore */ }
        });
      }
    });

    return () => { window.api.off('prep-chat:stream-event', handler); };
  }, [open, event.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamBuffer, agentStatus]);

  if (!open) return null;

  const meetingDate = new Date(event.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const sendMessage = () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text }]);
    setInput('');
    window.api.invoke('prep-chat:send', {
      message: text,
      googleEventId: event.id,
      meetingTitle: event.summary,
      meetingDate,
    });
  };

  const handleCancel = () => {
    window.api.invoke('prep-chat:cancel');
    setAgentStatus('idle');
    setStreamBuffer('');
    setActiveTool(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const addNote = (type: 'question' | 'note') => {
    const newNote: NoteItem = { id: `n-${Date.now()}`, text: '', type };
    const updated = [...notes, newNote];
    setNotes(updated);
    saveNotes(updated);
  };

  const updateNote = (id: string, text: string) => {
    const updated = notes.map((n) => n.id === id ? { ...n, text } : n);
    setNotes(updated);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveNotes(updated), 500);
  };

  const toggleNoteType = (id: string) => {
    const updated = notes.map((n) => n.id === id ? { ...n, type: n.type === 'question' ? 'note' as const : 'question' as const } : n);
    setNotes(updated);
    saveNotes(updated);
  };

  const deleteNote = (id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    saveNotes(updated);
  };

  const saveNotes = (items: NoteItem[]) => {
    window.api.invoke('prep:save-notes', { googleEventId: event.id, notesJson: JSON.stringify(items) });
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[960px] h-[80vh] flex bg-surface-2 border border-border-strong rounded-2xl overflow-hidden">
        {/* Left: Chat */}
        <div className="flex-1 flex flex-col border-r border-border-base min-w-0">
          <div className="px-5 py-3 border-b border-border-base bg-surface-0 shrink-0">
            <div className="text-xs font-medium text-text-muted">Meeting Prep</div>
            <div className="text-base font-semibold text-text-primary mt-0.5">{event.summary}</div>
            <div className="text-xs text-text-muted mt-0.5">{meetingDate}</div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
            {messages.length === 0 && agentStatus === 'idle' && !streamBuffer && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-text-muted text-center px-8">
                  Ask the AI to help you prepare — review past interactions, formulate questions, or get Mom Test tips.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}

            {/* Thinking / tool call indicator */}
            {agentStatus !== 'idle' && !streamBuffer && (
              <div className="self-start flex flex-col gap-1.5">
                {/* Completed tool results */}
                {toolResults.map((tr, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-1.5 text-xs text-text-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                    {tr}
                  </div>
                ))}
                {/* Active indicator */}
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-surface-2 border border-border-base">
                  <span className="text-xs text-text-muted">
                    {activeTool ? (TOOL_STATUS[activeTool] || `Running ${activeTool}`) : 'Thinking...'}
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-honey shrink-0"
                    style={{ animation: activeTool ? 'toolBounce 0.8s ease-in-out infinite' : 'thinkBounce 1.4s ease-in-out infinite' }}
                  />
                </div>
              </div>
            )}

            {/* Streaming buffer */}
            {streamBuffer && (
              <MessageBubble role="assistant" content={streamBuffer} />
            )}
          </div>

          {/* Input */}
          <div className="px-3 pb-3">
            <div className="relative rounded-xl border border-border-base bg-surface-2 overflow-hidden">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={agentStatus !== 'idle'}
                className="w-full text-sm px-4 pt-3 pb-10 bg-transparent text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
                placeholder="Ask about this meeting..."
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-2">
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
                    onClick={sendMessage}
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

        {/* Right: Notes & Attendees */}
        <div className="w-[360px] flex flex-col overflow-hidden bg-surface-1 shrink-0">
          <div className="px-5 py-3 border-b border-border-base bg-surface-0 flex items-center justify-between shrink-0">
            <span className="text-xs font-medium text-text-muted">Notes & Questions</span>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {attendees.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">Attendees</div>
                {attendees.map((a) => (
                  <div key={a.id} className="border border-border-base bg-surface-2 rounded-lg p-2.5 mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-surface-4 rounded-md flex items-center justify-center text-[10px] font-semibold text-text-muted">
                        {a.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs text-text-primary font-medium">{a.name}</div>
                        <div className="text-[10px] text-text-muted">{a.job_title || a.email}</div>
                      </div>
                    </div>
                    {a.profile_summary && (
                      <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{a.profile_summary}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">
              Questions & Notes ({notes.length})
            </div>
            {notes.map((note) => (
              <div key={note.id} className="flex gap-1.5 mb-1.5">
                <button
                  onClick={() => toggleNoteType(note.id)}
                  className={`shrink-0 w-5 h-5 flex items-center justify-center text-[9px] font-bold border rounded mt-0.5 ${
                    note.type === 'question'
                      ? 'border-honey/40 text-honey bg-honey/5'
                      : 'border-border-strong text-text-muted bg-surface-3'
                  }`}
                  title={note.type === 'question' ? 'Question' : 'Note'}
                >
                  {note.type === 'question' ? 'Q' : 'N'}
                </button>
                <textarea
                  className="flex-1 text-xs bg-surface-2 border border-border-base text-text-primary px-2 py-1.5 outline-none focus:border-honey/30 resize-none leading-relaxed rounded-lg"
                  value={note.text}
                  onChange={(e) => {
                    updateNote(note.id, e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder={note.type === 'question' ? 'Write a question...' : 'Write a note...'}
                  rows={1}
                  style={{ minHeight: '28px', overflow: 'hidden' }}
                  ref={(el) => {
                    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                  }}
                />
                <button
                  onClick={() => deleteNote(note.id)}
                  className="shrink-0 px-1 text-text-muted hover:text-red-400 transition-colors text-xs mt-0.5"
                >
                  &times;
                </button>
              </div>
            ))}

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => addNote('question')}
                className="text-xs font-medium px-3 py-1.5 border border-honey/30 bg-surface-3 text-honey rounded-lg hover:bg-honey/10 transition-all"
              >
                + Question
              </button>
              <button
                onClick={() => addNote('note')}
                className="text-xs font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
              >
                + Note
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes thinkBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes toolBounce {
          0%, 100% { transform: translateX(0); opacity: 0.4; }
          50% { transform: translateX(4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
