import React, { useCallback, useEffect, useState } from 'react';
import BuildList from './BuildList';
import BuildDetail from './BuildDetail';
import BuildForm from './BuildForm';

interface BuildEvent {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

interface Build {
  id: string;
  task_title: string;
  task_description: string | null;
  pm_notes: string | null;
  transcript_context: string | null;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  summary: string | null;
  files_changed: number;
  error_message: string | null;
  created_at: string;
  events: BuildEvent[];
}

type View = 'list' | 'form';

export default function BuildView() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null);
  const [view, setView] = useState<View>('list');

  const loadBuilds = useCallback(async () => {
    const result = await window.api.invoke('build:list') as Build[];
    setBuilds(result);
  }, []);

  const loadBuildDetail = useCallback(async (id: string) => {
    const result = await window.api.invoke('build:get', id) as Build | null;
    setSelectedBuild(result);
  }, []);

  // Initial load
  useEffect(() => {
    loadBuilds();
  }, [loadBuilds]);

  // Load detail when selection changes
  useEffect(() => {
    if (selectedId) {
      loadBuildDetail(selectedId);
    } else {
      setSelectedBuild(null);
    }
  }, [selectedId, loadBuildDetail]);

  // Listen for streaming build events
  useEffect(() => {
    const sub = window.api.on('build:event', (event: unknown) => {
      const evt = event as { id: string; build_id: string; type: string; content: string };

      // Update selected build's events in real-time
      setSelectedBuild((prev) => {
        if (!prev || prev.id !== evt.build_id) return prev;
        return {
          ...prev,
          events: [...prev.events, { id: evt.id, type: evt.type, content: evt.content, created_at: new Date().toISOString() }],
        };
      });

      // Refresh build list to update statuses
      loadBuilds();
    });
    return () => { window.api.off('build:event', sub); };
  }, [loadBuilds]);

  // Listen for build status changes (refreshes detail with full data)
  useEffect(() => {
    const sub = window.api.on('build:status', (event: unknown) => {
      const evt = event as { buildId: string; status: string };
      loadBuilds();

      // Reload detail if it's the selected build
      if (selectedId && selectedId === evt.buildId) {
        loadBuildDetail(selectedId);
      }
    });
    return () => { window.api.off('build:status', sub); };
  }, [selectedId, loadBuilds, loadBuildDetail]);

  const handleNewBuild = () => {
    setView('form');
    setSelectedId(null);
  };

  const handleFormSubmit = async (data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source: string;
    sourceId?: string;
  }) => {
    const build = await window.api.invoke('build:create', data) as Build;
    setView('list');
    await loadBuilds();
    setSelectedId(build.id);
  };

  const handleCancel = async (id: string) => {
    await window.api.invoke('build:cancel', id);
    await loadBuilds();
    if (selectedId === id) loadBuildDetail(id);
  };

  const handleRetry = async (id: string) => {
    const newBuild = await window.api.invoke('build:retry', id) as Build;
    await loadBuilds();
    setSelectedId(newBuild.id);
  };

  if (view === 'form') {
    return <BuildForm onSubmit={handleFormSubmit} onCancel={() => setView('list')} />;
  }

  return (
    <div className="flex h-full">
      {/* Left: Build list */}
      <div className="w-72 border-r border-border-base shrink-0 overflow-hidden">
        <BuildList
          builds={builds}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewBuild={handleNewBuild}
        />
      </div>

      {/* Right: Build detail */}
      <div className="flex-1 overflow-hidden">
        {selectedBuild ? (
          <BuildDetail
            build={selectedBuild}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-text-muted text-sm">Select a build or create a new one</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
