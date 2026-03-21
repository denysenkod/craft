import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const invokeChannels = [
  'meeting:create', 'meeting:list', 'meeting:get-status', 'meeting:paste-transcript',
  'transcript:get', 'transcript:analyze',
  'chat:send-message', 'chat:cancel', 'chat:get-history', 'chat:clear-history',
  'chat:approve-proposal', 'chat:reject-proposal',
  'task:list', 'task:create', 'task:update-status', 'task:push-to-linear',
  'linear:auth', 'linear:status', 'linear:disconnect', 'linear:get-teams', 'linear:get-issues', 'linear:get-states',
  'settings:get', 'settings:set',
  'momtest:generate-questions',
] as const;

const listenChannels = [
  'chat:stream-event',
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
