import React, { useEffect, useState } from 'react';

interface Repo {
  id: string;
  name: string;
  path: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
}

interface BuildFormProps {
  onSubmit: (data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source: string;
    sourceId?: string;
  }) => void;
  onCancel: () => void;
}

export default function BuildForm({ onSubmit, onCancel }: BuildFormProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [pmNotes, setPmNotes] = useState('');
  const [transcriptContext, setTranscriptContext] = useState('');

  useEffect(() => {
    window.api.invoke('repo:list').then((r) => {
      const repoList = r as Repo[];
      setRepos(repoList);
      if (repoList.length === 1) setSelectedRepoId(repoList[0].id);
    });

    setLoadingIssues(true);
    window.api.invoke('linear:get-issues').then((i) => {
      setIssues(i as LinearIssue[]);
      setLoadingIssues(false);
    }).catch(() => setLoadingIssues(false));
  }, []);

  const handleIssueSelect = (issueId: string) => {
    setSelectedIssueId(issueId);
    const issue = issues.find(i => i.id === issueId);
    if (issue) {
      setTaskTitle(issue.title);
      setTaskDescription(issue.description || '');
    }
  };

  const handleSubmit = () => {
    if (!selectedRepoId || !taskTitle) return;
    onSubmit({
      repoId: selectedRepoId,
      taskTitle,
      taskDescription: taskDescription || undefined,
      pmNotes: pmNotes || undefined,
      transcriptContext: transcriptContext || undefined,
      source: selectedIssueId ? 'linear' : 'manual',
      sourceId: selectedIssueId || undefined,
    });
  };

  const labelClass = 'block text-xs font-medium text-text-muted mb-1.5';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg">
        <h2 className="text-xl font-semibold text-text-primary mb-1">New Build</h2>
        <p className="text-sm text-text-muted mb-6">Configure a build from a Linear issue.</p>

        {/* Linear Issue */}
        <div className="mb-5">
          <label className={labelClass}>Linear Issue</label>
          {loadingIssues ? (
            <div className="text-sm text-text-muted py-2">Loading issues...</div>
          ) : issues.length === 0 ? (
            <div className="text-sm text-text-muted py-2">No Linear issues found. Connect Linear in Settings.</div>
          ) : (
            <select
              value={selectedIssueId}
              onChange={(e) => handleIssueSelect(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none appearance-none"
            >
              <option value="">Select an issue...</option>
              {issues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  {issue.identifier}: {issue.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Target Repo */}
        <div className="mb-5">
          <label className={labelClass}>Target Repository</label>
          {repos.length === 0 ? (
            <div className="text-sm text-text-muted py-2">No repos configured. Add one in Settings.</div>
          ) : (
            <select
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none appearance-none"
            >
              <option value="">Select a repository...</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>{repo.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Task Title */}
        <div className="mb-5">
          <label className={labelClass}>Task Title</label>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="What should be built?"
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
          />
        </div>

        {/* Task Description */}
        <div className="mb-5">
          <label className={labelClass}>Description</label>
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="Detailed requirements..."
            rows={4}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* PM Notes */}
        <div className="mb-5">
          <label className={labelClass}>PM Notes (optional)</label>
          <textarea
            value={pmNotes}
            onChange={(e) => setPmNotes(e.target.value)}
            placeholder="Implementation hints, constraints, or preferences..."
            rows={3}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* Transcript Context */}
        <div className="mb-6">
          <label className={labelClass}>Transcript Context (optional)</label>
          <textarea
            value={transcriptContext}
            onChange={(e) => setTranscriptContext(e.target.value)}
            placeholder="Paste relevant customer quotes or transcript excerpts..."
            rows={3}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedRepoId || !taskTitle}
            className="text-sm font-semibold px-6 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Build
          </button>
        </div>
      </div>
    </div>
  );
}
