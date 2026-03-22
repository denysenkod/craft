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
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleAuthed, setGoogleAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [linearStatus, setLinearStatus] = useState<LinearStatus>({ connected: false });
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [repos, setRepos] = useState<{ id: string; name: string; path: string; github_url: string | null; default_branch: string }[]>([]);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [repoGithubUrl, setRepoGithubUrl] = useState('');
  const [repoDefaultBranch, setRepoDefaultBranch] = useState('main');
  const [repoValidation, setRepoValidation] = useState<{ valid: boolean; error?: string } | null>(null);
  const [addingRepo, setAddingRepo] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const status = await window.api.invoke('google:auth-status') as { authenticated: boolean; email?: string };
      setGoogleAuthed(status.authenticated);
      setGoogleEmail(status.email || null);
    })();

    setLoadingStatus(true);
    window.api.invoke('linear:status').then((status) => {
      setLinearStatus(status as LinearStatus);
      setLoadingStatus(false);
      if ((status as LinearStatus).connected) {
        window.api.invoke('linear:get-teams').then((teams) => setLinearTeams(teams as LinearTeam[]));
      }
    }).catch(() => {
      setLoadingStatus(false);
    });

    window.api.invoke('repo:list').then((r) => setRepos(r as typeof repos));
  }, [open]);

  if (!open) return null;

  const handleGoogleAuth = async () => {
    setAuthLoading(true);
    try {
      const result = await window.api.invoke('google:auth') as { success: boolean; email?: string; error?: string };
      if (result.success) {
        setGoogleAuthed(true);
        setGoogleEmail(result.email || null);
      } else {
        console.error('Google auth failed:', result.error);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogout = async () => {
    await window.api.invoke('google:logout');
    setGoogleAuthed(false);
    setGoogleEmail(null);
  };

  const handleLinearConnect = async () => {
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

  const handleLinearDisconnect = async () => {
    await window.api.invoke('linear:disconnect');
    setLinearStatus({ connected: false });
    setLinearTeams([]);
  };

  const handleValidateRepo = async () => {
    if (!repoPath) return;
    const result = await window.api.invoke('repo:validate', repoPath) as { valid: boolean; error?: string };
    setRepoValidation(result);
  };

  const handleAddRepo = async () => {
    if (!repoName || !repoPath) return;
    setAddingRepo(true);
    await window.api.invoke('repo:add', {
      name: repoName,
      path: repoPath,
      github_url: repoGithubUrl || undefined,
      default_branch: repoDefaultBranch,
    });
    const updated = await window.api.invoke('repo:list') as typeof repos;
    setRepos(updated);
    setShowAddRepo(false);
    setRepoName('');
    setRepoPath('');
    setRepoGithubUrl('');
    setRepoDefaultBranch('main');
    setRepoValidation(null);
    setAddingRepo(false);
  };

  const handleRemoveRepo = async (id: string) => {
    await window.api.invoke('repo:remove', id);
    setRepos(repos.filter(r => r.id !== id));
  };

  const labelClass = 'block text-xs font-medium text-text-muted mb-1.5';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(7,7,10,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[520px] max-h-[80vh] overflow-y-auto bg-surface-2 border border-border-strong rounded-2xl">
        <div className="px-7 pt-7">
          <h2 className="text-2xl font-semibold text-text-primary">Settings</h2>
          <p className="text-sm text-text-muted mt-1">Integrations</p>
        </div>
        <div className="px-7 py-6">
          {/* Google Account */}
          <div className="mb-6 pb-5 border-b border-border-base">
            <label className={labelClass}>Google Account</label>
            {googleAuthed ? (
              <div className="border border-border-base rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg width="18" height="18" viewBox="-3 0 262 262">
                      <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"/>
                      <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"/>
                      <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"/>
                      <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"/>
                    </svg>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      <span className="text-sm text-text-primary">{googleEmail}</span>
                    </div>
                  </div>
                  <button
                    onClick={handleGoogleLogout}
                    className="text-xs text-text-muted underline underline-offset-2 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGoogleAuth}
                disabled={authLoading}
                className="w-full text-sm font-semibold px-4 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="-3 0 262 262">
                  <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#fff"/>
                  <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#fff"/>
                  <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#fff"/>
                  <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#fff"/>
                </svg>
                {authLoading ? 'Waiting for browser...' : 'Sign in with Google'}
              </button>
            )}
          </div>

          {/* Linear OAuth */}
          <div className="mb-5">
            <label className={labelClass}>Linear</label>
            {loadingStatus ? (
              <div className="text-sm text-text-muted py-2.5">Checking connection...</div>
            ) : linearStatus.connected ? (
              <div className="border border-border-base rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg width="18" height="18" viewBox="0 0 100 100" fill="none">
                      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228Z" fill="#5E6AD2"/>
                      <path d="M.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624Z" fill="#5E6AD2"/>
                      <path d="M4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855Z" fill="#5E6AD2"/>
                      <path d="M12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" fill="#5E6AD2"/>
                    </svg>
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-sm text-text-primary">{linearStatus.name}</span>
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{linearStatus.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleLinearDisconnect}
                    className="text-xs text-text-muted underline underline-offset-2 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleLinearConnect}
                disabled={connecting}
                className="w-full text-sm font-semibold px-4 py-2.5 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#4E5ABF] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 100 100" fill="none">
                  <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228Z" fill="#fff"/>
                  <path d="M.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624Z" fill="#fff"/>
                  <path d="M4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855Z" fill="#fff"/>
                  <path d="M12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" fill="#fff"/>
                </svg>
                {connecting ? 'Connecting...' : 'Connect to Linear'}
              </button>
            )}
          </div>

          {linearStatus.connected && linearTeams.length > 0 && (
            <div className="mb-5">
              <label className={labelClass}>Linear Team</label>
              <select className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary outline-none appearance-none rounded-lg">
                {linearTeams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name} ({team.key})</option>
                ))}
              </select>
            </div>
          )}
        </div>
          {/* Repositories */}
          <div className="px-7 pb-6">
            <div className="pt-5 border-t border-border-base">
              <label className={labelClass}>Repositories</label>

              {repos.length > 0 && (
                <div className="space-y-2 mb-3">
                  {repos.map((repo) => (
                    <div key={repo.id} className="border border-border-base rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-text-primary font-medium">{repo.name}</div>
                          <div className="text-xs text-text-muted mt-0.5 font-mono">{repo.path}</div>
                          {repo.github_url && (
                            <div className="text-xs text-text-muted mt-0.5">{repo.github_url}</div>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveRepo(repo.id)}
                          className="text-xs text-text-muted underline underline-offset-2 hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showAddRepo ? (
                <div className="border border-border-base rounded-lg p-3 space-y-3">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Name</label>
                    <input
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="e.g., Frontend App"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Local Path</label>
                    <div className="flex gap-2">
                      <input
                        value={repoPath}
                        onChange={(e) => { setRepoPath(e.target.value); setRepoValidation(null); }}
                        placeholder="/Users/you/projects/my-app"
                        className="flex-1 text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none font-mono"
                      />
                      <button
                        onClick={handleValidateRepo}
                        className="text-xs px-3 py-2 border border-border-base bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
                      >
                        Validate
                      </button>
                    </div>
                    {repoValidation && (
                      <div className={`text-xs mt-1 ${repoValidation.valid ? 'text-green-400' : 'text-red-400'}`}>
                        {repoValidation.valid ? 'Valid git repository' : repoValidation.error}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">GitHub URL (optional)</label>
                    <input
                      value={repoGithubUrl}
                      onChange={(e) => setRepoGithubUrl(e.target.value)}
                      placeholder="https://github.com/org/repo"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Default Branch</label>
                    <input
                      value={repoDefaultBranch}
                      onChange={(e) => setRepoDefaultBranch(e.target.value)}
                      placeholder="main"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowAddRepo(false)}
                      className="text-xs px-3 py-2 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddRepo}
                      disabled={!repoName || !repoPath || addingRepo}
                      className="text-xs px-4 py-2 bg-honey text-surface-0 rounded-lg font-medium hover:bg-honey-dim disabled:opacity-40 transition-all"
                    >
                      {addingRepo ? 'Adding...' : 'Add Repository'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddRepo(true)}
                  className="w-full text-sm font-medium px-4 py-2.5 border border-dashed border-border-base text-text-muted rounded-lg hover:border-honey hover:text-honey transition-all"
                >
                  + Add Repository
                </button>
              )}
            </div>
          </div>
        <div className="px-7 py-4 border-t border-border-strong flex justify-end">
          <button
            onClick={onClose}
            className="text-sm font-medium px-4 py-2.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
