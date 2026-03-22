import React, { useState } from 'react';

interface BuildChatProps {
  buildId: string;
}

export default function BuildChat({ buildId }: BuildChatProps) {
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await window.api.invoke('build:answer', buildId, answer.trim());
      setAnswer('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border-base p-3 shrink-0" style={{ background: 'rgba(232,168,56,0.04)' }}>
      <div className="text-xs text-honey font-medium mb-2">Claude Code needs your input</div>
      <div className="flex gap-2">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          rows={2}
          className="flex-1 text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
        />
        <button
          onClick={handleSend}
          disabled={!answer.trim() || sending}
          className="self-end text-sm font-medium px-4 py-2 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim disabled:opacity-40 transition-all"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
