import { contextBridge, ipcRenderer } from 'electron';

const channels = [
  'meeting:create', 'meeting:list', 'meeting:get-status', 'meeting:paste-transcript',
  'transcript:get', 'transcript:analyze',
  'chat:send-message',
  'task:list', 'task:create', 'task:update-status', 'task:push-to-linear',
  'linear:auth', 'linear:status', 'linear:disconnect', 'linear:get-teams', 'linear:get-issues', 'linear:get-states',
  'settings:get', 'settings:set',
  'momtest:generate-questions',
] as const;

type Channel = typeof channels[number];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: Channel, ...args: unknown[]) => {
    if (!(channels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
