# Linear Kanban Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded kanban columns with Linear's real workflow states (ordered by type category), add issue relation overlays (blocked/blocking badges), and enrich the detail modal with relation data.

**Architecture:** The main process fetches workflow states and issue relations from Linear's SDK alongside issues. Columns are driven by `WorkflowState.type` categories (triage → backlog → unstarted → started → completed → canceled), not hardcoded status names. Issue relations (`blocks`/`blocked by`) are resolved per-issue and surfaced as card badges + column header counts. No local DB caching — all data is live from Linear.

**Tech Stack:** Electron, Linear SDK (`@linear/sdk`), React, TypeScript, Tailwind CSS

**Hackathon note:** No formal tests — manual verification per task. This is a 1-day project.

---

## File Structure

```
src/
├── main/
│   └── ipc/
│       └── linear.ts              # Modify: new IPC handlers for workflow states + relations, upgrade get-issues
├── renderer/
│   └── components/
│       └── TaskReview.tsx          # Modify: columns from workflow states, relation badges, filter toggle
├── main/
│   └── preload.ts                 # Modify: add new IPC channels
└── types.d.ts                     # Modify: extend LinearClient type declarations
```

---

### Task 1: Extend Linear SDK type declarations

**Files:**
- Modify: `src/types.d.ts`

- [ ] **Step 1: Add team, state, and relation types to the `@linear/sdk` declaration**

```ts
declare module '@linear/sdk' {
  export class LinearClient {
    constructor(options: { apiKey?: string; accessToken?: string });
    get viewer(): Promise<{ id: string; name: string; email: string }>;
    teams(): Promise<{ nodes: Array<{ id: string; name: string; key: string }> }>;
    team(id: string): Promise<any>;
    createIssue(input: {
      title: string;
      description?: string;
      teamId: string;
    }): Promise<{ issue: Promise<{ id: string; identifier: string; url: string } | undefined> }>;
  }
}
```

- [ ] **Step 2: Verify no TS errors**

Run: `npx tsc --noEmit 2>&1 | grep "^src/"`
Expected: No errors from src/ files

---

### Task 2: Add IPC handler to fetch team workflow states

**Files:**
- Modify: `src/main/ipc/linear.ts` (add `linear:get-states` handler)
- Modify: `src/main/preload.ts` (add channel)

- [ ] **Step 1: Add `linear:get-states` IPC handler**

Add this handler inside `registerLinearHandlers()` in `src/main/ipc/linear.ts`:

```ts
// Fetch workflow states for a team, ordered by type category
ipcMain.handle('linear:get-states', async (_e, { teamId }: { teamId?: string } = {}) => {
  const client = await getLinearClient();

  let team: any;
  if (teamId) {
    team = await client.team(teamId);
  } else {
    const teams = await client.teams();
    if (teams.nodes.length === 0) return [];
    team = teams.nodes[0];
  }

  const states = await team.states();
  const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

  return states.nodes
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      type: s.type,       // "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
      color: s.color,
      position: s.position,
    }))
    .sort((a: any, b: any) => {
      const typeA = TYPE_ORDER.indexOf(a.type);
      const typeB = TYPE_ORDER.indexOf(b.type);
      if (typeA !== typeB) return typeA - typeB;
      return a.position - b.position;
    });
});
```

- [ ] **Step 2: Add channel to preload.ts**

In `src/main/preload.ts`, add `'linear:get-states'` to the channels array, after `'linear:get-issues'`.

- [ ] **Step 3: Verify it compiles**

Run: `npm start`, check for TS errors in console.

---

### Task 3: Upgrade `linear:get-issues` to include relations

**Files:**
- Modify: `src/main/ipc/linear.ts` (update existing handler)

- [ ] **Step 1: Replace the `linear:get-issues` handler**

Replace the existing handler with one that also resolves `relations` and `inverseRelations` for each issue:

