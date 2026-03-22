import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const invokeChannels = [
  'meeting:create', 'meeting:list', 'meeting:get-status', 'meeting:paste-transcript',
  'meeting:fetch-transcript',
  'transcript:get', 'transcript:list', 'transcript:analyze',
  'chat:send-message', 'chat:cancel', 'chat:get-history', 'chat:clear-history',
  'chat:approve-proposal', 'chat:reject-proposal',
  'chat:create-session', 'chat:list-sessions', 'chat:update-session-title',
  'task:list', 'task:create', 'task:update-status', 'task:push-to-linear',
  'linear:auth', 'linear:status', 'linear:disconnect', 'linear:get-teams', 'linear:get-issues', 'linear:get-states',
  'settings:get', 'settings:set',
  'google:auth', 'google:auth-status', 'google:logout',
  'calendar:list-events', 'calendar:create-event', 'calendar:send-bot', 'calendar:retry-bot', 'calendar:remove-meeting',
  'shell:open-external',
  'meeting-chat:open', 'meeting-chat:send', 'meeting-chat:cancel', 'meeting-chat:refresh-tip',
  'contacts:list', 'contacts:get', 'contacts:create', 'contacts:update', 'contacts:get-by-email',
  'prep:get-notes', 'prep:save-notes', 'prep:get-attendees', 'prep:set-attendees',
  'prep-chat:send', 'prep-chat:cancel', 'prep-chat:get-history', 'prep-chat:clear-history',
  'momtest:generate-questions',
  'repo:list', 'repo:add', 'repo:remove', 'repo:validate',
] as const;

const listenChannels = [
  'chat:stream-event',
  'meeting-chat:event',
  'prep-chat:stream-event',
] as const;

type InvokeChannel = typeof invokeChannels[number];
type ListenChannel = typeof listenChannels[number];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => {
    if (!(invokeChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: ListenChannel, callback: (...args: unknown[]) => void) => {
    if (!(listenChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid listen channel: ${channel}`);
    }
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return subscription;
  },
  off: (channel: ListenChannel, subscription: (...args: unknown[]) => void) => {
    if (!(listenChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid listen channel: ${channel}`);
    }
    ipcRenderer.removeListener(channel, subscription);
  },
});
