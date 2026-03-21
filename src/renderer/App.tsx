import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import MeetingList from './components/MeetingList';
import TranscriptView from './components/TranscriptView';
import ChatInterface from './components/ChatInterface';
import TaskReview from './components/TaskReview';
import SettingsModal from './components/SettingsModal';
import MomTestModal from './components/MomTestModal';

type Screen = 'meetings' | 'transcript' | 'tasks';

interface CurrentContext {
  screen: Screen;
  transcriptId?: string;
  meetingId?: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('meetings');
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [momTestOpen, setMomTestOpen] = useState(false);
  const [transcriptId, setTranscriptId] = useState<string | undefined>();
  const [meetingId, setMeetingId] = useState<string | undefined>();
  const [taskVersion, setTaskVersion] = useState(0);

  const context: CurrentContext = { screen, transcriptId, meetingId };

  const handleOpenTranscript = (tId: string, mId: string) => {
    setTranscriptId(tId);
    setMeetingId(mId);
    setScreen('transcript');
  };

  return (
    <div className="flex h-screen bg-surface-0">
      {/* Titlebar */}
      <div
        className="fixed top-0 left-0 right-0 h-10 z-50 border-b border-border-base"
        style={{ background: '#07070A', WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Sidebar */}
      <div style={{ paddingTop: '40px' }}>
        <Sidebar active={screen} onNavigate={setScreen} onSettings={() => setSettingsOpen(true)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-1" style={{ marginTop: '40px' }}>
        {screen === 'meetings' && (
          <MeetingList
            onOpenTranscript={handleOpenTranscript}
            onOpenMomTest={() => setMomTestOpen(true)}
          />
        )}
        {screen === 'transcript' && (
          <TranscriptView onOpenChat={() => setChatOpen(true)} />
        )}
        {screen === 'tasks' && <TaskReview refreshKey={taskVersion} />}
      </div>

      {/* Chat toggle button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-6 right-6 z-40 w-11 h-11 flex items-center justify-center border transition-all duration-200"
        style={{
          background: chatOpen ? '#E8A838' : '#1C1C22',
          borderColor: chatOpen ? '#E8A838' : '#3A3A44',
          right: chatOpen ? 'calc(420px + 24px)' : '24px',
        }}
        title={chatOpen ? 'Close chat' : 'Open chat'}
      >
        <svg fill="none" stroke={chatOpen ? '#07070A' : '#9C9890'} strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Chat right sidebar */}
      <div
        className="fixed top-10 right-0 bottom-0 bg-surface-0 border-l border-border-base z-30 flex flex-col transition-transform duration-200"
        style={{
          width: '420px',
          transform: chatOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Chat header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-base shrink-0">
          <div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Chat</div>
            <div className="text-[13px] font-medium text-text-primary mt-0.5">PM Assistant</div>
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ChatInterface context={context} onTaskChanged={() => setTaskVersion(v => v + 1)} />
      </div>

      {/* Modals */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MomTestModal open={momTestOpen} onClose={() => setMomTestOpen(false)} />
    </div>
  );
}
