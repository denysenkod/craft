import React, { useState } from 'react';

type Screen = 'meetings' | 'transcript' | 'tasks' | 'build';

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
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'transcript',
    label: 'Transcripts',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'build',
    label: 'Build',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
      </svg>
    ),
  },
];

export default function Sidebar({ active, onNavigate, onSettings }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="flex flex-col bg-surface-0 border-r border-border-base h-full overflow-hidden"
      style={{ width: expanded ? '180px' : '60px', transition: 'width 250ms cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      {/* Toggle button */}
      <div className="flex items-center justify-center h-12 mt-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 transition-all"
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg
            fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          >
            <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Nav Items */}
      <div className="flex flex-col w-full mt-1 px-2 gap-1">
        {navItems.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => onNavigate(item.id)}
              className={`w-full h-10 flex items-center rounded-lg transition-all duration-150 ${
                isActive
                  ? 'bg-honey/10 text-honey'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-3'
              }`}
              style={{
                paddingLeft: expanded ? '12px' : '0',
                justifyContent: expanded ? 'flex-start' : 'center',
                gap: expanded ? '10px' : '0',
              }}
            >
              {item.icon}
              <span
                className="text-sm font-medium whitespace-nowrap overflow-hidden"
                style={{
                  opacity: expanded ? 1 : 0,
                  maxWidth: expanded ? '120px' : '0',
                  transition: 'opacity 200ms ease, max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* Settings at bottom */}
      <div className="px-2 mb-4">
        <button
          title="Settings"
          onClick={onSettings}
          className="w-full h-10 flex items-center rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-all duration-150"
          style={{
            paddingLeft: expanded ? '12px' : '0',
            justifyContent: expanded ? 'flex-start' : 'center',
            gap: expanded ? '10px' : '0',
          }}
        >
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span
            className="text-sm font-medium whitespace-nowrap overflow-hidden"
            style={{
              opacity: expanded ? 1 : 0,
              maxWidth: expanded ? '120px' : '0',
              transition: 'opacity 200ms ease, max-width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            Settings
          </span>
        </button>
      </div>
    </div>
  );
}
