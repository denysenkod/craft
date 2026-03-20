import React from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
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
          <div className="mb-5">
            <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Linear API Key</label>
            <div className="flex">
              <input type="password" defaultValue="lin_api_****" className="flex-1 font-mono text-xs px-3 py-2.5 bg-surface-2 border border-border-base border-r-0 text-text-primary outline-none focus:border-honey/30" />
              <button className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Load Teams</button>
            </div>
          </div>
          <div className="mb-5">
            <label className="block font-mono text-[10px] font-medium text-text-muted uppercase tracking-widest mb-1.5">Linear Team</label>
            <select className="w-full font-mono text-xs px-3 py-2.5 bg-surface-3 border border-border-base text-text-primary outline-none appearance-none">
              <option>Engineering</option>
              <option>Product</option>
            </select>
          </div>
        </div>
        <div className="px-7 py-4 border-t border-border-strong flex justify-end gap-2">
          <button onClick={onClose} className="font-mono text-[11px] font-medium px-4 py-2 border border-border-strong bg-surface-3 text-text-secondary uppercase tracking-wider hover:border-honey hover:text-honey transition-all">Cancel</button>
          <button onClick={onClose} className="font-mono text-[11px] font-semibold px-4 py-2 bg-honey text-surface-0 border border-honey uppercase tracking-wider hover:bg-honey-dim transition-all">Save</button>
        </div>
      </div>
    </div>
  );
}
