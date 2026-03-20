import React, { useState } from 'react';

const MOCK_MESSAGES = [
  { role: 'user' as const, content: 'What were the most critical pain points Sarah mentioned?' },
  { role: 'assistant' as const, content: 'Sarah highlighted three critical issues:\n\n1. Silent migration failures — Import tool fails without errors on Salesforce custom fields. 4,000 blank records required manual fixes.\n\n2. Zero progress visibility — "Literally refreshing a page for hours" with no feedback.\n\n3. No rollback — Turned a 2-week onboarding into 6 weeks, nearly lost $200K ARR. VP of Sales escalated to CEO, threatened HubSpot switch.' },
  { role: 'user' as const, content: 'Create a task for the dry-run migration validation Sarah described' },
  { role: 'assistant' as const, content: "Created a task based on Sarah's description and the Stripe reference." },
];

const MOCK_TASK = {
  title: 'Build dry-run migration validation with field mapping preview',
  description: 'Pre-migration validation previewing field mapping between Salesforce and target schema. Flag mismatches inline. Reference: Stripe dry-run, Intercom inline errors.',
};

const SUGGESTIONS = ['What about rollback?', 'Create task for progress tracking', 'Competitive insights'];

export default function ChatInterface() {
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-7 py-4 border-b border-border-base shrink-0 bg-surface-0">
        <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Chat</div>
        <div className="text-[15px] font-medium text-text-primary mt-0.5">Enterprise Onboarding — Sarah Chen</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-12 py-8 flex flex-col gap-6">
        {MOCK_MESSAGES.map((msg, i) => (
          <div key={i} className={`flex max-w-[70%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
            <div
              className="px-5 py-4 text-sm leading-relaxed"
              style={{
                background: msg.role === 'user' ? '#E8A838' : '#1C1C22',
                color: msg.role === 'user' ? '#07070A' : '#F0EDE8',
                border: msg.role === 'assistant' ? '1px solid #2A2A32' : 'none',
                whiteSpace: 'pre-line',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Task Card */}
        <div className="max-w-[70%] p-5 bg-surface-2 border border-honey/20">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-honey mb-2">Task Created</div>
          <div className="text-[15px] font-medium text-text-primary mb-1.5">{MOCK_TASK.title}</div>
          <div className="text-[13px] text-text-secondary leading-snug">{MOCK_TASK.description}</div>
          <div className="flex gap-1.5 mt-3.5">
            <button className="font-mono text-[10px] font-semibold px-2.5 py-1.5 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Approve</button>
            <button className="font-mono text-[10px] font-medium px-2.5 py-1.5 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Edit</button>
          </div>
        </div>

        {/* Thinking indicator */}
        <div className="self-start px-5 py-4 bg-surface-3 border border-border-base flex items-center gap-2">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-honey"
                style={{ animation: 'thinkBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="px-12 pt-4 pb-6 border-t border-border-strong bg-surface-0">
        <div className="flex gap-2 flex-wrap justify-center mb-3.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="font-mono text-[11px] px-3.5 py-2 bg-surface-2 border border-border-base text-text-secondary hover:border-honey hover:text-honey transition-all"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 font-mono text-xs px-4 py-3.5 bg-surface-2 border border-border-base border-r-0 text-text-primary outline-none focus:border-honey/30"
            placeholder="Ask about the transcript..."
          />
          <button className="w-12 h-12 bg-honey border border-honey flex items-center justify-center hover:bg-honey-dim transition-colors">
            <svg fill="none" stroke="#07070A" strokeWidth={2} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
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
