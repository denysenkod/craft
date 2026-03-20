import React from 'react';

interface MomTestModalProps {
  open: boolean;
  onClose: () => void;
}

const MOCK_QUESTIONS = [
  { text: 'Walk me through the last time you onboarded a new enterprise customer from start to finish.', purpose: 'Surfaces actual workflow, not idealized version.' },
  { text: 'What happened when something went wrong? How did you handle it?', purpose: 'Past tense forces real stories, not hypotheticals.' },
  { text: 'How did the customer react when there were delays?', purpose: 'Measures real business impact of the problem.' },
  { text: 'What tools or workarounds have you tried?', purpose: "If they've built workarounds, the pain is real." },
  { text: 'Have you seen any other product handle this well?', purpose: 'Competitive intelligence without leading.' },
];

export default function MomTestModal({ open, onClose }: MomTestModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[640px] max-h-[80vh] overflow-y-auto bg-surface-2 border border-border-strong">
        <div className="px-7 pt-7">
          <h2 className="text-2xl font-light italic text-text-primary">Mom Test</h2>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest mt-1">Non-leading interview questions</p>
        </div>
        <div className="px-7 py-6">
          <textarea
            defaultValue="Enterprise onboarding interview with Sarah Chen, Account Manager. Focus: pain points in onboarding and data migration."
            className="w-full font-mono text-xs px-3.5 py-3.5 bg-surface-3 border border-border-base text-text-primary outline-none min-h-[80px] resize-y focus:border-honey/30"
          />
          <div className="mt-3">
            <button className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Generate Questions</button>
          </div>

          <div className="mt-6">
            {MOCK_QUESTIONS.map((q, i) => (
              <div key={i} className="border-l-2 border-honey pl-5 py-3 mb-4">
                <div className="font-mono text-[10px] font-semibold text-honey uppercase tracking-wider">Q{i + 1}</div>
                <div className="text-base text-text-primary leading-snug mt-1">{q.text}</div>
                <div className="font-mono text-[11px] text-text-muted mt-1.5 leading-snug">{q.purpose}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-7 py-4 border-t border-border-strong flex justify-end gap-2">
          <button onClick={onClose} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Close</button>
          <button className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Copy to Clipboard</button>
        </div>
      </div>
    </div>
  );
}