```ts
ipcMain.handle('linear:get-issues', async (_e, { teamId }: { teamId?: string } = {}) => {
  const client = await getLinearClient();

  let team: any;
  if (teamId) {
    team = await client.team(teamId);
  } else {
    const teams = await client.teams();
    if (teams.nodes.length === 0) return [];
    team = teams.nodes[0];
  }

  const issues = await team.issues({ first: 100, orderBy: 'updatedAt' });

  const results = [];
  for (const issue of issues.nodes) {
    const state = await issue.state;
    const assignee = await issue.assignee;

    // Resolve relations
    let blockedBy: { id: string; identifier: string; title: string }[] = [];
    let blocking: { id: string; identifier: string; title: string }[] = [];
    try {
      const inverseRels = await issue.inverseRelations();
      for (const rel of inverseRels.nodes) {
        if (rel.type === 'blocks') {
          const blocker = await rel.issue;
          blockedBy.push({ id: blocker.id, identifier: blocker.identifier, title: blocker.title });
        }
      }
      const rels = await issue.relations();
      for (const rel of rels.nodes) {
        if (rel.type === 'blocks') {
          const blocked = await rel.relatedIssue;
          blocking.push({ id: blocked.id, identifier: blocked.identifier, title: blocked.title });
        }
      }
    } catch {
      // Relations may not be available — continue without them
    }

    results.push({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      statusId: state?.id || '',
      status: state?.name || 'Unknown',
      statusType: state?.type || 'backlog',
      statusColor: state?.color || '#5E5B54',
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      assigneeName: assignee?.name || null,
      assigneeInitials: assignee?.name ? assignee.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : null,
      blockedBy,
      blocking,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    });
  }
  return results;
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npm start`, check for TS errors.

---

### Task 4: Rewrite TaskReview to use real workflow states for columns

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx`

- [ ] **Step 1: Update the `LinearIssue` interface**

```ts
interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  statusId: string;
  status: string;
  statusType: string;  // "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
  statusColor: string;
  priority: number;
  priorityLabel: string;
  assigneeName: string | null;
  assigneeInitials: string | null;
  blockedBy: { id: string; identifier: string; title: string }[];
  blocking: { id: string; identifier: string; title: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
}
```

- [ ] **Step 2: Fetch workflow states alongside issues in useEffect**

```ts
useEffect(() => {
  window.api.invoke('linear:status').then((status: any) => {
    setLinearConnected(status.connected);
    if (status.connected) {
      Promise.all([
        window.api.invoke('linear:get-states'),
        window.api.invoke('linear:get-issues'),
      ]).then(([states, issues]: any) => {
        setWorkflowStates(states);
        setLinearIssues(issues);
        setLoadingIssues(false);
      }).catch(() => setLoadingIssues(false));
    } else {
      setLoadingIssues(false);
    }
  });
}, []);
```

- [ ] **Step 3: Build columns from workflow states, not hardcoded list**

Remove the `DEFAULT_COLUMNS` constant and `sortStatuses` function. Replace column grouping logic:

```ts
// Columns = workflow states from Linear, already sorted by type+position from the backend
// Group issues by statusId, keyed to workflow states
const columns = workflowStates.map((state) => ({
  ...state,
  issues: linearIssues.filter((issue) => issue.status === state.name),
  blockedCount: linearIssues.filter((issue) => issue.status === state.name && issue.blockedBy.length > 0).length,
}));
```

- [ ] **Step 4: Update column headers to show blocked count**

```tsx
<div className="flex items-center gap-2 px-2 py-3 shrink-0">
  <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
    {col.name}
  </span>
  <span className="font-mono text-[11px] text-text-muted">{col.issues.length}</span>
  {col.blockedCount > 0 && (
    <span className="font-mono text-[10px] text-red-400 ml-auto">{col.blockedCount} blocked</span>
  )}
</div>
```

- [ ] **Step 5: Verify columns render from real Linear data**

Run: `npm start`, navigate to Tasks. Columns should match your Linear team's actual workflow states.

---

### Task 5: Add blocked/blocking badges to kanban cards

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx`

- [ ] **Step 1: Add badges to card rendering**

Inside the card `<button>`, after the assignee section, add:

```tsx
{/* Relation badges */}
{(issue.blockedBy.length > 0 || issue.blocking.length > 0) && (
  <div className="flex gap-1.5 mt-2 flex-wrap">
    {issue.blockedBy.length > 0 && (
      <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
        Blocked by {issue.blockedBy.length}
      </span>
    )}
    {issue.blocking.length > 0 && (
      <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
        Blocks {issue.blocking.length}
      </span>
    )}
  </div>
)}
```

