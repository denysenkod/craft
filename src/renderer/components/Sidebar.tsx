import React from 'react';

type Screen = 'meetings' | 'transcript' | 'chat' | 'tasks';

interface SidebarProps {
  active: Screen;
  onNavigate: (screen: Screen) => void;
  onSettings: () => void;
}

const navItems: { id: Screen; label: string; icon: React.ReactElement }[] = [
  {
    id: 'meetings',
    label: 'Meetings',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'transcript',
    label: 'Transcript',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

export default function Sidebar({ active, onNavigate, onSettings }: SidebarProps) {
  return (
    <div className="w-14 flex flex-col items-center bg-surface-0 border-r border-border-base" style={{ paddingTop: '40px' }}>
      <div className="text-honey font-semibold text-xl mb-8">P</div>
      <div className="flex flex-col w-full">
        {navItems.map((item) => (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onNavigate(item.id)}
            className="w-full h-11 flex items-center justify-center transition-all duration-100"
            style={{
              color: active === item.id ? '#E8A838' : '#5E5B54',
              background: active === item.id ? 'rgba(232,168,56,0.08)' : 'transparent',
              borderLeft: active === item.id ? '2px solid #E8A838' : '2px solid transparent',
            }}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <button
        title="Settings"
        onClick={onSettings}
        className="w-full h-11 flex items-center justify-center mb-4 transition-colors duration-100"
        style={{ color: '#5E5B54' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#9C9890')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#5E5B54')}
      >
        <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  );
}
