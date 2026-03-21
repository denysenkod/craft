import React from 'react';

interface Props {
  role: 'user' | 'assistant';
  content: string;
}

export default function MessageBubble({ role, content }: Props) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] px-4 py-3 text-[13px] leading-relaxed"
        style={{
          background: role === 'user' ? '#E8A838' : '#1C1C22',
          color: role === 'user' ? '#07070A' : '#F0EDE8',
          borderRadius: role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          whiteSpace: 'pre-line',
        }}
      >
        {content}
      </div>
    </div>
  );
}
