import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import MeetingList from './components/MeetingList';
import TranscriptView from './components/TranscriptView';
import ChatInterface from './components/ChatInterface';
import TaskReview from './components/TaskReview';
import SettingsModal from './components/SettingsModal';
import MomTestModal from './components/MomTestModal';

type Screen = 'meetings' | 'transcript' | 'chat' | 'tasks';

export default function App() {
  const [screen, setScreen] = useState<Screen>('meetings');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [momTestOpen, setMomTestOpen] = useState(false);

  return (
    <div className="flex h-screen bg-surface-0">
      {/* Titlebar — native traffic lights from hiddenInset, just need drag region + title */}
      <div
        className="fixed top-0 left-0 right-0 h-10 flex items-center z-50 border-b border-border-base"
        style={{ background: '#07070A', WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-honey" style={{ marginLeft: '76px' }}>
          PM Tool
        </span>
      </div>

      {/* Sidebar */}
      <div style={{ paddingTop: '40px' }}>
        <Sidebar active={screen} onNavigate={setScreen} onSettings={() => setSettingsOpen(true)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-1" style={{ marginTop: '40px' }}>
        {screen === 'meetings' && (
          <MeetingList
            onOpenTranscript={() => setScreen('transcript')}
            onOpenMomTest={() => setMomTestOpen(true)}
          />
        )}
        {screen === 'transcript' && (
          <TranscriptView onOpenChat={() => setScreen('chat')} />
        )}
        {screen === 'chat' && <ChatInterface />}
        {screen === 'tasks' && <TaskReview />}
      </div>

      {/* Modals */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MomTestModal open={momTestOpen} onClose={() => setMomTestOpen(false)} />
    </div>
  );
}