- [ ] **Step 2: Add orange left border to blocked cards**

On the card `<button>`, add a conditional left border:

```tsx
style={{
  borderLeft: issue.blockedBy.length > 0 ? '3px solid #E5484D' : undefined,
}}
```

- [ ] **Step 3: Verify badges render on cards with relations**

Create a test blocking relationship in Linear, refresh the app, verify the badge appears.

---

### Task 6: Show relations in the detail modal

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx` (inside `IssueDetailModal`)

- [ ] **Step 1: Add a relations section between Meta and Description**

After the meta `<div>` and before the description `<div>`, add:

```tsx
{/* Relations */}
{(issue.blockedBy.length > 0 || issue.blocking.length > 0) && (
  <div className="px-6 py-4 border-b border-border-base">
    {issue.blockedBy.length > 0 && (
      <div className="mb-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-red-400 mb-2">Blocked by</div>
        {issue.blockedBy.map((blocker) => (
          <div key={blocker.id} className="flex items-center gap-2 py-1">
            <span className="font-mono text-[10px] text-text-muted">{blocker.identifier}</span>
            <span className="text-[12px] text-text-secondary">{blocker.title}</span>
          </div>
        ))}
      </div>
    )}
    {issue.blocking.length > 0 && (
      <div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-amber-400 mb-2">Blocks</div>
        {issue.blocking.map((blocked) => (
          <div key={blocked.id} className="flex items-center gap-2 py-1">
            <span className="font-mono text-[10px] text-text-muted">{blocked.identifier}</span>
            <span className="text-[12px] text-text-secondary">{blocked.title}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Verify modal shows relations**

Click a blocked issue card, verify the relations section appears in the modal.

---

### Task 7: Add "Show blocked only" filter toggle

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx`

- [ ] **Step 1: Add filter state**

```ts
const [showBlockedOnly, setShowBlockedOnly] = useState(false);
```

- [ ] **Step 2: Add toggle button in the header**

Next to the "Connected" indicator:

```tsx
<button
  onClick={() => setShowBlockedOnly(!showBlockedOnly)}
  className="font-mono text-[10px] px-3 py-1.5 rounded-full border transition-all"
  style={{
    borderColor: showBlockedOnly ? '#E5484D' : '#3A3A44',
    color: showBlockedOnly ? '#E5484D' : '#5E5B54',
    background: showBlockedOnly ? 'rgba(229,72,77,0.1)' : 'transparent',
  }}
>
  {showBlockedOnly ? 'Showing blocked' : 'Show blocked'}
</button>
```

- [ ] **Step 3: Apply filter to column issues**

When building columns, filter if toggle is active:

```ts
const columns = workflowStates.map((state) => {
  const allIssues = linearIssues.filter((issue) => issue.status === state.name);
  const filteredIssues = showBlockedOnly ? allIssues.filter((i) => i.blockedBy.length > 0) : allIssues;
  return {
    ...state,
    issues: filteredIssues,
    totalCount: allIssues.length,
    blockedCount: allIssues.filter((i) => i.blockedBy.length > 0).length,
  };
});
```

- [ ] **Step 4: Verify filter works**

Toggle the filter on, verify only blocked cards remain visible.

---

### Task 8: Clean up dead code

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx`

- [ ] **Step 1: Remove unused code**

- Remove `PriorityIconStandalone` function
- Remove `STATUS_ORDER` constant and `sortStatuses` function (if not already removed in Task 4)
- Remove `DEFAULT_COLUMNS` constant (if not already removed in Task 4)

- [ ] **Step 2: Verify everything still works**

Run: `npm start`, test the full flow: columns render, cards show badges, modal shows relations, filter toggles.

---

## Summary of IPC channel changes

| Channel | Action | Purpose |
|---------|--------|---------|
| `linear:get-states` | **New** | Fetch team workflow states sorted by type+position |
| `linear:get-issues` | **Modified** | Now includes `statusType`, `blockedBy[]`, `blocking[]` per issue |

## No DB schema changes needed

All data comes live from Linear API. No local caching for workflow states or relations — they change frequently and must be fresh for standup use.
