import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void;
      off: (channel: string, subscription: (...args: unknown[]) => void) => void;
    };
  }
}

interface LinearStatus {
  connected: boolean;
  name?: string;
  email?: string;
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [linearStatus, setLinearStatus] = useState<LinearStatus>({ connected: false });
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    if (open) {
      setLoadingStatus(true);
      window.api.invoke('linear:status').then((status) => {
        setLinearStatus(status as LinearStatus);
        setLoadingStatus(false);
        if ((status as LinearStatus).connected) {
          window.api.invoke('linear:get-teams').then((teams) => setLinearTeams(teams as LinearTeam[]));
        }
      });
    }
  }, [open]);

  const handleConnect = async () => {
    setConnecting(true);
    const result = await window.api.invoke('linear:auth') as { success: boolean; error?: string };
    if (result.success) {
      const status = await window.api.invoke('linear:status') as LinearStatus;
      setLinearStatus(status);
      if (status.connected) {
        const teams = await window.api.invoke('linear:get-teams') as LinearTeam[];
        setLinearTeams(teams);
      }
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await window.api.invoke('linear:disconnect');
    setLinearStatus({ connected: false });
    setLinearTeams([]);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[520px] max-h-[80vh] overflow-y-auto bg-surface-2 border border-border-strong">
        <div className="px-7 pt-7">
          <h2 className="text-2xl font-light italic text-text-primary">Settings</h2>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest mt-1">API Keys & Integrations</p>
        </div>
        <div className="px-7 py-6">
          <div className="mb-5">
            <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Anthropic API Key</label>
            <input type="password" defaultValue="sk-ant-api03-****" className="w-full font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30" />
            <p className="font-mono text-[10px] text-text-muted mt-1">Transcript analysis and chat</p>
          </div>
          <div className="mb-5">
            <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Recall.ai API Key</label>
            <input type="password" placeholder="Enter key" className="w-full font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base text-text-primary outline-none focus:border-honey/30" />
          </div>

          {/* Linear OAuth */}
          <div className="mb-5">
            <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Linear</label>
            {loadingStatus ? (
              <div className="font-mono text-xs text-text-muted py-2.5">Checking connection...</div>
            ) : linearStatus.connected ? (
              <div className="border border-border-base p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="font-mono text-xs text-text-primary">{linearStatus.name}</span>
                    </div>
                    <p className="font-mono text-[10px] text-text-muted mt-0.5 ml-4">{linearStatus.email}</p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="font-mono text-[10px] text-text-muted underline underline-offset-2 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full font-mono text-[11px] font-semibold px-4 py-2.5 bg-[#5E6AD2] text-white border border-[#5E6AD2] uppercase tracking-wider hover:bg-[#4E5ABF] transition-all disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect to Linear'}
              </button>
            )}
          </div>

          {linearStatus.connected && linearTeams.length > 0 && (
            <div className="mb-5">
              <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Linear Team</label>
              <select className="w-full font-mono text-xs px-3 py-2.5 bg-surface-3 border border-border-base text-text-primary outline-none appearance-none">
                {linearTeams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name} ({team.key})</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="px-7 py-4 border-t border-border-strong flex justify-end gap-2">
          <button onClick={onClose} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Cancel</button>
          <button onClick={onClose} className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Save</button>
        </div>
      </div>
    </div>
  );
}
