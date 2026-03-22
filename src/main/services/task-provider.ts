/**
 * TaskProvider — platform-agnostic interface for task/issue management.
 *
 * The agent's tools call these methods. The active implementation
 * (Linear, Jira, etc.) is determined by which platform the user
 * connected in Settings.
 */

export interface TaskItem {
  id: string;
  identifier: string;       // e.g. "CRA-3", "PROJ-42"
  title: string;
  description: string;
  status: string;            // e.g. "Todo", "In Progress", "Done"
  priority: number | null;
  priorityLabel: string | null;
  assignee: { name: string; email?: string } | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  teamId?: string;
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  status?: string;
}

export interface CreatedTask {
  id: string;
  identifier: string;
  url: string;
}

export interface TaskProvider {
  readonly name: string;     // "linear", "jira", etc.

  list(filters?: { status?: string; limit?: number }): Promise<TaskItem[]>;
  get(taskId: string): Promise<TaskItem | null>;
  create(input: CreateTaskInput): Promise<CreatedTask>;
  update(input: UpdateTaskInput): Promise<{ id: string }>;
  delete(taskId: string): Promise<{ id: string }>;
}
