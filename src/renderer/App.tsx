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
  meetingTitle?: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('meetings');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [momTestOpen, setMomTestOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<{ id: string; title: string } | null>(null);
  const [taskVersion, setTaskVersion] = useState(0);
  const [tasksChatOpen, setTasksChatOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);

  const context: CurrentContext = {
    screen,
    transcriptId: transcriptId || undefined,
    meetingId: meetingId || undefined,
    meetingTitle: selectedMeeting?.title,
  };
  const showChat = screen === 'transcript' || (screen === 'tasks' && tasksChatOpen);

  const openTranscript = (calendarEventId: string, meetingTitle: string) => {
    setSelectedMeeting({ id: calendarEventId, title: meetingTitle });
    setTranscriptId(null);
    setMeetingId(null);
    setScreen('transcript');
  };

  const handleTranscriptLoaded = (tId: string, mId: string) => {
    setTranscriptId(tId);
    setMeetingId(mId);
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
            onOpenTranscript={openTranscript}
            onOpenMomTest={() => setMomTestOpen(true)}
          />
        )}
        {screen === 'transcript' && (
          <TranscriptView
            meetingId={selectedMeeting?.id || null}
            meetingTitle={selectedMeeting?.title || 'Transcript'}
            onTranscriptLoaded={handleTranscriptLoaded}
          />
        )}
        {screen === 'tasks' && <TaskReview refreshKey={taskVersion} />}
      </div>

      {/* Chat toggle button — tasks screen */}
      {screen === 'tasks' && (
        <button
          onClick={() => setTasksChatOpen(!tasksChatOpen)}
          className="fixed bottom-6 z-40 w-11 h-11 flex items-center justify-center border"
          style={{
            right: tasksChatOpen ? 'calc(420px + 16px)' : '24px',
            background: tasksChatOpen ? '#E8A838' : '#1C1C22',
            borderColor: tasksChatOpen ? '#E8A838' : '#3A3A44',
          }}
          title={tasksChatOpen ? 'Close chat' : 'Open chat'}
        >
          <svg fill="none" stroke={tasksChatOpen ? '#07070A' : '#9C9890'} strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* Chat right sidebar */}
      {showChat && (
        <div
          className="flex flex-col bg-surface-0 border-l border-border-base shrink-0"
          style={{ width: '420px', marginTop: '40px' }}
        >
          {/* Chat header */}
          <div className="px-5 py-3 border-b border-border-base shrink-0">
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Chat</div>
            <div className="text-[13px] font-medium text-text-primary mt-0.5">PM Assistant</div>
          </div>
          <ChatInterface
            context={context}
            activeSessionId={activeSessionId}
            onSessionChange={setActiveSessionId}
            onTaskChanged={() => setTaskVersion(v => v + 1)}
          />
        </div>
      )}

      {/* Modals */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MomTestModal open={momTestOpen} onClose={() => setMomTestOpen(false)} />
    </div>
  );
}
